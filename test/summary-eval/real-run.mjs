/*
  Zenlo – the old prompts (OLD_COMMIT) and the current ones on real conversations exported from Zalo.

  node test/summary-eval/real-run.mjs --data <data.json> --out <folder> [--providers claude,gemini-3.6-flash]

  data.json: { now, myUid, myName, summary: [conv], digest: [conv] }, each conv
  { convName, isGroup, from, to, messages (Zalo's own), reactions: [[msgId, people]], lines (what Zenlo
  built in Zalo, to check the rebuild here), unread }. It holds private messages: keep it out of git.
  Writes each answer with its citation check, and judge-<n>.md / judge-digest.md for blind grading.
*/

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadCore } from './load-core.mjs'
import { OLD_COMMIT } from './chats.mjs'
import * as V2 from './v2.mjs'
import { call, modelOf } from './providers.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((list, arg, i, all) => {
  if (arg.startsWith('--')) list.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return list
}, []))
if (!args.data || !args.out) throw new Error('--data <file> and --out <folder> are required')
const OUT = args.out
const PROVIDERS = String(args.providers || 'claude,gemini-3.6-flash,gemini-3.5-flash-lite').split(',')
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DATA = JSON.parse(fs.readFileSync(args.data, 'utf8'))
const { now, myUid, myName } = DATA

const Z = loadCore()
// --old <commit>: the version to compare against (default: the prompts from before v3)
const OLD = loadCore(execSync(`git show ${args.old || OLD_COMMIT}:src/renderer/core.js`, { cwd: ROOT, encoding: 'utf8' }))
fs.mkdirSync(OUT, { recursive: true })

const pad = (n) => String(n).padStart(2, '0')
const transcriptOf = (C, conv, withNow) => C.buildTranscript(conv.messages, { myUid, reactions: new Map(conv.reactions), ...(withNow ? { now } : {}) })

// The rebuild here must match what Zenlo built inside Zalo
for (const conv of [...DATA.summary, ...DATA.digest]) {
  const lines = transcriptOf(Z, conv, true).lines
  if (lines.join('\n') !== conv.lines.join('\n')) console.log(`warning: "${conv.convName}" rebuilds differently (${lines.length} vs ${conv.lines.length} lines)`)
}

function singleDay (conv) {
  const from = new Date(conv.from)
  if (from.toDateString() !== new Date(conv.to).toDateString()) return null
  return `${pad(from.getDate())}/${pad(from.getMonth() + 1)}`
}

// ---------- Requests ----------

// "old" before v3 is built the old way (length Vừa, one request per digest conversation); an --old
// commit from v3 on is built as the current code builds it
const LEGACY = !args.old

// A summary as each version builds it: the parts first when the conversation is too long
async function summarize (provider, conv, variant) {
  const C = variant === 'old' ? OLD : Z
  const legacy = variant === 'old' && LEGACY
  const { lines, count } = transcriptOf(C, conv, !legacy)
  const systemPrompt = legacy
    ? OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'medium', now, myName })
    : C.buildSystemPrompt({ systemPrompt: C.SUMMARY_PROMPT, now, myName })
  const chunks = C.splitIntoChunks(lines)
  let input = `<transcript>\n${lines.join('\n')}\n</transcript>`
  let requests = 1
  if (chunks.length > 1) {
    const notes = []
    for (const [i, chunk] of chunks.entries()) {
      const r = await call(provider, { systemPrompt, input: `<transcript>\n${chunk.join('\n')}\n</transcript>`, instruction: C.buildPartInstruction({ convName: conv.convName, part: i + 1, parts: chunks.length }) })
      if (r.error) return r
      notes.push(`### Phần ${i + 1}\n${r.text}`)
    }
    input = `<notes>\n${notes.join('\n\n')}\n</notes>`
    requests += chunks.length
  }
  const r = await call(provider, { systemPrompt, input, instruction: C.buildSummaryInstruction({ convName: conv.convName, isGroup: conv.isGroup, from: conv.from, to: conv.to, count, notes: chunks.length > 1 }) })
  return { ...r, requests }
}

// The digest's conversations: those with something to read, as digest.js keeps them
const digestConvs = DATA.digest.filter((c) => c.messages.some((m) => m.fromUid !== '0' && Z.describeContent(m)))

async function digestOld (provider) {
  if (!LEGACY) return digestNew(provider, OLD)
  const sections = {}
  const usage = {}
  let ms = 0
  for (const [i, conv] of digestConvs.entries()) {
    const { lines, count } = transcriptOf(OLD, conv, false)
    const r = await call(provider, {
      systemPrompt: OLD.buildSystemPrompt({ systemPrompt: OLD.SUMMARY_PROMPT, length: 'short', now, myName }),
      input: `<transcript>\n${lines.join('\n')}\n</transcript>`,
      instruction: OLD.buildSummaryInstruction({ convName: conv.convName, isGroup: conv.isGroup, from: conv.from, to: conv.to, count, kind: 'unread' })
    })
    if (r.error) return r
    sections[i + 1] = r.text.trim()
    for (const k of Object.keys(r.usage)) usage[k] = (usage[k] || 0) + (r.usage[k] || 0)
    ms += r.ms
  }
  return { sections, usage, ms, requests: digestConvs.length }
}

