/*
  Zenlo – which message a click on each citation of an answer would open, for the citation test.

  open(text, { messages, numbered, mode, describe, defaultDay }) -> { items, display }
    mode "first":  the first message of the cited minute (what Zenlo does today)
    mode "match":  the message of that minute whose words best match the point's line
    mode "number": message #n of the transcript, unless it shares no word with the point while the
                   cited minute has other messages (a time that is not #n's counts as a mismatch)
    mode "id":     what Zenlo opens for an answer cleanAnswer has kept: the message "~<id>" names,
                   else the first message of the cited minute
  items: one { msg, mismatch } per citation (msg null when nothing can be opened); display: the
  answer with every citation written as the "[dd/mm hh:mm]" Zenlo would show for it.
*/

const pad = (n) => String(n).padStart(2, '0')
const CITE = /\[((?:[\d\s/:,;\-–—#]|~[\w-]+)+)\]/g
const minuteOf = (msg) => Math.floor(Number(msg.sendDttm) / 60000)
const label = (msg) => {
  const d = new Date(Number(msg.sendDttm))
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const words = (text) => new Set(String(text).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [])

export function open (text, { messages, numbered = [], mode, describe, defaultDay = null }) {
  const byMinute = new Map()
  for (const msg of messages) {
    if (!describe(msg)) continue
    const key = minuteOf(msg)
    if (!byMinute.has(key)) byMinute.set(key, [])
    byMinute.get(key).push(msg)
  }
  const year = new Date(Number(messages[0].sendDttm)).getFullYear()
  const minuteAt = (date, h, m) => {
    const [day, month] = (date || defaultDay || '').split('/').map(Number)
    return day ? Math.floor(new Date(year, month - 1, day, h, m).getTime() / 60000) : null
  }
  // How many of a message's words the point's line has (its sender's name counts a little)
  const score = (msg, line, withName = true) => {
    const context = words(line.replace(CITE, ' '))
    let total = 0
    for (const w of words(describe(msg))) if (context.has(w)) total += w.length > 1 ? 1 : 0.25
    if (withName) for (const w of words(msg.dName || '')) if (context.has(w)) total += 0.5
    return total
  }
  const match = (candidates, line) => {
    let best = null
    let bestScore = -1
    for (const msg of candidates) {
      const s = score(msg, line)
      if (s > bestScore) { best = msg; bestScore = s }
    }
    return best
  }

  const items = []
  const display = text.split('\n').map((line) => line.replace(CITE, (whole, body) => {
    let date = null
    const labels = []
    let any = false
    for (const segment of body.split(/[,;]/)) {
      const d = segment.match(/(\d{1,2})\/(\d{1,2})/)
      if (d) date = `${pad(d[1])}/${pad(d[2])}`
      const t = segment.match(/(\d{1,2}):(\d{2})/)
      const n = segment.match(/#\s*(\d+)/)
      const id = segment.match(/~([\w-]+)/)
      if (!t && !n) continue
      any = true
      const minute = t ? minuteAt(date, Number(t[1]), Number(t[2])) : null
      const inMinute = minute !== null ? byMinute.get(minute) || [] : []
      let msg = null
      let mismatch = false
      if (mode === 'id') {
        // Zenlo's jump: the message whose id the citation kept, else the first one of its minute
        msg = (id && inMinute.find((m) => String(m.msgId) === id[1])) || inMinute[0] || null
      } else if (mode === 'number' && n) {
        // The number is usually right even when the time is not (weak models misread the minute),
        // but now and then names a neighbour: #n is kept unless it shares no word with the point,
        // then the cited minute's message that matches the point best
        msg = numbered[Number(n[1]) - 1] || null
        if (msg && minute !== null && minuteOf(msg) !== minute) mismatch = true
        const others = inMinute.filter((m) => m !== msg)
        if (others.length && (!msg || score(msg, line, false) === 0)) msg = match(others, line) || msg
      } else if (inMinute.length) {
        msg = mode === 'match' || mode === 'number' ? match(inMinute, line) : inMinute[0]
      }
      items.push({ msg, mismatch })
      if (msg) labels.push(label(msg))
      else if (t) labels.push(`${date || defaultDay || ''} ${pad(t[1])}:${t[2]}`.trim())
    }
    if (!any) return whole
    return labels.length ? `[${labels.join(', ')}]` : ''
  })).join('\n')
  return { items, display }
}
