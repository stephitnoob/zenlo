/*
  Zenlo – trình quản lí hội thoại Zalo

  Zenlo-Setup.exe: the installer for everyone (no Node.js needed). Built as a Node single
  executable application by scripts/build-setup.mjs; Zenlo's files travel inside it as assets.
  A small menu in Vietnamese: install or update, uninstall, quit. Installing also keeps a copy and a
  Start Menu shortcut for reinstalling after a Zalo update.
*/

const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { execFileSync } = require('child_process')
const { install, uninstall, getStatus } = require('./zalo')

const ASSETS = ['zenlo.js', 'zenlo.css', 'zenlo-main.js', 'zenlo-preload.js']
const VERSION = process.env.ZENLO_VERSION || 'dev'

// Inside the .exe the files come from the embedded assets; run with node, from dist/
function unpackAssets () {
  let sea = null
  try {
    sea = require('node:sea')
  } catch (error) {}
  if (!sea || !sea.isSea()) return path.join(__dirname, '..', 'dist')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenlo-files-'))
  for (const name of ASSETS) fs.writeFileSync(path.join(dir, name), Buffer.from(sea.getAsset(name)))
  return dir
}

// ---------- Reinstalling after a Zalo update ----------

// A Zalo update replaces the patched app, so Zenlo disappears until the setup runs again. The setup
// keeps a copy of itself and adds a Start Menu shortcut "Zenlo - Cài đặt", so no new download is needed.
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const KEEP_DIR = path.join(LOCAL, 'Zenlo')
const KEPT_EXE = path.join(KEEP_DIR, 'Zenlo-Setup.exe')
const SHORTCUT = path.join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Zenlo - Cài đặt.lnk')
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const isExe = () => {
  try {
    return require('node:sea').isSea()
  } catch (error) {
    return false
  }
}
const isKeptCopy = () => path.resolve(process.execPath).toLowerCase() === KEPT_EXE.toLowerCase()

// Returns true when the copy and the shortcut are in place
function keepForReinstall () {
  if (!isExe()) return false
  try {
    fs.mkdirSync(KEEP_DIR, { recursive: true })
    if (!isKeptCopy()) fs.copyFileSync(process.execPath, KEPT_EXE)
    // Windows' own shortcut object; the paths go in through environment variables, never into the
    // command text, so no path can change what the command does. That object cannot write a file
    // name with "đ", so the shortcut is made under a plain name and renamed here. (It also mangles
    // Vietnamese descriptions, so the shortcut has none.)
    const plain = path.join(path.dirname(SHORTCUT), 'Zenlo-Setup.lnk')
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
      '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ZENLO_LNK); $s.TargetPath = $env:ZENLO_EXE; $s.WorkingDirectory = $env:ZENLO_DIR; $s.Save()'], {
      env: { ...process.env, ZENLO_LNK: plain, ZENLO_EXE: KEPT_EXE, ZENLO_DIR: KEEP_DIR },
      stdio: 'ignore',
      windowsHide: true
    })
    fs.rmSync(SHORTCUT, { force: true })
    fs.renameSync(plain, SHORTCUT)
    return fs.existsSync(SHORTCUT)
  } catch (error) {
    return false
  }
}

// Takes the shortcut and the kept copy away. Returns the copy's path when it is the program
// running right now (it cannot delete itself).
function removeReinstallCopy () {
  fs.rmSync(SHORTCUT, { force: true })
  fs.rmSync(path.join(path.dirname(SHORTCUT), 'Zenlo-Setup.lnk'), { force: true })
  if (isKeptCopy()) return KEPT_EXE
  fs.rmSync(KEEP_DIR, { recursive: true, force: true })
  return null
}

// One reader for the whole session: a new one per question would swallow lines typed ahead
let reader = null
const pendingLines = []
let waiting = null

function ask (question) {
  if (!reader) {
    reader = readline.createInterface({ input: process.stdin, output: process.stdout })
    reader.on('line', (line) => {
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve(line.trim())
      } else {
        pendingLines.push(line.trim())
      }
    })
    // Input closed (window closed or piped input ran out): answer "quit"
    reader.on('close', () => {
      if (waiting) waiting('3')
    })
  }
  process.stdout.write(question)
  if (pendingLines.length) return Promise.resolve(pendingLines.shift())
  return new Promise((resolve) => { waiting = resolve })
}

function header () {
  console.clear()
  console.log('==============================================')
  console.log(`  Zenlo ${VERSION} – trình quản lí hội thoại Zalo PC`)
  console.log('==============================================')
  try {
    const { version, installed } = getStatus()
    console.log(`  Zalo PC: ${version}`)
    console.log(`  Zenlo:   ${installed ? 'đã cài' : 'chưa cài'}`)
  } catch (error) {
    console.log(`  ${error.message}`)
  }
  console.log('')
}

async function main () {
  while (true) {
    header()
    console.log('  1. Cài Zenlo (hoặc cài lại sau khi Zalo cập nhật)')
    console.log('  2. Gỡ Zenlo, đưa Zalo về bản gốc')
    console.log('  3. Thoát')
    console.log('')
    const choice = await ask('Chọn 1, 2 hoặc 3 rồi bấm Enter: ')
    if (choice === '3' || choice === '') {
      if (reader) reader.close()
      return
    }

    if (choice === '1' || choice === '2') {
      const confirm = await ask('Zalo sẽ được tắt trong lúc cài đặt. Tiếp tục? (c/k): ')
      if (confirm.toLowerCase() !== 'c') continue
      console.log('')
      try {
        if (choice === '1') {
          const source = unpackAssets()
          try {
            install({ source })
          } finally {
            if (source.includes('zenlo-files-')) fs.rmSync(source, { recursive: true, force: true })
          }
          const kept = keepForReinstall()
          console.log('')
          console.log('Xong. Mở lại Zalo, bấm nút Zenlo màu tím ở thanh bên trái để bắt đầu.')
          console.log('Cài đặt, bản tóm tắt và Bản tin của bạn vẫn được giữ nguyên.')
          if (kept) {
            console.log('')
            console.log('Mỗi khi Zalo cập nhật, nút Zenlo sẽ biến mất. Khi đó: mở Start, gõ "Zenlo",')
            console.log('chọn "Zenlo - Cài đặt" rồi chọn 1. Không cần tải lại.')
          }
        } else {
          uninstall()
          const left = removeReinstallCopy()
          console.log('')
          console.log('Dữ liệu của Zenlo vẫn còn trong %APPDATA%\\Zenlo; xoá thư mục đó nếu muốn xoá sạch.')
          if (left) console.log(`Có thể xoá file cài đặt còn lại: ${left}`)
        }
      } catch (error) {
        console.log(`Lỗi: ${error.message}`)
      }
      console.log('')
      await ask('Bấm Enter để quay lại.')
    }
  }
}

// "Zenlo-Setup.exe --check": unpacks the embedded files, prints their sizes, cleans up (used by the
// release build to test the .exe before publishing it)
if (process.argv.includes('--check')) {
  const dir = unpackAssets()
  for (const name of ASSETS) console.log(`${name} ${fs.statSync(path.join(dir, name)).size}`)
  if (dir.includes('zenlo-files-')) fs.rmSync(dir, { recursive: true, force: true })
} else {
  main()
}
