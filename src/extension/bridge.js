/* global chrome */
/*
  Zenlo – trình quản lí hội thoại Zalo

  Browser extension, the content script in its own world beside Zalo web's page. Zalo's page cannot
  read anything here, so the Gemini keys stay here, in the extension's storage. Answers what
  window.$zenlo (shim.js) asks, and runs Gemini with the same model chain as Zalo PC
  (src/shared/gemini.js). Gemini is called from here, not from the page (Zalo web's CSP does not
  allow it) nor from the extension's service worker (Chrome stops a service worker whose fetch
  waits more than 30 seconds, and a busy free key can keep Gemini quiet that long).
*/

import { MAX_KEYS, maskKey, hideKeys, pickKeys, createGemini } from '../shared/gemini.js'
import { fetchJSON, streamGemini } from './gemini-fetch.js'

const TAG = 'zenlo-ext'
const LATEST_RELEASE = 'https://api.github.com/repos/stephitnoob/zenlo/releases/latest'
// What the page may send: a request's text (the summary panel splits a conversation into parts of
// 300 000 characters, the digest packs 60 000) and the localStorage mirror
const MAX_REQUEST_CHARS = 2000000
const MAX_BACKUP_CHARS = 20000000

// Where the extension's files are, for the page's stylesheet (styles.js)
document.documentElement.dataset.zenloBase = chrome.runtime.getURL('')

// ---------- Storage ----------

async function read (key, fallback) {
  const value = (await chrome.storage.local.get(key))[key]
  return value === undefined ? fallback : value
}

const write = (key, value) => chrome.storage.local.set({ [key]: value })

// The Zalo account logged in on this tab, as the page says once Zalo has started. Gemini keys and
// the storage mirror are kept per account ("geminiKeys:<id>", "storageBackup:<id>"), so people who
// share a browser and take turns in Zalo web neither see nor use each other's.
let account = ''
const NO_ACCOUNT = 'Zenlo chưa biết tài khoản Zalo nào đang đăng nhập. Đợi Zalo web mở xong rồi thử lại.'
// Zalo's ids are digits; never a name objects already have ("__proto__")
const isAccountId = (uid) => typeof uid === 'string' && /^[\w-]{1,64}$/.test(uid) && !(uid in Object.prototype)

async function getKeys (owner = account) {
  if (!owner) return []
  const keys = await read(`geminiKeys:${owner}`, [])
  return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && key) : []
}

// The keys and the mirror saved before Zenlo knew accounts ("geminiKeys", "storageBackup") go to the
// first account that opens it; an account that already has its own keeps them, and the old ones go
async function useAccount (uid) {
  if (account !== uid) gemini.resetModels()
  account = uid
  const legacy = await chrome.storage.local.get(['geminiKeys', 'storageBackup'])
  const mine = await chrome.storage.local.get([`geminiKeys:${uid}`, `storageBackup:${uid}`])
  const moves = {}
  if (legacy.geminiKeys !== undefined && mine[`geminiKeys:${uid}`] === undefined) moves[`geminiKeys:${uid}`] = legacy.geminiKeys
  if (legacy.storageBackup !== undefined && mine[`storageBackup:${uid}`] === undefined) moves[`storageBackup:${uid}`] = legacy.storageBackup
  if (Object.keys(moves).length) await chrome.storage.local.set(moves)
  if (legacy.geminiKeys !== undefined || legacy.storageBackup !== undefined) await chrome.storage.local.remove(['geminiKeys', 'storageBackup'])
}

// A short id for a key in the quota list (cyrb53): the list then never holds the key itself
function keyId (key) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(0, 12)
}

const gemini = createGemini({
  getKeys,
  keyId,
  loadQuota: () => read('geminiQuota', {}),
  saveQuota: (quota) => write('geminiQuota', quota),
  getJSON: fetchJSON,
  stream: streamGemini
})

// ---------- Messages from the page ----------

const post = (message) => window.postMessage({ [TAG]: 'to-page', ...message }, window.location.origin)

// Once the extension is reloaded or updated, this script stays in a tab that was already open but is
// cut off from the extension: every storage call then fails with "Extension context invalidated."
function errorText (error) {
  if (!chrome.runtime || !chrome.runtime.id) return 'Zenlo vừa được cập nhật hoặc tải lại. Hãy tải lại trang Zalo web (F5).'
  return hideKeys(String((error && error.message) || error))
}

