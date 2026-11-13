/*
  Zenlo – trình quản lí hội thoại Zalo

  Puts Zenlo into Zalo PC (Windows) and takes it out again.

  Zalo ships its app as resources/app.asar. To add Zenlo we unpack it, add our files and hooks,
  and put the unpacked folder back under the name "app.asar" (Electron loads a folder with that
  name just like the archive). The untouched archive is kept as app.asar.bak, so removing Zenlo
  is a rename back.
*/

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const asar = require('@electron/asar')

const ZALO_ROOT = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Zalo')
const ZENLO_FOLDER = 'zenlo' // inside Zalo's pc-dist
const DEV_MARKER = 'zenlo-dev' // in Zalo's resources folder while dev mode is on
const DIST = path.join(__dirname, '..', 'dist') // built by npm run build

// One stylesheet and one script (all of Zenlo's page code, bundled)
const PAGE_STYLE = 'zenlo.css'
const PAGE_SCRIPT = 'zenlo.js'

const log = (...args) => console.log(...args)

const versionOf = (name) => name.slice('Zalo-'.length).split('.').map(Number)

// Zalo's versions are dates ("26.11.10" for 10/11/2026): one more than two months ahead is not a
// release. A "Zalo-27.12.31" made to stop updates once took Zenlo in while Zalo ran 26.11.10.
function isFutureVersion (version, now = Date.now()) {
  if (version.length < 3) return false
  const [year, month, day] = version
  const date = new Date(2000 + year, month - 1, day)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return false
  return date.getTime() > now + 60 * 24 * 60 * 60 * 1000
}

// Of the version folders that can run, the one to patch: the folder Zalo runs from (running: the
// names of those folders), else the newest real version
function pickVersionDir (names, { running = [], now = Date.now() } = {}) {
  const live = names.find((name) => running.some((r) => r.toLowerCase() === name.toLowerCase()))
  if (live) return live
  const newerFirst = (a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)]
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0)
    }
    return 0
  }
  const real = names.filter((name) => !isFutureVersion(versionOf(name), now))
  return [...(real.length ? real : names)].sort(newerFirst)[0]
}

// Every "Zalo-x.y.z" folder that can run: Zalo.exe, and the app (or its backup while Zenlo is in)
function zaloVersionDirs () {
  if (process.platform !== 'win32') throw new Error('Zenlo chỉ hỗ trợ Zalo PC trên Windows.')
  if (!fs.existsSync(ZALO_ROOT)) throw new Error(`Không thấy Zalo PC ở ${ZALO_ROOT}.`)
  return fs.readdirSync(ZALO_ROOT)
    .filter((name) => /^Zalo-\d+(\.\d+)*$/.test(name))
    .filter((name) => isFile(path.join(ZALO_ROOT, name, 'Zalo.exe')))
    .filter((name) => ['app.asar', 'app.asar.bak'].some((file) => fs.existsSync(path.join(ZALO_ROOT, name, 'resources', file))))
}

// The version folders of the Zalo.exe running now, under ZALO_ROOT
function runningVersionNames () {
  // The full path, so a "powershell" planted somewhere on PATH is never run instead
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  let output = ''
  try {
    output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process -Name Zalo -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (error) {
    return []
  }
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((exe) => path.dirname(path.dirname(exe)).toLowerCase() === ZALO_ROOT.toLowerCase())
    .map((exe) => path.basename(path.dirname(exe)))
}

// The folders to patch: the one pickVersionDir names, and every real version newer than it (Zalo may
// have downloaded an update it starts next time, while it still runs the older one)
function pickTargetDirs (names, { running = [], now = Date.now() } = {}) {
  const first = pickVersionDir(names, { running, now })
  const firstVersion = versionOf(first)
  const newer = (name) => {
    const v = versionOf(name)
    for (let i = 0; i < Math.max(v.length, firstVersion.length); i++) {
      if ((v[i] || 0) !== (firstVersion[i] || 0)) return (v[i] || 0) > (firstVersion[i] || 0)
    }
    return false
  }
  return [first, ...names.filter((name) => newer(name) && !isFutureVersion(versionOf(name), now))]
}

// Picked before Zalo is closed, while it still tells which folder it runs
function targetResourcesDirs () {
  const names = zaloVersionDirs()
  if (!names.length) throw new Error('Không tìm thấy thư mục phiên bản Zalo nào.')
  return pickTargetDirs(names, { running: runningVersionNames() }).map((name) => path.join(ZALO_ROOT, name, 'resources'))
}

const findResourcesDir = () => targetResourcesDirs()[0]

function stopZalo () {
  // The full path, so a "taskkill" planted somewhere on PATH is never run instead
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
  try {
    execFileSync(taskkill, ['/F', '/T', '/IM', 'Zalo.exe'], { stdio: 'ignore' })
  } catch (error) {
    // Zalo was not running
  }
  // Give Windows a moment to release the files
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)
}

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile()

