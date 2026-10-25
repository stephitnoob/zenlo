/*
  Zenlo – trình quản lí hội thoại Zalo

  Main process: runs the AI the user chose and streams the answer back to the renderer through IPC.
  - Claude: Claude Code headless (`claude -p`) on the user's own Claude Pro/Max subscription
  - Codex: OpenAI's Codex CLI (`codex exec`) on the user's ChatGPT plan
  - Gemini: the Gemini API with the user's own API key, kept encrypted with Windows' safeStorage
*/

const { app, session, ipcMain, safeStorage, shell } = require('electron')
const { spawn } = require('child_process')
const https = require('https')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')

const PARTITION_NAME = 'persist:zalo'
const PRELOAD_PATH = path.join(__dirname, 'zenlo-preload.js')

const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus']
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const GEMINI_EFFORTS = ['low', 'medium', 'high']
// The only host Zenlo sends messages to for Gemini. Certificates are always checked, whatever
// NODE_TLS_REJECT_UNAUTHORIZED says, and the key goes in a header, never in the URL.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'
const GEMINI_TLS = { rejectUnauthorized: true, minVersion: 'TLSv1.2' }

const running = new Map()

// ---------- Claude Code ----------

const findClaudeExecutable = () => {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', name),
    path.join(os.homedir(), '.claude', 'local', name)
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

// Variables that could send the messages somewhere else, switch to another billing or provider,
// weaken TLS, or load code into Claude Code. Zalo's environment is inherited, so they are removed
// whatever set them.
const UNSAFE_ENV = [
  // Claude Code must use the Claude subscription login, not API billing
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  // Another endpoint or provider for the same messages
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_CUSTOM_HEADERS',
  // TLS and code injection into a Node-based program
  'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'SSLKEYLOGFILE'
]

const getChildEnv = () => {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (UNSAFE_ENV.includes(name.toUpperCase())) delete env[name]
  }
  // Keep the user's own CLAUDE.md and memory files out of the summary context
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
  return env
}

const runClaude = (send, finish, { id, model, effort, systemPrompt, instruction, input }) => {
  const args = [
    '-p', instruction,
    '--model', CLAUDE_MODELS.includes(model) ? model : 'sonnet',
    '--effort', CLAUDE_EFFORTS.includes(effort) ? effort : 'medium',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    // Skip the user's settings (hooks, plugins, slash commands) so nothing extra enters the context
    '--setting-sources', '',
    '--disable-slash-commands',
    '--system-prompt', systemPrompt
  ]

  const child = spawn(findClaudeExecutable() || 'claude', args, {
    cwd: os.tmpdir(),
    env: getChildEnv(),
    windowsHide: true
  })
  running.set(id, () => child.kill())

  let buffer = ''
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue

      let event
      try {
        event = JSON.parse(line)
      } catch (error) {
        continue
      }

      if (event.type === 'stream_event' && event.event && event.event.type === 'content_block_delta' && event.event.delta && event.event.delta.type === 'text_delta') {
        send({ type: 'text', text: event.event.delta.text })
      } else if (event.type === 'result') {
        finish({ type: 'done', isError: !!event.is_error, result: event.result || '' })
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  child.on('error', (error) => {
    const message = error.code === 'ENOENT'
      ? 'Không tìm thấy Claude Code (lệnh "claude"). Hãy cài Claude Code và đăng nhập bằng tài khoản Claude Pro/Max.'
      : String(error.message || error)
    finish({ type: 'error', message })
  })

  child.on('close', (code) => {
    if (code === 0) {
      finish({ type: 'error', message: 'Claude Code kết thúc mà không trả kết quả.' })
    } else {
      finish({ type: 'error', message: stderr.trim() || `Claude Code thoát với mã ${code}.` })
    }
  })

  child.stdin.on('error', () => {})
  child.stdin.end(input, 'utf8')
}

// ---------- Codex (ChatGPT) ----------

// OpenAI's Codex CLI, logged in with the user's ChatGPT plan. Run as `codex exec` with the summary
// prompt as its whole instructions, read-only, in an empty folder, without tools, the user's
// config.toml or project AGENTS.md. (Codex always reads the global $CODEX_HOME/AGENTS.md, if the
// user has one; no setting turns that off.)
const CODEX_MODELS = ['gpt-5.5']
const CODEX_EFFORTS = ['low', 'medium', 'high']

// The codex.exe itself, never npm's .cmd shim (quoting through cmd.exe is unsafe)
const findCodexExecutable = () => {
  if (process.platform !== 'win32') return null
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const vendor = (arch) => [
    path.join(roaming, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`),
    path.join(roaming, 'npm', 'node_modules', '@openai', `codex-win32-${arch}`)
  ].map((dir) => path.join(dir, 'vendor', `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'bin', 'codex.exe'))
  const candidates = [
    // The standalone installer (install.ps1)
    path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(os.homedir(), '.codex', 'packages', 'standalone', 'current', 'bin', 'codex.exe'),
    // npm install -g @openai/codex
    ...vendor('x64'),
    ...vendor('arm64'),
    // Anything else on PATH
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, 'codex.exe'))
  ]
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch (error) {
      return false
    }
  }) || null
}

