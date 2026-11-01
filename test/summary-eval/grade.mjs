/*
  Zenlo – grading for the summary evaluation, in two steps.

  node test/summary-eval/grade.mjs pack <folder>
    writes judge-<chat>.md: the facts and traps of a chat and every answer under a neutral label
    (O1, O2…, shuffled), so the judge cannot tell prompt or model apart; the labels are kept in
    judge-key.json
  node test/summary-eval/grade.mjs score <folder>
    reads the judge's verdicts (verdict-<chat>.json) and prints the table per prompt and model:
    facts, the user's own facts, traps hit, citations right, tokens, time
*/

import fs from 'node:fs'
import path from 'node:path'
import { CHATS } from './chats.mjs'

const [mode, OUT, only] = process.argv.slice(2)
const results = fs.readdirSync(OUT).filter((f) => /^[ABC]-[A-E]-.+-r\d+\.json$/.test(f))
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) }))
  .filter((r) => r.text)

if (mode === 'pack') {
  const keyFile = path.join(OUT, 'judge-key.json')
  const key = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : {}
  // Answers already packed keep their labels (their verdicts stay valid): only new ones are added,
  // in judge-<chat>-<n>.md, numbered after the existing labels
  for (const chatId of (only ? only.split(',') : Object.keys(CHATS))) {
    const packed = new Set(Object.values(key))
    const used = Object.keys(key).filter((l) => l.startsWith(chatId + '-')).length
    const chat = CHATS[chatId]
    const answers = results.filter((r) => r.chatId === chatId && !packed.has(r.file)).sort(() => Math.random() - 0.5)
    if (!answers.length) continue
    let md = `# Chat ${chatId}: "${chat.convName}" (bây giờ: ${new Date(chat.now).toLocaleString('vi-VN')})\n\n`
    md += '## Sự kiện phải có (fact)\n\n'
    for (const f of chat.facts) md += `- **${f.id}**${f.mine ? ' (việc của người dùng)' : ''}: ${f.what}${f.status ? ` — Trạng thái đúng: ${f.status}.` : ''}\n`
    md += '\n## Bẫy (trap)\n\n'
    for (const t of chat.traps) md += `- **${t.id}**: ${t.what}\n`
    md += '\n## Các bản tóm tắt\n'
    answers.forEach((r, i) => {
      const label = `${chatId}-out${used + i + 1}`
      key[label] = r.file
      md += `\n### ${label}\n\n${r.text.trim()}\n`
    })
    fs.writeFileSync(path.join(OUT, `judge-${chatId}${used ? `-${used + 1}` : ''}.md`), md)
  }
  fs.writeFileSync(keyFile, JSON.stringify(key, null, 2))
  console.log('packed', Object.keys(key).length, 'answers')
}

if (mode === 'score') {
  const key = JSON.parse(fs.readFileSync(path.join(OUT, 'judge-key.json'), 'utf8'))
  const verdicts = {}
  for (const chatId of Object.keys(CHATS)) {
    for (const file of fs.readdirSync(OUT).filter((f) => f.startsWith(`verdict-${chatId}`) && f.endsWith('.json'))) {
      Object.assign(verdicts, JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8')))
    }
  }
  const groups = {}
  for (const [label, file] of Object.entries(key)) {
    const v = verdicts[label]
    const r = results.find((x) => x.file === file)
    if (!v || !r || (only && !only.split(',').includes(r.chatId))) continue
    const chat = CHATS[r.chatId]
    const g = (groups[`${r.variant} ${r.model}`] ||= { runs: 0, facts: 0, factsMax: 0, mine: 0, mineMax: 0, traps: 0, citeOk: 0, citeOf: 0, exactOk: 0, exactOf: 0, wrong: 0, cites: 0, noCite: 0, items: 0, inTok: 0, thinkTok: 0, outTok: 0, ms: 0, byChat: {} })
    g.runs++
    for (const f of chat.facts) {
      const fv = v.facts[f.id] || { score: 0, cites: [] }
      g.facts += fv.score
      g.factsMax++
      if (f.mine) { g.mine += fv.score; g.mineMax++ }
      if (fv.score > 0) {
        g.citeOf++
        const cites = (fv.cites || []).map((c) => c.replace(/\b(\d)\b/g, '0$1'))
        if (cites.some((c) => f.cite.includes(c))) g.citeOk++
        if (f.exact) { g.exactOf++; if (cites.includes(f.exact)) g.exactOk++ }
      }
    }
    g.traps += Object.values(v.traps).filter(Boolean).length
    g.wrong += r.cites.wrong
    g.cites += r.cites.cites
    g.noCite += r.cites.items - r.cites.itemsWithCite
    g.items += r.cites.items
    g.inTok += r.usage.promptTokenCount || 0
    g.thinkTok += r.usage.thoughtsTokenCount || 0
    g.outTok += r.usage.candidatesTokenCount || 0
    g.ms += r.ms
    const c = (g.byChat[r.chatId] ||= { facts: 0, max: 0, traps: 0 })
    c.facts += chat.facts.reduce((s, f) => s + ((v.facts[f.id] || {}).score || 0), 0)
    c.max += chat.facts.length
    c.traps += Object.values(v.traps).filter(Boolean).length
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–')
  const rows = Object.entries(groups).sort().map(([name, g]) => ({
    'prompt model': name,
    runs: g.runs,
    facts: pct(g.facts, g.factsMax),
    'việc của bạn': pct(g.mine, g.mineMax),
    'chat A': pct(g.byChat.A?.facts, g.byChat.A?.max),
    'chat B': pct(g.byChat.B?.facts, g.byChat.B?.max),
    'bẫy/lần': (g.traps / g.runs).toFixed(1),
    'mốc đúng tin': pct(g.citeOk, g.citeOf),
    'mốc trong dòng nối': pct(g.exactOk, g.exactOf),
    'mốc không có tin': `${g.wrong}/${g.cites}`,
    'ý thiếu mốc': `${g.noCite}/${g.items}`,
    'token vào': Math.round(g.inTok / g.runs),
    'suy nghĩ': Math.round(g.thinkTok / g.runs),
    ra: Math.round(g.outTok / g.runs),
    giây: Math.round(g.ms / g.runs / 1000)
  }))
  console.table(rows)
  fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify(rows, null, 2))
}