// Brings back Zalo's untouched app.asar (undoes a previous install). The patched one is only moved
// aside until the original is in its place, then deleted: if a file is still held (by Zalo or an
// antivirus), Zalo is never left without an app.asar.
function restoreOriginal (resourcesDir) {
  const app = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, 'app.asar.bak')
  let old = path.join(resourcesDir, 'app.asar.zenlo-old')
  const removeQuietly = (p) => {
    try {
      fs.rmSync(p, { recursive: true, force: true })
    } catch (error) {}
  }
  // Left by earlier runs that could not delete them; one still held makes this run use a name of its own
  for (const name of fs.readdirSync(resourcesDir)) {
    if (name.startsWith('app.asar.zenlo-old')) removeQuietly(path.join(resourcesDir, name))
  }
  if (fs.existsSync(old)) old += `-${Date.now()}`
  if (!isFile(backup)) return false
  if (fs.existsSync(app)) fs.renameSync(app, old)
  try {
    fs.renameSync(backup, app)
  } catch (error) {
    if (!fs.existsSync(app) && fs.existsSync(old)) fs.renameSync(old, app)
    throw error
  }
  removeQuietly(old)
  return true
}

function insertBefore (text, marker, addition, file) {
  const at = text.lastIndexOf(marker)
  if (at < 0) throw new Error(`Không tìm thấy "${marker}" trong ${file}. Có thể Zalo đã đổi cấu trúc.`)
  return text.slice(0, at) + addition + text.slice(at)
}

// Adds Zenlo's stylesheet and scripts to Zalo's main page
function patchPage (appDir) {
  const file = path.join(appDir, 'pc-dist', 'index.html')
  let html = fs.readFileSync(file, 'utf8')
  html = insertBefore(html, '</head>', `<link rel="stylesheet" href="${ZENLO_FOLDER}/${PAGE_STYLE}">`, 'index.html')
  html = insertBefore(html, '</body>', `<script src="${ZENLO_FOLDER}/${PAGE_SCRIPT}"></script>`, 'index.html')
  fs.writeFileSync(file, html)
}

// Loads Zenlo's main-process module right after Zalo's own. If Zenlo's files are missing,
// Zalo still starts normally.
function patchBootstrap (appDir) {
  const file = path.join(appDir, 'bootstrap.js')
  const anchor = "require('./main-dist/main');"
  const source = fs.readFileSync(file, 'utf8')
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error('Không tìm thấy điểm nạp trong bootstrap.js. Có thể Zalo đã đổi cấu trúc.')
  const hook = `\n    try { require('./pc-dist/${ZENLO_FOLDER}/zenlo-main'); } catch (error) { console.error('[zenlo]', error); }`
  fs.writeFileSync(file, source.slice(0, at + anchor.length) + hook + source.slice(at + anchor.length))
}

// Normal mode copies Zenlo's files into Zalo. Dev mode links to the build folder instead,
// so a rebuild plus Ctrl+Shift+R in Zalo is enough to see a change.
// source: the folder with Zenlo's built files (dist/ by default; the setup program unpacks its own copy)
function addZenloFiles (appDir, dev, source) {
  if (!fs.existsSync(path.join(source, 'zenlo-main.js'))) {
    throw new Error('Chưa build Zenlo. Hãy chạy "npm run build" trước.')
  }
  const target = path.join(appDir, 'pc-dist', ZENLO_FOLDER)
  if (dev) fs.symlinkSync(source, target, 'junction')
  else fs.cpSync(source, target, { recursive: true })
}

