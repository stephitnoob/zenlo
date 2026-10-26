/*
  Zenlo – tests Zenlo's real main process (dist/zenlo-main.js) against a fake codex.exe
  (test/codex/FakeCodex.cs), with Electron replaced by a small stand-in.

  npm run build && node test/codex/run.mjs

  What this cannot prove: the real CLI's behaviour with a real ChatGPT plan (its exact limit
  messages, model names, the global AGENTS.md), only that Zenlo handles what the source shows.
*/

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FAKE_DIR = path.join(ROOT, 'build', 'test', 'codex')
const FAKE = path.join(FAKE_DIR, 'codex.exe')
const LOG = path.join(FAKE_DIR, 'last-run.txt')
const require = createRequire(import.meta.url)

// ---------- One test process per login state (Zenlo keeps the login check for a minute) ----------

if (!process.argv[2]) {
  fs.mkdirSync(FAKE_DIR, { recursive: true })
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  execFileSync(csc, ['/nologo', '/codepage:65001', `/out:${FAKE}`, path.join(ROOT, 'test', 'codex', 'FakeCodex.cs')], { stdio: 'inherit' })
  let failed = 0
  for (const login of ['chatgpt', 'none', 'apikey', 'missing']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), login], { stdio: 'inherit' })
    if (result.status !== 0) failed++
  }
  console.log(failed ? `\n${failed} nhóm test lỗi.` : '\nTất cả test Codex đều qua.')
  process.exit(failed ? 1 : 0)
}

// ---------- Inside one test process ----------

const login = process.argv[2]
const handlers = {}
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-test-appdata-'))
const electron = {
  app: {
    getPath: () => appData,
    on: () => {},
    whenReady: () => new Promise(() => {})
  },
  session: { defaultSession: null, fromPartition: () => ({ setPreloads: () => {}, getPreloads: () => [] }) },
  ipcMain: {
    on: (name, fn) => { handlers[name] = fn },
    handle: (name, fn) => { handlers[name] = fn }
  },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  shell: { openExternal: () => {} }
}
const Module = require('node:module')
const load = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron
  return load.call(this, request, ...rest)
}

