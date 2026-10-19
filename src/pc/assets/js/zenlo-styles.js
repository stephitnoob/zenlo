/*
  Zenlo – trình quản lí hội thoại Zalo

  Zalo PC (26.10+) removes unknown <link rel="stylesheet"> tags from the page at runtime,
  so this script keeps the Zenlo stylesheets attached.
*/

(function () {
  const STYLESHEETS = [
    'zenlo/css/zenlo.min.css'
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
