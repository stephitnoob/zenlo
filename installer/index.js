/*
  Zenlo – trình quản lí hội thoại Zalo

  node installer install     cài Zenlo vào Zalo PC (chép file từ dist/)
  node installer dev         cài ở chế độ phát triển (liên kết tới dist/, Ctrl+Shift+R để tải lại)
  node installer uninstall   gỡ Zenlo, đưa Zalo về bản gốc
  node installer status      xem Zenlo đang được cài thế nào
*/

const { install, uninstall, status } = require('./zalo')

const commands = {
  install: () => install(),
  dev: () => install({ dev: true }),
  uninstall,
  status
}

const command = commands[process.argv[2]]
if (!command) {
  console.log('Cách dùng: node installer <install | dev | uninstall | status>')
  process.exitCode = 1
} else {
  try {
    command()
  } catch (error) {
    console.error(`Lỗi: ${error.message}`)
    process.exitCode = 1
  }
}
