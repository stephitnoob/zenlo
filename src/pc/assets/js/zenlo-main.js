/*
  Zenlo – trình quản lí hội thoại Zalo

  Main process: runs the AI the user chose and streams the answer back to the renderer through IPC.
  - Claude: Claude Code headless (`claude -p`) on the user's own Claude Pro/Max subscription
  - Gemini: the Gemini API with the user's own API key, kept encrypted with Windows' safeStorage
*/

const { app, session, ipcMain, safeStorage } = require('electron')
const { spawn } = require('child_process')
const https = require('https')
const path = require('path')
const fs = require('fs')
const os = require('os')

const PARTITION_NAME = 'persist:zalo'
const PRELOAD_PATH = path.join(__dirname, 'zenlo-preload.min.js')

const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus']
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const GEMINI_EFFORTS = ['low', 'medium', 'high']
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'

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

// Claude Code must use the Claude subscription login, not API billing
const getChildEnv = () => {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
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

// ---------- Gemini ----------

const SECRETS_FILE = () => path.join(app.getPath('userData'), 'zenlo-secrets.json')

const readSecrets = () => {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE(), 'utf8')) || {}
  } catch (error) {
    return {}
  }
}

const getGeminiKey = () => {
  const stored = readSecrets().gemini
  if (!stored) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch (error) {
    return ''
  }
}

const setGeminiKey = (key) => {
  const secrets = readSecrets()
  if (key) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows không cho mã hoá dữ liệu, nên Zenlo không lưu key.')
    secrets.gemini = safeStorage.encryptString(key).toString('base64')
  } else {
    delete secrets.gemini
  }
  fs.writeFileSync(SECRETS_FILE(), JSON.stringify(secrets))
  geminiModels = null
}

const geminiLabel = (id) => {
  const match = id.match(/^gemini-([\d.]+)-flash(-lite)?$/)
  if (match) return `Gemini ${match[1]} Flash${match[2] ? '-Lite' : ''}`
  if (id === 'gemini-flash-latest') return 'Gemini Flash'
  if (id === 'gemini-flash-lite-latest') return 'Gemini Flash-Lite'
  return id
}

