/*
  Zenlo – calls one AI the way Zenlo's main process does: Claude Code (claude -p) and Codex (codex exec)
  on the user's plan with Zenlo's flags, Gemini on the API with the keys in .env.gemini (the next key
  when one is out of its daily quota). call(provider, { systemPrompt, input, instruction }) returns
  { text, usage, ms } or { error }; provider is "claude", "codex" or a Gemini model id.
*/

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
// ---------- Claude Code and Codex, with Zenlo's flags ----------

const CODEX_EXE = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai',
  'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')

// Zenlo's child environment: the plan's login only, no other endpoint, no user files
function childEnv () {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY|CODEX_ACCESS_TOKEN|CLAUDE_CODE_USE_|NODE_OPTIONS|NODE_TLS|SSLKEYLOGFILE|CLAUDECODE)/i.test(name)) delete env[name]
  }
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.RUST_LOG = 'error'
  return env
}

function run (exe, argv, stdin, cwd) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(exe, argv, { cwd, env: childEnv(), windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), 600000)
    child.stdout.setEncoding('utf8').on('data', (c) => { out += c })
    child.stderr.setEncoding('utf8').on('data', (c) => { err += c })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, out, err: error.message, ms: Date.now() - started }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - started }) })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin, 'utf8')
  })
}

export async function callClaude (request) {
  const r = await run('claude', [
    '-p', '--model', 'sonnet', '--effort', 'medium', '--output-format', 'json',
    '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
    '--disable-slash-commands', '--system-prompt', request.systemPrompt
  ], `${request.input}\n\n${request.instruction}`, os.tmpdir())
  let data
  try { data = JSON.parse(r.out) } catch (error) { return { error: (r.err || r.out).slice(-300) } }
  if (data.is_error || !data.result) return { error: String(data.result || data.subtype).slice(0, 300) }
  const u = data.usage || {}
  return {
    text: data.result,
    ms: r.ms,
    usage: {
      promptTokenCount: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      thoughtsTokenCount: 0,
      candidatesTokenCount: u.output_tokens || 0
    }
  }
}

export async function callCodex (request) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-eval-codex-'))
  const toml = (text) => JSON.stringify(String(text))
  const config = [
    'model_reasoning_effort="medium"', `instructions=${toml(request.systemPrompt)}`, 'project_doc_max_bytes=0',
    'web_search="disabled"', 'features.shell_tool=false', 'features.multi_agent=false', 'features.apps=false',
    'features.plugins=false', 'features.view_image=false', 'include_environment_context=false',
    'include_permissions_instructions=false', 'include_apps_instructions=false',
    'include_collaboration_mode_instructions=false', 'skills.include_instructions=false',
    'features.memories=false', 'history.persistence="none"', 'analytics.enabled=false'
  ]
  const r = await run(CODEX_EXE, [
    'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '-s', 'read-only', '-C', work, ...config.flatMap((c) => ['-c', c]), '-'
  ], `${request.input}\n\n${request.instruction}`, work)
  fs.rmSync(work, { recursive: true, force: true })
  let text = ''
  let usage = {}
  let error = ''
  for (const line of r.out.split('\n')) {
    let event
    try { event = JSON.parse(line) } catch (e) { continue }
    if (event.type === 'item.completed' && event.item && event.item.type === 'agent_message') text = event.item.text
    if (event.type === 'turn.completed') usage = event.usage || {}
    if (event.type === 'turn.failed' || event.type === 'error') error = JSON.stringify(event).slice(0, 300)
  }
  if (!text) return { error: error || r.err.slice(-300) || `exit ${r.code}` }
  return {
    text,
    ms: r.ms,
    usage: {
      promptTokenCount: usage.input_tokens || 0,
      thoughtsTokenCount: usage.reasoning_output_tokens || 0,
      candidatesTokenCount: (usage.output_tokens || 0) - (usage.reasoning_output_tokens || 0)
    }
  }
}

// Gemini, as in run.mjs: keys from .env.gemini, the next key when one is out of its daily quota
const KEY_FILE = path.join(ROOT, '.env.gemini')
const KEYS = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').split('\n').map((k) => k.trim()).filter((k) => k && !k.startsWith('#')) : []
const outOfQuota = new Set()

export async function callGemini (model, request) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: `${request.input}\n\n${request.instruction}` }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: 'high' } }
  })
  let lastError = ''
  for (let attempt = 1; attempt <= 8; attempt++) {
    const key = KEYS.find((k) => !outOfQuota.has(`${k} ${model}`))
    if (!key) return { error: `every key is out of its daily quota for ${model}` }
    const started = Date.now()
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(300000)
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        const parts = data.candidates?.[0]?.content?.parts || []
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
        if (text) return { text, usage: data.usageMetadata || {}, ms: Date.now() - started }
        lastError = 'empty answer'
      } else {
        lastError = `${response.status} ${data.error?.message || ''}`.slice(0, 200)
        if (![429, 500, 503].includes(response.status)) break
        if (response.status === 429 && /PerDay|per day/i.test(JSON.stringify(data))) {
          outOfQuota.add(`${key} ${model}`)
          attempt--
          continue
        }
      }
    } catch (error) {
      lastError = error.message
    }
    console.log(`  ${model} attempt ${attempt}: ${lastError}`)
    await new Promise((resolve) => setTimeout(resolve, Math.min(60000, 8000 * 2 ** (attempt - 1))))
  }
  return { error: lastError }
}

export const MODEL = { claude: 'claude-sonnet', codex: 'codex' }
export const modelOf = (provider) => MODEL[provider] || provider
export const call = (provider, request) => provider === 'claude'
  ? callClaude(request)
  : provider === 'codex' ? callCodex(request) : callGemini(provider, request)
