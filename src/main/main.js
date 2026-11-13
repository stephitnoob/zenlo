/* global ZENLO_VERSION */
/*
  Zenlo – trình quản lí hội thoại Zalo

  Main process: runs the AI the user chose and streams the answer back to the renderer through IPC.
  - Claude: Claude Code headless (`claude -p`) on the user's own Claude Pro/Max subscription
  - Codex: OpenAI's Codex CLI (`codex exec`) on the user's ChatGPT plan
  - Gemini: the Gemini API with the user's own API key, kept encrypted with Windows' safeStorage
*/

const { app, session, ipcMain, safeStorage, shell, Notification, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const https = require('https')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')

const PARTITION_NAME = 'persist:zalo'
const PRELOAD_PATH = path.join(__dirname, 'zenlo-preload.js')

const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable']
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Gemini (shared with the browser extension). Certificates are always checked, whatever
// NODE_TLS_REJECT_UNAUTHORIZED says, and the key goes in a header, never in the URL.
const { GEMINI_URL, IDLE_TIMEOUT, MAX_KEYS, maskKey, pickKeys, geminiError, createStreamParser, createGemini } = require('../shared/gemini')
const GEMINI_TLS = { rejectUnauthorized: true, minVersion: 'TLSv1.2' }

const running = new Map()
// Gemini runs only: moves on from the model that keeps the user waiting ("Chuyển model khác")
const skippers = new Map()

// ---------- Claude Code ----------

// Folders on PATH, only absolute ones: a relative entry (or a bare command name) would be looked up
// in the working folder, where anyone could have put a claude.exe
const pathFolders = () => String(process.env.PATH || '').split(path.delimiter).filter((dir) => dir && path.isAbsolute(dir))

const findClaudeExecutable = () => {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', name),
    path.join(os.homedir(), '.claude', 'local', name),
    // Anything else on PATH (winget, other installers)
    ...pathFolders().map((dir) => path.join(dir, name))
  ]
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch (error) {
      return false
    }
  }) || null
}

const CLAUDE_NOT_FOUND = 'Không tìm thấy Claude Code (lệnh "claude"). Hãy cài Claude Code và đăng nhập bằng tài khoản Claude Pro/Max.'

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
  // No telemetry, error reports or update checks: measured 1–2.5 s faster per summary (Oct 2026),
  // at start and before the result, and nothing extra leaves the machine
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  return env
}

