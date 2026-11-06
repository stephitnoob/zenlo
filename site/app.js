/*
  Zenlo – website. Fills the download buttons and the release facts (version, size, SHA-256)
  from the latest GitHub release. Only GitHub's public API is called; nothing is tracked.
*/

(function () {
  // The official repository ("owner/name") and the feedback e-mail. Empty until they exist:
  // the download buttons then say the first release is coming.
  const REPO = 'stephitnoob/zenlo'
  const FEEDBACK_EMAIL = 'stephit.zenlo@outlook.com'

  const $$ = (selector) => document.querySelectorAll(selector)

  // "Sao chép" buttons: copy their data-copy text, or select it when the clipboard is not allowed
  $$('.js-copy').forEach((button) => {
    const label = button.textContent
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
        button.textContent = 'Đã sao chép ✓'
      } catch (error) {
        const target = document.querySelector(button.dataset.select || '.js-account')
        if (target) {
          const range = document.createRange()
          range.selectNodeContents(target)
          window.getSelection().removeAllRanges()
          window.getSelection().addRange(range)
        }
        button.textContent = 'Bấm Ctrl+C để sao chép'
      }
      setTimeout(() => { button.textContent = label }, 2000)
    })
  })

  // Platforms that are not out yet: a "Coming soon" note in the middle of the screen for a moment
  let soon = null
  let soonTimer = null
  function showSoon (what) {
    if (!soon) {
      soon = document.createElement('div')
      soon.className = 'soon'
      soon.setAttribute('role', 'status')
      soon.addEventListener('click', () => soon.classList.remove('soon--show'))
      document.body.appendChild(soon)
    }
    soon.textContent = ''
    const title = document.createElement('b')
    title.textContent = 'Coming soon…'
    const detail = document.createElement('span')
    detail.textContent = `${what} đang được làm.`
    soon.append(title, detail)
    soon.classList.add('soon--show')
    clearTimeout(soonTimer)
    soonTimer = setTimeout(() => soon.classList.remove('soon--show'), 2200)
  }
  $$('.js-soon').forEach((button) => {
    button.addEventListener('click', () => showSoon(button.querySelector('.js-soon-label').textContent))
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && soon) soon.classList.remove('soon--show')
  })

  // A phone, or Zalo's own browser on one (an iPad says it is a Mac, but has a touch screen).
  // The installer is no use there, so the button hands over a link to open on the computer.
  const onPhone = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

  function copyLinkInstead (a) {
    const box = document.createElement('div')
    box.className = 'phone-get'
    const line = document.createElement('p')
    const lead = document.createElement('b')
    lead.textContent = 'Zenlo chạy trên máy tính Windows.'
    line.append(lead, ' Sao chép link, dán vào Cloud của tôi trên Zalo rồi mở trên máy tính.')
    const button = document.createElement('button')
    button.className = 'btn'
    button.type = 'button'
    button.textContent = 'Sao chép link'
    const shown = document.createElement('span')
    shown.className = 'phone-get__link'
    shown.textContent = 'zenlo.io.vn/#cai-dat'
    box.append(line, button, shown)
    a.replaceWith(box)

    button.addEventListener('click', async () => {
      let copied = false
      try {
        await navigator.clipboard.writeText('https://zenlo.io.vn/#cai-dat')
        copied = true
      } catch (error) {
        // In-app browsers often refuse the clipboard: select the link, and try the old way
        const range = document.createRange()
        range.selectNodeContents(shown)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        try { copied = document.execCommand('copy') } catch (ignored) {}
      }
      button.textContent = copied ? 'Đã sao chép ✓' : 'Giữ vào link để sao chép'
      setTimeout(() => { button.textContent = 'Sao chép link' }, 2500)
    })
  }

  if (onPhone) $$('.js-download').forEach(copyLinkInstead)

  function setDownload (href, label) {
    $$('.js-download').forEach((a) => {
      if (href) {
        a.href = href
        a.removeAttribute('aria-disabled')
      } else {
        a.href = '#cai-dat'
        a.setAttribute('aria-disabled', 'true')
      }
    })
    $$('.js-download-label').forEach((span) => {
      span.textContent = label
    })
  }

  function setText (selector, text) {
    $$(selector).forEach((el) => {
      el.textContent = text
    })
  }

  if (FEEDBACK_EMAIL) {
    $$('.js-feedback').forEach((a) => {
      a.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Góp ý Zenlo')}`
    })
  } else {
    $$('.js-feedback').forEach((a) => a.remove())
  }

  if (!REPO) {
    setDownload('', 'Sắp phát hành')
    setText('.js-release-meta', 'Windows 10/11')
    $$('.js-source').forEach((a) => a.remove())
    return
  }

  $$('.js-source').forEach((a) => {
    a.href = `https://github.com/${REPO}`
  })
  const fileUrl = `https://github.com/${REPO}/releases/latest/download/Zenlo-Setup.exe`
  setDownload(fileUrl, 'Tải Zenlo miễn phí cho Windows')

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
    .then((release) => {
      // From v0.2.0 a release also has the installer in a zip, which browsers warn less about
      const zip = (release.assets || []).find((a) => a.name === 'Zenlo-Setup.zip')
      if (zip) {
        setDownload(`https://github.com/${REPO}/releases/latest/download/Zenlo-Setup.zip`, 'Tải Zenlo miễn phí cho Windows')
        setText('.js-file-name', 'Zenlo-Setup.zip')
        setText('.js-download-step', 'Tải, giải nén, mở file')
      }

      // Only the home page and the versions page show the release facts
      if (!document.querySelector('.js-version, .js-size-small, .js-sha')) return
      const asset = zip || (release.assets || []).find((a) => a.name === 'Zenlo-Setup.exe')
      const sha = ((release.body || '').match(/\b[a-f0-9]{64}\b/) || [])[0]
      // The C# installer is about 180 KB, the old one 90 MB
      const size = !asset ? 'khoảng 200 KB' : asset.size < 1048576 ? `${Math.round(asset.size / 1024)} KB` : `${Math.round(asset.size / 1048576)} MB`
      const tag = release.tag_name || 'bản mới nhất'
      setText('.js-version', tag)
      setText('.js-size', size)
      setText('.js-size-small', `${tag} · ${size}`)
      setText('.js-sha', sha || 'xem trong ghi chú phát hành')
      setText('.js-release-meta', `Miễn phí · ${tag} · ${size} · Windows 10/11`)
      if (sha) {
        $$('.js-virustotal').forEach((a) => {
          a.href = `https://www.virustotal.com/gui/file/${sha}`
        })
        $$('.js-virustotal-line').forEach((el) => { el.hidden = false })
      }
    })
    .catch(() => {
      // GitHub did not answer (e.g. too many requests from one network): words instead of dashes
      setText('.js-version', 'bản mới nhất')
      setText('.js-size', 'khoảng 200 KB')
      setText('.js-sha', 'xem trong ghi chú phát hành trên GitHub')
    })
})()
