/*
  Zenlo – the old prompts (before v3, OLD_COMMIT) and the current ones (src) on Claude Code and Codex,
  each called the way Zenlo's main process calls it (the user's Claude Pro/Max or ChatGPT plan).

  node test/summary-eval/cli-run.mjs --out <folder> [--providers claude,codex] [--what summary,digest]
    [--reps 2] [--dry]

  Summary: chats A and B, "A" = old (length Vừa, the old default), "E" = current (no length).
  Digest: the four conversations of DIGEST_CONVERSATIONS, "old" = one request per conversation with
  length Ngắn, "src" = one request for all four.
  Files are named as run.mjs and digest-run.mjs name theirs, so grade.mjs reads the summaries.
*/

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadCore } from './load-core.mjs'
import { CHATS, MY_UID, MY_NAME, DIGEST_CONVERSATIONS, DIGEST_NOW, OLD_COMMIT, longChat } from './chats.mjs'
import * as V2 from './v2.mjs'
import { call, modelOf } from './providers.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((list, arg, i, all) => {
  if (arg.startsWith('--')) list.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return list
}, []))
const OUT = args.out
if (!OUT) throw new Error('--out <folder> is required')
const PROVIDERS = String(args.providers || 'claude,codex').split(',')
const WHAT = String(args.what || 'summary,digest').split(',')
const REPS = Number(args.reps || 2)
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const Z = loadCore()
const OLD = loadCore(execSync(`git show ${OLD_COMMIT}:src/renderer/core.js`, { cwd: ROOT, encoding: 'utf8' }))
fs.mkdirSync(OUT, { recursive: true })

// "dd/mm hh:mm" of every message, as checkCitations wants them
const minuteKeys = (messages, now) => Z.buildTranscript(messages, { myUid: MY_UID, now }).minutes

// ---------- Requests, built as each version of Zenlo builds them ----------

function summaryRequest (chat, variant) {
  if (variant === 'A') {
    const { lines, count } = OLD.buildTranscript(chat.messages, { myUid: MY_UID })
    return {
      systemPrompt: OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'medium', now: chat.now, myName: MY_NAME }),
      input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
      instruction: OLD.buildSummaryInstruction({ convName: chat.convName, isGroup: chat.isGroup, from: chat.from, to: chat.to, count })
    }
  }
  const { lines, count } = Z.buildTranscript(chat.messages, { myUid: MY_UID, now: chat.now })
  return {
    systemPrompt: Z.buildSystemPrompt({ systemPrompt: Z.SUMMARY_PROMPT, now: chat.now, myName: MY_NAME }),
    input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
    instruction: Z.buildSummaryInstruction({ convName: chat.convName, isGroup: chat.isGroup, from: chat.from, to: chat.to, count })
  }
}

function digestOldRequests () {
  return DIGEST_CONVERSATIONS.map((c) => {
    const { lines, count } = OLD.buildTranscript(c.messages, { myUid: MY_UID })
    return {
      systemPrompt: OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'short', now: DIGEST_NOW, myName: MY_NAME }),
      input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
      instruction: OLD.buildSummaryInstruction({ convName: c.convName, isGroup: c.isGroup, from: c.from, to: c.to, count, kind: 'unread' })
    }
  })
}

function digestSrcRequest () {
  const entries = DIGEST_CONVERSATIONS.map((c) => {
    const { lines, count } = Z.buildTranscript(c.messages, { myUid: MY_UID, now: DIGEST_NOW })
    return { name: c.convName, isGroup: c.isGroup, from: c.from, to: c.to, count, lines }
  })
  return {
    systemPrompt: Z.buildSystemPrompt({ systemPrompt: Z.DIGEST_PROMPT, now: DIGEST_NOW, myName: MY_NAME }),
    input: Z.buildDigestInput(entries),
    instruction: Z.buildDigestInstruction({ count: entries.length, notes: entries.map(() => '') })
  }
}

// ---------- Jobs ----------