const runClaude = (send, finish, { id, model, effort, systemPrompt, instruction, input }) => {
  // The same prompt as Gemini and Codex: the transcript, then the request, all on stdin
  const args = [
    '-p',
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

  const exe = findClaudeExecutable()
  if (!exe) return finish({ type: 'error', message: CLAUDE_NOT_FOUND })
  const child = spawn(exe, args, {
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

      const part = event.type === 'stream_event' && event.event ? event.event : {}
      if (part.type === 'content_block_delta' && part.delta && part.delta.type === 'text_delta') {
        send({ type: 'text', text: part.delta.text })
      } else if (part.type === 'content_block_start' && part.content_block && /thinking/.test(part.content_block.type)) {
        // The page shows that Claude is thinking, not stuck
        send({ type: 'thinking' })
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
    const message = error.code === 'ENOENT' ? CLAUDE_NOT_FOUND : String(error.message || error)
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
  child.stdin.end(`${input}\n\n${instruction}`, 'utf8')
}

// ---------- Codex (ChatGPT) ----------

// OpenAI's Codex CLI, logged in with the user's ChatGPT plan. Run as `codex exec` with the summary
// prompt as its whole instructions, read-only, in an empty folder, without tools, the user's
// config.toml or project AGENTS.md. (Codex always reads the global $CODEX_HOME/AGENTS.md, if the
// user has one; no setting turns that off.)
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
// A model name as Codex lists them ("gpt-6-luna"); anything else is not passed to -m
const CODEX_MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

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
    ...pathFolders().map((dir) => path.join(dir, 'codex.exe'))
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

// "codex login status": { loggedIn, mode } (mode "chatgpt", or "other" for an API key, Bedrock, an
// access token or a workload identity, which may be billed by the API); null when unknown.
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
      else if (/Logged in using|API key configured/i.test(output)) finish({ loggedIn: true, mode: 'other' })
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

const CODEX_NOT_CHATGPT = 'Codex đang đăng nhập bằng API key hoặc cách khác ChatGPT, có thể bị tính tiền theo API. Hãy chạy "codex logout" rồi "codex login" và chọn đăng nhập bằng ChatGPT.'

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

// "codex debug models": the catalog Codex refreshes for the logged-in plan (no request to a model,
// no usage), and with --bundled the one shipped with this Codex. Models are { id, label, efforts,
// defaultEffort }, in Codex's order. available is null when the refresh failed (e.g. offline).
const runCodexJSON = (exe, args) => new Promise((resolve) => {
  let output = ''
  let done = false
  const finish = (value) => {
    if (done) return
    done = true
    resolve(value)
  }
  let child
  try {
    child = spawn(exe, args, { cwd: os.tmpdir(), env: getCodexEnv(), windowsHide: true })
  } catch (error) {
    return finish(null)
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += chunk })
  child.on('error', () => finish(null))
  child.on('close', (code) => {
    try {
      finish(code === 0 ? JSON.parse(output) : null)
    } catch (error) {
      finish(null)
    }
  })
  setTimeout(() => {
    try {
      child.kill()
    } catch (error) {}
    finish(null)
  }, 20000)
})

const codexModelList = (data) => {
  if (!data || !Array.isArray(data.models)) return null
  return data.models
    .filter((m) => m && m.visibility === 'list' && CODEX_MODEL_ID.test(String(m.slug || '')))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))
    .map((m) => ({
      id: m.slug,
      label: String(m.display_name || m.slug).slice(0, 40),
      efforts: (m.supported_reasoning_levels || []).map((l) => l && l.effort).filter((e) => CODEX_EFFORTS.includes(e)),
      defaultEffort: CODEX_EFFORTS.includes(m.default_reasoning_level) ? m.default_reasoning_level : 'medium'
    }))
}

const codexCatalog = async () => {
  const exe = findCodexExecutable()
  if (!exe) return { error: 'Chưa tìm thấy Codex.' }
  const [live, bundled] = await Promise.all([runCodexJSON(exe, ['debug', 'models']), runCodexJSON(exe, ['debug', 'models', '--bundled'])])
  const available = codexModelList(live)
  const known = codexModelList(bundled) || []
  if (!available) return { error: 'Không lấy được danh sách model của Codex.', known }
  return { available, known }
}

// Claude Code keeps the account's model list in its cache folder (cache/model-catalog, the
// "-cc" file for the CLI). Only the "main" models are offered, as Claude Code's aliases, with the
// efforts each one supports. Nothing else in Claude Code's folder is read.
const claudeVersion = (exe) => new Promise((resolve) => {
  let output = ''
  let child
  try {
    child = spawn(exe, ['--version'], { cwd: os.tmpdir(), env: getChildEnv(), windowsHide: true })
  } catch (error) {
    return resolve(null)
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += chunk })
  child.on('error', () => resolve(null))
  child.on('close', () => {
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/)
    resolve(match ? match.slice(1).map(Number) : null)
  })
  setTimeout(() => {
    try {
      child.kill()
    } catch (error) {}
    resolve(null)
  }, 15000)
})

const olderThan = (version, min) => {
  const wanted = String(min || '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((version[i] || 0) !== (wanted[i] || 0)) return (version[i] || 0) < (wanted[i] || 0)
  }
  return false
}

