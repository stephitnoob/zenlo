/*
  Zenlo – website. Anonymous visit counting with GoatCounter (goatcounter.com): one request per
  page view, and one when a download button is clicked. Sent: the page's address and title, the
  site the visitor came from, and the browser's usual request headers. No cookies, nothing stored
  in the browser, no script from anyone else. Nothing is counted on a local copy of the site.
*/

(function () {
  // The GoatCounter site code ("<code>.goatcounter.com"). Empty: count nothing.
  const GOATCOUNTER = 'zenlo'
  if (!GOATCOUNTER) return
  if (window.location.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(window.location.hostname)) return

  function count (path, title, isEvent) {
    const params = new URLSearchParams({ p: path, t: title, rnd: Math.random().toString(36).slice(2) })
    if (isEvent) params.set('e', 'true')
    else if (document.referrer) params.set('r', document.referrer)
    const url = `https://${GOATCOUNTER}.goatcounter.com/count?${params}`
    // A beacon still goes out when the click leaves the page
    if (!(navigator.sendBeacon && navigator.sendBeacon(url))) new window.Image().src = url
  }

  count(window.location.pathname, document.title, false)

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.js-download, .js-download-web')
    if (!link || link.getAttribute('aria-disabled') === 'true') return
    // Two totals, whichever page the button is on (home page or versions page): Zalo web and Zalo
    // PC. The top bar's "Tải về" only goes to the install chapter and is not counted.
    if (link.classList.contains('js-download-web')) count('tai-ve/zalo-web', 'Tải Zenlo cho Zalo web', true)
    else count('tai-ve/zalo-pc', 'Tải Zenlo cho Zalo PC', true)
  })
})()
