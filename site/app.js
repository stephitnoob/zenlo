/*
  Zenlo – website. Fills the download buttons and the release facts (version, size, SHA-256)
  from the latest GitHub release. Only GitHub's public API is called; nothing is tracked.
*/

(function () {
  // The official repository ("owner/name") and the feedback e-mail. Empty until they exist:
  // the download buttons then say the first release is coming.
  const REPO = ''
  const FEEDBACK_EMAIL = ''

  const $$ = (selector) => document.querySelectorAll(selector)

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
    setText('.js-release-meta', 'Bản đầu tiên sắp ra mắt · Windows 10/11')
    $$('.js-source').forEach((a) => a.remove())
    return
  }

  $$('.js-source').forEach((a) => {
    a.href = `https://github.com/${REPO}`
  })
  const fileUrl = `https://github.com/${REPO}/releases/latest/download/Zenlo-Setup.exe`
  setDownload(fileUrl, 'Tải Zenlo cho Windows')

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
    .then((release) => {
      const asset = (release.assets || []).find((a) => a.name === 'Zenlo-Setup.exe')
      const sha = ((release.body || '').match(/\b[a-f0-9]{64}\b/) || [])[0]
      const size = asset ? `${(asset.size / 1048576).toFixed(0)} MB` : '–'
      setText('.js-version', release.tag_name || '–')
      setText('.js-size', size)
      setText('.js-sha', sha || 'xem trong ghi chú phát hành')
      setText('.js-release-meta', `Miễn phí · ${release.tag_name} · ${size} · Windows 10/11`)
      if (sha) {
        $$('.js-virustotal').forEach((a) => {
          a.href = `https://www.virustotal.com/gui/file/${sha}`
        })
      }
    })
    .catch(() => {
      setText('.js-sha', 'xem trong ghi chú phát hành trên GitHub')
    })
})()