const claudeCatalog = async () => {
  const exe = findClaudeExecutable()
  if (!exe) return { error: 'Chưa tìm thấy Claude Code.' }
  const folder = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'cache', 'model-catalog')
  let files = []
  try {
    files = fs.readdirSync(folder)
      .filter((name) => /-cc\.json$/.test(name))
      .map((name) => ({ file: path.join(folder, name), at: fs.statSync(path.join(folder, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
  } catch (error) {}
  let models = null
  for (const { file } of files) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8')).catalog.config.models
      if (Array.isArray(list)) {
        models = list
        break
      }
    } catch (error) {}
  }
  if (!models) return { error: 'Claude Code chưa lưu danh sách model trên máy. Mở Claude Code một lần rồi thử lại.' }
  const version = await claudeVersion(exe)
  const available = []
  for (const m of models) {
    const runtime = m.runtime || {}
    const family = runtime.family || String(m.short_name || '').toLowerCase()
    if (m.section !== 'main' || !CLAUDE_MODELS.includes(family) || available.some((a) => a.id === family)) continue
    if (version && m.min_claude_code_version && olderThan(version, m.min_claude_code_version)) continue
    const efforts = (runtime.effort_levels || ((m.thinking || {}).effort_options || []).map((o) => o && o.id)).filter((e) => CLAUDE_EFFORTS.includes(e))
    available.push({
      id: family,
      label: String(m.name || m.short_name || family).slice(0, 40),
      efforts,
      defaultEffort: CLAUDE_EFFORTS.includes(runtime.default_effort) ? runtime.default_effort : 'medium'
    })
  }
  return { available }
}

// ---------- Codex, word by word ----------

// "codex exec" sends the answer whole at the end; Codex's app server sends it as it is written.
// The app server always loads the user's config.toml, so Zenlo turns off what could run or read
// anything: every MCP server (by name, from config/read), plugins, apps, memories, notify, history.
// Before the messages are sent it checks a ChatGPT login, that no MCP server runs and that no hook
// is set. Anything unexpected before that point falls back to "codex exec".
const CODEX_HANDSHAKE_TIMEOUT = 30 * 1000
const CODEX_STREAM_CONFIG = [
  'model_provider="openai"',
  'notify=[]',
  'features.memories=false',
  'memories.use_memories=false',
  'memories.generate_memories=false',
  'history.persistence="none"',
  'analytics.enabled=false',
  'sandbox_mode="read-only"',
  'approval_policy="never"'
]

// fallback (codex exec) is null when "codex login status" did not say ChatGPT: exec cannot check
// the login itself, and an API key login is billed
const runCodexStream = ({ exe, work, id, model, effort, systemPrompt, prompt, config, send, finish, fallback, cleanUp }) => {
  const cannotRun = () => {
    cleanUp()
    finish({ type: 'error', message: 'Không chạy được Codex ở chế độ an toàn (còn MCP server hay hook đang bật, hoặc không xác định được Codex đăng nhập bằng gì). Hãy chạy "codex login status" để xem, rồi thử lại.' })
  }
  // Once codex exec has the empty folder, it removes it itself
  let handedOver = false
  const handOver = () => {
    handedOver = true
    fallback()
  }
  let child
  try {
    child = spawn(exe, ['app-server', ...[...config, ...CODEX_STREAM_CONFIG].flatMap((item) => ['-c', item])], { cwd: work, env: getCodexEnv(), windowsHide: true })
  } catch (error) {
    return fallback ? handOver() : cannotRun()
  }

  let buffer = ''
  let stderr = ''
  let nextId = 0
  const pending = new Map()
  // Once the messages are sent there is no fallback: it would ask a second time
  let sent = false
  let over = false
  let cancelled = false
  let answer = ''
  let streamed = ''
  let lastError = ''
  let authMode = null

  const stop = () => {
    over = true
    clearTimeout(timer)
    for (const { reject } of pending.values()) reject(new Error('stopped'))
    pending.clear()
    try {
      child.kill()
    } catch (error) {}
  }
  const giveUp = (reason) => {
    if (over) return
    stop()
    if (cancelled) return
    if (!sent && authMode && authMode !== 'chatgpt') {
      cleanUp()
      return finish({ type: 'error', message: CODEX_NOT_CHATGPT })
    }
    if (!sent) return fallback ? handOver() : cannotRun()
    finish({ type: 'error', message: codexError(lastError || reason) })
  }
  const timer = setTimeout(() => { if (!sent) giveUp('timeout') }, CODEX_HANDSHAKE_TIMEOUT)
  running.set(id, () => {
    cancelled = true
    stop()
  })

  const write = (message) => {
    try {
      child.stdin.write(JSON.stringify(message) + '\n')
    } catch (error) {}
  }
  const call = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++nextId
    pending.set(requestId, { resolve, reject })
    write({ id: requestId, method, params })
  })

  const onNotification = (method, params = {}) => {
    if (method === 'account/updated') {
      authMode = params.authMode || null
    } else if (method === 'mcpServer/startupStatus/updated' && params.status !== 'disabled') {
      giveUp('mcp')
    } else if (method === 'item/started' && params.item && params.item.type === 'reasoning') {
      // The page shows that Codex is thinking, not stuck
      send({ type: 'thinking' })
    } else if (method === 'item/agentMessage/delta' && params.delta) {
      streamed += params.delta
      send({ type: 'text', text: params.delta })
    } else if (method === 'item/completed' && params.item && params.item.type === 'agentMessage' && params.item.text) {
      answer = params.item.text
    } else if (method === 'error' && params.error && !params.willRetry) {
      lastError = params.error.message || lastError
    } else if (method === 'turn/completed') {
      const turn = params.turn || {}
      stop()
      if (cancelled) return
      if (turn.status === 'completed' && (answer || streamed)) return finish({ type: 'done', isError: false, result: answer || streamed })
      finish({ type: 'error', message: codexError((turn.error && turn.error.message) || lastError || `Codex dừng lượt trả lời (${turn.status || 'không rõ'}).`) })
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line || over) continue
      let message
      try {
        message = JSON.parse(line)
      } catch (error) {
        continue
      }
      if (message.id !== undefined && message.method) {
        // Approvals, tool calls, questions: never granted
        write({ id: message.id, error: { code: -32000, message: 'Zenlo không cho phép yêu cầu này.' } })
      } else if (message.id !== undefined) {
        const request = pending.get(message.id)
        if (!request) continue
        pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error.message || 'error'))
        else request.resolve(message.result || {})
      } else if (message.method) {
        onNotification(message.method, message.params)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.stdin.on('error', () => {})
  child.on('error', () => giveUp('spawn'))
  child.on('close', (code) => {
    if (!over) giveUp(stderr.trim().split(/\r?\n/).pop() || `Codex thoát với mã ${code} mà không trả kết quả.`)
    // Again once Codex has exited: removing the folder while it was still Codex's working folder may have failed
    if (!handedOver) cleanUp()
  })

  ;(async () => {
    await call('initialize', { clientInfo: { name: 'zenlo', title: 'Zenlo', version: typeof ZENLO_VERSION === 'string' ? ZENLO_VERSION : 'dev' } })
    write({ method: 'initialized' })
    // Codex (Nov 2026) tells the login only once something asks for it; without asking, the check
    // below saw no login yet and every summary fell back to exec (no streaming, no "thinking").
    // An older Codex without account/read still sends account/updated by itself.
    // Not answered within a few seconds (a Codex that ignores the method): go on without it
    const account = (await Promise.race([
      call('account/read', { refreshToken: false }).catch(() => ({})),
      new Promise((resolve) => setTimeout(() => resolve({}), 5000))
    ])).account
    // Stopped meanwhile: Codex is gone, nothing more to ask it
    if (over) return
    if (!authMode && account && account.type) authMode = account.type
    const effective = (await call('config/read', {})).config || {}
    const off = {}
    for (const name of Object.keys(effective.mcp_servers || {})) off[name] = { enabled: false }
    const { thread } = await call('thread/start', {
      cwd: work,
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      baseInstructions: systemPrompt,
      model: model || null,
      config: { mcp_servers: off, 'features.plugins': false, 'features.apps': false, 'features.memories': false }
    })
    if (!thread || !thread.id) throw new Error('no thread')
    const servers = (await call('mcpServerStatus/list', { threadId: thread.id })).data || []
    const hooks = (await call('hooks/list', {})).data || []
    if (authMode !== 'chatgpt' || servers.some((s) => s.runtimeStatus !== 'disabled') || hooks.some((h) => (h.hooks || []).length)) throw new Error('not isolated')
    if (over) return
    sent = true
    clearTimeout(timer)
    await call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }], effort, model: model || null })
  })().catch((error) => giveUp(error.message))
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
  // Stop works while the login is still being checked (up to 15 s), before Codex starts
  let cancelled = false
  running.set(id, () => {
    cancelled = true
    cleanUp()
  })

  getCodexLogin(exe).then((login) => {
    if (cancelled) return
    if (login && login.loggedIn === false) {
      cleanUp()
      return finish({ type: 'error', message: codexError('Not logged in') })
    }
    if (login && login.mode !== 'chatgpt') {
      cleanUp()
      return finish({ type: 'error', message: CODEX_NOT_CHATGPT })
    }

    const chosenEffort = CODEX_EFFORTS.includes(effort) ? effort : 'medium'
    const chosenModel = model && model !== 'default' && CODEX_MODEL_ID.test(model) ? model : null
    const config = [
      `model_reasoning_effort=${tomlString(chosenEffort)}`,
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
    // The transcript first, the request after it, as with Gemini
    const prompt = `${input}\n\n${instruction}`
    runCodexStream({ exe, work, id, model: chosenModel, effort: chosenEffort, systemPrompt, prompt, config, send, finish, cleanUp, fallback: login ? () => runCodexExec(config, prompt) : null })
  }).catch((error) => {
    cleanUp()
    finish({ type: 'error', message: codexError(error.message) })
  })

  const runCodexExec = (config, prompt) => {
    const args = [
      'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-C', work,
      ...(model && model !== 'default' && CODEX_MODEL_ID.test(model) ? ['-m', model] : []),
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
        if (event.type === 'item.started' && item.type === 'reasoning') {
          send({ type: 'thinking' })
        } else if (event.type === 'item.completed' && item.type === 'agent_message' && item.text) {
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

    child.stdin.on('error', () => {})
    child.stdin.end(prompt, 'utf8')
  }
}

// ---------- Gemini ----------

// Up to 5 API keys (MAX_KEYS), each encrypted with Windows' safeStorage. The model chain, quotas and
// errors are shared with the browser extension (src/shared/gemini.js); only where the keys and
// quotas are kept and how a request is sent are here.
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
// One mirror per Zalo account; the one without an account is from before Zenlo knew accounts
const STORAGE_BACKUP_FILE = (uid = '') => path.join(ZENLO_DIR(), uid ? `storage-backup-${uid}.json` : 'storage-backup.json')

// The Zalo account logged in, as the page says once Zalo has started. Gemini keys and the storage
// mirror are kept per account, so people who share a Windows user and take turns in Zalo neither
// see nor use each other's.
let account = ''
const NO_ACCOUNT = 'Zenlo chưa biết tài khoản Zalo nào đang đăng nhập. Đợi Zalo mở xong rồi thử lại.'
// Zalo's ids are digits; never a name objects already have ("__proto__"), never a path
const isAccountId = (uid) => typeof uid === 'string' && /^[\w-]{1,64}$/.test(uid) && !(uid in Object.prototype)
const own = (object, key) => object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined

// Written to a temporary file and moved into place, so a file is never left cut in half (the
// installer closes Zalo with taskkill, which could land in the middle of a write)
// A virus scanner or the search indexer may hold the new file for a moment (EPERM/EBUSY on rename):
// a few short retries, then a plain write, never a temporary file left behind.
const writeFileAtomic = (file, text) => {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, text)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(temp, file)
      return
    } catch (error) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30)
    }
  }
  try {
    fs.unlinkSync(temp)
  } catch (error) {}
  fs.writeFileSync(file, text)
}

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