// Only the fake may be found: the user folders Zenlo looks in for a real Codex (standalone or npm)
// point at an empty folder, and PATH holds just the fake's folder. A real Codex must never run
// here: it would send the test text to OpenAI and use the plan's quota.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-test-home-'))
for (const name of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME']) process.env[name] = empty
process.env.PATH = login === 'missing' ? empty : FAKE_DIR
process.env.FAKE_CODEX_LOGIN = login
process.env.FAKE_CODEX_LOG = LOG
process.env.CODEX_API_KEY = 'should-be-removed'
process.env.OPENAI_API_KEY = 'should-be-removed'
require(path.join(ROOT, 'dist', 'zenlo-main.js'))

const trusted = { senderFrame: { url: 'file:///zalo/index.html' } }

function summarize (scenario, request = {}) {
  process.env.FAKE_CODEX_SCENARIO = scenario
  fs.rmSync(LOG, { force: true })
  return new Promise((resolve) => {
    const events = []
    const event = {
      ...trusted,
      sender: {
        isDestroyed: () => false,
        send: (channel, payload) => {
          events.push(payload)
          if (payload.type === 'done' || payload.type === 'error') resolve({ events, last: payload })
        }
      }
    }
    handlers['zenlo:summary:run'](event, {
      id: `t-${scenario}-${Math.random()}`,
      provider: 'codex',
      model: 'default',
      effort: 'low',
      systemPrompt: 'Bạn tóm tắt cuộc trò chuyện Zalo cho người dùng.',
      instruction: 'Tóm tắt giúp mình.',
      input: '<transcript>\n08:30 Chị Hoa: (@Tôi) mai em gửi chị slide trước 9h\n</transcript>',
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

console.log(`\n[đăng nhập: ${login}]`)

await test('Cài đặt báo đúng trạng thái Codex', async () => {
  const settings = await handlers['zenlo:settings:get'](trusted)
  if (login === 'missing') {
    assert.equal(settings.codex.path, null)
  } else {
    assert.equal(settings.codex.path, FAKE)
    assert.equal(settings.codex.loggedIn, login !== 'none')
    if (login === 'apikey') assert.match(settings.codex.account, /API key/)
  }
})

if (login === 'chatgpt') {
  await test('Thành công: trả đúng câu trả lời, có sự kiện text', async () => {
    const { events, last } = await summarize('success')
    assert.equal(last.type, 'done')
    assert.match(last.result, /Gửi chị Hoa slide trước 9h mai/)
    assert.ok(events.some((e) => e.type === 'text'))
  })

  await test('Lệnh gọi sạch: chỉ đọc, thư mục trống, tắt công cụ, đúng effort, prompt qua stdin', async () => {
    await summarize('success', { effort: 'high' })
    const log = fs.readFileSync(LOG, 'utf8')
    const args = log.split('\nCWD\n')[0].split('\n').slice(1)
    for (const flag of ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']) assert.ok(args.includes(flag), flag)
    assert.equal(args[args.indexOf('-s') + 1], 'read-only')
    for (const config of ['project_doc_max_bytes=0', 'web_search="disabled"', 'features.shell_tool=false', 'model_reasoning_effort="high"']) assert.ok(args.includes(config), config)
    assert.ok(args.some((a) => a.startsWith('instructions="Bạn tóm tắt cuộc trò chuyện Zalo')), 'instructions')
    assert.equal(args[args.length - 1], '-')
    assert.ok(!args.includes('-m'), 'no -m for the default model')
    const cwd = log.split('\nCWD\n')[1].split('\n')[0]
    assert.match(path.basename(cwd), /^zenlo-codex-/)
    // Removed once Codex has exited, a moment after the answer
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.ok(!fs.existsSync(cwd), 'the empty folder is removed afterwards')
    assert.match(log, /ENV CODEX_API_KEY=\n/)
    assert.match(log, /ENV OPENAI_API_KEY=\n/)
    const prompt = log.split('\nPROMPT\n')[1]
    assert.ok(prompt.indexOf('<transcript>') < prompt.indexOf('Tóm tắt giúp mình.'), 'transcript first, request last')
  })

  await test('Model được truyền bằng -m', async () => {
    await summarize('success', { model: 'gpt-6-luna' })
    const args = fs.readFileSync(LOG, 'utf8').split('\nCWD\n')[0].split('\n')
    assert.equal(args[args.indexOf('-m') + 1], 'gpt-6-luna')
  })

  await test('Tên model lạ không được truyền cho Codex', async () => {
    await summarize('success', { model: '--dangerously-bypass-approvals-and-sandbox' })
    const args = fs.readFileSync(LOG, 'utf8').split('\nCWD\n')[0].split('\n')
    assert.ok(!args.includes('-m'))
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'))
  })

  await test('Kiểm tra model: danh sách của gói, bỏ model ẩn, kèm danh sách Codex biết', async () => {
    delete process.env.FAKE_CODEX_CATALOG
    const result = await handlers['zenlo:models:check'](trusted, 'codex')
    assert.deepEqual(result.available.map((m) => m.id), ['gpt-6-luna', 'gpt-5.6-luna'])
    assert.deepEqual(result.available[1].efforts, ['low', 'medium', 'high'])
    assert.equal(result.available[0].label, 'GPT-6-Luna')
    assert.deepEqual(result.known.map((m) => m.id), ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-luna'])
  })

  await test('Kiểm tra model: không làm mới được thì báo lỗi', async () => {
    process.env.FAKE_CODEX_CATALOG = 'fail'
    const result = await handlers['zenlo:models:check'](trusted, 'codex')
    delete process.env.FAKE_CODEX_CATALOG
    assert.match(result.error, /Không lấy được danh sách model/)
    assert.equal(result.known.length, 3)
  })

  await test('Kiểm tra model Claude: đọc danh sách Claude Code lưu trên máy', async () => {
    const bin = path.join(empty, '.local', 'bin')
    const cache = path.join(empty, '.claude', 'cache', 'model-catalog')
    fs.mkdirSync(bin, { recursive: true })
    fs.mkdirSync(cache, { recursive: true })
    // Any program will do: its "--version" prints nothing, so no version limit applies
    fs.copyFileSync(FAKE, path.join(bin, 'claude.exe'))
    const model = (id, family, section, efforts) => ({ id, name: id, short_name: family, section, runtime: { family, effort_levels: efforts, default_effort: 'medium' } })
    fs.writeFileSync(path.join(cache, 'a-cc.json'), JSON.stringify({
      catalog: {
        config: {
          models: [
            model('claude-opus-5-5', 'opus', 'main', ['low', 'medium', 'high', 'xhigh', 'max']),
            model('claude-sonnet-5-5', 'sonnet', 'main', ['low', 'medium', 'high']),
            model('claude-opus-4-6', 'opus', 'overflow', ['low', 'high'])
          ]
        }
      }
    }))
    const result = await handlers['zenlo:models:check'](trusted, 'claude')
    assert.deepEqual(result.available.map((m) => m.id), ['opus', 'sonnet'])
    assert.deepEqual(result.available[1].efforts, ['low', 'medium', 'high'])
  })

  const errors = {
    usage: /hết lượt dùng Codex, thử lại lúc 3:05 PM/,
    'usage-plus': /hết lượt dùng Codex, thử lại lúc Oct 26th, 2026 3:05 PM/,
    upgrade: /cần gói Plus|Cần gói Plus/i,
    badmodel: /Model đã chọn không dùng được/,
    unauthorized: /chưa đăng nhập/,
    network: /Không kết nối được tới OpenAI/,
    crash: /Codex báo lỗi|thoát với mã 101/,
    tooLong: /Codex báo lỗi: turn\/start: Input exceeds/
  }
  for (const [scenario, expected] of Object.entries(errors)) {
    await test(`Lỗi "${scenario}" thành thông báo dễ hiểu`, async () => {
      const { last } = await summarize(scenario)
      assert.equal(last.type, 'error')
      assert.match(last.message, expected, last.message)
    })
  }
} else if (login === 'none') {
  await test('Chưa đăng nhập: báo chạy codex login, không gọi exec', async () => {
    const { last } = await summarize('success')
    assert.equal(last.type, 'error')
    assert.match(last.message, /codex login/)
    assert.ok(!fs.existsSync(LOG), 'exec was not run')
  })
} else if (login === 'apikey') {
  await test('Đăng nhập bằng API key: từ chối chạy để không bị tính tiền API', async () => {
    const { last } = await summarize('success')
    assert.equal(last.type, 'error')
    assert.match(last.message, /API key/)
    assert.ok(!fs.existsSync(LOG), 'exec was not run')
  })
} else if (login === 'missing') {
  await test('Chưa cài Codex: báo không tìm thấy', async () => {
    const { last } = await summarize('success')
    assert.equal(last.type, 'error')
    assert.match(last.message, /Không tìm thấy Codex/)
  })
}

console.log(results.join('\n'))
fs.rmSync(appData, { recursive: true, force: true })
process.exit(process.exitCode || 0)