// Variables that would make Codex bill an API key instead of the ChatGPT plan, or send the
// messages somewhere else
const CODEX_UNSAFE_ENV = [
  'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_SANDBOX', 'CODEX_OSS_BASE_URL', 'CODEX_OSS_PORT', 'RUST_LOG'
]

const getCodexEnv = () => {
  const env = getChildEnv()
  for (const name of Object.keys(env)) {
    if (CODEX_UNSAFE_ENV.includes(name.toUpperCase())) delete env[name]
  }
  env.RUST_LOG = 'error'
  return env
}

// "codex login status": { loggedIn, mode } (mode "chatgpt" or "apikey"); null when unknown.
// Kept for a minute, since the settings and the drawer ask often.
let codexLogin = null
const getCodexLogin = (exe) => {
  if (!exe) return Promise.resolve(null)
  if (codexLogin && codexLogin.exe === exe && Date.now() - codexLogin.at < 60 * 1000) return Promise.resolve(codexLogin.value)
  return new Promise((resolve) => {
    let output = ''
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      codexLogin = { exe, at: Date.now(), value }
      resolve(value)
    }
    let child
    try {
      child = spawn(exe, ['login', 'status'], { cwd: os.tmpdir(), env: getCodexEnv(), windowsHide: true })
    } catch (error) {
      return finish(null)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (/Logged in using ChatGPT/i.test(output)) finish({ loggedIn: true, mode: 'chatgpt' })
      else if (/API key configured/i.test(output)) finish({ loggedIn: true, mode: 'apikey' })
      else if (/Not logged in/i.test(output) || code === 1) finish({ loggedIn: false })
      else finish(null)
    })
    setTimeout(() => {
      try {
        child.kill()
      } catch (error) {}
      finish(null)
    }, 15000)
  })
}

// Codex's error texts (English) as a short Vietnamese message
const codexError = (message) => {
  const text = String(message || '').trim()
  if (/usage limit|quota exceeded/i.test(text)) {
    const reset = text.match(/try again at ([^.]+)\./i)
    return `Gói ChatGPT đã hết lượt dùng Codex${reset ? `, thử lại lúc ${reset[1].trim()}` : ', thử lại sau'}. Có thể tạm chuyển sang Gemini trong Cài đặt.`
  }
  if (/upgrade to plus/i.test(text)) return 'Gói ChatGPT của bạn chưa dùng được Codex. Cần gói Plus trở lên.'
  if (/not logged in|unauthori[sz]ed|\b401\b|log ?in/i.test(text)) return 'Codex chưa đăng nhập. Mở Terminal, chạy "codex login" và đăng nhập bằng tài khoản ChatGPT.'
  if (/model_not_found|model metadata for|model .*(not found|does not exist|not supported|unsupported)|unknown model/i.test(text)) {
    return 'Model đã chọn không dùng được với tài khoản ChatGPT này. Trong Cài đặt Zenlo, chọn Model là "Mặc định của Codex".'
  }
  if (/at capacity|high demand|overloaded/i.test(text)) return 'Máy chủ OpenAI đang quá tải. Thử lại sau ít phút.'
  if (/connection failed|timed out|stream disconnected|retry limit|reading the server response/i.test(text)) {
    return 'Không kết nối được tới OpenAI. Kiểm tra mạng rồi thử lại.'
  }
  return `Codex báo lỗi: ${text || 'không rõ lý do'}`
}