function install ({ dev = false, source = DIST } = {}) {
  const targets = targetResourcesDirs()
  for (const resourcesDir of targets) log(`Zalo: ${resourcesDir}`)
  log('Đang tắt Zalo…')
  stopZalo()
  installInto(targets[0], dev, source)
  for (const resourcesDir of targets.slice(1)) {
    try {
      installInto(resourcesDir, dev, source)
    } catch (error) {
      // The version that runs now has Zenlo; a newer one that could not take it is only told
      log(`Không cài được vào ${resourcesDir}: ${error.message}`)
    }
  }
  log(dev
    ? 'Đã cài Zenlo (chế độ phát triển). Mở lại Zalo; sau mỗi lần build bấm Ctrl+Shift+R trong Zalo.'
    : 'Đã cài Zenlo. Mở lại Zalo.')
}

function installInto (resourcesDir, dev, source) {
  const app = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, 'app.asar.bak')
  // A fresh folder with a random name, so nothing prepared in the temp folder can be slipped in
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-install-'))

  restoreOriginal(resourcesDir)
  if (!isFile(app)) throw new Error('Không tìm thấy app.asar gốc của Zalo.')

  log('Đang giải nén Zalo…')
  const appDir = path.join(work, 'app')
  try {
    asar.extractAll(app, appDir)

    log(dev ? 'Đang liên kết Zenlo (chế độ phát triển)…' : 'Đang chép Zenlo…')
    addZenloFiles(appDir, dev, source)
    patchPage(appDir)
    patchBootstrap(appDir)
  } catch (error) {
    // Zalo is untouched so far; only the extracted copy (hundreds of MB) is left to remove
    fs.rmSync(work, { recursive: true, force: true })
    throw error
  }

  try {
    fs.renameSync(app, backup)
  } catch (error) {
    // Zalo still holds app.asar: nothing was changed
    fs.rmSync(work, { recursive: true, force: true })
    throw error
  }
  try {
    try {
      fs.renameSync(appDir, app)
    } catch (error) {
      // Different drives: copy instead (keeping the dev-mode link as a link)
      fs.cpSync(appDir, app, { recursive: true, verbatimSymlinks: true })
    }
  } catch (error) {
    // Never leave Zalo without its app: put the original back
    restoreOriginal(resourcesDir)
    throw new Error(`Không chép được Zenlo vào Zalo (${error.message}). Đã đưa Zalo về bản gốc.`)
  } finally {
    // A temp folder that cannot be removed yet (a file an antivirus still holds) must not turn a
    // finished install, or the error above, into another error
    try {
      fs.rmSync(work, { recursive: true, force: true })
    } catch (error) {}
  }

  const marker = path.join(resourcesDir, DEV_MARKER)
  if (dev) fs.writeFileSync(marker, 'Zenlo dev mode: Ctrl+Shift+R reloads Zalo\n')
  else fs.rmSync(marker, { force: true })
}

// Every version folder Zenlo is in goes back to its original, not only the one that runs now (an
// older Zenlo may have gone into another folder)
function uninstall () {
  const dirs = zaloVersionDirs().map((name) => path.join(ZALO_ROOT, name, 'resources'))
  log('Đang tắt Zalo…')
  stopZalo()
  let restored = false
  for (const resourcesDir of dirs) {
    if (restoreOriginal(resourcesDir)) restored = true
    fs.rmSync(path.join(resourcesDir, DEV_MARKER), { force: true })
  }
  if (!restored) throw new Error('Không thấy bản sao lưu app.asar.bak, có vẻ máy này chưa cài Zenlo.')
  log('Đã gỡ Zenlo, Zalo đã về bản gốc. Mở lại Zalo.')
}

function getStatus () {
  const resourcesDir = findResourcesDir()
  return {
    resourcesDir,
    version: path.basename(path.dirname(resourcesDir)).replace(/^Zalo-/, ''),
    installed: isFile(path.join(resourcesDir, 'app.asar.bak')),
    dev: fs.existsSync(path.join(resourcesDir, DEV_MARKER))
  }
}

function status () {
  const { resourcesDir, installed, dev } = getStatus()
  log(`Zalo: ${resourcesDir}`)
  log(installed ? `Zenlo: đã cài${dev ? ' (chế độ phát triển)' : ''}` : 'Zenlo: chưa cài')
}

module.exports = { install, uninstall, status, getStatus, pickVersionDir, pickTargetDirs, isFutureVersion }