// secrets.json: { accounts: { <uid>: { geminiKeys: [encrypted…] } } }
const getGeminiKeys = () => {
  if (!account) return []
  const stored = own(own(own(readJSONFile(SECRETS_FILE()), 'accounts'), account), 'geminiKeys')
  return (Array.isArray(stored) ? stored : []).map(decrypt).filter(Boolean)
}

// The page never sees a saved key, only its mask. It sends back the list it wants (see pickKeys).
const setGeminiKeys = (entries) => {
  if (!account) throw new Error(NO_ACCOUNT)
  const clean = pickKeys(getGeminiKeys(), entries)
  if (clean.length && !safeStorage.isEncryptionAvailable()) throw new Error('Windows không cho mã hoá dữ liệu, nên Zenlo không lưu key.')
  const secrets = readJSONFile(SECRETS_FILE())
  if (!own(secrets, 'accounts') || typeof secrets.accounts !== 'object') secrets.accounts = {}
  secrets.accounts[account] = { geminiKeys: clean.map((k) => safeStorage.encryptString(k).toString('base64')) }
  writeFileAtomic(SECRETS_FILE(), JSON.stringify(secrets))
  gemini.resetModels()
}

// The keys and the mirror saved before Zenlo knew accounts go to the first account that opens it;
// an account that already has its own keeps them, and the old ones are dropped
const useAccount = (uid) => {
  if (account !== uid) gemini.resetModels()
  account = uid
  const secrets = readJSONFile(SECRETS_FILE())
  // Older Zenlo kept one list in "geminiKeys", and before that a single key in "gemini"
  const legacy = Array.isArray(secrets.geminiKeys) ? secrets.geminiKeys : secrets.gemini ? [secrets.gemini] : null
  if (legacy) {
    if (!own(secrets, 'accounts') || typeof secrets.accounts !== 'object') secrets.accounts = {}
    if (!own(secrets.accounts, uid)) secrets.accounts[uid] = { geminiKeys: legacy }
    delete secrets.geminiKeys
    delete secrets.gemini
    writeFileAtomic(SECRETS_FILE(), JSON.stringify(secrets))
  }
  const oldMirror = STORAGE_BACKUP_FILE()
  if (fs.existsSync(oldMirror)) {
    if (fs.existsSync(STORAGE_BACKUP_FILE(uid))) fs.unlinkSync(oldMirror)
    else fs.renameSync(oldMirror, STORAGE_BACKUP_FILE(uid))
  }
}

