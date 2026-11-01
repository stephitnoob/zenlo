/*
  Zenlo – runs the current summary prompt ("A") and the proposed one ("B", v2.mjs) on the fake chats
  with the real Gemini API, and checks every citation against the real message times.

  node test/summary-eval/run.mjs --out <folder> [--models a,b] [--reps 3]
    [--chats A,B] [--variants A,B] [--effort high] [--length medium] [--dry]

  --dry writes the prompts only. The request is built exactly as Zenlo's main process builds it.
  Answers, token counts and citation checks go to <folder>; the grading of facts is done apart.
*/

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCore } from './load-core.mjs'
import { CHATS, MY_UID, MY_NAME } from './chats.mjs'
import * as V2 from './v2.mjs'
import * as V3 from './v3.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((list, arg, i, all) => {
  if (arg.startsWith('--')) list.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return list
}, []))
const OUT = args.out
if (!OUT) throw new Error('--out <folder> is required')
const MODELS = String(args.models || 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',')
const REPS = Number(args.reps || 3)
const CHAT_IDS = String(args.chats || 'A,B').split(',')
const VARIANTS = String(args.variants || 'A,B').split(',')
const EFFORT = args.effort || 'high'
const LENGTH = args.length || 'medium'
// Keys: GEMINI_API_KEY, then one per line in --key-file (default: .env.gemini at the repository root,
// which git ignores). A key out of its daily quota for a model is skipped for that model.
const keyFile = args['key-file'] || fileURLToPath(new URL('../../.env.gemini', import.meta.url))
const KEYS = [process.env.GEMINI_API_KEY, ...(fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').split('\n') : [])]
  .map((k) => (k || '').trim()).filter((k) => k && !k.startsWith('#'))
const outOfQuota = new Set()

const Z = loadCore()
fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true })

// ---------- The two requests ----------

function buildRequest (chatId, variant) {
  const chat = CHATS[chatId]
  const v2 = V2.buildTranscriptV2(Z, chat.messages, { myUid: MY_UID, myName: MY_NAME, now: chat.now })
  if (variant === 'A') {
    const { lines, count } = Z.buildTranscript(chat.messages, { myUid: MY_UID })
    return {
      minutes: v2.minutes,
      systemPrompt: Z.buildSystemPrompt({ systemPrompt: Z.SUMMARY_PROMPT, length: LENGTH, now: chat.now, myName: MY_NAME }),
      input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
      instruction: Z.buildSummaryInstruction({ convName: chat.convName, from: chat.from, to: chat.to, count })
    }
  }
  if (variant === 'E') {
    // v3: every decision of 1/11 (v3.mjs); no length chosen, so the AI decides
    const v3 = V3.transcriptV3(Z, chat.messages, { myUid: MY_UID, myName: MY_NAME, now: chat.now })
    return {
      minutes: v3.minutes,
      clean: true,
      systemPrompt: V3.buildSystemPromptV3({ now: chat.now, myName: MY_NAME }),
      input: `<transcript>\n${v3.lines.join('\n')}\n</transcript>`,
      instruction: V3.buildSummaryInstructionV3({ Z, convName: chat.convName, from: chat.from, to: chat.to, count: v3.count })
    }
  }
  if (variant === 'C') {
    // v2 split into parts of --chunk characters, then the parts' notes merged with <lien-quan>
    const chunks = V2.splitWithDays(v2.lines, Number(args.chunk || 15000))
    return {
      minutes: v2.minutes,
      systemPrompt: V2.buildSystemPromptV2({ now: chat.now, myName: MY_NAME }),
      parts: chunks.map((lines, i) => ({
        input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
        instruction: V2.buildPartInstructionV2({ convName: chat.convName, part: i + 1, parts: chunks.length })
      })),
      final: (notes) => ({
        input: V2.buildInputV2({ related: v2.related, notes }),
        instruction: V2.buildSummaryInstructionV2({ Z, convName: chat.convName, from: chat.from, to: chat.to, count: v2.count, notes: true, length: LENGTH })
      }),
      input: `(${chunks.length} phần)`,
      instruction: ''
    }
  }
  return {
    minutes: v2.minutes,
    // D: v2.1, the same with the prompt tuned after round 1
    systemPrompt: V2.buildSystemPromptV2({ now: chat.now, myName: MY_NAME, prompt: variant === 'D' ? V2.SUMMARY_PROMPT_V21 : V2.SUMMARY_PROMPT_V2 }),
    input: V2.buildInputV2({ lines: v2.lines, related: v2.related }),
    instruction: V2.buildSummaryInstructionV2({ Z, convName: chat.convName, from: chat.from, to: chat.to, count: v2.count, length: LENGTH })
  }
}

