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

// Aliases, so Zenlo keeps working when Google ships a new version.
// When the chosen model is overloaded (503), the other one is tried.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
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
}

const geminiError = (status, body) => {
  let message = ''
  try {
    message = JSON.parse(body).error.message
  } catch (error) {}
  if (status === 400 && /API key/i.test(message)) return 'API key Gemini không hợp lệ.'
  if (status === 403) return 'API key Gemini không có quyền dùng model này.'
  if (status === 429) return 'Gemini báo đã hết lượt dùng (giới hạn của key). Hãy thử lại sau ít phút.'
  if (status === 503 || status === 500) return 'Máy chủ Gemini đang quá tải, hãy thử lại sau.'
  return `Gemini báo lỗi ${status}${message ? ': ' + message : ''}.`
}

// One streaming call (server-sent events). Zalo's Electron runs Node 16, which has no fetch.
// Resolves to { status, body } on an HTTP error, or { status: 200, result, blocked } when done.
const streamGemini = (model, key, body, onText, setCancel) => new Promise((resolve, reject) => {
  const request = https.request(`${GEMINI_URL}${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Content-Length': Buffer.byteLength(body) }
  }, (response) => {
    response.setEncoding('utf8')
    if (response.statusCode !== 200) {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: text }))
      return
    }

    let buffer = ''
    let result = ''
    let blocked = ''
    response.on('data', (chunk) => {
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
          // Thought summaries are not part of the answer
          if (part.thought || typeof part.text !== 'string') continue
          result += part.text
          onText(part.text)
        }
      }
    })
    response.on('end', () => resolve({ status: 200, result, blocked }))
    response.on('error', reject)
  })
  request.on('error', reject)
  setCancel(() => request.destroy(new Error('cancelled')))
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

  const first = GEMINI_MODELS.includes(model) ? model : GEMINI_MODELS[0]
  const models = [first, ...GEMINI_MODELS.filter((m) => m !== first)]
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // The question comes after the data, which works best for long inputs
    contents: [{ role: 'user', parts: [{ text: `${input}\n\n${instruction}` }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: GEMINI_EFFORTS.includes(effort) ? effort : 'high' } }
  })

  try {
    for (let i = 0; i < models.length; i++) {
      const response = await streamGemini(models[i], key, body, (text) => send({ type: 'text', text }), (fn) => { cancelRequest = fn })
      if (response.status !== 200) {
        // Overloaded: try the next model
        if ((response.status === 503 || response.status === 500) && i < models.length - 1) continue
        return finish({ type: 'error', message: geminiError(response.status, response.body) })
      }
      if (!response.result && response.blocked) return finish({ type: 'error', message: `Gemini từ chối nội dung này (${response.blocked}).` })
      return finish({ type: 'done', isError: false, result: response.result })
    }
  } catch (error) {
    if (cancelled) return finish({ type: 'error', message: 'Đã dừng.' })
    return finish({ type: 'error', message: `Không kết nối được Gemini: ${error.message || error}` })
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