const handlers = {
  // Masks only ("AIza…x9Qk"): the keys themselves never leave this script
  async getSettings () {
    return { geminiKeys: (await getKeys()).map(maskKey), maxKeys: MAX_KEYS, web: true }
  },
  // true, or { error }
  async useAccount (uid) {
    if (!isAccountId(uid)) return { error: 'Mã tài khoản Zalo không hợp lệ.' }
    await useAccount(uid)
    return true
  },
  // { error } with the message as written; the new list right away, so the page numbers its rows again
  async setGeminiKeys (entries) {
    // Not a list: an error, never "remove every key"
    if (!Array.isArray(entries)) return { error: 'Danh sách key không hợp lệ.' }
    // Taken now: the keys go to the account that was logged in when they were sent
    const owner = account
    if (!owner) return { error: NO_ACCOUNT }
    try {
      const keys = pickKeys(await getKeys(owner), entries)
      await write(`geminiKeys:${owner}`, keys)
      gemini.resetModels()
      return { masks: keys.map(maskKey) }
    } catch (error) {
      return { error: error.message }
    }
  },
  geminiStatus: () => gemini.status(),
  async saveStorage (data) {
    const owner = account
    if (!owner || !data || typeof data !== 'object' || JSON.stringify(data).length > MAX_BACKUP_CHARS) return
    await write(`storageBackup:${owner}`, { at: Date.now(), data })
  },
  async loadStorage () {
    if (!account) return null
    const backup = await read(`storageBackup:${account}`, null)
    return (backup && backup.data) || null
  },
  // The newest release on GitHub: { tag } or { error }. The extension is downloaded from there as a
  // zip and loaded by hand, so no store updates it.
  async latestRelease () {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, credentials: 'omit' })
      if (response.status !== 200) return { error: `GitHub trả lời mã ${response.status}.` }
      const release = await response.json()
      return { tag: String(release.tag_name || '') }
    } catch (error) {
      if (controller.signal.aborted) return { error: 'Hết thời gian chờ GitHub.' }
      return { error: error instanceof SyntaxError ? 'Không đọc được trả lời của GitHub.' : 'Không kết nối được GitHub.' }
    } finally {
      clearTimeout(timer)
    }
  }
}

const running = new Map()
// Gemini runs: moves on from the model that keeps the user waiting ("Chuyển model khác")
const skippers = new Map()

function startRun (id, request) {
  const send = (payload) => post({ kind: 'event', id, payload })
  let finished = false
  const finish = (payload) => {
    if (finished) return
    finished = true
    running.delete(id)
    skippers.delete(id)
    send(payload)
  }
  if (!request || typeof request !== 'object') return finish({ type: 'error', message: 'Yêu cầu không hợp lệ.' })
  // Gemini's keys are the account's: none until Zalo web has said who is logged in
  if (!account) return finish({ type: 'error', message: NO_ACCOUNT })
  const chars = ['systemPrompt', 'instruction', 'note', 'input'].reduce((sum, field) => sum + String(request[field] || '').length, 0)
  if (chars > MAX_REQUEST_CHARS) return finish({ type: 'error', message: 'Đoạn cần tóm tắt quá dài.' })
  gemini.run(send, finish, request, {
    onCancel: (fn) => running.set(id, fn),
    onSkip: (fn) => skippers.set(id, fn)
  }).catch((error) => finish({ type: 'error', message: errorText(error) }))
}

window.addEventListener('message', (event) => {
  const data = event.source === window && event.data
  if (!data || data[TAG] !== 'to-bridge' || typeof data.id !== 'string') return
  if (data.kind === 'call') {
    const handler = Object.prototype.hasOwnProperty.call(handlers, data.method) ? handlers[data.method] : null
    Promise.resolve()
      .then(() => (handler ? handler(...(Array.isArray(data.args) ? data.args : [])) : null))
      .then((result) => post({ kind: 'reply', id: data.id, result }), (error) => post({ kind: 'reply', id: data.id, error: errorText(error) }))
  } else if (data.kind === 'run') {
    startRun(data.id, data.request)
  } else if (data.kind === 'cancel') {
    const cancel = running.get(data.id)
    if (cancel) cancel()
    // The page stopped listening already; a cancelled run never finishes on its own
    running.delete(data.id)
    skippers.delete(data.id)
  } else if (data.kind === 'skip') {
    const skip = skippers.get(data.id)
    if (skip) skip()
  }
})