async function digestNew (provider, C = Z) {
  const entries = digestConvs.map((conv) => {
    const { lines, count } = transcriptOf(C, conv, true)
    return { name: conv.convName, isGroup: conv.isGroup, from: conv.from, to: conv.to, count, lines }
  })
  const r = await call(provider, {
    systemPrompt: C.buildSystemPrompt({ systemPrompt: C.DIGEST_PROMPT, now, myName }),
    input: C.buildDigestInput(entries),
    instruction: C.buildDigestInstruction({ count: entries.length, notes: entries.map(() => '') })
  })
  if (r.error) return r
  const sections = Z.splitDigest(r.text)
  for (const n of Object.keys(sections)) sections[n] = Z.cleanAnswer(sections[n], transcriptOf(Z, digestConvs[n - 1], true).minutes)
  return { sections, usage: r.usage, ms: r.ms, requests: 1 }
}

// ---------- Run ----------

await Promise.all(PROVIDERS.map(async (provider) => {
  for (const [i, conv] of DATA.summary.entries()) {
    for (const variant of ['old', 'new']) {
      const file = path.join(OUT, `S${i + 1}-${variant}-${modelOf(provider)}.json`)
      if (fs.existsSync(file)) continue
      const r = await summarize(provider, conv, variant)
      if (r.error) { console.log(`${path.basename(file)}: ERROR ${r.error}`); continue }
      const minutes = transcriptOf(Z, conv, true).minutes
      const text = variant === 'new' ? Z.cleanAnswer(r.text, minutes) : r.text
      const cites = V2.checkCitations(text, new Set(minutes.keys()), singleDay(conv))
      fs.writeFileSync(file, JSON.stringify({ conv: i + 1, variant, model: modelOf(provider), text, raw: r.text, usage: r.usage, ms: r.ms, requests: r.requests, cites }, null, 2))
      console.log(`${path.basename(file)}: ${r.requests} request(s), ${Math.round(r.ms / 1000)} s`)
    }
  }
  for (const variant of ['old', 'new']) {
    const file = path.join(OUT, `digest-${variant}-${modelOf(provider)}.json`)
    if (fs.existsSync(file)) continue
    const r = variant === 'old' ? await digestOld(provider) : await digestNew(provider)
    if (r.error) { console.log(`${path.basename(file)}: ERROR ${r.error}`); continue }
    const checks = digestConvs.map((conv, i) => r.sections[i + 1] === undefined ? 'missing' : V2.checkCitations(r.sections[i + 1], new Set(transcriptOf(Z, conv, true).minutes.keys()), singleDay(conv)))
    fs.writeFileSync(file, JSON.stringify({ variant, model: modelOf(provider), ...r, checks }, null, 2))
    console.log(`${path.basename(file)}: ${r.requests} request(s), ${Math.round(r.ms / 1000)} s`)
  }
}))

// ---------- Blind grading packs: the transcript, then every answer under a shuffled label ----------

const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
const key = {}
const nowText = new Date(now).toLocaleString('vi-VN')
for (const [i, conv] of DATA.summary.entries()) {
  const runs = shuffle(fs.readdirSync(OUT).filter((f) => f.startsWith(`S${i + 1}-`) && f.endsWith('.json')))
  let md = `# Hội thoại ${i + 1}: "${conv.convName}" (bây giờ: ${nowText}; "Tôi" là người dùng)\n\n## Bản chép\n\n${transcriptOf(Z, conv, true).lines.join('\n')}\n\n## Các bản tóm tắt\n`
  runs.forEach((f, n) => {
    const label = `S${i + 1}-out${n + 1}`
    key[label] = f
    md += `\n### ${label}\n\n${JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')).text.trim()}\n`
  })
  fs.writeFileSync(path.join(OUT, `judge-S${i + 1}.md`), md)
}
const digests = shuffle(fs.readdirSync(OUT).filter((f) => /^digest-.+\.json$/.test(f)))
let md = `# Bản tin (bây giờ: ${nowText}; "Tôi" là người dùng)\n\n## Bản chép các hội thoại chưa đọc\n`
digestConvs.forEach((conv, i) => { md += `\n### Hội thoại ${i + 1}: "${conv.convName}"\n\n${transcriptOf(Z, conv, true).lines.join('\n')}\n` })
md += '\n## Các bản tin\n'
digests.forEach((f, n) => {
  const label = `D${n + 1}`
  key[label] = f
  const run = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
  md += `\n### ${label}\n`
  digestConvs.forEach((conv, j) => { md += `\n#### Hội thoại ${j + 1}\n\n${run.sections[j + 1] || '(trống)'}\n` })
})
fs.writeFileSync(path.join(OUT, 'judge-digest.md'), md)
fs.writeFileSync(path.join(OUT, 'judge-key.json'), JSON.stringify(key, null, 2))
console.log('packed')