// TOML string for a -c value (JSON strings are valid TOML basic strings for this text)
const tomlString = (text) => JSON.stringify(String(text))

const runCodex = (send, finish, { id, model, effort, systemPrompt, instruction, input }) => {
  const exe = findCodexExecutable()
  if (!exe) {
    return finish({ type: 'error', message: 'Không tìm thấy Codex trên máy. Hãy cài Codex của OpenAI rồi chạy "codex login" để đăng nhập bằng tài khoản ChatGPT.' })
  }
  // An empty folder of its own: nothing for Codex to read, no project AGENTS.md
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-codex-'))
  const cleanUp = () => fs.rm(work, { recursive: true, force: true }, () => {})

  getCodexLogin(exe).then((login) => {
    if (login && login.loggedIn === false) {
      cleanUp()
      return finish({ type: 'error', message: codexError('Not logged in') })
    }
    if (login && login.mode === 'apikey') {
      cleanUp()
      return finish({ type: 'error', message: 'Codex đang đăng nhập bằng API key, sẽ bị tính tiền theo API. Hãy chạy "codex logout" rồi "codex login" và chọn đăng nhập bằng ChatGPT.' })
    }

    const config = [
      `model_reasoning_effort=${tomlString(CODEX_EFFORTS.includes(effort) ? effort : 'medium')}`,
      `instructions=${tomlString(systemPrompt)}`,
      'project_doc_max_bytes=0',
      'web_search="disabled"',
      'features.shell_tool=false',
      'features.multi_agent=false',
      'features.apps=false',
      'features.plugins=false',
      'features.view_image=false',
      'include_environment_context=false',
      'include_permissions_instructions=false',
      'include_apps_instructions=false',
      'include_collaboration_mode_instructions=false',
      'skills.include_instructions=false'
    ]
    const args = [
      'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-C', work,
      ...(CODEX_MODELS.includes(model) ? ['-m', model] : []),
      ...config.flatMap((item) => ['-c', item]),
      // The prompt comes from stdin
      '-'
    ]

    const child = spawn(exe, args, { cwd: work, env: getCodexEnv(), windowsHide: true })
    running.set(id, () => child.kill())

    let buffer = ''
    let stderr = ''
    let answer = ''
    let lastError = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let event
        try {
          event = JSON.parse(line)
        } catch (error) {
          continue
        }
        const item = event.item || {}
        if (event.type === 'item.completed' && item.type === 'agent_message' && item.text) {
          // Codex sends each message whole, not word by word
          answer = item.text
          send({ type: 'text', text: item.text })
        } else if (event.type === 'item.completed' && item.type === 'error' && item.message) {
          if (/model metadata for/i.test(item.message)) lastError = item.message
        } else if (event.type === 'error' && event.message) {
          lastError = event.message
        } else if (event.type === 'turn.failed') {
          finish({ type: 'error', message: codexError((event.error && event.error.message) || lastError) })
        } else if (event.type === 'turn.completed') {
          finish({ type: 'done', isError: false, result: answer })
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      cleanUp()
      finish({ type: 'error', message: error.code === 'ENOENT' ? 'Không tìm thấy Codex trên máy. Hãy cài Codex rồi mở lại Zalo.' : codexError(error.message) })
    })

    child.on('close', (code) => {
      cleanUp()
      if (code === 0 && answer) return finish({ type: 'done', isError: false, result: answer })
      const message = lastError || stderr.trim().split(/\r?\n/).filter((l) => !/^Reading prompt from stdin/i.test(l)).pop() || ''
      finish({ type: 'error', message: message ? codexError(message.replace(/^Error:\s*/, '')) : `Codex thoát với mã ${code} mà không trả kết quả.` })
    })

    // The transcript first, the request after it, as with Gemini
    child.stdin.on('error', () => {})
    child.stdin.end(`${input}\n\n${instruction}`, 'utf8')
  })
}

