/*
  Zenlo – trình quản lí hội thoại Zalo

  Gemini, shared by Zalo PC's main process (Node's https) and the browser extension (fetch): the
  model chain, the keys and their daily quotas, the errors. Each side passes in where the keys and
  quotas are kept and how a request is sent.
*/

export const GEMINI_EFFORTS = ['low', 'medium', 'high']
// The only host Zenlo sends messages to for Gemini. The key goes in a header, never in the URL.
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'
// Up to 5 API keys. Quotas belong to Google Cloud projects, so only keys from different projects add quota.
export const MAX_KEYS = 5

export const maskKey = (key) => key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••'

// Spaces and invisible characters copied along with a key
const INVISIBLE = /[\s\u200b-\u200d\u2060\ufeff]+/g

// The keys to keep, from the list the page sends: a number keeps the saved key at that index, a
// string is a new key. Spaces and invisible characters copied along with a key are dropped. Anything
// else that is not plain ASCII cannot be sent in a request header, so it is refused here with a clear
// message rather than failing every summary as a lost connection.
export function pickKeys (saved, entries) {
  const keys = entries.slice(0, MAX_KEYS * 2).map((entry) => Number.isInteger(entry) ? saved[entry] : typeof entry === 'string' ? entry.slice(0, 200) : '')
  const clean = [...new Set(keys.map((k) => String(k || '').replace(INVISIBLE, '')).filter(Boolean))].slice(0, MAX_KEYS)
  const bad = clean.findIndex((k) => !/^[\x21-\x7e]+$/.test(k))
  if (bad !== -1) throw new Error(`Key thứ ${bad + 1} có ký tự không hợp lệ (có thể đã dán nhầm chữ có dấu hay ký tự lạ). Hãy sao chép lại key từ Google AI Studio.`)
  return clean
}

// Daily quotas restart at midnight Pacific time (about 14:00–15:00 in Vietnam)
export const nextPacificMidnight = (now = Date.now()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
  }).formatToParts(new Date(now)).map((p) => [p.type, Number(p.value)]))
  const wallAsUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offset = wallAsUTC - Math.floor(now / 1000) * 1000
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset
}

export const geminiLabel = (id) => {
  const match = id.match(/^gemini-([\d.]+)-flash(-lite)?$/)
  if (match) return `Gemini ${match[1]} Flash${match[2] ? '-Lite' : ''}`
  if (id === 'gemini-flash-latest') return 'Gemini Flash'
  if (id === 'gemini-flash-lite-latest') return 'Gemini Flash-Lite'
  return id
}

// Where the chain begins for the chosen model: that model, or else the next older one of the same
// kind (Flash or Flash-Lite), or else the newest
export const geminiStart = (list, model) => {
  const index = list.indexOf(model)
  if (index !== -1) return index
  const wanted = String(model).match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/)
  if (!wanted) return 0
  const older = list.findIndex((id) => {
    const m = id.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/)
    return m && !!m[2] === !!wanted[2] && Number(m[1]) <= Number(wanted[1])
  })
  return older === -1 ? 0 : older
}

// How busy each model usually is. Google publishes no load figures: this is a fixed estimate from
// Zenlo's measurements (Oct 2026): the two newest Flash versions are crowded, the next one is
// moderate, older Flash and Flash-Lite are quiet. 3 = đông, 2 = vừa, 1 = thoáng.
export const congestionLevel = (model, list) => {
  const flash = list.filter((id) => /-flash$/.test(id))
  const rank = flash.indexOf(model)
  if (rank === 0 || rank === 1) return 3
  if (rank === 2) return 2
  return 1
}

// A problem with the key itself (invalid, revoked, API not allowed for it), as opposed to one with the
// model (gone, does not take a setting): only the first kind stops a key for the other models
// A 403 that names the key (leaked, suspended) is the key's; any other 403 (API not enabled for the
// key's project, no access to this model) only skips this key for this model, like a quota.
export const isKeyProblem = (status, body) => status === 401 || ((status === 400 || status === 403) && /API[ _]?key/i.test(body))

