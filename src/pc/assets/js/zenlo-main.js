/*
  Zenlo – trình quản lí hội thoại Zalo

  AI Summary (main process): runs Claude Code headless (`claude -p`) on the user's
  own Claude subscription and streams the answer back to the renderer through IPC.
*/

const { app, session, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const PARTITION_NAME = 'persist:zalo'
const PRELOAD_PATH = path.join(__dirname, 'zenlo-preload.min.js')

const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const running = new Map()

const findClaudeExecutable = () => {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    path.join(os.homedir(), '.claude', 'local', process.platform === 'win32' ? 'claude.exe' : 'claude')
  ]
  return candidates.find((p) => fs.existsSync(p)) || 'claude'
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

const runClaude = (sender, { id, model, effort, systemPrompt, instruction, input }) => {
  const send = (payload) => {
    if (!sender.isDestroyed()) sender.send('zenlo:summary:event', { id, ...payload })
  }

  const args = [
    '-p', instruction,
    '--model', MODELS.includes(model) ? model : 'sonnet',
    '--effort', EFFORTS.includes(effort) ? effort : 'medium',
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

  const child = spawn(findClaudeExecutable(), args, {
    cwd: os.tmpdir(),
    env: getChildEnv(),
    windowsHide: true
  })
  running.set(id, child)

  let buffer = ''
  let stderr = ''
  let finished = false

  const finish = (payload) => {
    if (finished) return
    finished = true
    running.delete(id)
    send(payload)
  }

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
        finish({
          type: 'done',
          isError: !!event.is_error,
          result: event.result || '',
          usage: event.usage || null
        })
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  child.on('error', (error) => {
    const message = error.code === 'ENOENT'
      ? 'Không tìm thấy Claude Code (lệnh "claude"). Hãy cài Claude Code và đăng nhập bằng tài khoản Claude.'
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

// Only Zalo's own local pages may start Claude Code
const isTrustedSender = (event) => {
  const url = (event.senderFrame && event.senderFrame.url) || ''
  return url.startsWith('file://')
}

ipcMain.on('zenlo:summary:run', (event, request) => {
  if (!isTrustedSender(event) || !request || !request.id) return
  runClaude(event.sender, request)
})

ipcMain.on('zenlo:summary:cancel', (event, id) => {
  if (!isTrustedSender(event)) return
  const child = running.get(id)
  if (child) child.kill()
})

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
