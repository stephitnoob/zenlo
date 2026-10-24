/*
  Zenlo – trình quản lí hội thoại Zalo

  Zenlo-Setup.exe: the installer for everyone (no Node.js needed). Built as a Node single
  executable application by scripts/build-setup.mjs; Zenlo's files travel inside it as assets.
  A small menu in Vietnamese: install or update, uninstall, quit.
*/

const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
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

function ask (question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close()
    resolve(answer.trim())
  }))
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
    if (choice === '3' || choice === '') return

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
          console.log('')
          console.log('Xong. Mở lại Zalo, bấm nút Zenlo màu tím ở thanh bên trái để bắt đầu.')
          console.log('Cài đặt, bản tóm tắt và Bản tin của bạn vẫn được giữ nguyên.')
        } else {
          uninstall()
          console.log('')
          console.log('Dữ liệu của Zenlo vẫn còn trong %APPDATA%\\Zenlo; xoá thư mục đó nếu muốn xoá sạch.')
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