// The reason of a 429: per-day quota (wait for the reset) or per-minute (sent too fast)
export const isDailyQuota = (body) => /PerDay/i.test(body) || (/per day|daily/i.test(body) && !/PerMinute/i.test(body))

// A Gemini key written out in an error text (Google's or the network's), masked like in settings
export const hideKeys = (text) => String(text).replace(/AIza[\w-]{20,}/g, maskKey)

export const geminiError = (status, body) => {
  let message = ''
  try {
    message = hideKeys(JSON.parse(body).error.message)
  } catch (error) {}
  if (status === 400 && /API key/i.test(message)) return 'API key Gemini không hợp lệ.'
  if (status === 403) return 'API key Gemini không có quyền dùng model này.'
  if (status === 429) return isDailyQuota(body) ? 'Đã hết lượt trong ngày.' : 'Gửi quá nhanh, hết lượt trong phút.'
  if (status === 503 || status === 500) return 'Máy chủ Gemini đang quá tải.'
  return `Gemini báo lỗi ${status}${message ? ': ' + message : ''}.`
}

// The body of one streaming call (server-sent events), fed in pieces as they arrive. state.result is
// the answer so far, state.blocked why the prompt was refused, state.finishReason why the model
// stopped ("STOP" when the answer is whole). onThought: the model sent a thought summary.
export function createStreamParser ({ onText, onThought }) {
  let buffer = ''
  const state = { result: '', blocked: '', finishReason: '' }
  function push (chunk) {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      let event
      try {
        event = JSON.parse(line.slice(5))
      } catch (error) {
        continue
      }
      if (event.promptFeedback && event.promptFeedback.blockReason) state.blocked = event.promptFeedback.blockReason
      if (event.candidates && event.candidates[0] && event.candidates[0].finishReason) state.finishReason = event.candidates[0].finishReason
      const parts = (event.candidates && event.candidates[0] && event.candidates[0].content && event.candidates[0].content.parts) || []
      for (const part of parts) {
        // Thought summaries only show that the model is working; they are not part of the answer
        if (part.thought) onThought()
        if (part.thought || typeof part.text !== 'string') continue
        state.result += part.text
        onText(part.text)
      }
    }
  }
  return { push, state }
}

// How long one summary waits for Gemini to start answering, all models together. Google keeps
// requests from free keys in a queue instead of answering 503: on a busy day every model takes
// 15–20 s before its first byte (measured Nov 2026), so a short wait per model only threw away
// requests that were about to answer. A model that answers 500/503 is left at once for the next;
// one that keeps quiet is waited for, and the user can move on with "Chuyển model khác". Both
// waits are settings ("Chờ Gemini tối đa", "Thử lại model quá tải sau"); these are the defaults.
const ANSWER_WAIT = 45 * 1000
// A model that went quiet after it had started answering
export const IDLE_TIMEOUT = 60 * 1000
const RECENT_FAILURE = 60 * 1000
const BUSY_RETRY_DELAY = 1000
// Reasons a model stops early over what it was writing
const GEMINI_CONTENT_STOPS = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']
const clampSetting = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

// The Flash models the keys can use, newest first, then the Flash-Lite ones newest first:
// e.g. 3.8 → 3.7 → 3.6 → 3.5 Flash → 3.5 → 3.1 Flash-Lite
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

