/*
  Zenlo – website. The page for an address that does not exist: a letter sent back. The address
  that was typed is written on the envelope, and the page closest to it is offered. Nothing is
  sent or stored; the address is read from the browser's own location.
*/

(function () {
  // [title, address, other ways people write it (without accents or dashes)]
  const PAGES = [
    ['Trang chủ', '/', 'trangchu home index'],
    ['Hướng dẫn', '/huong-dan.html', 'huongdan hd hdsd guide help docs tailieu cachdung'],
    ['Hướng dẫn › Bắt đầu', '/huong-dan.html#bat-dau', 'batdau start'],
    ['Hướng dẫn › Cài Zenlo', '/huong-dan.html#cai-zenlo', 'caizenlo cai install setup caidat'],
    ['Hướng dẫn › Khi trình duyệt hoặc Windows cảnh báo', '/huong-dan.html#canh-bao', 'canhbao smartscreen virus'],
    ['Hướng dẫn › Lấy API key Gemini', '/huong-dan.html#lay-key', 'laykey key apikey geminikey laykeygemini'],
    ['Hướng dẫn › Tóm tắt một hội thoại', '/huong-dan.html#tom-tat', 'tomtat summary'],
    ['Hướng dẫn › Bản tin', '/huong-dan.html#ban-tin', 'bantin digest'],
    ['Hướng dẫn › Gemini, Claude hay ChatGPT', '/huong-dan.html#chon-ai', 'chonai ai'],
    ['Hướng dẫn › Gemini', '/huong-dan.html#gemini', 'gemini'],
    ['Hướng dẫn › Claude', '/huong-dan.html#claude', 'claude'],
    ['Hướng dẫn › ChatGPT (Codex)', '/huong-dan.html#codex', 'codex chatgpt openai'],
    ['Hướng dẫn › Khi Zalo cập nhật', '/huong-dan.html#zalo-cap-nhat', 'zalocapnhat'],
    ['Hướng dẫn › Gỡ Zenlo', '/huong-dan.html#go-zenlo', 'gozenlo gocaidat uninstall remove'],
    ['Hướng dẫn › Zenlo cho Zalo web', '/huong-dan.html#zalo-web', 'zaloweb web extension tienich chrome edge'],
    ['Hướng dẫn › Xử lý sự cố', '/huong-dan.html#su-co', 'suco loi error'],
    ['Hướng dẫn › Không thấy nút Zenlo', '/huong-dan.html#su-co-mat-nut', 'matnut khongthaynut'],
    ['Hướng dẫn › Báo hết lượt', '/huong-dan.html#su-co-het-luot', 'hetluot quota'],
    ['Phiên bản', '/phien-ban.html', 'phienban version versions changelog release releases capnhat banmoi'],
    ['Tải Zenlo', '/#cai-dat', 'tai taive download downloads zenlosetup exe zip'],
    ['Thử tóm tắt một nhóm chat', '/#thu', 'thu thungay demo dungthu'],
    ['Câu hỏi thường gặp', '/#cau-hoi', 'faq hoidap cauhoi'],
    ['Quyền riêng tư', '/privacy.html', 'privacy quyenriengtu riengtu baomat chinhsach'],
    ['Điều khoản sử dụng', '/dieu-khoan.html', 'dieukhoan terms tos'],
    ['Code signing policy', '/ky-so.html', 'kyso codesigning signing chukyso signpath'],
    ['Mã nguồn trên GitHub', 'https://github.com/stephitnoob/zenlo', 'github source code manguon src repo']
  ]

  const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/\.html?$/, '').replace(/[^a-z0-9]/g, '')

  function distance (a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let corner = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const up = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, corner + (a[i - 1] === b[j - 1] ? 0 : 1))
        corner = up
      }
    }
    return row[b.length]
  }

  let path = window.location.pathname
  try {
    path = decodeURIComponent(path)
  } catch (error) {}
  path = path.replace(/^\/+/, '')

  const to = document.querySelector('.js-to')
  if (to) {
    const shown = `${window.location.host || 'zenlo.io.vn'}/${path}`
    to.textContent = shown.length > 80 ? `${shown.slice(0, 79)}…` : shown
  }

  // Each part of the address, and the whole of it, against every way of writing every page
  // The old address stephitnoob.github.io/zenlo/… may still be in someone's bookmarks
  const asked = path.replace(/^zenlo\//i, '')
  const parts = asked.split('/').map(plain).filter(Boolean)
  if (parts.length > 1) parts.push(plain(asked))
  let best = null
  let bestScore = Infinity
  for (const [title, href, words] of PAGES) {
    for (const word of [plain(href.split('#').pop()), ...words.split(' ')]) {
      if (!word) continue
      for (const part of parts) {
        let score = part === word ? 0 : word.length >= 4 && part.includes(word) ? 0.5 : distance(part, word)
        if (score > Math.max(1, Math.floor(word.length / 4))) continue
        score -= word.length / 1000 // a longer word that fits says more
        if (score < bestScore) {
          bestScore = score
          best = { title, href }
        }
      }
    }
  }

  const hint = document.querySelector('.js-hint')
  if (hint && best) {
    const link = document.createElement('a')
    link.className = 'link'
    link.href = best.href
    link.textContent = best.title
    hint.textContent = 'Có phải bạn tìm: '
    hint.appendChild(link)
    hint.hidden = false
  }
})()