// ---------- Gemini ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function callGemini (model, request) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: `${request.input}\n\n${request.instruction}` }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: EFFORT } }
  })
  let lastError = ''
  for (let attempt = 1; attempt <= 8; attempt++) {
    const key = KEYS.find((k) => !outOfQuota.has(`${k} ${model}`))
    if (!key) return { error: `every key is out of its daily quota for ${model}` }
    const started = Date.now()
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(240000)
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
        if (text) return { text, usage: data.usageMetadata || {}, ms: Date.now() - started, attempts: attempt }
        lastError = 'empty answer'
      } else {
        lastError = `${response.status} ${(data.error && data.error.message) || ''}`.slice(0, 200)
        if (![429, 500, 503].includes(response.status)) break
        if (response.status === 429 && /PerDay|per day/i.test(JSON.stringify(data))) {
          // That key is done for today with this model: the next key, at once
          outOfQuota.add(`${key} ${model}`)
          console.log(`    ${model}: key ${KEYS.indexOf(key) + 1}/${KEYS.length} out of daily quota`)
          attempt--
          continue
        }
      }
    } catch (error) {
      lastError = error.message
    }
    console.log(`    ${model} attempt ${attempt}: ${lastError}`)
    await sleep(Math.min(60000, 4000 * 2 ** (attempt - 1)))
  }
  return { error: lastError }
}

// ---------- Run ----------

const jobs = []
for (const chatId of CHAT_IDS) {
  for (const variant of VARIANTS) {
    const request = buildRequest(chatId, variant)
    fs.writeFileSync(path.join(OUT, 'prompts', `${chatId}-${variant}.txt`),
      `=== SYSTEM ===\n${request.systemPrompt}\n\n=== USER ===\n${request.input}\n\n${request.instruction}\n`)
    for (const model of MODELS) {
      for (let rep = 1; rep <= REPS; rep++) jobs.push({ chatId, variant, model, rep, request })
    }
  }
}
if (args.dry) {
  console.log(`prompts written to ${path.join(OUT, 'prompts')}`)
  process.exit(0)
}
if (!KEYS.length) throw new Error('No key: set GEMINI_API_KEY, or put keys in .env.gemini or --key-file')

// Spread the variants, so a busy spell of the server does not hit one variant only
jobs.sort((a, b) => a.rep - b.rep || a.model.localeCompare(b.model) || a.chatId.localeCompare(b.chatId) || a.variant.localeCompare(b.variant))

let next = 0
async function worker () {
  while (next < jobs.length) {
    const job = jobs[next++]
    const name = `${job.chatId}-${job.variant}-${job.model}-r${job.rep}`
    const file = path.join(OUT, `${name}.json`)
    if (fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, 'utf8')).error) continue
    console.log(`  ${name}…`)
    let result
    if (job.request.parts) {
      // The parts one after another, then the merge; tokens and time added up
      const total = { promptTokenCount: 0, thoughtsTokenCount: 0, candidatesTokenCount: 0 }
      let ms = 0
      const notes = []
      for (const [i, part] of job.request.parts.entries()) {
        const r = await callGemini(job.model, { ...job.request, ...part })
        if (r.error) { result = r; break }
        notes.push(`### Phần ${i + 1}\n${r.text}`)
        for (const k of Object.keys(total)) total[k] += r.usage[k] || 0
        ms += r.ms
      }
      if (!result) {
        const r = await callGemini(job.model, { ...job.request, ...job.request.final(notes.join('\n\n')) })
        if (r.error) result = r
        else {
          for (const k of Object.keys(total)) total[k] += r.usage[k] || 0
          result = { text: r.text, usage: total, ms: ms + r.ms, notes }
        }
      }
    } else {
      result = await callGemini(job.model, job.request)
    }
    const chat = CHATS[job.chatId]
    const day = chat.from && new Date(chat.from).toDateString() === new Date(chat.to).toDateString()
      ? `${String(new Date(chat.from).getDate()).padStart(2, '0')}/${String(new Date(chat.from).getMonth() + 1).padStart(2, '0')}`
      : null
    // v3 (E) cleans the answer in code, as Zenlo would show it; the raw answer is kept
    if (result.text && job.request.clean) {
      result.raw = result.text
      result.text = V3.cleanAnswer(result.text, job.request.minutes)
    }
    const cites = result.text ? V2.checkCitations(result.text, job.request.minutes, day) : null
    fs.writeFileSync(file, JSON.stringify({ ...job, request: undefined, ...result, cites }, null, 2))
    console.log(`  ${name}: ${result.error ? 'ERROR ' + result.error : `${Math.round(result.ms / 1000)} s, in ${result.usage.promptTokenCount}, think ${result.usage.thoughtsTokenCount || 0}, out ${result.usage.candidatesTokenCount}`}`)
  }
}
await Promise.all([worker(), worker()])
console.log('done')