const show = (r) => `=== SYSTEM ===\n${r.systemPrompt}\n\n=== USER ===\n${r.input}\n\n${r.instruction}\n`
fs.writeFileSync(path.join(OUT, 'prompt-summary-A-old.txt'), show(summaryRequest(CHATS.A, 'A')))
fs.writeFileSync(path.join(OUT, 'prompt-summary-A-new.txt'), show(summaryRequest(CHATS.A, 'E')))
fs.writeFileSync(path.join(OUT, 'prompt-digest-src.txt'), show(digestSrcRequest()))
if (args.dry) process.exit(0)

const sum = (a, b) => {
  for (const k of ['promptTokenCount', 'thoughtsTokenCount', 'candidatesTokenCount']) a[k] = (a[k] || 0) + (b[k] || 0)
  return a
}

// A chat within one day: a citation without a date means that day, as Zenlo reads it
function singleDay (chat) {
  const from = new Date(chat.from)
  if (from.toDateString() !== new Date(chat.to).toDateString()) return null
  return `${String(from.getDate()).padStart(2, '0')}/${String(from.getMonth() + 1).padStart(2, '0')}`
}

// --rescore: recount the citations of the answers already written, without calling any AI
if (args.rescore) {
  for (const f of fs.readdirSync(OUT).filter((f) => /^[AB]-[AE]-.+\.json$/.test(f))) {
    const r = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
    const chat = CHATS[r.chatId]
    r.cites = V2.checkCitations(r.text, new Set(minuteKeys(chat.messages, chat.now).keys()), singleDay(chat))
    fs.writeFileSync(path.join(OUT, f), JSON.stringify(r, null, 2))
  }
  process.exit(0)
}

async function summaryJob (provider, chatId, variant, rep) {
  const file = path.join(OUT, `${chatId}-${variant}-${modelOf(provider)}-r${rep}.json`)
  if (fs.existsSync(file)) return
  const chat = CHATS[chatId]
  const minutes = minuteKeys(chat.messages, chat.now)
  const r = await call(provider, summaryRequest(chat, variant))
  if (r.error) return console.log(`${path.basename(file)}: ERROR ${r.error}`)
  // The current Zenlo cleans the answer before showing it; the raw answer is kept
  const text = variant === 'E' ? Z.cleanAnswer(r.text, minutes) : r.text
  const cites = V2.checkCitations(text, new Set(minutes.keys()), singleDay(chat))
  fs.writeFileSync(file, JSON.stringify({ chatId, variant, model: modelOf(provider), rep, text, raw: r.text, usage: r.usage, ms: r.ms, cites }, null, 2))
  console.log(`${path.basename(file)}: ${Math.round(r.ms / 1000)} s, in ${r.usage.promptTokenCount}, out ${r.usage.candidatesTokenCount}`)
}

async function digestJob (provider, variant, rep) {
  const file = path.join(OUT, `digest-${variant}-${modelOf(provider)}-r${rep}.json`)
  if (fs.existsSync(file)) return
  const minutes = DIGEST_CONVERSATIONS.map((c) => minuteKeys(c.messages, DIGEST_NOW))
  let sections = {}
  const usage = {}
  let ms = 0
  let requests
  if (variant === 'old') {
    // The old digest ran two conversations at a time on Claude and Codex alike
    const requestsList = digestOldRequests()
    const results = []
    for (let i = 0; i < requestsList.length; i += 2) results.push(...await Promise.all(requestsList.slice(i, i + 2).map((r) => call(provider, r))))
    const failed = results.find((r) => r.error)
    if (failed) return console.log(`${path.basename(file)}: ERROR ${failed.error}`)
    results.forEach((r, i) => { sections[i + 1] = r.text.trim(); sum(usage, r.usage); ms += r.ms })
    requests = results.length
  } else {
    const r = await call(provider, digestSrcRequest())
    if (r.error) return console.log(`${path.basename(file)}: ERROR ${r.error}`)
    sections = Z.splitDigest(r.text)
    for (const n of Object.keys(sections)) sections[n] = Z.cleanAnswer(sections[n], minutes[n - 1])
    sum(usage, r.usage)
    ms = r.ms
    requests = 1
  }
  const checks = DIGEST_CONVERSATIONS.map((c, i) => (sections[i + 1] === undefined ? 'missing' : V2.checkCitations(sections[i + 1], new Set(minutes[i].keys()), '30/10')))
  fs.writeFileSync(file, JSON.stringify({ variant, model: modelOf(provider), rep, requests, usage, ms, sections, checks }, null, 2))
  console.log(`${path.basename(file)}: ${requests} request(s), ${Math.round(ms / 1000)} s, in ${usage.promptTokenCount}, out ${usage.candidatesTokenCount}`)
}

