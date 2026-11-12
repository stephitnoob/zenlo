/* global chrome */
/*
  Zenlo – trình quản lí hội thoại Zalo

  Dev builds only (npm run build:ext-dev, npm run dev): scripts/build.mjs adds this file to the
  content script (bridge.js) and the service worker (background.js). A release never has it.
  When a new build lands, the extension and Zalo web's tab reload by themselves, so the unpacked
  extension never needs a click in the browser's extension page.
*/

if (typeof window === 'undefined') {
  // The service worker: the content script saw a new build
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'zenlo:dev-reload') chrome.runtime.reload()
  })
} else {
  // The content script: build.mjs writes build-id.txt last, once every file of a build is written
  let build = null
  const timer = setInterval(async () => {
    let text
    try {
      text = await (await fetch(chrome.runtime.getURL('build-id.txt'), { cache: 'no-store' })).text()
    } catch (error) {
      // The extension was reloaded or removed: this script is cut off from it
      clearInterval(timer)
      return
    }
    if (build === null) build = text
    if (text === build) return
    clearInterval(timer)
    try {
      chrome.runtime.sendMessage({ type: 'zenlo:dev-reload' })
    } catch (error) {}
    setTimeout(() => window.location.reload(), 800)
  }, 1500)
}
