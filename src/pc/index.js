/*
  Zenlo – trình quản lí hội thoại Zalo

  node build/pc install     cài Zenlo vào Zalo PC (chép file)
  node build/pc dev         cài ở chế độ phát triển (liên kết tới thư mục build, Ctrl+Shift+R để tải lại)
  node build/pc uninstall   gỡ Zenlo, đưa Zalo về bản gốc
  node build/pc status      xem Zenlo đang được cài thế nào
*/

const { install, uninstall, status } = require('./zalo-patch')

const commands = {
  install: () => install(),
  dev: () => install({ dev: true }),
  uninstall,
  status
}

const command = commands[process.argv[2]]
if (!command) {
  console.log('Cách dùng: node build/pc <install | dev | uninstall | status>')
  process.exitCode = 1
} else {
  try {
    command()
  } catch (error) {
    console.error(`Lỗi: ${error.message}`)
    process.exitCode = 1
  }
}