// A key is remembered by a short hash, never in plain text
const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)

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

// One streaming call (server-sent events). Zalo's Electron runs Node 16, which has no fetch.
// What it resolves to: see createGemini in src/shared/gemini.js.
const streamGemini = (model, key, body, { onText, onThought, setCancel, setSkip, firstByteTimeout }) => new Promise((resolve, reject) => {
  let settled = false
  const settle = (fn, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn(value)
  }
  let timer = null
  // body "timeout": nothing came at all; "idle": the model went quiet after it had started
  const arm = (ms, body = 'timeout') => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      request.destroy()
      settle(resolve, { status: 0, body })
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

    const parser = createStreamParser({ onText, onThought })
    response.on('data', (chunk) => {
      arm(IDLE_TIMEOUT, 'idle')
      parser.push(chunk)
    })
    response.on('end', () => settle(resolve, { status: 200, ...parser.state }))
    // Destroyed (cancel or timeout) after the answer started: Node 16 emits "aborted"/"close", not "end"
    response.on('aborted', () => settle(reject, new Error('aborted')))
    response.on('close', () => settle(reject, new Error('closed')))
  })
  request.on('error', (error) => settle(reject, error))
  setCancel(() => {
    request.destroy()
    settle(reject, new Error('cancelled'))
  })
  setSkip(() => {
    request.destroy()
    settle(resolve, { status: -1, body: 'skipped' })
  })
  arm(firstByteTimeout)
  request.end(body)
})