// What each side passes in:
// - getKeys(): the saved keys, in order
// - keyId(key): a short id for a key, so the quota file never holds a key
// - loadQuota() / saveQuota(quota): { keyId: { model: resetAt } }, kept between runs
// - getJSON(url, key): GET with the key; rejects with geminiError's message on an HTTP error
// - stream(model, key, body, { onText, onThought, setCancel, setSkip, firstByteTimeout }): one
//   streaming call. Resolves to { status, body } on an HTTP error, a timeout (status 0; body "idle"
//   when the model went quiet after it had started) or a skip by the user (status -1, through
//   setSkip), or { status: 200, result, blocked, finishReason }; rejects when cancelled (setCancel)
//   or when the connection drops.
export function createGemini ({ getKeys, keyId, loadQuota, saveQuota, getJSON, stream }) {
  // The model list, cached for an hour or until the keys change
  let geminiModels = null
  // Models that failed in the last few minutes, tried last so a busy model does not cost a wait every time
  const recentFailures = new Map()

  // { keyId: { model: resetAt } } for (key, model) pairs out of daily quota
  async function readQuota () {
    const quota = (await loadQuota()) || {}
    const now = Date.now()
    for (const id of Object.keys(quota)) {
      for (const model of Object.keys(quota[id] || {})) {
        if (quota[id][model] <= now) delete quota[id][model]
      }
    }
    return quota
  }

  async function markExhausted (key, model) {
    const quota = await readQuota()
    const id = keyId(key)
    quota[id] = { ...(quota[id] || {}), [model]: nextPacificMidnight() }
    await saveQuota(quota)
  }

  const exhaustedUntil = (quota, key, model) => (quota[keyId(key)] || {})[model] || 0

  async function getGeminiModels (keys) {
    if (geminiModels && Date.now() - geminiModels.at < geminiModels.ttl) return geminiModels.list
    let list = FALLBACK_MODELS
    let fetched = false
    for (const key of keys) {
      try {
        const data = await getJSON(`${GEMINI_URL}?pageSize=200`, key)
        const found = (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, ''))
          .map((id) => ({ id, match: id.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/) }))
          .filter((m) => m.match)
          .sort((a, b) => (!!a.match[2] - !!b.match[2]) || (Number(b.match[1]) - Number(a.match[1])))
          .map((m) => m.id)
        // Older generations (2.x) only when nothing newer is available
        const current = found.filter((id) => Number(id.match(/^gemini-(\d+)/)[1]) >= 3)
        if (current.length) list = current
        else if (found.length) list = found
        fetched = true
        break
      } catch (error) {}
    }
    // The fallback (no key could list the models, e.g. the network dropped) only for a minute, so the
    // real list and the chosen starting model are back as soon as Google answers again
    geminiModels = { list, at: Date.now(), ttl: fetched ? 60 * 60 * 1000 : 60 * 1000 }
    return list
  }

  // Order of attempts, from the chosen model down:
  // - overloaded / no answer: the server is busy, another key will not help → next model
  // - out of quota (daily or per minute): that key's project is out → same model with the next key;
  //   when every key is out, next model
  // onCancel(fn) / onSkip(fn): how the caller stops this run, or moves it on to the next model
  async function run (send, finish, { model, effort, systemPrompt, instruction, input, timeout, retryWindow }, { onCancel = () => {}, onSkip = () => {} } = {}) {
    const wait = clampSetting(timeout, ANSWER_WAIT, 3000, 300000)
    const failureWindow = clampSetting(retryWindow, RECENT_FAILURE, 0, 60 * 60 * 1000)

    let cancelled = false
    let cancelRequest = () => {}
    let skipRequest = () => {}
    // Before anything is awaited, so a stop that comes at once is not lost
    onCancel(() => {
      cancelled = true
      cancelRequest()
    })
    onSkip(() => skipRequest())

    const keys = await getKeys()
    if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
    if (!keys.length) return finish({ type: 'error', message: 'Chưa có API key Gemini. Hãy dán key trong Cài đặt Zenlo.' })

    // The wait for the first byte, shared by every model; a model the user moves on from gives the
    // next one a full wait again
    let deadline = Date.now() + wait
    const timedOut = (label) => finish({
      type: 'error',
      message: `Gemini đang nghẽn: chờ ${Math.round(wait / 1000)} giây mà ${label} vẫn chưa trả lời. Thử lại sau vài phút, hoặc chọn AI khác trong Cài đặt.`
    })

    const all = await getGeminiModels(keys)
    const start = geminiStart(all, model)
    const chain = start > 0 ? all.slice(start) : all
    const failedRecently = (m) => Date.now() - (recentFailures.get(m) || 0) < failureWindow
    const models = [...chain.filter((m) => !failedRecently(m)), ...chain.filter(failedRecently)]
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      // The question comes after the data, which works best for long inputs
      contents: [{ role: 'user', parts: [{ text: `${input}\n\n${instruction}` }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: GEMINI_EFFORTS.includes(effort) ? effort : 'high', includeThoughts: true } }
    })

    const skipped = []
    const problems = []
    const badKeys = new Set()
    for (const current of models) {
      const quota = await readQuota()
      if (badKeys.size === keys.length) break
      const usable = keys.filter((key) => !badKeys.has(key) && !exhaustedUntil(quota, key, current))
      if (!usable.length) {
        problems.push(`${geminiLabel(current)}: mọi key đã hết lượt trong ngày`)
        skipped.push(current)
        continue
      }

      let moveOn = false
      for (const key of usable) {
        if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
        send({ type: 'status', model: current, label: geminiLabel(current), skipped: skipped.map(geminiLabel), canSkip: true })
        let response
        try {
          // Thinking models sometimes finish with no text at all: ask the same model once more.
          // A busy answer at once (500, 503) is often gone a second later: one more try after a
          // second, before going down a model. A model that keeps the request waiting (status 0)
          // used up the wait.
          let busyRetried = false
          let thinking = false
          for (let attempt = 0; attempt < 2; attempt++) {
            if (deadline - Date.now() < 1000) {
              response = { status: 0, body: 'timeout' }
              break
            }
            response = await stream(current, key, body, {
              onText: (text) => send({ type: 'text', text }),
              // Once per model: the page shows that it is thinking, not stuck
              onThought: () => {
                if (thinking) return
                thinking = true
                send({ type: 'thinking' })
              },
              setCancel: (fn) => { cancelRequest = fn },
              setSkip: (fn) => { skipRequest = fn },
              firstByteTimeout: deadline - Date.now()
            })
            if (cancelled) break
            if ((response.status === 500 || response.status === 503) && !busyRetried) {
              busyRetried = true
              attempt--
              await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAY))
              if (cancelled) break
              continue
            }
            if (response.status !== 200 || response.result || response.blocked || GEMINI_CONTENT_STOPS.includes(response.finishReason)) break
          }
        } catch (error) {
          if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
          recentFailures.set(current, Date.now())
          problems.push(`${geminiLabel(current)}: mất kết nối`)
          moveOn = true
          break
        }

        if (response.status === 200) {
          const reason = response.finishReason
          if (!response.result && response.blocked) return finish({ type: 'error', message: `Gemini từ chối nội dung này (${response.blocked}).` })
          // Stopped over the content (safety, recitation…): another model would most likely stop too
          if (GEMINI_CONTENT_STOPS.includes(reason)) return finish({ type: 'error', message: `Gemini dừng giữa chừng vì nội dung (${reason}), nên câu trả lời không đủ. Thử lại với khoảng tin ngắn hơn hoặc chọn AI khác.` })
          if (response.result && (!reason || reason === 'STOP')) return finish({ type: 'done', isError: false, result: response.result, model: geminiLabel(current), skipped: skipped.map(geminiLabel) })
          if (response.result) {
            // Cut off for another reason (out of tokens…): the next model gets a fresh try. Its status
            // event clears what this one wrote.
            problems.push(`${geminiLabel(current)}: trả lời bị cắt giữa chừng (${reason})`)
            moveOn = true
            break
          }
          // Still empty: treat like a busy model
          recentFailures.set(current, Date.now())
          problems.push(`${geminiLabel(current)}: trả lời rỗng`)
          moveOn = true
          break
        }
        if (response.status === 429) {
          // Out of quota for this key's project: try the same model with the next key
          if (isDailyQuota(response.body)) {
            // Only a note to skip this key and model until tomorrow: not worth failing the run over
            try {
              await markExhausted(key, current)
            } catch (error) {}
          }
          problems.push(`${geminiLabel(current)} (key ${maskKey(key)}): ${geminiError(429, response.body)}`)
          continue
        }
        if (response.status === 0 && response.body !== 'idle') {
          // The whole wait is used up: going down a model now would only make the user wait longer
          recentFailures.set(current, Date.now())
          return timedOut(geminiLabel(current))
        }
        if (response.status === -1) {
          // The user moved on: the next model, with a full wait of its own
          recentFailures.set(current, Date.now())
          problems.push(`${geminiLabel(current)}: quá tải (bạn đã chuyển model khác)`)
          deadline = Date.now() + wait
          moveOn = true
          break
        }
        if ([0, 500, 503].includes(response.status)) {
          // The model's servers are busy for every key, or it went quiet halfway: go down a model
          recentFailures.set(current, Date.now())
          problems.push(`${geminiLabel(current)}: quá tải${response.status === 0 ? ' (ngừng trả lời giữa chừng)' : ''}`)
          moveOn = true
          break
        }
        if (isKeyProblem(response.status, response.body)) {
          // Invalid key or no access: skip this key from now on
          badKeys.add(key)
          problems.push(`key ${maskKey(key)}: ${geminiError(response.status, response.body)}`)
          continue
        }
        if (response.status === 403) {
          problems.push(`${geminiLabel(current)} (key ${maskKey(key)}): ${geminiError(403, response.body)}`)
          continue
        }
        // Something about this model (removed, a setting it does not take): another key will not help
        problems.push(`${geminiLabel(current)}: ${geminiError(response.status, response.body)}`)
        moveOn = true
        break
      }
      skipped.push(current)
      if (!moveOn && cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
    }
    // The first problems are the cause; what follows from them (e.g. every key skipped) comes after
    // Without their own final period: they are joined by "; " and the message ends with one ("không hợp lệ..")
    const reasons = [...new Set(problems.map((problem) => problem.replace(/\.+$/, '')))]
    const busy = reasons.length && reasons.every((reason) => reason.includes('quá tải'))
    const lead = busy
      ? 'Gemini đang quá tải ở mọi model. Thử lại sau vài phút, hoặc chọn AI khác trong Cài đặt.'
      : 'Không model Gemini nào dùng được lúc này.'
    finish({ type: 'error', message: `${lead} ${busy ? 'Chi tiết: ' : ''}${reasons.slice(0, 4).join('; ')}${reasons.length > 4 ? '; …' : ''}.` })
  }

  // For the settings page: the models (with the fixed congestion estimate, and whether every key is
  // out of quota for the day) and the keys (masked, with the models they ran out of)
  async function status () {
    const keys = await getKeys()
    if (!keys.length) return { models: [], keys: [] }
    const list = await getGeminiModels(keys)
    const quota = await readQuota()
    return {
      models: list.map((model) => {
        const resets = keys.map((key) => exhaustedUntil(quota, key, model))
        return {
          id: model,
          label: geminiLabel(model),
          level: congestionLevel(model, list),
          exhausted: resets.every(Boolean),
          resetAt: resets.every(Boolean) ? Math.min(...resets) : 0
        }
      }),
      keys: keys.map((key) => ({
        masked: maskKey(key),
        exhausted: list.filter((model) => exhaustedUntil(quota, key, model)).map((model) => ({ label: geminiLabel(model), resetAt: exhaustedUntil(quota, key, model) }))
      }))
    }
  }

  return { run, status, resetModels: () => { geminiModels = null } }
}