// ---------- Gemini ----------

// Up to 5 API keys, each encrypted with Windows' safeStorage. Quotas belong to Google Cloud projects,
// so only keys from different projects add quota.
const MAX_KEYS = 5
// Zenlo keeps its own files in %APPDATA%\Zenlo, apart from Zalo's data, so they survive Zalo
// updates, a reinstall of Zalo and Zalo clearing its storage
const ZENLO_DIR = () => {
  const dir = path.join(app.getPath('appData'), 'Zenlo')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Older Zenlo kept these files in Zalo's data folder: move them once
const zenloFile = (name, oldName) => {
  const file = path.join(ZENLO_DIR(), name)
  const old = path.join(app.getPath('userData'), oldName)
  if (!fs.existsSync(file) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, file)
    } catch (error) {}
  }
  return file
}

const SECRETS_FILE = () => zenloFile('secrets.json', 'zenlo-secrets.json')
const QUOTA_FILE = () => zenloFile('gemini-quota.json', 'zenlo-gemini-quota.json')
const STORAGE_BACKUP_FILE = () => path.join(ZENLO_DIR(), 'storage-backup.json')

const readJSONFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch (error) {
    return {}
  }
}

const decrypt = (stored) => {
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch (error) {
    return ''
  }
}

const getGeminiKeys = () => {
  const secrets = readJSONFile(SECRETS_FILE())
  // Older Zenlo kept a single key in "gemini"
  const stored = Array.isArray(secrets.geminiKeys) ? secrets.geminiKeys : secrets.gemini ? [secrets.gemini] : []
  return stored.map(decrypt).filter(Boolean)
}

const setGeminiKeys = (keys) => {
  const clean = [...new Set(keys.map((k) => String(k || '').trim()).filter(Boolean))].slice(0, MAX_KEYS)
  if (clean.length && !safeStorage.isEncryptionAvailable()) throw new Error('Windows không cho mã hoá dữ liệu, nên Zenlo không lưu key.')
  const secrets = readJSONFile(SECRETS_FILE())
  delete secrets.gemini
  secrets.geminiKeys = clean.map((k) => safeStorage.encryptString(k).toString('base64'))
  fs.writeFileSync(SECRETS_FILE(), JSON.stringify(secrets))
  geminiModels = null
}

// A key is remembered by a short hash, never in plain text
const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
const maskKey = (key) => key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••'

// Daily quotas restart at midnight Pacific time (about 14:00–15:00 in Vietnam)
const nextPacificMidnight = (now = Date.now()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
  }).formatToParts(new Date(now)).map((p) => [p.type, Number(p.value)]))
  const wallAsUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offset = wallAsUTC - Math.floor(now / 1000) * 1000
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset
}

// { keyId: { model: resetAt } } for (key, model) pairs out of daily quota, kept on disk
const readQuota = () => {
  const quota = readJSONFile(QUOTA_FILE())
  const now = Date.now()
  for (const id of Object.keys(quota)) {
    for (const model of Object.keys(quota[id])) {
      if (quota[id][model] <= now) delete quota[id][model]
    }
  }
  return quota
}

const markExhausted = (key, model) => {
  const quota = readQuota()
  const id = keyId(key)
  quota[id] = { ...(quota[id] || {}), [model]: nextPacificMidnight() }
  fs.writeFileSync(QUOTA_FILE(), JSON.stringify(quota))
}

