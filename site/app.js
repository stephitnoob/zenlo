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

  // The post (style.css): every button presses down like a rubber stamp, a main download button's
  // wax seal breaks open, and a copy leaves a violet ink mark where the button was hit
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function ink (button, text, event) {
    if (still) return
    const rect = button.getBoundingClientRect()
    const x = event && event.clientX ? event.clientX : rect.left + rect.width * 0.85
    const y = event && event.clientY ? event.clientY : rect.top + rect.height / 2
    const mark = document.createElement('span')
    mark.className = 'ink'
    mark.textContent = text
    mark.setAttribute('aria-hidden', 'true')
    mark.style.left = `${x + window.scrollX}px`
    mark.style.top = `${y + window.scrollY}px`
    document.body.appendChild(mark)
    setTimeout(() => mark.remove(), 1400)
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('.btn')
    if (!button || still || button.getAttribute('aria-disabled') === 'true') return
    button.classList.remove('is-pressed')
    button.getBoundingClientRect() // restart the press
    button.classList.add('is-pressed')
    if (button.classList.contains('btn--seal')) {
      button.classList.add('is-open')
      setTimeout(() => button.classList.remove('is-open'), 1800)
    }
  })
  document.addEventListener('animationend', (event) => {
    if (event.animationName === 'btn-stamp') event.target.classList.remove('is-pressed')
  })

  // Questions are envelopes (style.css): each gets its flap and its "?" stamp. Opening, the flap
  // turns up and the answer slides out from under the envelope while the page below makes room;
  // closing, the answer slides back in, then the flap shuts. With reduced motion, a plain <details>.
  $$('.faq details').forEach((item) => {
    const summary = item.querySelector('summary')
    const letter = summary && summary.nextElementSibling
    if (!letter) return
    summary.insertAdjacentHTML('afterbegin', '<i class="faq__flap" aria-hidden="true"></i><i class="faq__stamp" aria-hidden="true">?</i>')
    if (still || !letter.animate) return
    let run = null
    summary.addEventListener('click', (event) => {
      event.preventDefault()
      const opening = !item.open || item.classList.contains('is-closing')
      if (run) {
        run.onfinish = null
        run.cancel()
      }
      item.open = true
      item.classList.toggle('is-closing', !opening)
      // Tucked: lifted by its own height, the part above the envelope's edge cut off, and taking
      // no room on the page
      const h = letter.offsetHeight
      const tucked = { transform: `translateY(${-h}px)`, clipPath: `inset(${h}px 0 0 0)`, marginBottom: `${-h}px` }
      const out = { transform: 'none', clipPath: 'inset(0 0 0 0)', marginBottom: '0px' }
      run = letter.animate(opening ? [tucked, out] : [out, tucked], opening
        ? { duration: 420, delay: 80, fill: 'backwards', easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' }
        : { duration: 300, easing: 'cubic-bezier(0.5, 0, 0.75, 0.3)' })
      run.onfinish = () => {
        run = null
        if (opening) return
        item.open = false
        item.classList.remove('is-closing')
      }
    })
  })

  // "Sao chép" buttons: copy their data-copy text, or select it when the clipboard is not allowed
  $$('.js-copy').forEach((button) => {
    const label = button.textContent
    button.addEventListener('click', async (event) => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
        button.textContent = 'Đã sao chép ✓'
        ink(button, 'đã chép', event)
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

  // Platforms that are not out yet: a "Sắp có" stamp in the middle of the screen for a moment
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
    title.textContent = 'Sắp có'
    const detail = document.createElement('span')
    detail.textContent = `${what} chưa phát hành.`
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

  // A downloaded file dropped on a page with a download button: its seal is checked. The file's
  // SHA-256 is worked out here in the browser, never sent anywhere, and compared with the ones
  // GitHub's release notes give for every release (asked from api.github.com at the first drop).
  // A Zenlo-Setup.zip is opened here, for the Zenlo-Setup.exe inside it, the file the notes name.
  function setupSealCheck () {
    let known = null // { map: hash -> { tag, file }, latest, partial }
    let depth = 0
    const desk = document.createElement('div')
    desk.className = 'seal-desk'
    desk.setAttribute('role', 'status')
    desk.hidden = true
    document.body.appendChild(desk)

    const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files')
    const el = (tag, className, text) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text) node.textContent = text
      return node
    }
    function card (state, ...children) {
      desk.textContent = ''
      desk.dataset.state = state
      const box = el('div', 'seal-card')
      box.append(...children)
      if (state !== 'wait') {
        const shut = el('button', 'seal-card__close', '×')
        shut.type = 'button'
        shut.setAttribute('aria-label', 'Đóng')
        box.appendChild(shut)
      }
      desk.appendChild(box)
      desk.hidden = false
    }
    function close () {
      desk.hidden = true
      desk.textContent = ''
      depth = 0
    }

    async function sha256 (bytes) {
      const digest = await window.crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    // The Zenlo-Setup.exe inside a zip, read from the zip's own table of contents
    async function exeInZip (bytes) {
      if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || !('DecompressionStream' in window)) return null
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      let end = -1
      for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          end = i
          break
        }
      }
      if (end < 0) return null
      const count = view.getUint16(end + 10, true)
      let at = view.getUint32(end + 16, true)
      for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
        if (view.getUint32(at, true) !== 0x02014b50) return null
        const method = view.getUint16(at + 10, true)
        const packed = view.getUint32(at + 20, true)
        const nameLength = view.getUint16(at + 28, true)
        const local = view.getUint32(at + 42, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
        if (name.split('/').pop() !== 'Zenlo-Setup.exe') continue
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return null
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
        const data = bytes.subarray(start, start + packed)
        if (method === 0) return data
        if (method !== 8) return null
        const stream = new Blob([data]).stream().pipeThrough(new window.DecompressionStream('deflate-raw'))
        return new Uint8Array(await new Response(stream).arrayBuffer())
      }
      return null
    }

    // Every hash in every release's notes, with the file named before it on its line
    async function knownHashes () {
      if (known) return known
      const map = {}
      try {
        const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } })
        if (!response.ok) throw new Error(response.status)
        const list = (await response.json()).filter((r) => !r.draft)
        for (const release of list) {
          for (const line of String(release.body || '').split('\n')) {
            for (const match of line.matchAll(/\b[a-f0-9]{64}\b/g)) {
              const before = line.slice(0, match.index).match(/[\w.-]+\.(?:exe|zip)/g)
              if (!map[match[0]]) map[match[0]] = { tag: release.tag_name, file: before ? before[before.length - 1] : 'Zenlo-Setup.exe' }
            }
          }
        }
        const newest = list.find((r) => !r.prerelease)
        known = { map, latest: newest ? newest.tag_name : '', partial: false }
      } catch (error) {
        // GitHub did not answer: the hashes this page already shows, of the newest release only
        const tag = (document.querySelector('.js-version') || {}).textContent || ''
        const add = (selector, file) => {
          const hash = ((document.querySelector(selector) || {}).textContent || '').trim()
          if (/^[a-f0-9]{64}$/.test(hash)) map[hash] = { tag, file }
        }
        add('.js-sha', 'Zenlo-Setup.exe')
        add('.js-web-sha', 'Zenlo-ZaloWeb.zip')
        return { map, latest: tag, partial: true }
      }
      return known
    }

    async function check (file) {
      if (!file) return close()
      card('busy', el('p', 'seal-card__file', file.name), el('p', '', 'Đang kiểm…'))
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const whole = await sha256(bytes)
        const exe = await exeInZip(bytes).catch(() => null)
        const inner = exe && await sha256(exe)
        const { map, latest, partial } = await knownHashes()
        const hit = (inner && map[inner]) || map[whole]
        const hash = (inner && map[inner]) ? inner : whole
        const name = el('p', 'seal-card__file', exe ? `${file.name} › Zenlo-Setup.exe` : file.name)
        const stamp = el('span', 'seal-stamp' + (still ? '' : ' is-new'))
        const sum = el('p', 'seal-card__hash', `SHA-256 ${hash}`)
        if (hit) {
          stamp.textContent = 'Còn nguyên niêm phong'
          const line = el('p')
          if (latest && hit.tag !== latest) {
            line.append(`Đây là Zenlo ${hit.tag}. Bản mới nhất là ${latest}. `)
            const get = el('a', 'link', 'Tải bản mới')
            get.href = './#cai-dat'
            line.appendChild(get)
          } else {
            const notes = el('a', 'link', 'ghi chú phát hành')
            notes.href = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(hit.tag)}`
            notes.target = '_blank'
            notes.rel = 'noopener'
            line.append(`Khớp SHA-256 của ${hit.file} ${hit.tag} trong `, notes, '.')
          }
          card(latest && hit.tag !== latest ? 'old' : 'ok', name, stamp, line, sum)
        } else if (!Object.keys(map).length) {
          card('busy', name, el('p', '', 'Chưa hỏi được GitHub để so. Thử lại sau ít phút.'))
        } else {
          stamp.textContent = 'Không khớp'
          const text = /zenlo/i.test(file.name)
            ? 'File này không khớp bản phát hành nào của Zenlo. Đừng mở nó, hãy tải lại ở nút Tải.'
            : 'Không khớp file nào của Zenlo.'
          card('bad', name, stamp, el('p', '', partial ? `${text} Mới so được với bản ${latest || 'mới nhất'}, vì chưa hỏi được GitHub.` : text), sum)
        }
      } catch (error) {
        card('busy', el('p', 'seal-card__file', file.name), el('p', '', 'Trình duyệt này không kiểm được file.'))
      }
    }

    document.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth++
      if (desk.hidden || desk.dataset.state !== 'wait') {
        card('wait', el('b', '', 'Kiểm niêm phong'), el('p', '', 'Thả Zenlo-Setup.zip, Zenlo-Setup.exe hoặc Zenlo-ZaloWeb.zip vào đây.'))
      }
    })
    document.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    })
    document.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return
      depth--
      if (depth <= 0 && desk.dataset.state === 'wait') close()
    })
    document.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      check(event.dataTransfer.files[0])
    })
    desk.addEventListener('click', (event) => {
      if (event.target.closest('a')) return
      if (event.target === desk || event.target.closest('.seal-card__close')) close()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !desk.hidden) close()
    })
  }
  if (REPO && document.querySelector('.js-download, .js-download-web') && window.crypto && window.crypto.subtle) {
    setupSealCheck()
  }

  // A phone, or Zalo's own browser on one (an iPad says it is a Mac, but has a touch screen).
  // The installer is no use there, so the button hands over a link to open on the computer.
  const onPhone = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

  function copyLinkInstead (a, { leadText = 'Zenlo chạy trên máy tính Windows.', link = 'zenlo.io.vn/#cai-dat' } = {}) {
    const box = document.createElement('div')
    box.className = 'phone-get'
    const line = document.createElement('p')
    const lead = document.createElement('b')
    lead.textContent = leadText
    line.append(lead, ' Sao chép link, dán vào Cloud của tôi trên Zalo rồi mở trên máy tính.')
    const button = document.createElement('button')
    button.className = 'btn'
    button.type = 'button'
    button.textContent = 'Sao chép link'
    const shown = document.createElement('span')
    shown.className = 'phone-get__link'
    shown.textContent = link
    box.append(line, button, shown)
    a.replaceWith(box)

    button.addEventListener('click', async (event) => {
      let copied = false
      try {
        await navigator.clipboard.writeText(`https://${link}`)
        copied = true
      } catch (error) {
        // In-app browsers often refuse the clipboard: select the link, and try the old way
        const range = document.createRange()
        range.selectNodeContents(shown)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        try { copied = document.execCommand('copy') } catch (ignored) {}
      }
      button.textContent = copied ? 'Đã sao chép ✓' : 'Nhấn giữ vào link để sao chép'
      if (copied) ink(button, 'đã chép', event)
      setTimeout(() => { button.textContent = 'Sao chép link' }, 2500)
    })
  }

  if (onPhone) {
    $$('.js-download').forEach((a) => copyLinkInstead(a))
    // The web zip is no use on a phone either: a link to the guide, for the computer
    $$('.js-download-web').forEach((a) => copyLinkInstead(a, { leadText: 'Zenlo cho Zalo web chạy trên trình duyệt máy tính.', link: 'zenlo.io.vn/#tai-web' }))
  }

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

      // The extension for Zalo web (guide), from v0.3.0. A release without it: no button to a missing file
      const web = (release.assets || []).find((a) => a.name === 'Zenlo-ZaloWeb.zip')
      if (web) {
        const webSha = ((release.body || '').match(/Zenlo-ZaloWeb\.zip[^\n]*?\b([a-f0-9]{64})\b/) || [])[1]
        setText('.js-web-version', release.tag_name || 'bản mới nhất')
        setText('.js-web-size', web.size < 1048576 ? `${Math.round(web.size / 1024)} KB` : `${Math.round(web.size / 1048576)} MB`)
        setText('.js-web-sha', webSha || 'xem trong ghi chú phát hành')
      } else {
        $$('.js-download-web').forEach((a) => {
          a.href = '#zalo-web'
          a.setAttribute('aria-disabled', 'true')
        })
        setText('.js-download-web-label', 'Sắp phát hành')
        setText('.js-web-version', 'chưa có bản phát hành')
        setText('.js-web-size', 'khoảng 90 KB')
        setText('.js-web-sha', '–')
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
      setText('.js-web-version', 'bản mới nhất')
      setText('.js-web-size', 'khoảng 90 KB')
      setText('.js-web-sha', 'xem trong ghi chú phát hành trên GitHub')
    })
})()