const gemini = createGemini({
  getKeys: async () => getGeminiKeys(),
  keyId,
  loadQuota: async () => readJSONFile(QUOTA_FILE()),
  saveQuota: async (quota) => writeFileAtomic(QUOTA_FILE(), JSON.stringify(quota)),
  getJSON: httpsGetJSON,
  stream: streamGemini
})

const runGemini = (send, finish, request) => gemini.run(send, finish, request, {
  onCancel: (fn) => running.set(request.id, fn),
  onSkip: (fn) => skippers.set(request.id, fn)
})

const geminiStatus = () => gemini.status()

// ---------- IPC ----------

// Only the page Zenlo is added to may use it: the main frame of Zalo's own pc-dist/index.html,
// not a frame inside it nor Zalo's other windows
const isTrustedSender = (event) => {
  const frame = event.senderFrame
  const main = event.sender && event.sender.mainFrame
  if (!frame || !main || frame.routingId !== main.routingId || frame.processId !== main.processId) return false
  try {
    const url = new URL(frame.url)
    return url.protocol === 'file:' && url.pathname.endsWith('/pc-dist/index.html')
  } catch (error) {
    return false
  }
}

// What the page may send: a request's text (the summary panel splits a conversation into parts of
// 300 000 characters, the digest packs 60 000) and the localStorage mirror
const MAX_REQUEST_CHARS = 2000000
const MAX_BACKUP_CHARS = 20000000
const requestChars = (request) => ['systemPrompt', 'instruction', 'note', 'input'].reduce((sum, field) => sum + String(request[field] || '').length, 0)

