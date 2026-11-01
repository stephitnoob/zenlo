/*
  Zenlo – the digest ("Bản tin") before and after, on the real Gemini API. Keys as in run.mjs.
  - old: as Zenlo shipped it (core.js from git HEAD): one request per conversation, the summary
    panel's prompt, length "Ngắn"
  - v3: several conversations in one request (v3.mjs DIGEST_PROMPT_V3), a time per message

  node test/summary-eval/digest-run.mjs --out <folder> [--variants old,v3] [--models a,b] [--reps 2]

  Writes each run's text per conversation and the citation check, and judge-digest.md for grading.
*/

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
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
const MODELS = String(args.models || 'gemini-3.5-flash-lite,gemini-3.6-flash').split(',')
const VARIANTS = String(args.variants || 'old,v3').split(',')
const REPS = Number(args.reps || 2)
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const keyFile = args['key-file'] || path.join(ROOT, '.env.gemini')
const KEYS = fs.readFileSync(keyFile, 'utf8').split('\n').map((k) => k.trim()).filter((k) => k && !k.startsWith('#'))
const NOW = new Date(2026, 9, 30, 23, 0).getTime()

const Z = loadCore()
const OLD = loadCore(execSync('git show HEAD:src/renderer/core.js', { cwd: ROOT, encoding: 'utf8' }))
fs.mkdirSync(OUT, { recursive: true })

// Two small conversations next to chats A and B: a direct chat that concerns the user, and a group
// where nothing does
function small (name, isGroup, script) {
  const messages = script.map(([at, who, text], i) => {
    const [h, m] = at.split(':').map(Number)
    return {
      msgId: `${name}-${i}`,
      sendDttm: String(new Date(2026, 9, 30, h, m).getTime()),
      fromUid: who === 'Tôi' ? '0' : '2000',
      dName: who === 'Tôi' ? MY_NAME : who,
      msgType: 1,
      originMsgType: 'webchat',
      message: text
    }
  })
  return { convName: name, isGroup, messages, from: Number(messages[0].sendDttm), to: Number(messages[messages.length - 1].sendDttm) }
}

const conversations = [
  CHATS.A,
  small('Mẹ', false, [
    ['17:05', 'Mẹ', 'Tối nay về sớm ăn cơm nhé con, có bác Tư sang chơi'],
    ['17:06', 'Mẹ', 'Tiện đường mua giúp mẹ 2 hộp sữa tươi không đường'],
    ['18:40', 'Mẹ', 'Con đến đâu rồi?']
  ]),
  CHATS.B,
  small('CLB Nhiếp ảnh Hà Nội', true, [
    ['09:00', 'Admin Tuấn Anh', 'Thứ 7 này CLB đi chụp phố cổ, ai đăng ký thì comment nhé'],
    ['09:12', 'Hồng Nhung', 'em đăng ký ạ'],
    ['09:30', 'Văn Minh', 'cho mình 1 suất'],
    ['10:15', 'Admin Tuấn Anh', 'đã đủ 20 người, chốt danh sách nhé'],
    ['14:00', 'Lê Hoa', 'ảnh hôm trước đẹp quá mọi người ơi'],
    ['14:05', 'Văn Minh', 'chuẩn']
  ])
]
const minutesOf = conversations.map((c) => V3.transcriptV3(Z, c.messages, { myUid: MY_UID, myName: MY_NAME, now: NOW }).minutes)
const srcMinutes = conversations.map((c) => Z.buildTranscript(c.messages, { myUid: MY_UID, now: NOW }).minutes)

// ---------- Requests ----------

// old: one request per conversation, exactly as HEAD's digest built it (length "short")
function oldRequests () {
  return conversations.map((c) => {
    const { lines, count } = OLD.buildTranscript(c.messages, { myUid: MY_UID })
    return {
      systemPrompt: OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'short', now: NOW, myName: MY_NAME }),
      input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
      instruction: OLD.buildSummaryInstruction({ convName: c.convName, isGroup: c.isGroup, from: c.from, to: c.to, count, kind: 'unread' })
    }
  })
}

// v3: one request for all four
function v3Request () {
  const entries = conversations.map((c) => {
    const { lines, count } = V3.transcriptV3(Z, c.messages, { myUid: MY_UID, myName: MY_NAME, now: NOW })
    return { name: c.convName, isGroup: c.isGroup, from: c.from, to: c.to, count, lines }
  })
  return {
    systemPrompt: V3.buildSystemPromptV3({ now: NOW, myName: MY_NAME, prompt: V3.DIGEST_PROMPT_V3 }),
    input: Z.buildDigestInput(entries),
    instruction: Z.buildDigestInstruction({ count: entries.length, notes: entries.map(() => '') })
  }
}

// src: exactly what Zenlo now sends (src/renderer/core.js)
function srcRequest () {
  const entries = conversations.map((c) => {
    const { lines, count } = Z.buildTranscript(c.messages, { myUid: MY_UID, now: NOW })
    return { name: c.convName, isGroup: c.isGroup, from: c.from, to: c.to, count, lines }
  })
  return {
    systemPrompt: Z.buildSystemPrompt({ systemPrompt: Z.DIGEST_PROMPT, now: NOW, myName: MY_NAME }),
    input: Z.buildDigestInput(entries),
    instruction: Z.buildDigestInstruction({ count: entries.length, notes: entries.map(() => '') })
  }
}

