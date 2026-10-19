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
const ASSETS = path.join(__dirname, 'assets')

const PAGE_STYLES = ['zenlo.min.css']
// zenlo-styles first (Zalo strips unknown stylesheets at runtime, it puts them back), then the core
const PAGE_SCRIPTS = ['zenlo-styles', 'zenlo-core', 'zenlo', 'zenlo-digest', 'zenlo-reply']

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
  try {
    execFileSync('taskkill', ['/F', '/T', '/IM', 'Zalo.exe'], { stdio: 'ignore' })
  } catch (error) {
    // Zalo was not running
  }
  // Give Windows a moment to release the files
  execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500'], { stdio: 'ignore' })
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
  const links = PAGE_STYLES.map((name) => `<link rel="stylesheet" href="${ZENLO_FOLDER}/css/${name}">`).join('')
  const scripts = PAGE_SCRIPTS.map((name) => `<script src="${ZENLO_FOLDER}/js/${name}.min.js"></script>`).join('')
  html = insertBefore(html, '</head>', links, 'index.html')
  html = insertBefore(html, '</body>', scripts, 'index.html')
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
  const hook = `\n    try { require('./pc-dist/${ZENLO_FOLDER}/js/zenlo-main.min'); } catch (error) { console.error('[zenlo]', error); }`
  fs.writeFileSync(file, source.slice(0, at + anchor.length) + hook + source.slice(at + anchor.length))
}

// Normal mode copies Zenlo's files into Zalo. Dev mode links to the build folder instead,
// so a rebuild plus Ctrl+Shift+R in Zalo is enough to see a change.
function addZenloFiles (appDir, dev) {
  if (!fs.existsSync(path.join(ASSETS, 'js', 'zenlo-main.min.js'))) {
    throw new Error('Chưa build Zenlo. Hãy chạy "npm run build" trước.')
  }
  const target = path.join(appDir, 'pc-dist', ZENLO_FOLDER)
  if (dev) fs.symlinkSync(ASSETS, target, 'junction')
  else fs.cpSync(ASSETS, target, { recursive: true })
}

function install ({ dev = false } = {}) {
  const resourcesDir = findResourcesDir()
  const app = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, 'app.asar.bak')
  const work = path.join(os.tmpdir(), 'zenlo-install')

  log(`Zalo: ${resourcesDir}`)
  log('Đang tắt Zalo…')
  stopZalo()

  restoreOriginal(resourcesDir)
  if (!isFile(app)) throw new Error('Không tìm thấy app.asar gốc của Zalo.')

  log('Đang giải nén Zalo…')
  fs.rmSync(work, { recursive: true, force: true })
  const appDir = path.join(work, 'app')
  asar.extractAll(app, appDir)

  log(dev ? 'Đang liên kết Zenlo (chế độ phát triển)…' : 'Đang chép Zenlo…')
  addZenloFiles(appDir, dev)
  patchPage(appDir)
  patchBootstrap(appDir)

  fs.renameSync(app, backup)
  try {
    fs.renameSync(appDir, app)
  } catch (error) {
    // Different drives: copy instead (keeping the dev-mode link as a link)
    fs.cpSync(appDir, app, { recursive: true, verbatimSymlinks: true })
  }
  fs.rmSync(work, { recursive: true, force: true })

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

function status () {
  const resourcesDir = findResourcesDir()
  const installed = isFile(path.join(resourcesDir, 'app.asar.bak'))
  const dev = fs.existsSync(path.join(resourcesDir, DEV_MARKER))
  log(`Zalo: ${resourcesDir}`)
  log(installed ? `Zenlo: đã cài${dev ? ' (chế độ phát triển)' : ''}` : 'Zenlo: chưa cài')
}

module.exports = { install, uninstall, status }