ipcMain.on('zenlo:summary:run', (event, request) => {
  if (!isTrustedSender(event) || !request || !request.id) return
  if (requestChars(request) > MAX_REQUEST_CHARS) {
    event.sender.send('zenlo:summary:event', { id: request.id, type: 'error', message: 'Đoạn cần tóm tắt quá dài.' })
    return
  }
  const sender = event.sender
  const send = (payload) => {
    if (!sender.isDestroyed()) sender.send('zenlo:summary:event', { id: request.id, ...payload })
  }
  let finished = false
  const finish = (payload) => {
    if (finished) return
    finished = true
    running.delete(request.id)
    skippers.delete(request.id)
    send(payload)
  }
  // Anything unexpected (a full disk, a locked file) ends the run with its message instead of
  // leaving the panel at "Đang tóm tắt…"
  const fail = (error) => finish({ type: 'error', message: String((error && error.message) || error) })
  // Gemini's keys are the account's: none until Zalo has said who is logged in
  if (request.provider === 'gemini' && !account) return finish({ type: 'error', message: NO_ACCOUNT })
  const run = request.provider === 'gemini' ? runGemini : request.provider === 'codex' ? runCodex : runClaude
  // Claude and Codex: the page counts the seconds until the first word, like Gemini (which reports
  // each model it tries itself, and can skip one)
  if (run !== runGemini) send({ type: 'status' })
  try {
    Promise.resolve(run(send, finish, request)).catch(fail)
  } catch (error) {
    fail(error)
  }
})

ipcMain.on('zenlo:summary:cancel', (event, id) => {
  if (!isTrustedSender(event)) return
  const cancel = running.get(id)
  if (cancel) cancel()
  // The page stopped listening already; a cancelled run never finishes on its own
  running.delete(id)
  skippers.delete(id)
})

ipcMain.on('zenlo:summary:skip', (event, id) => {
  if (!isTrustedSender(event)) return
  const skip = skippers.get(id)
  if (skip) skip()
})

// Claude Code or Codex still answering when Zalo quits: stop them with it
app.on('will-quit', () => {
  for (const cancel of running.values()) {
    try {
      cancel()
    } catch (error) {}
  }
})

// Links Zenlo may open in the default browser: Google AI Studio (Gemini keys), Claude Code's
// page, Zenlo's website and repository, and e-mail. Anything else is refused.
const EXTERNAL_HOSTS = ['aistudio.google.com', 'ai.google.dev', 'claude.com', 'www.claude.com', 'docs.claude.com', 'github.com', 'zenlo.io.vn']

const isAllowedExternal = (url) => {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    return false
  }
  if (parsed.protocol === 'mailto:') return true
  if (parsed.protocol !== 'https:') return false
  return EXTERNAL_HOSTS.includes(parsed.hostname)
}

ipcMain.handle('zenlo:open-external', (event, url) => {
  if (!isTrustedSender(event) || !isAllowedExternal(String(url))) return false
  shell.openExternal(String(url))
  return true
})

// A link in a summary (from the messages), when the user clicks it: any http(s) address
ipcMain.handle('zenlo:open-link', (event, url) => {
  if (!isTrustedSender(event)) return false
  let parsed
  try {
    parsed = new URL(String(url))
  } catch (error) {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  shell.openExternal(parsed.href)
  return true
})

// A Windows notification for a newer Zenlo, shown once per version by the page; a click opens the
// versions page. The text and the link are fixed here, only the version comes from the page.
const VERSIONS_PAGE = 'https://zenlo.io.vn/phien-ban.html'
let updateNotification = null

ipcMain.handle('zenlo:update:notify', (event, tag) => {
  if (!isTrustedSender(event) || !/^v?\d+(\.\d+){1,3}$/.test(String(tag)) || !Notification.isSupported()) return false
  updateNotification = new Notification({ title: `Đã có Zenlo ${tag}`, body: 'Bấm để xem có gì mới và tải về.' })
  updateNotification.on('click', () => shell.openExternal(VERSIONS_PAGE))
  updateNotification.show()
  return true
})

// The narrowest Zalo lets its window be: Zalo's own layout fits there, so it tells how narrow
// the chat may get (the drawer's width keeps to it)
ipcMain.handle('zenlo:window:min-width', (event) => {
  if (!isTrustedSender(event)) return 0
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.getMinimumSize()[0] : 0
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
    // Masks only ("AIza…x9Qk"): the keys themselves never leave this process
    geminiKeys: getGeminiKeys().map(maskKey),
    maxKeys: MAX_KEYS,
    claudePath: findClaudeExecutable(),
    codexPath,
    codex: {
      path: codexPath,
      loggedIn: login ? login.loggedIn : null,
      account: login && login.mode === 'chatgpt' ? 'đã đăng nhập bằng ChatGPT' : login && login.loggedIn ? 'đang dùng API key hoặc cách khác ChatGPT (nên đăng nhập bằng ChatGPT)' : ''
    },
    encryption: safeStorage.isEncryptionAvailable()
  }
})