const show = (r) => `=== SYSTEM ===\n${r.systemPrompt}\n\n=== USER ===\n${r.input}\n\n${r.instruction}\n`
fs.writeFileSync(path.join(OUT, 'prompt-old-conv1.txt'), show(oldRequests()[0]))
fs.writeFileSync(path.join(OUT, 'prompt-v3.txt'), show(v3Request()))
fs.writeFileSync(path.join(OUT, 'prompt-src.txt'), show(srcRequest()))
if (args.dry) process.exit(0)

// ---------- Gemini ----------

const outOfQuota = new Set()
async function call (model, request) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: `${request.input}\n\n${request.instruction}` }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: 'high' } }
  })
  for (let attempt = 1; attempt <= 6; attempt++) {
    const key = KEYS.find((k) => !outOfQuota.has(`${k} ${model}`))
    if (!key) return { error: 'every key is out of quota' }
    const started = Date.now()
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(240000)
    }).catch((error) => ({ ok: false, status: 0, json: async () => ({ error: { message: error.message } }) }))
    const data = await response.json().catch(() => ({}))
    if (response.ok) {
      const parts = data.candidates?.[0]?.content?.parts || []
      const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
      if (text) return { text, usage: data.usageMetadata, ms: Date.now() - started }
    } else if (response.status === 429 && /PerDay|per day/i.test(JSON.stringify(data))) {
      outOfQuota.add(`${key} ${model}`)
      attempt--
      continue
    } else if (![0, 429, 500, 503].includes(response.status)) {
      return { error: `${response.status} ${data.error?.message || ''}` }
    }
    console.log(`  ${model} attempt ${attempt}: ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 4000 * 2 ** (attempt - 1)))
  }
  return { error: 'gave up' }
}

const sum = (a, b) => {
  for (const k of ['promptTokenCount', 'thoughtsTokenCount', 'candidatesTokenCount']) a[k] = (a[k] || 0) + (b[k] || 0)
  return a
}

for (const variant of VARIANTS) {
  for (const model of MODELS) {
    for (let rep = 1; rep <= REPS; rep++) {
      const name = `digest-${variant}-${model}-r${rep}`
      const file = path.join(OUT, `${name}.json`)
      if (fs.existsSync(file)) continue
      let sections = {}
      const usage = {}
      let ms = 0
      let requests = 0
      let failed = ''
      if (variant === 'old') {
        // The old digest ran two conversations at a time
        const results = await Promise.all(oldRequests().map((r) => call(model, r)))
        results.forEach((r, i) => {
          if (r.error) failed = r.error
          else sections[i + 1] = r.text.trim()
          sum(usage, r.usage || {})
          ms = Math.max(ms, r.ms || 0)
        })
        requests = results.length
      } else {
        const r = await call(model, variant === 'src' ? srcRequest() : v3Request())
        if (r.error) failed = r.error
        else {
          sections = Z.splitDigest(r.text)
          for (const n of Object.keys(sections)) sections[n] = variant === 'src' ? Z.cleanAnswer(sections[n], srcMinutes[n - 1]) : V3.cleanAnswer(sections[n], minutesOf[n - 1] || new Set())
          sum(usage, r.usage)
          ms = r.ms
        }
        requests = 1
      }
      if (failed) {
        console.log(`${name}: ERROR ${failed}`)
        continue
      }
      const checks = conversations.map((c, i) => (sections[i + 1] === undefined ? 'missing' : V2.checkCitations(sections[i + 1], minutesOf[i], '30/10')))
      fs.writeFileSync(file, JSON.stringify({ variant, model, rep, requests, usage, ms, sections, checks }, null, 2))
      console.log(`${name}: ${requests} request(s), ${Math.round(ms / 1000)} s, in ${usage.promptTokenCount}, think ${usage.thoughtsTokenCount}, out ${usage.candidatesTokenCount}`)
    }
  }
}

// ---------- Blind grading pack ----------

const runs = fs.readdirSync(OUT).filter((f) => /^digest-(old|v3|src)-.+\.json$/.test(f)).sort(() => Math.random() - 0.5)
const key = {}
let md = '# Bản tin cần chấm\n\nBốn hội thoại: 1 = nhóm lớp 12A5, 2 = chat riêng với Mẹ, 3 = nhóm KHKT, 4 = CLB Nhiếp ảnh. Bây giờ: 30/10/2026 23:00.\n'
runs.forEach((f, i) => {
  const label = `D${i + 1}`
  key[label] = f
  const run = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
  md += `\n## ${label}\n`
  for (let n = 1; n <= 4; n++) md += `\n### Hội thoại ${n}\n\n${run.sections[n] || '(trống)'}\n`
})
fs.writeFileSync(path.join(OUT, 'judge-digest.md'), md)
fs.writeFileSync(path.join(OUT, 'judge-digest-key.json'), JSON.stringify(key, null, 2))
console.log(`packed ${runs.length} digests`)
