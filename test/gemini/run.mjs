/*
  Zenlo – tests the Gemini model chain in Zenlo's real main process (dist/zenlo-main.js) against a
  stand-in for Google's servers: Node's https module is replaced, so nothing leaves the machine and
  no key quota is used.

  npm run build && node test/gemini/run.mjs

  What this cannot prove: how often the real models are busy, or how long they take to answer.
*/

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

// ---------- Google's servers, scripted per model ----------

const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']
let script = {}
const calls = []

function reply (callback, answer) {
  const response = new EventEmitter()
  response.setEncoding = () => {}
  response.statusCode = answer.status
  callback(response)
  setTimeout(() => {
    if (answer.status !== 200) {
      response.emit('data', JSON.stringify({ error: { message: 'busy' } }))
    } else {
      const event = { candidates: [{ content: { parts: [{ text: answer.text }] } }] }
      response.emit('data', `data: ${JSON.stringify(event)}\n\n`)
    }
    response.emit('end')
  }, 5)
}

const fakeHttps = {
  // The model list
  get: (url, options, callback) => {
    const request = new EventEmitter()
    request.setTimeout = () => {}
    request.destroy = () => {}
    setTimeout(() => {
      const response = new EventEmitter()
      response.setEncoding = () => {}
      response.statusCode = 200
      callback(response)
      response.emit('data', JSON.stringify({ models: MODELS.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ['generateContent'] })) }))
      response.emit('end')
    }, 1)
    return request
  },
  // One streaming call: the next scripted answer for that model; "hang" never answers
  request: (url, options, callback) => {
    const model = decodeURIComponent(url.split('/models/')[1].split(':')[0])
    calls.push({ model, at: Date.now() })
    const answer = (script[model] || []).shift() || { status: 200, text: `ok từ ${model}` }
    const request = new EventEmitter()
    request.destroy = () => {}
    request.end = () => {
      if (answer.status !== 'hang') setTimeout(() => reply(callback, answer), 1)
    }
    return request
  }
}

// ---------- Electron, as small as the main process needs ----------

const handlers = {}
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-test-gemini-'))
const electron = {
  app: { getPath: () => appData, on: () => {}, whenReady: () => new Promise(() => {}) },
  session: { defaultSession: null, fromPartition: () => ({ setPreloads: () => {}, getPreloads: () => [] }) },
  ipcMain: { on: (name, fn) => { handlers[name] = fn }, handle: (name, fn) => { handlers[name] = fn } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  shell: { openExternal: () => {} }
}
const Module = require('node:module')
const load = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron
  if (request === 'https') return fakeHttps
  return load.call(this, request, ...rest)
}
require(path.join(ROOT, 'dist', 'zenlo-main.js'))

const trusted = { senderFrame: { url: 'file:///zalo/index.html' } }
handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaFAKEKEY0000'])

function summarize (request = {}) {
  calls.length = 0
  return new Promise((resolve) => {
    const event = {
      ...trusted,
      sender: {
        isDestroyed: () => false,
        send: (channel, payload) => {
          if (payload.type === 'done' || payload.type === 'error') resolve(payload)
        }
      }
    }
    handlers['zenlo:summary:run'](event, {
      id: `t-${Math.random()}`,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      effort: 'low',
      timeout: 3000,
      retryWindow: 60 * 1000,
      systemPrompt: 'x',
      instruction: 'Tóm tắt giúp mình.',
      input: '<transcript>\n08:30 Lan: hi\n</transcript>',
      ...request
    })
  })
}

const results = []
async function test (name, fn) {
  try {
    await fn()
    results.push(`  ✓ ${name}`)
  } catch (error) {
    results.push(`  ✗ ${name}: ${error.message}`)
    process.exitCode = 1
  }
}

await test('Bắt đầu từ model đã chọn (3.6 Flash)', async () => {
  script = {}
  const last = await summarize()
  assert.equal(last.type, 'done')
  assert.equal(calls[0].model, 'gemini-3.6-flash')
  assert.equal(calls.length, 1)
})

await test('503 rồi được: thử lại đúng model sau khoảng 1 giây, không xuống model thấp hơn', async () => {
  script = { 'gemini-3.6-flash': [{ status: 503 }, { status: 200, text: 'được rồi' }] }
  const last = await summarize()
  assert.equal(last.type, 'done')
  assert.equal(last.result, 'được rồi')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.6-flash'])
  const gap = calls[1].at - calls[0].at
  assert.ok(gap >= 900 && gap < 2000, `${gap} ms`)
})

await test('503 hai lần: chuyển xuống 3.5 Flash, không thử lần thứ ba', async () => {
  script = { 'gemini-3.6-flash': [{ status: 503 }, { status: 503 }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'])
})

await test('Không phản hồi (hàng đợi): chuyển xuống ngay khi hết thời gian chờ, không thử lại', async () => {
  script = { 'gemini-3.6-flash': [{ status: 'hang' }] }
  const started = Date.now()
  const last = await summarize({ timeout: 3000, retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.5-flash'])
  const took = Date.now() - started
  assert.ok(took >= 2900 && took < 4500, `${took} ms`)
})

await test('Model vừa quá tải bị xếp cuối trong 1 phút', async () => {
  script = { 'gemini-3.6-flash': [{ status: 503 }, { status: 503 }] }
  await summarize({ retryWindow: 60 * 1000 })
  script = {}
  await summarize({ retryWindow: 60 * 1000 })
  assert.equal(calls[0].model, 'gemini-3.5-flash')
})

console.log('\n[Gemini]')
console.log(results.join('\n'))
fs.rmSync(appData, { recursive: true, force: true })
process.exit(process.exitCode || 0)