// Long chat (D): the parts at the same time, then one summary from their notes, as summary.js does it
let LONG = null
async function longJob (provider, variant, rep) {
  const file = path.join(OUT, `D-${variant}-${modelOf(provider)}-r${rep}.json`)
  if (fs.existsSync(file)) return
  LONG ||= longChat()
  const chat = LONG
  const C = variant === 'A' ? OLD : Z
  const minutes = minuteKeys(chat.messages, chat.now)
  const { lines, count } = variant === 'A' ? OLD.buildTranscript(chat.messages, { myUid: MY_UID }) : Z.buildTranscript(chat.messages, { myUid: MY_UID, now: chat.now })
  const systemPrompt = variant === 'A'
    ? OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'medium', now: chat.now, myName: MY_NAME })
    : Z.buildSystemPrompt({ systemPrompt: Z.SUMMARY_PROMPT, now: chat.now, myName: MY_NAME })
  const chunks = C.splitIntoChunks(lines)
  const notes = []
  const usage = {}
  let ms = 0
  let failed = ''
  let next = 0
  const worker = async () => {
    while (next < chunks.length && !failed) {
      const i = next++
      const r = await call(provider, {
        systemPrompt,
        input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`,
        instruction: C.buildPartInstruction({ convName: chat.convName, part: i + 1, parts: chunks.length })
      })
      if (r.error) { failed = r.error; return }
      notes[i] = `### Phần ${i + 1}\n` + r.text
      sum(usage, r.usage)
      ms = Math.max(ms, r.ms)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Z.PARALLEL[provider] || 2, chunks.length) }, worker))
  if (failed) return console.log(`${path.basename(file)}: ERROR ${failed}`)
  const r = await call(provider, {
    systemPrompt,
    input: `<notes>\n${notes.join('\n\n')}\n</notes>`,
    instruction: C.buildSummaryInstruction({ convName: chat.convName, isGroup: true, from: chat.from, to: chat.to, count, notes: true })
  })
  if (r.error) return console.log(`${path.basename(file)}: ERROR ${r.error}`)
  sum(usage, r.usage)
  ms += r.ms
  const text = variant === 'E' ? Z.cleanAnswer(r.text, minutes) : r.text
  const cites = V2.checkCitations(text, new Set(minutes.keys()), singleDay(chat))
  fs.writeFileSync(file, JSON.stringify({ chatId: 'D', variant, model: modelOf(provider), rep, requests: chunks.length + 1, text, raw: r.text, notes, usage, ms, cites }, null, 2))
  console.log(`${path.basename(file)}: ${chunks.length} parts + 1, ${Math.round(ms / 1000)} s, in ${usage.promptTokenCount}, out ${usage.candidatesTokenCount}`)
}

// One job at a time per provider, the providers side by side
await Promise.all(PROVIDERS.map(async (provider) => {
  for (let rep = 1; rep <= REPS; rep++) {
    if (WHAT.includes('long')) for (const variant of ['A', 'E']) await longJob(provider, variant, rep)
    if (WHAT.includes('summary')) for (const chatId of ['A', 'B']) for (const variant of ['A', 'E']) await summaryJob(provider, chatId, variant, rep)
    if (WHAT.includes('digest')) for (const variant of ['old', 'src']) await digestJob(provider, variant, rep)
  }
}))
console.log('done')
