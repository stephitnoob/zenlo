/*
  Zenlo – tests for the Zalo web extension's bridge: the built dist-ext/zenlo-shim.js (the page's
  window.$zenlo) talking to dist-ext/zenlo-bridge.js (the content script) through window messages,
  with chrome.storage in memory. Gemini keys and the storage mirror per Zalo account.

  npm run build && node test/extension/run.mjs
*/

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXT = path.join(ROOT, 'dist-ext')

// ---------- A browser tab on chat.zalo.me, as small as the two scripts need ----------

const stored = {}
const has = (key) => Object.prototype.hasOwnProperty.call(stored, key)
const chrome = {
  runtime: { id: 'iapgflamcjakdbcfklmegkclckkgjpap', getURL: (file) => `chrome-extension://iapgflamcjakdbcfklmegkclckkgjpap/${file}` },
  storage: {
    local: {
      get: async (keys) => {
        const list = keys == null ? Object.keys(stored) : Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.filter(has).map((key) => [key, structuredClone(stored[key])]))
      },
      set: async (items) => { Object.assign(stored, structuredClone(items)) },
      remove: async (keys) => { [].concat(keys).forEach((key) => delete stored[key]) }
    }
  }
}

const listeners = []
const window = {
  location: { origin: 'https://chat.zalo.me', href: 'https://chat.zalo.me/' },
  addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn) },
  postMessage: (data) => setTimeout(() => listeners.forEach((fn) => fn({ source: window, data })), 0),
  open: () => null
}
const document = { documentElement: { dataset: {} } }
// No request reaches the network in these tests
const fetch = async () => { throw new Error('no network in tests') }

const context = vm.createContext({ window, document, chrome, fetch, console, setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, URL })
for (const file of ['zenlo-shim.js', 'zenlo-bridge.js']) {
  vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), context, { filename: file })
}
const zenlo = window.$zenlo
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
// What crosses from the scripts' realm, as plain values (their arrays have another Array.prototype)
const plain = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value))
const masks = async () => plain((await zenlo.getSettings()).geminiKeys)

// A Gemini run to its end: the last event
const run = () => new Promise((resolve) => {
  zenlo.run({ provider: 'gemini', model: 'gemini-3.6-flash', systemPrompt: 'x', instruction: 'Tóm tắt.', input: 'hi' }, (event) => {
    if (event.type === 'done' || event.type === 'error') resolve(event)
  })
})

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

// ---------- Tests ----------

await test('Trước khi biết tài khoản Zalo: không lưu key, không chạy Gemini, không sao lưu', async () => {
  assert.match((await zenlo.setGeminiKeys(['AIzaFAKEKEY0000'])).error, /chưa biết tài khoản Zalo/)
  assert.match((await run()).message, /chưa biết tài khoản Zalo/)
  zenlo.saveStorage({ '@Zenlo:NOTE:c0': 'x' })
  await settle()
  assert.deepEqual(Object.keys(stored), [])
})

await test('Key và bản sao lưu từ trước khi có tài khoản: thuộc về tài khoản mở Zenlo đầu tiên', async () => {
  // As Zenlo 0.3.0 left them
  stored.geminiKeys = ['AIzaLEGACYKEY0000']
  stored.storageBackup = { at: 1, data: { '@Zenlo:NOTE:c1': 'ghi chú của 1000' } }
  assert.equal(await zenlo.useAccount('1000'), true)
  assert.deepEqual(await masks(), ['AIza…0000'])
  assert.deepEqual(plain(await zenlo.loadStorage()), { '@Zenlo:NOTE:c1': 'ghi chú của 1000' })
  assert.ok(!has('geminiKeys') && !has('storageBackup'))
  // The next new account gets none of it
  assert.equal(await zenlo.useAccount('2000'), true)
  assert.deepEqual(await masks(), [])
  assert.equal(plain(await zenlo.loadStorage()), null)
})

await test('Mỗi tài khoản Zalo một bộ key và một bản sao lưu', async () => {
  assert.deepEqual(plain(await zenlo.setGeminiKeys(['AIzaOTHERKEY2222'])), { masks: ['AIza…2222'] })
  zenlo.saveStorage({ '@Zenlo:NOTE:c2': 'ghi chú của 2000' })
  await settle()
  assert.equal(await zenlo.useAccount('1000'), true)
  assert.deepEqual(await masks(), ['AIza…0000'])
  assert.deepEqual(plain(await zenlo.loadStorage()), { '@Zenlo:NOTE:c1': 'ghi chú của 1000' })
  assert.deepEqual(stored['geminiKeys:2000'], ['AIzaOTHERKEY2222'])
  assert.equal(stored['storageBackup:2000'].data['@Zenlo:NOTE:c2'], 'ghi chú của 2000')
})

await test('Tài khoản đã có key: key cũ bị bỏ, không chuyển sang tài khoản khác', async () => {
  stored.geminiKeys = ['AIzaLEGACYKEY5555']
  assert.equal(await zenlo.useAccount('1000'), true)
  assert.deepEqual(await masks(), ['AIza…0000'])
  assert.ok(!has('geminiKeys'))
})

await test('Trang Zalo web chỉ nhận key đã che', async () => {
  const settings = await zenlo.getSettings()
  assert.ok(!JSON.stringify(settings).includes('AIzaLEGACYKEY0000'))
  assert.ok(!JSON.stringify(await zenlo.setGeminiKeys([0])).includes('AIzaLEGACYKEY0000'))
})

await test('Mã tài khoản lạ, danh sách key sai dạng: báo lỗi, không đổi gì', async () => {
  for (const uid of ['../x', '', '__proto__', 'a'.repeat(65), 42, null]) {
    assert.ok((await zenlo.useAccount(uid)).error, String(uid))
  }
  assert.match((await zenlo.setGeminiKeys('AIzaFAKEKEY0000')).error, /không hợp lệ/)
  assert.deepEqual(await masks(), ['AIza…0000'])
})

console.log('\n[Zalo web]')
console.log(results.join('\n'))
console.log(process.exitCode ? '\nCó test lỗi.' : '\nTất cả test Zalo web đều qua.')
