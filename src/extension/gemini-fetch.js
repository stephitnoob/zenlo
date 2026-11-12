/*
  Zenlo – trình quản lí hội thoại Zalo

  Browser extension: how a Gemini request is sent, over fetch (Zalo PC's main process uses Node's
  https). Nothing here needs the browser's extension APIs, so it also runs in Node for a test.
*/

import { GEMINI_URL, IDLE_TIMEOUT, geminiError, createStreamParser } from '../shared/gemini.js'

// GET with the key; rejects with geminiError's message on an HTTP error
export async function fetchJSON (url, key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: controller.signal, credentials: 'omit' })
    const text = await response.text()
    if (response.status !== 200) throw new Error(geminiError(response.status, text))
    return JSON.parse(text)
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Hết thời gian chờ danh sách model.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// One streaming call (server-sent events); what it resolves to: see createGemini
export function streamGemini (model, key, body, { onText, onThought, setCancel, setSkip, firstByteTimeout }) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    let timer = null
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    // body "timeout": nothing came at all; "idle": the model went quiet after it had started
    const arm = (ms, kind = 'timeout') => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        controller.abort()
        settle(resolve, { status: 0, body: kind })
      }, ms)
    }
    setCancel(() => {
      controller.abort()
      settle(reject, new Error('cancelled'))
    })
    setSkip(() => {
      controller.abort()
      settle(resolve, { status: -1, body: 'skipped' })
    })
    arm(firstByteTimeout)

    ;(async () => {
      const response = await fetch(`${GEMINI_URL}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: controller.signal,
        credentials: 'omit'
      })
      if (response.status !== 200) {
        const text = await response.text()
        settle(resolve, { status: response.status, body: text })
        return
      }
      const parser = createStreamParser({ onText, onThought })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        arm(IDLE_TIMEOUT, 'idle')
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.push(decoder.decode())
      settle(resolve, { status: 200, ...parser.state })
    })().catch((error) => settle(reject, error))
  })
}