// The models and efforts Claude Code or Codex can use on this machine, for "Kiểm tra kết nối"
ipcMain.handle('zenlo:models:check', (event, provider) => {
  if (!isTrustedSender(event)) return null
  if (provider === 'codex') return codexCatalog()
  if (provider === 'claude') return claudeCatalog()
  return null
})

// { error } with the message as written, not wrapped in Electron's "Error invoking remote method"
ipcMain.handle('zenlo:settings:setGeminiKeys', (event, keys) => {
  if (!isTrustedSender(event)) return false
  try {
    setGeminiKeys(Array.isArray(keys) ? keys : [])
  } catch (error) {
    return { error: error.message }
  }
  // The new list right away, so the page numbers its rows again before anything else is saved
  return { masks: getGeminiKeys().map(maskKey) }
})

// The page says which Zalo account is logged in, before it reads or writes the mirror
ipcMain.handle('zenlo:account:use', (event, uid) => {
  if (!isTrustedSender(event)) return false
  if (!isAccountId(uid)) return { error: 'Mã tài khoản Zalo không hợp lệ.' }
  try {
    useAccount(uid)
  } catch (error) {
    return { error: error.message }
  }
  return true
})

// A mirror of Zenlo's localStorage (settings, saved summaries, digest order and ticks) in its own
// folder, one per account; the page writes it and reads it back when Zalo's storage was wiped or
// held another account's data
ipcMain.on('zenlo:storage:save', (event, data) => {
  if (!isTrustedSender(event) || !account || !data || typeof data !== 'object') return
  try {
    const text = JSON.stringify({ at: Date.now(), data })
    if (text.length <= MAX_BACKUP_CHARS) writeFileAtomic(STORAGE_BACKUP_FILE(account), text)
  } catch (error) {}
})

ipcMain.handle('zenlo:storage:load', (event) => {
  if (!isTrustedSender(event) || !account) return null
  return readJSONFile(STORAGE_BACKUP_FILE(account)).data || null
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

// Opened for tests by scripts/zalo-behind.ps1 (ZENLO_BEHIND=1): Zalo's windows never come up by themselves,
// so they do not cover the window in use. A window Zalo wants shown goes to the taskbar minimized instead,
// and the user still opens it from there (Windows does that, not these methods). Timers are not slowed down
// while minimized, so tests run as they would with the window in front.
if (process.env.ZENLO_BEHIND === '1') {
  const keepBehind = (win) => {
    const show = () => {
      if (!win.isVisible()) win.minimize()
    }
    win.show = show
    win.showInactive = show
    for (const name of ['focus', 'moveTop', 'setAlwaysOnTop']) win[name] = () => {}
    // Zalo's own buttons use these (maximize, restore down): blocked only while minimized, where
    // they would bring the window up
    for (const name of ['restore', 'maximize', 'setFullScreen']) {
      const original = win[name].bind(win)
      win[name] = (...args) => (win.isMinimized() ? undefined : original(...args))
    }
    win.webContents.setBackgroundThrottling(false)
  }
  app.focus = () => {}
  app.on('browser-window-created', (event, win) => keepBehind(win))
  app.whenReady().then(() => BrowserWindow.getAllWindows().forEach(keepBehind))
}

// Zalo may create its windows before our whenReady callback runs,
// so the preload is attached as soon as each session is created
app.on('session-created', addPreload)

app.whenReady().then(() => {
  addPreload(session.fromPartition(PARTITION_NAME))
})
