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

// Zalo keeps each version in its own "Zalo-x.y.z" folder; the newest one is the one that runs
function findResourcesDir () {
  if (process.platform !== 'win32') throw new Error('Zenlo chỉ hỗ trợ Zalo PC trên Windows.')
  if (!fs.existsSync(ZALO_ROOT)) throw new Error(`Không thấy Zalo PC ở ${ZALO_ROOT}.`)

  const versionOf = (name) => name.slice('Zalo-'.length).split('.').map(Number)
  const newerFirst = (a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)]
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0)
    }
    return 0
  }

  const versions = fs.readdirSync(ZALO_ROOT)
    .filter((name) => /^Zalo-\d+(\.\d+)*$/.test(name))
    .filter((name) => fs.existsSync(path.join(ZALO_ROOT, name, 'resources')))
    .sort(newerFirst)
  if (!versions.length) throw new Error('Không tìm thấy thư mục phiên bản Zalo nào.')
  return path.join(ZALO_ROOT, versions[0], 'resources')
}

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

// Brings back Zalo's untouched app.asar (undoes a previous install)
function restoreOriginal (resourcesDir) {
  const app = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, 'app.asar.bak')
  if (!isFile(backup)) return false
  if (fs.existsSync(app)) fs.rmSync(app, { recursive: true, force: true })
  fs.renameSync(backup, app)
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
  const resourcesDir = findResourcesDir()
  const app = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, 'app.asar.bak')
  // A fresh folder with a random name, so nothing prepared in the temp folder can be slipped in
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-install-'))

  log(`Zalo: ${resourcesDir}`)
  log('Đang tắt Zalo…')
  stopZalo()

  restoreOriginal(resourcesDir)
  if (!isFile(app)) throw new Error('Không tìm thấy app.asar gốc của Zalo.')

  log('Đang giải nén Zalo…')
  const appDir = path.join(work, 'app')
  asar.extractAll(app, appDir)

  log(dev ? 'Đang liên kết Zenlo (chế độ phát triển)…' : 'Đang chép Zenlo…')
  addZenloFiles(appDir, dev, source)
  patchPage(appDir)
  patchBootstrap(appDir)

  fs.renameSync(app, backup)
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
    throw new Error(`Không chép được Zenlo vào Zalo (${error.message}). Zalo đã được đưa về bản gốc.`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }

  const marker = path.join(resourcesDir, DEV_MARKER)
  if (dev) fs.writeFileSync(marker, 'Zenlo dev mode: Ctrl+Shift+R reloads Zalo\n')
  else fs.rmSync(marker, { force: true })

  log(dev
    ? 'Đã cài Zenlo (chế độ phát triển). Mở lại Zalo; sau mỗi lần build bấm Ctrl+Shift+R trong Zalo.'
    : 'Đã cài Zenlo. Mở lại Zalo.')
}

function uninstall () {
  const resourcesDir = findResourcesDir()
  log('Đang tắt Zalo…')
  stopZalo()
  if (!restoreOriginal(resourcesDir)) throw new Error('Không có bản sao lưu app.asar.bak, có vẻ Zenlo chưa được cài.')
  fs.rmSync(path.join(resourcesDir, DEV_MARKER), { force: true })
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

module.exports = { install, uninstall, status, getStatus }
