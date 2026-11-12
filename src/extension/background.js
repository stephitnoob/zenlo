/* global chrome */
/*
  Zenlo – trình quản lí hội thoại Zalo

  Browser extension, service worker: the toolbar button opens Zalo web (or brings its tab to the
  front). Everything else runs in Zalo web's tab (bridge.js, shim.js, zenlo.js).
*/

const ZALO_WEB = 'https://chat.zalo.me/'

chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: `${ZALO_WEB}*` })
  if (!tab) {
    await chrome.tabs.create({ url: ZALO_WEB })
    return
  }
  await chrome.tabs.update(tab.id, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true })
})
