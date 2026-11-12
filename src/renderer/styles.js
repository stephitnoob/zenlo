/*
  Zenlo – trình quản lí hội thoại Zalo

  Zalo PC (26.10+) removes unknown <link rel="stylesheet"> tags from the page at runtime,
  so this script keeps the Zenlo stylesheets attached. In the browser extension the stylesheet is
  one of the extension's files: its address comes from the content script (bridge.js).
*/

(function () {
  const web = typeof ZENLO_WEB !== 'undefined' && ZENLO_WEB === true
  const base = web ? document.documentElement.dataset.zenloBase || '' : 'zenlo/'
  if (web && !base) return
  const STYLESHEETS = [
    `${base}zenlo.css`
  ]

  function ensureStylesheets () {
    for (const href of STYLESHEETS) {
      if (document.querySelector(`link[data-zenlo-style="${href}"]`)) continue
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      link.setAttribute('data-zenlo-style', href)
      document.head.appendChild(link)
    }
  }

  ensureStylesheets()
  new MutationObserver(ensureStylesheets).observe(document.head, { childList: true })
})()