const httpsGetJSON = (url, key) => new Promise((resolve, reject) => {
  const request = https.get(url, { headers: { 'x-goog-api-key': key } }, (response) => {
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

// The Flash models this key can use, newest first, then the Flash-Lite ones newest first:
// e.g. 3.8 → 3.7 → 3.6 → 3.5 Flash → 3.5 → 3.1 Flash-Lite. Cached until the key changes.
let geminiModels = null
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

const getGeminiModels = async (key) => {
  if (geminiModels && Date.now() - geminiModels.at < 60 * 60 * 1000) return geminiModels.list
  let list = FALLBACK_MODELS
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
  } catch (error) {}
  geminiModels = { list, at: Date.now() }
  return list
}

// How each model answered lately, for the congestion bars in the settings
const geminiStats = new Map()
const recordStat = (model, result) => {
  const list = (geminiStats.get(model) || []).filter((s) => Date.now() - s.at < 30 * 60 * 1000)
  list.push({ ...result, at: Date.now() })
  geminiStats.set(model, list.slice(-5))
}

const geminiError = (status, body) => {
  let message = ''
  try {
    message = JSON.parse(body).error.message
  } catch (error) {}
  if (status === 400 && /API key/i.test(message)) return 'API key Gemini không hợp lệ.'
  if (status === 403) return 'API key Gemini không có quyền dùng model này.'
  if (status === 429) return 'Gemini báo đã hết lượt dùng của key. Hãy thử lại sau ít phút.'
  if (status === 503 || status === 500) return 'Máy chủ Gemini đang quá tải, hãy thử lại sau.'
  return `Gemini báo lỗi ${status}${message ? ': ' + message : ''}.`
}

// A model that sends nothing for this long is treated as overloaded (one waited over 90 s for
// nothing). Thought summaries are requested, so a working model sends something early.
const FIRST_BYTE_TIMEOUT = 40 * 1000
const IDLE_TIMEOUT = 60 * 1000
const RECENT_FAILURE = 5 * 60 * 1000

// One streaming call (server-sent events). Zalo's Electron runs Node 16, which has no fetch.
// Resolves to { status, body } on an HTTP error or a timeout (status 0), or { status: 200, result, blocked }.
const streamGemini = (model, key, body, onText, setCancel) => new Promise((resolve, reject) => {
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

  const request = https.request(`${GEMINI_URL}${model}:streamGenerateContent?alt=sse`, {
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
  arm(FIRST_BYTE_TIMEOUT)
  request.end(body)
})

const runGemini = async (send, finish, { id, model, effort, systemPrompt, instruction, input }) => {
  const key = getGeminiKey()
  if (!key) return finish({ type: 'error', message: 'Chưa có API key Gemini. Hãy dán key trong Cài đặt Zenlo.' })

  let cancelled = false
  let cancelRequest = () => {}
  running.set(id, () => {
    cancelled = true
    cancelRequest()
  })

  // From the chosen model down to older and lighter ones ("auto" starts at the newest)
  const all = await getGeminiModels(key)
  const start = all.indexOf(model)
  // A model that failed in the last few minutes is tried last, so a busy 3.8 does not cost
  // another 40 s wait on every request
  const chain = start > 0 ? all.slice(start) : all
  const failedRecently = (model) => {
    const stats = geminiStats.get(model) || []
    const last = stats[stats.length - 1]
    return !!last && !last.ok && Date.now() - last.at < RECENT_FAILURE
  }
  const models = [...chain.filter((m) => !failedRecently(m)), ...chain.filter(failedRecently)]
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // The question comes after the data, which works best for long inputs
    contents: [{ role: 'user', parts: [{ text: `${input}\n\n${instruction}` }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: GEMINI_EFFORTS.includes(effort) ? effort : 'high', includeThoughts: true } }
  })

  const skipped = []
  let lastError = ''
  for (const current of models) {
    if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
    send({ type: 'status', model: current, label: geminiLabel(current), skipped: skipped.map(geminiLabel) })
    const t0 = Date.now()
    let response
    try {
      response = await streamGemini(current, key, body, (text) => send({ type: 'text', text }), (fn) => { cancelRequest = fn })
    } catch (error) {
      if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
      // Dropped connection: try the next model
      recordStat(current, { ok: false, reason: 'lỗi kết nối' })
      lastError = `Không kết nối được Gemini: ${error.message || error}`
      skipped.push(current)
      continue
    }

    if (response.status === 200) {
      recordStat(current, { ok: true, ms: Date.now() - t0 })
      if (!response.result && response.blocked) return finish({ type: 'error', message: `Gemini từ chối nội dung này (${response.blocked}).` })
      return finish({ type: 'done', isError: false, result: response.result, model: geminiLabel(current), skipped: skipped.map(geminiLabel) })
    }
    // Overloaded, out of quota for this model, or no answer in time: try the next model
    if ([0, 429, 500, 503].includes(response.status)) {
      recordStat(current, { ok: false, reason: response.status === 0 ? 'chờ quá lâu' : response.status === 429 ? 'hết lượt' : 'quá tải' })
      lastError = response.status === 0 ? 'Gemini không trả lời kịp.' : geminiError(response.status, response.body)
      skipped.push(current)
      continue
    }
    return finish({ type: 'error', message: geminiError(response.status, response.body) })
  }
  finish({ type: 'error', message: `Mọi model Gemini đều không dùng được lúc này (${lastError}).` })
}

// The model list with the latest results, for the settings page
const geminiStatus = async () => {
  const key = getGeminiKey()
  if (!key) return { models: [] }
  const list = await getGeminiModels(key)
  return {
    models: list.map((model) => ({ id: model, label: geminiLabel(model), stats: geminiStats.get(model) || [] }))
  }
}

// "Đo tải": one tiny request to every model at once, with low thinking
const probeGemini = async () => {
  const key = getGeminiKey()
  if (!key) throw new Error('Chưa có API key Gemini.')
  const list = await getGeminiModels(key)
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng một chữ: ok' }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }
  })
  await Promise.all(list.map(async (model) => {
    const t0 = Date.now()
    try {
      const response = await streamGemini(model, key, body, () => {}, () => {})
      if (response.status === 200) recordStat(model, { ok: true, ms: Date.now() - t0 })
      else recordStat(model, { ok: false, reason: response.status === 0 ? 'chờ quá lâu' : response.status === 429 ? 'hết lượt' : 'quá tải' })
    } catch (error) {
      recordStat(model, { ok: false, reason: 'lỗi kết nối' })
    }
  }))
  return geminiStatus()
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
  else runClaude(send, finish, request)
})

ipcMain.on('zenlo:summary:cancel', (event, id) => {
  if (!isTrustedSender(event)) return
  const cancel = running.get(id)
  if (cancel) cancel()
})

ipcMain.handle('zenlo:settings:get', (event) => {
  if (!isTrustedSender(event)) return null
  return {
    geminiKey: getGeminiKey(),
    claudePath: findClaudeExecutable(),
    encryption: safeStorage.isEncryptionAvailable()
  }
})

ipcMain.handle('zenlo:settings:setGeminiKey', (event, key) => {
  if (!isTrustedSender(event)) return false
  setGeminiKey(String(key || '').trim())
  return true
})

ipcMain.handle('zenlo:gemini:status', (event) => {
  if (!isTrustedSender(event)) return null
  return geminiStatus()
})

ipcMain.handle('zenlo:gemini:probe', (event) => {
  if (!isTrustedSender(event)) return null
  return probeGemini()
})

// ---------- Setup ----------

const addPreload = (targetSession) => {
  const preloads = targetSession.getPreloads()
  if (!preloads.includes(PRELOAD_PATH)) {
    targetSession.setPreloads([...preloads, PRELOAD_PATH])
  }
}

// Dev mode (installed with "node build/pc dev"): Ctrl+Shift+R reloads a Zalo window,
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