const exhaustedUntil = (quota, key, model) => (quota[keyId(key)] || {})[model] || 0

const geminiLabel = (id) => {
  const match = id.match(/^gemini-([\d.]+)-flash(-lite)?$/)
  if (match) return `Gemini ${match[1]} Flash${match[2] ? '-Lite' : ''}`
  if (id === 'gemini-flash-latest') return 'Gemini Flash'
  if (id === 'gemini-flash-lite-latest') return 'Gemini Flash-Lite'
  return id
}

const httpsGetJSON = (url, key) => new Promise((resolve, reject) => {
  const request = https.get(url, { ...GEMINI_TLS, headers: { 'x-goog-api-key': key } }, (response) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => {
      if (response.statusCode !== 200) return reject(new Error(geminiError(response.statusCode, text)))
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
  })
  request.setTimeout(15000, () => request.destroy(new Error('Hết thời gian chờ danh sách model.')))
  request.on('error', reject)
})

// The Flash models the keys can use, newest first, then the Flash-Lite ones newest first:
// e.g. 3.8 → 3.7 → 3.6 → 3.5 Flash → 3.5 → 3.1 Flash-Lite. Cached for an hour or until the keys change.
let geminiModels = null
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

const getGeminiModels = async (keys) => {
  if (geminiModels && Date.now() - geminiModels.at < 60 * 60 * 1000) return geminiModels.list
  let list = FALLBACK_MODELS
  for (const key of keys) {
    try {
      const data = await httpsGetJSON(`${GEMINI_URL}?pageSize=200`, key)
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
      break
    } catch (error) {}
  }
  geminiModels = { list, at: Date.now() }
  return list
}

// How busy each model usually is. Google publishes no load figures: this is a fixed estimate from
// Zenlo's measurements (Oct 2026): the two newest Flash versions are crowded, the next one is
// moderate, older Flash and Flash-Lite are quiet. 3 = đông, 2 = vừa, 1 = thoáng.
const congestionLevel = (model, list) => {
  const flash = list.filter((id) => /-flash$/.test(id))
  const rank = flash.indexOf(model)
  if (rank === 0 || rank === 1) return 3
  if (rank === 2) return 2
  return 1
}

// The reason of a 429: per-day quota (wait for the reset) or per-minute (sent too fast)
const isDailyQuota = (body) => /PerDay/i.test(body) || (/per day|daily/i.test(body) && !/PerMinute/i.test(body))

const geminiError = (status, body) => {
  let message = ''
  try {
    message = JSON.parse(body).error.message
  } catch (error) {}
  if (status === 400 && /API key/i.test(message)) return 'API key Gemini không hợp lệ.'
  if (status === 403) return 'API key Gemini không có quyền dùng model này.'
  if (status === 429) return isDailyQuota(body) ? 'Đã hết lượt trong ngày.' : 'Gửi quá nhanh, hết lượt trong phút.'
  if (status === 503 || status === 500) return 'Máy chủ Gemini đang quá tải.'
  return `Gemini báo lỗi ${status}${message ? ': ' + message : ''}.`
}

// A model that sends nothing for this long is treated as overloaded: Google keeps requests from free
// keys waiting in a queue instead of answering 503 (one waited over 90 s). Thought summaries are
// requested, so a working model sends something within a few seconds. Both waits are settings
// ("Chờ model trả lời", "Thử lại model quá tải sau"); these are the defaults and the limits.
const FIRST_BYTE_TIMEOUT = 10 * 1000
const IDLE_TIMEOUT = 60 * 1000
const RECENT_FAILURE = 5 * 60 * 1000
const clampSetting = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

