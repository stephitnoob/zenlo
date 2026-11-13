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
      response.emit('data', answer.body || JSON.stringify({ error: { message: 'busy' } }))
    } else {
      // A thinking model sends thought summaries before its answer
      for (const thought of answer.thoughts || []) {
        response.emit('data', `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: thought, thought: true }] } }] })}\n\n`)
      }
      const event = { candidates: [{ content: { parts: [{ text: answer.text || '' }] }, ...(answer.finish ? { finishReason: answer.finish } : {}) }] }
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
    calls.push({ model, at: Date.now(), key: options.headers['x-goog-api-key'] })
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

// Zalo's main page, where Zenlo is added: only its main frame may use Zenlo
const frame = { url: 'file:///C:/Zalo/resources/app.asar/pc-dist/index.html?type=24', routingId: 1, processId: 1 }
const trusted = { senderFrame: frame, sender: { mainFrame: frame } }
// Before Zalo says who is logged in, there are no keys to save or use
assert.match(handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaFAKEKEY0000']).error, /chưa biết tài khoản Zalo/)
assert.equal(handlers['zenlo:account:use'](trusted, '1000'), true)
handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaFAKEKEY0000'])
const ZENLO_DIR = path.join(appData, 'Zenlo')

// Every event the page got in the last run
const events = []

// onStart(id): called once the run has started, with its id (to press "Chuyển model khác")
function summarize (request = {}, onStart = () => {}) {
  calls.length = 0
  events.length = 0
  const id = `t-${Math.random()}`
  return new Promise((resolve) => {
    const event = {
      ...trusted,
      sender: {
        mainFrame: frame,
        isDestroyed: () => false,
        send: (channel, payload) => {
          events.push(payload)
          if (payload.type === 'done' || payload.type === 'error') resolve(payload)
        }
      }
    }
    handlers['zenlo:summary:run'](event, {
      id,
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
    onStart(id)
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

await test('Không phản hồi (hàng đợi): hết thời gian chờ chung thì dừng và báo nghẽn, không đi tiếp từng model', async () => {
  script = { 'gemini-3.6-flash': [{ status: 'hang' }] }
  const started = Date.now()
  const last = await summarize({ timeout: 3000, retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.match(last.message, /nghẽn/)
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash'])
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

await test('503 rồi hàng đợi: model sau chỉ chờ phần thời gian còn lại', async () => {
  script = { 'gemini-3.6-flash': [{ status: 503 }, { status: 503 }], 'gemini-3.5-flash': [{ status: 'hang' }] }
  const started = Date.now()
  const last = await summarize({ timeout: 3000, retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.match(last.message, /3\.5 Flash vẫn chưa trả lời/)
  const took = Date.now() - started
  assert.ok(took >= 2900 && took < 4500, `${took} ms`)
})

await test('Chuyển model khác: bỏ model đang im, model sau được chờ đủ và trả lời', async () => {
  script = { 'gemini-3.6-flash': [{ status: 'hang' }] }
  const last = await summarize({ timeout: 3000, retryWindow: 0 }, (id) => {
    setTimeout(() => handlers['zenlo:summary:skip'](trusted, id), 2500)
  })
  assert.equal(last.type, 'done')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.5-flash'])
  assert.match(last.skipped.join(), /3\.6 Flash/)
})

await test('Đang suy nghĩ: trang được báo một lần, rồi mới tới chữ', async () => {
  script = { 'gemini-3.6-flash': [{ status: 200, thoughts: ['đọc tin', 'so hạn'], text: 'xong' }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  const types = events.map((e) => e.type)
  assert.equal(types.filter((t) => t === 'thinking').length, 1)
  assert.ok(types.indexOf('thinking') < types.indexOf('text'))
  assert.equal(last.result, 'xong')
})

await test('Lỗi riêng của một model (404): sang model kế tiếp, vẫn dùng key đó', async () => {
  script = { 'gemini-3.6-flash': [{ status: 404, body: JSON.stringify({ error: { message: 'models/gemini-3.6-flash is not found' } }) }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.5-flash'])
})

await test('Key không hợp lệ: dừng, báo đúng lý do, không đổ cho hết lượt', async () => {
  script = { 'gemini-3.6-flash': [{ status: 400, body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.equal(calls.length, 1)
  assert.match(last.message, /không hợp lệ/)
  assert.doesNotMatch(last.message, /hết lượt/)
  // One period at the end, not the reason's own plus the message's ("không hợp lệ..")
  assert.doesNotMatch(last.message, /\.\./)
})

await test('Lời báo lỗi của Google có key: chỉ hiện key đã che', async () => {
  const leaked = 'AIzaLEAKEDLEAKEDLEAKEDLEAKED0000'
  const body = JSON.stringify({ error: { message: `Request with key ${leaked} is malformed` } })
  script = { 'gemini-3.6-flash': [{ status: 400, body }], 'gemini-3.5-flash': [{ status: 400, body }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.ok(!last.message.includes(leaked), last.message)
  assert.match(last.message, /AIza…0000/)
})

await test('403 của riêng một model (một key): sang model kế tiếp, không bỏ key', async () => {
  script = { 'gemini-3.6-flash': [{ status: 403, body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Permission denied on resource project.' } }) }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.5-flash'])
})

await test('403 nói key bị lộ: dừng, báo lỗi key', async () => {
  script = { 'gemini-3.6-flash': [{ status: 403, body: JSON.stringify({ error: { message: 'Your API key was reported as leaked. Please use another API key.' } }) }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.equal(calls.length, 1)
})

await test('Trả lời bị cắt vì hết token: sang model kế tiếp', async () => {
  script = { 'gemini-3.6-flash': [{ status: 200, text: 'Phần đầu…', finish: 'MAX_TOKENS' }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.equal(last.result, 'ok từ gemini-3.5-flash')
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.5-flash'])
})

await test('Dừng giữa chừng vì nội dung (SAFETY): báo lỗi, không coi phần dở là xong', async () => {
  script = { 'gemini-3.6-flash': [{ status: 200, text: 'Phần đầu…', finish: 'SAFETY' }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'error')
  assert.match(last.message, /dừng giữa chừng vì nội dung \(SAFETY\)/)
  assert.equal(calls.length, 1)
})

await test('Trả lời trọn vẹn (STOP) vẫn xong như thường', async () => {
  script = { 'gemini-3.6-flash': [{ status: 200, text: 'Xong.', finish: 'STOP' }] }
  const last = await summarize({ retryWindow: 0 })
  assert.equal(last.type, 'done')
  assert.equal(last.result, 'Xong.')
})

await test('Key dán kèm khoảng trắng, ký tự ẩn: được làm sạch trước khi lưu', async () => {
  const saved = handlers['zenlo:settings:setGeminiKeys'](trusted, [' AIzaFAKE\u200bKEY 0000\n'])
  // The page gets the new list at once, masked
  assert.deepEqual(saved, { masks: ['AIza…0000'] })
  script = {}
  await summarize()
  assert.equal(calls[0].key, 'AIzaFAKEKEY0000')
})

await test('Key có chữ có dấu: không lưu, báo rõ lý do', async () => {
  const saved = handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaFAKEKEY0000', 'AIzaKhoáGiả'])
  assert.match(saved.error, /Key thứ 2 có ký tự không hợp lệ/)
  script = {}
  await summarize()
  assert.equal(calls[0].key, 'AIzaFAKEKEY0000')
})

await test('Key đã lưu: giữ theo số thứ tự, thêm key mới, bỏ key cũ', async () => {
  assert.deepEqual(handlers['zenlo:settings:setGeminiKeys'](trusted, [0, 'AIzaSECONDKEY1111']), { masks: ['AIza…0000', 'AIza…1111'] })
  assert.deepEqual(handlers['zenlo:settings:setGeminiKeys'](trusted, [1]), { masks: ['AIza…1111'] })
  script = {}
  await summarize()
  assert.equal(calls[0].key, 'AIzaSECONDKEY1111')
  assert.deepEqual(handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaFAKEKEY0000']), { masks: ['AIza…0000'] })
})

const maskedKeys = async () => ((await handlers['zenlo:gemini:status'](trusted)).keys || []).map((k) => k.masked)

await test('Tài khoản Zalo khác: không thấy, không dùng key và bản sao lưu của người trước', async () => {
  handlers['zenlo:storage:save'](trusted, { '@Zenlo:NOTE:c1': 'ghi chú của 1000' })
  assert.equal(handlers['zenlo:account:use'](trusted, '2000'), true)
  assert.deepEqual(await maskedKeys(), [])
  assert.equal(handlers['zenlo:storage:load'](trusted), null)
  script = {}
  const last = await summarize()
  assert.equal(last.type, 'error')
  assert.equal(calls.length, 0)
  assert.deepEqual(handlers['zenlo:settings:setGeminiKeys'](trusted, ['AIzaOTHERKEY2222']), { masks: ['AIza…2222'] })
  handlers['zenlo:storage:save'](trusted, { '@Zenlo:NOTE:c2': 'ghi chú của 2000' })
  // Back to the first account: its own keys and mirror, nothing of the second
  handlers['zenlo:account:use'](trusted, '1000')
  assert.deepEqual(await maskedKeys(), ['AIza…0000'])
  assert.deepEqual(handlers['zenlo:storage:load'](trusted), { '@Zenlo:NOTE:c1': 'ghi chú của 1000' })
  await summarize()
  assert.equal(calls[0].key, 'AIzaFAKEKEY0000')
})

await test('Key và bản sao lưu từ trước khi có tài khoản: thuộc về tài khoản mở Zenlo đầu tiên', async () => {
  const secretsFile = path.join(ZENLO_DIR, 'secrets.json')
  const saved = fs.readFileSync(secretsFile, 'utf8')
  // As Zenlo 0.3.0 left them (the test's "encryption" is base64 of the key)
  const secrets = JSON.parse(saved)
  secrets.geminiKeys = [Buffer.from('AIzaLEGACYKEY3333').toString('base64')]
  fs.writeFileSync(secretsFile, JSON.stringify(secrets))
  fs.writeFileSync(path.join(ZENLO_DIR, 'storage-backup.json'), JSON.stringify({ at: 1, data: { '@Zenlo:NOTE:c3': 'cũ' } }))
  handlers['zenlo:account:use'](trusted, '3000')
  assert.deepEqual(await maskedKeys(), ['AIza…3333'])
  assert.deepEqual(handlers['zenlo:storage:load'](trusted), { '@Zenlo:NOTE:c3': 'cũ' })
  assert.ok(!fs.existsSync(path.join(ZENLO_DIR, 'storage-backup.json')))
  assert.equal(JSON.parse(fs.readFileSync(secretsFile, 'utf8')).geminiKeys, undefined)
  // The next new account gets none of it
  handlers['zenlo:account:use'](trusted, '4000')
  assert.deepEqual(await maskedKeys(), [])
  assert.equal(handlers['zenlo:storage:load'](trusted), null)
  // An account that already has its own keeps them; the old ones are dropped
  fs.writeFileSync(secretsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(secretsFile, 'utf8')), geminiKeys: [Buffer.from('AIzaLEGACYKEY5555').toString('base64')] }))
  handlers['zenlo:account:use'](trusted, '1000')
  assert.deepEqual(await maskedKeys(), ['AIza…0000'])
  assert.equal(JSON.parse(fs.readFileSync(secretsFile, 'utf8')).geminiKeys, undefined)
})

await test('Mã tài khoản lạ hoặc từ khung khác: không nhận', async () => {
  for (const uid of ['../x', '', '__proto__', 'a'.repeat(65), 42]) {
    assert.ok(handlers['zenlo:account:use'](trusted, uid).error, String(uid))
  }
  const child = { url: frame.url, routingId: 2, processId: 1 }
  assert.equal(handlers['zenlo:account:use']({ senderFrame: child, sender: { mainFrame: frame } }, '2000'), false)
  // Still the first account
  assert.deepEqual(await maskedKeys(), ['AIza…0000'])
})

await test('Trang Zalo: chỉ trả key đã che', async () => {
  const status = await handlers['zenlo:gemini:status'](trusted)
  assert.deepEqual(status.keys.map((k) => k.masked), ['AIza…0000'])
  assert.ok(!JSON.stringify(status).includes('AIzaFAKEKEY0000'))
})

await test('Khung con, trang khác của Zalo, trang web: không dùng được Zenlo', async () => {
  const child = { url: frame.url, routingId: 2, processId: 1 }
  const other = { url: 'file:///C:/Zalo/resources/app.asar/pc-dist/znotification.html', routingId: 1, processId: 1 }
  const web = { url: 'https://example.com/pc-dist/index.html', routingId: 1, processId: 1 }
  assert.equal(handlers['zenlo:settings:setGeminiKeys']({ senderFrame: child, sender: { mainFrame: frame } }, []), false)
  assert.equal(handlers['zenlo:settings:setGeminiKeys']({ senderFrame: other, sender: { mainFrame: other } }, []), false)
  assert.equal(handlers['zenlo:settings:setGeminiKeys']({ senderFrame: web, sender: { mainFrame: web } }, []), false)
  script = {}
  await summarize()
  assert.equal(calls[0].key, 'AIzaFAKEKEY0000')
})

await test('Đoạn cần tóm tắt quá dài: báo lỗi, không gọi Gemini', async () => {
  script = {}
  const last = await summarize({ input: 'x'.repeat(2000001) })
  assert.equal(last.type, 'error')
  assert.equal(calls.length, 0)
})

console.log('\n[Gemini]')
console.log(results.join('\n'))
fs.rmSync(appData, { recursive: true, force: true })
process.exit(process.exitCode || 0)