// One streaming call (server-sent events). Zalo's Electron runs Node 16, which has no fetch.
// Resolves to { status, body } on an HTTP error or a timeout (status 0), or { status: 200, result, blocked }.
const streamGemini = (model, key, body, onText, setCancel, firstByteTimeout = FIRST_BYTE_TIMEOUT) => new Promise((resolve, reject) => {
  let settled = false
  const settle = (fn, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn(value)
  }
  let timer = null
  const arm = (ms) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      request.destroy()
      settle(resolve, { status: 0, body: 'timeout' })
    }, ms)
  }

  const request = https.request(`${GEMINI_URL}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    ...GEMINI_TLS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Content-Length': Buffer.byteLength(body) }
  }, (response) => {
    response.setEncoding('utf8')
    if (response.statusCode !== 200) {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => settle(resolve, { status: response.statusCode, body: text }))
      return
    }

    let buffer = ''
    let result = ''
    let blocked = ''
    response.on('data', (chunk) => {
      arm(IDLE_TIMEOUT)
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
        if (event.promptFeedback && event.promptFeedback.blockReason) blocked = event.promptFeedback.blockReason
        const parts = (event.candidates && event.candidates[0] && event.candidates[0].content && event.candidates[0].content.parts) || []
        for (const part of parts) {
          // Thought summaries only show that the model is working; they are not part of the answer
          if (part.thought || typeof part.text !== 'string') continue
          result += part.text
          onText(part.text)
        }
      }
    })
    response.on('end', () => settle(resolve, { status: 200, result, blocked }))
    // Destroyed (cancel or timeout) after the answer started: Node 16 emits "aborted"/"close", not "end"
    response.on('aborted', () => settle(reject, new Error('aborted')))
    response.on('close', () => settle(reject, new Error('closed')))
  })
  request.on('error', (error) => settle(reject, error))
  setCancel(() => {
    request.destroy()
    settle(reject, new Error('cancelled'))
  })
  arm(firstByteTimeout)
  request.end(body)
})

// Models that failed in the last few minutes, tried last so a busy model does not cost a wait every time
const recentFailures = new Map()

// Order of attempts, from the chosen model down:
// - overloaded / no answer within 10 s: the server is busy, another key will not help → next model
// - out of quota (daily or per minute): that key's project is out → same model with the next key;
//   when every key is out, next model
const runGemini = async (send, finish, { id, model, effort, systemPrompt, instruction, input, timeout, retryWindow }) => {
  const firstByteTimeout = clampSetting(timeout, FIRST_BYTE_TIMEOUT, 3000, 120000)
  const failureWindow = clampSetting(retryWindow, RECENT_FAILURE, 0, 60 * 60 * 1000)
  const keys = getGeminiKeys()
  if (!keys.length) return finish({ type: 'error', message: 'Chưa có API key Gemini. Hãy dán key trong Cài đặt Zenlo.' })

  let cancelled = false
  let cancelRequest = () => {}
  running.set(id, () => {
    cancelled = true
    cancelRequest()
  })

  const all = await getGeminiModels(keys)
  const start = all.indexOf(model)
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
    const quota = readQuota()
    const usable = keys.filter((key) => !badKeys.has(key) && !exhaustedUntil(quota, key, current))
    if (!usable.length) {
      problems.push(`${geminiLabel(current)}: mọi key đã hết lượt trong ngày`)
      skipped.push(current)
      continue
    }

    let moveOn = false
    for (const key of usable) {
      if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
      send({ type: 'status', model: current, label: geminiLabel(current), skipped: skipped.map(geminiLabel) })
      let response
      try {
        // Thinking models sometimes finish with no text at all: ask the same model once more
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await streamGemini(current, key, body, (text) => send({ type: 'text', text }), (fn) => { cancelRequest = fn }, firstByteTimeout)
          if (response.status !== 200 || response.result || response.blocked || cancelled) break
        }
      } catch (error) {
        if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
        recentFailures.set(current, Date.now())
        problems.push(`${geminiLabel(current)}: mất kết nối`)
        moveOn = true
        break
      }

      if (response.status === 200) {
        if (!response.result && response.blocked) return finish({ type: 'error', message: `Gemini từ chối nội dung này (${response.blocked}).` })
        if (response.result) return finish({ type: 'done', isError: false, result: response.result, model: geminiLabel(current), skipped: skipped.map(geminiLabel) })
        // Still empty: treat like a busy model
        recentFailures.set(current, Date.now())
        problems.push(`${geminiLabel(current)}: trả lời rỗng`)
        moveOn = true
        break
      }
      if (response.status === 429) {
        // Out of quota for this key's project: try the same model with the next key
        if (isDailyQuota(response.body)) markExhausted(key, current)
        problems.push(`${geminiLabel(current)} (key ${maskKey(key)}): ${geminiError(429, response.body)}`)
        continue
      }
      if ([0, 500, 503].includes(response.status)) {
        // The model's servers are busy for every key: go down a model
        recentFailures.set(current, Date.now())
        problems.push(`${geminiLabel(current)}: quá tải${response.status === 0 ? ` (không phản hồi sau ${Math.round(firstByteTimeout / 1000)} giây)` : ''}`)
        moveOn = true
        break
      }
      // Invalid key or no access: skip this key from now on
      badKeys.add(key)
      problems.push(`key ${maskKey(key)}: ${geminiError(response.status, response.body)}`)
    }
    skipped.push(current)
    if (!moveOn && cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
  }
  finish({ type: 'error', message: `Không model Gemini nào dùng được lúc này. ${problems.slice(-4).join('; ')}.` })
}

// For the settings page: the models (with the fixed congestion estimate, and whether every key is
// out of quota for the day) and the keys (masked, with the models they ran out of)
const geminiStatus = async () => {
  const keys = getGeminiKeys()
  if (!keys.length) return { models: [], keys: [] }
  const list = await getGeminiModels(keys)
  const quota = readQuota()
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

// ---------- IPC ----------

// Only Zalo's own local pages may use Zenlo
const isTrustedSender = (event) => {
  const url = (event.senderFrame && event.senderFrame.url) || ''
  return url.startsWith('file://')
}

ipcMain.on('zenlo:summary:run', (event, request) => {
  if (!isTrustedSender(event) || !request || !request.id) return
  const sender = event.sender
  const send = (payload) => {
    if (!sender.isDestroyed()) sender.send('zenlo:summary:event', { id: request.id, ...payload })
  }
  let finished = false
  const finish = (payload) => {
    if (finished) return
    finished = true
    running.delete(request.id)
    send(payload)
  }
  if (request.provider === 'gemini') runGemini(send, finish, request)
  else if (request.provider === 'codex') runCodex(send, finish, request)
  else runClaude(send, finish, request)
})

ipcMain.on('zenlo:summary:cancel', (event, id) => {
  if (!isTrustedSender(event)) return
  const cancel = running.get(id)
  if (cancel) cancel()
})

// Links Zenlo may open in the default browser: Google AI Studio (Gemini keys), Claude Code's
// page, Zenlo's website and repository, and e-mail. Anything else is refused.
const EXTERNAL_HOSTS = ['aistudio.google.com', 'ai.google.dev', 'claude.com', 'www.claude.com', 'docs.claude.com', 'github.com']
const EXTERNAL_HOST_SUFFIXES = ['.github.io', '.pages.dev']

const isAllowedExternal = (url) => {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    return false
  }
  if (parsed.protocol === 'mailto:') return true
  if (parsed.protocol !== 'https:') return false
  return EXTERNAL_HOSTS.includes(parsed.hostname) || EXTERNAL_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix))
}

ipcMain.handle('zenlo:open-external', (event, url) => {
  if (!isTrustedSender(event) || !isAllowedExternal(String(url))) return false
  shell.openExternal(String(url))
  return true
})

// The newest Zenlo release, asked only when the user presses "Kiểm tra bản mới" or turned on the
// daily check in the settings. A plain request to GitHub's public API; nothing about the user is sent.
const LATEST_RELEASE = 'https://api.github.com/repos/stephitnoob/zenlo/releases/latest'

ipcMain.handle('zenlo:update:latest', (event) => {
  if (!isTrustedSender(event)) return null
  return new Promise((resolve) => {
    const headers = { 'User-Agent': 'Zenlo', Accept: 'application/vnd.github+json' }
    const request = https.get(LATEST_RELEASE, { ...GEMINI_TLS, headers }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve({ error: `GitHub trả lời mã ${response.statusCode}.` })
        try {
          const release = JSON.parse(text)
          resolve({ tag: String(release.tag_name || '') })
        } catch (error) {
          resolve({ error: 'Không đọc được trả lời của GitHub.' })
        }
      })
    })
    request.setTimeout(10000, () => request.destroy(new Error('Hết thời gian chờ GitHub.')))
    request.on('error', (error) => resolve({ error: error.message }))
  })
})

ipcMain.handle('zenlo:settings:get', async (event) => {
  if (!isTrustedSender(event)) return null
  const codexPath = findCodexExecutable()
  const login = await getCodexLogin(codexPath)
  return {
    geminiKeys: getGeminiKeys(),
    maxKeys: MAX_KEYS,
    claudePath: findClaudeExecutable(),
    codexPath,
    codex: {
      path: codexPath,
      loggedIn: login ? login.loggedIn : null,
      account: login && login.mode === 'chatgpt' ? 'đã đăng nhập bằng ChatGPT' : login && login.mode === 'apikey' ? 'đang dùng API key (nên đăng nhập bằng ChatGPT)' : ''
    },
    encryption: safeStorage.isEncryptionAvailable()
  }
})

ipcMain.handle('zenlo:settings:setGeminiKeys', (event, keys) => {
  if (!isTrustedSender(event)) return false
  setGeminiKeys(Array.isArray(keys) ? keys : [])
  return true
})

// A mirror of Zenlo's localStorage (settings, saved summaries, digest order and ticks) in its own
// folder; the page writes it and reads it back when Zalo's storage was wiped
ipcMain.on('zenlo:storage:save', (event, data) => {
  if (!isTrustedSender(event) || !data || typeof data !== 'object') return
  try {
    fs.writeFileSync(STORAGE_BACKUP_FILE(), JSON.stringify({ at: Date.now(), data }))
  } catch (error) {}
})

ipcMain.handle('zenlo:storage:load', (event) => {
  if (!isTrustedSender(event)) return null
  return readJSONFile(STORAGE_BACKUP_FILE()).data || null
})

ipcMain.handle('zenlo:gemini:status', (event) => {
  if (!isTrustedSender(event)) return null
  return geminiStatus()
})

// ---------- Setup ----------

const addPreload = (targetSession) => {
  const preloads = targetSession.getPreloads()
  if (!preloads.includes(PRELOAD_PATH)) {
    targetSession.setPreloads([...preloads, PRELOAD_PATH])
  }
}

// Dev mode (installed with "npm run zalo:dev"): Ctrl+Shift+R reloads a Zalo window,
// so a rebuilt Zenlo shows up without restarting Zalo
const DEV_MODE = fs.existsSync(path.join(process.resourcesPath || '', 'zenlo-dev'))

if (DEV_MODE) {
  app.on('web-contents-created', (event, contents) => {
    contents.on('before-input-event', (inputEvent, input) => {
      if (input.type !== 'keyDown' || !input.control || !input.shift || input.key.toLowerCase() !== 'r') return
      inputEvent.preventDefault()
      // Zalo asks to stay on the page when it unloads; allow it for this reload
      contents.once('will-prevent-unload', (unloadEvent) => unloadEvent.preventDefault())
      contents.reloadIgnoringCache()
    })
  })
}

// Zalo may create its windows before our whenReady callback runs,
// so the preload is attached as soon as each session is created
app.on('session-created', addPreload)

app.whenReady().then(() => {
  addPreload(session.fromPartition(PARTITION_NAME))
})
