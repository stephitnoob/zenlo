/*
  Zenlo – website. The pretend Zalo windows on the home page: a summary that streams out, a digest
  with ticks and drag to reorder, citations that scroll the chat, length and AI switches.
  Everything here is made up and runs in the page; nothing is sent anywhere.
*/

(function () {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, still ? 0 : ms))

  // ---------- Summaries ----------

  // A summary is a list of blocks: { h: 'heading' } or { li: 'text', cite: ['dd/mm hh:mm', ...] }
  const CLASS = {
    short: [
      { h: 'Liên quan tới bạn' },
      { li: 'Xác nhận số áo lớp cho Chi trước thứ 5.', cite: ['19/10 08:20'] },
      { li: 'Chuyển 100k picnic cho Hà trước tối thứ 4.', cite: ['19/10 20:40'] },
      { li: 'Mai kiểm tra 15 phút Toán chương 3.', cite: ['19/10 20:15'] }
    ],
    medium: [
      { h: 'Liên quan tới bạn' },
      { li: 'Chi nhờ bạn xác nhận số áo lớp, bên in cần trước thứ 5 (22/10).', cite: ['19/10 08:20'] },
      { li: 'Hà nhắc cả lớp chuyển 100k tiền picnic trước tối thứ 4 (21/10); mới có 12 bạn chuyển.', cite: ['19/10 20:40'] },
      { h: 'Còn lại' },
      { li: 'Lớp đi picnic thứ 6 (23/10). An và Hà tìm địa điểm, mai Hà đặt cọc.', cite: ['19/10 08:03'] },
      { li: 'Cô Lan: mai (20/10) kiểm tra 15 phút Toán chương 3, ôn cấp số nhân.', cite: ['19/10 20:15'] },
      { li: 'Dũng gửi đề cương Lý HK1.', cite: ['19/10 09:05'] }
    ],
    long: [
      { h: 'Liên quan tới bạn' },
      { li: 'Chi nhắc tên bạn: cần xác nhận số áo lớp, bên in cần trước thứ 5 (22/10). Bạn chưa trả lời.', cite: ['19/10 08:20'] },
      { li: 'Hà nhắc cả lớp (@All) chuyển 100k tiền picnic cho Hà trước tối thứ 4 (21/10). Tới 20:40 mới có 12 bạn chuyển.', cite: ['19/10 08:10', '19/10 20:40'] },
      { h: 'Còn lại' },
      { li: 'Picnic: An rủ, Bình và Dũng đồng ý, chốt thứ 6 (23/10). An và Hà lo địa điểm; An hỏi có cần đặt cọc, Hà nói mai sẽ đặt.', cite: ['19/10 08:03', '19/10 21:08'] },
      { li: 'Cô Lan báo mai (20/10) kiểm tra 15 phút Toán chương 3, các em ôn kỹ phần cấp số nhân.', cite: ['19/10 20:15'] },
      { li: 'Bình hỏi đề cương Lý; Dũng gửi file De_cuong_Ly_HK1.pdf.', cite: ['19/10 09:05'] }
    ]
  }

  function citeButton (label) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cite'
    button.dataset.t = label.slice(-5)
    button.textContent = label
    return button
  }

  // Draws a summary at once
  function render (box, blocks) {
    box.textContent = ''
    let list = null
    for (const block of blocks) {
      if (block.h) {
        const h = document.createElement('h4')
        h.textContent = block.h
        box.appendChild(h)
        list = document.createElement('ul')
        box.appendChild(list)
      } else {
        const li = document.createElement('li')
        li.textContent = block.li
        for (const label of block.cite) li.appendChild(citeButton(label))
        list.appendChild(li)
      }
    }
  }

  // Types a summary out a few characters at a time, the way the model's answer arrives
  async function stream (box, blocks, isStopped = () => false) {
    if (still) return render(box, blocks)
    box.textContent = ''
    const caret = document.createElement('span')
    caret.className = 'caret'
    let list = null
    for (const block of blocks) {
      if (isStopped()) return
      let target
      if (block.h) {
        target = document.createElement('h4')
        box.appendChild(target)
        list = document.createElement('ul')
        box.appendChild(list)
      } else {
        target = document.createElement('li')
        list.appendChild(target)
      }
      const text = block.h || block.li
      const node = document.createTextNode('')
      target.appendChild(node)
      target.appendChild(caret)
      for (let i = 0; i < text.length; i += 3) {
        if (isStopped()) return
        node.data = text.slice(0, i + 3)
        await wait(18)
      }
      if (block.cite) for (const label of block.cite) target.insertBefore(citeButton(label), caret)
      await wait(120)
    }
    caret.remove()
  }

  // ---------- Citations scroll the chat beside them ----------

  function jump (win, time) {
    const msgs = win.querySelector('.js-msgs')
    const msg = msgs && msgs.querySelector(`.msg[data-t="${time}"]`)
    if (!msg) return
    msgs.scrollTop += msg.getBoundingClientRect().top - msgs.getBoundingClientRect().top - 40
    msg.classList.remove('msg--flash')
    msg.getBoundingClientRect() // restart the flash animation
    msg.classList.add('msg--flash')
    setTimeout(() => msg.classList.remove('msg--flash'), 1600)
  }

  document.querySelectorAll('.zw').forEach((win) => {
    const msgs = win.querySelector('.js-msgs')
    // The chat opens at its newest message, as Zalo does
    if (msgs) msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'instant' })
    win.addEventListener('click', (event) => {
      const cite = event.target.closest('.cite')
      if (cite) jump(win, cite.dataset.t)
    })
  })

  // ---------- 1. Summary ----------

  const summary = document.getElementById('demo-summary')
  if (summary) {
    const run = summary.querySelector('.js-run')
    const hint = summary.querySelector('.js-hint')
    const out = summary.querySelector('.js-out')
    const log = summary.querySelector('.js-netlog')
    let busy = false
    run.addEventListener('click', async () => {
      if (busy) return
      busy = true
      run.disabled = true
      run.classList.remove('zp__btn--pulse')
      hint.textContent = 'Đang đọc 14 tin…'
      log.classList.remove('show')
      out.textContent = ''
      await wait(700)
      hint.textContent = ''
      await stream(out, CLASS.medium)
      log.classList.add('show')
      hint.textContent = 'thử bấm vào một mốc giờ'
      run.textContent = 'Tóm tắt lại'
      run.disabled = false
      busy = false
    })
  }

  // ---------- 2. Digest ----------

  const DIGEST = {
    lop: { text: 'Chi cần bạn xác nhận số áo lớp trước thứ 5. Chuyển 100k picnic cho Hà trước tối thứ 4. Mai kiểm tra 15 phút Toán.', cite: '19/10 08:20', count: 14 },
    tin: { text: 'Thi thử thứ 7, 7h30 ở phòng máy 2, nhớ mang thẻ học sinh.', cite: '20/10 18:02', count: 23 },
    me: { text: 'Mẹ dặn tối nay về sớm ăn cơm, nhà có khách.', cite: '20/10 16:40', count: 2 },
    clb: { text: 'Họp chuẩn bị giải thứ 5, 17h ở phòng Lab. Cần 2 bạn mang laptop; Tuấn đã nhận một chỗ.', cite: '20/10 19:05', count: 51 },
    shop: { text: 'Đơn hàng đang giao, kèm mã giảm 10% cho lần sau.', cite: '20/10 10:12', count: 6 }
  }

  const digest = document.getElementById('demo-digest')
  if (digest) {
    const run = digest.querySelector('.js-run')
    const cards = digest.querySelector('.js-cards')
    const count = digest.querySelector('.js-count')
    let round = 0

    const ticked = () => [...cards.querySelectorAll('.dcard')].filter((card) => card.querySelector('.dcard__check').checked)
    function updateCount () {
      const chosen = ticked()
      const total = chosen.reduce((sum, card) => sum + DIGEST[card.dataset.id].count, 0)
      count.textContent = `${chosen.length} hội thoại · ${total} tin`
    }

    async function fill (card, mine) {
      const item = DIGEST[card.dataset.id]
      const box = card.querySelector('.dcard__sum')
      box.textContent = ''
      const node = document.createTextNode('')
      const caret = document.createElement('span')
      caret.className = 'caret'
      box.append(node, caret)
      for (let i = 0; i < item.text.length; i += 3) {
        if (mine !== round) return
        node.data = item.text.slice(0, i + 3)
        await wait(16)
      }
      caret.remove()
      box.appendChild(citeButton(item.cite))
    }

    async function make () {
      const mine = ++round
      cards.querySelectorAll('.dcard__sum').forEach((box) => { box.textContent = '' })
      const chosen = ticked()
      // Two at a time, like Zenlo does with Gemini
      let next = 0
      const worker = async () => {
        while (next < chosen.length) {
          if (mine !== round) return
          const card = chosen[next++]
          await wait(350)
          await fill(card, mine)
        }
      }
      await Promise.all([worker(), worker()])
    }

    run.addEventListener('click', make)
    cards.addEventListener('change', (event) => {
      const card = event.target.closest('.dcard')
      if (!card) return
      card.dataset.off = String(!event.target.checked)
      if (!event.target.checked) card.querySelector('.dcard__sum').textContent = ''
      updateCount()
    })

    // Drag to reorder
    let dragged = null
    const clearMarks = () => cards.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'))
    cards.addEventListener('dragstart', (event) => {
      dragged = event.target.closest('.dcard')
      if (!dragged) return
      dragged.classList.add('dragging')
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', dragged.dataset.id)
    })
    cards.addEventListener('dragover', (event) => {
      const card = event.target.closest('.dcard')
      if (!dragged || !card || card === dragged) return
      event.preventDefault()
      clearMarks()
      const box = card.getBoundingClientRect()
      card.classList.add(event.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after')
    })
    cards.addEventListener('drop', (event) => {
      const card = event.target.closest('.dcard')
      if (!dragged || !card || card === dragged) return
      event.preventDefault()
      cards.insertBefore(dragged, card.classList.contains('drop-before') ? card : card.nextSibling)
      clearMarks()
    })
    cards.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging')
      dragged = null
      clearMarks()
    })

    updateCount()

    // Runs once by itself the first time it comes into view
    if ('IntersectionObserver' in window) {
      const seen = new window.IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          seen.disconnect()
          if (!round) make()
        }
      }, { threshold: 0.5 })
      seen.observe(digest)
    }
  }

  // ---------- 4. Length and AI ----------

  const yours = document.getElementById('demo-yours')
  if (yours) {
    const lengthOut = yours.querySelector('.js-length-out')
    const pick = (group, button) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))

    const lengths = yours.querySelector('.js-length')
    render(lengthOut, CLASS.medium)
    lengths.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (!button) return
      pick(lengths, button)
      render(lengthOut, CLASS[button.dataset.len])
    })

    const AI = {
      gemini: {
        field: ['API key Gemini', 'AIza••••••••k3Qf'],
        log: ['generativelanguage.googleapis.com', 'HTTPS · bằng key của bạn'],
        note: 'Key miễn phí, không cần thẻ. Với key miễn phí, Google có thể dùng nội dung gửi lên để cải thiện sản phẩm.'
      },
      claude: {
        field: ['Claude Code', 'đã đăng nhập'],
        log: ['Claude Code trên máy bạn → api.anthropic.com', 'HTTPS · bằng gói Claude của bạn'],
        note: 'Cần gói Claude Pro hoặc Max, và Claude Code đã cài trên máy.'
      }
    }
    const ai = yours.querySelector('.js-ai')
    const field = yours.querySelector('.js-ai-field')
    const log = yours.querySelector('.js-ai-log')
    const note = yours.querySelector('.js-ai-note')
    function showAI (name) {
      const it = AI[name]
      field.textContent = ''
      const label = document.createElement('span')
      label.textContent = it.field[0]
      const value = document.createElement('span')
      value.textContent = it.field[1]
      field.append(label, value)
      log.textContent = ''
      const where = document.createElement('b')
      where.textContent = it.log[0]
      log.append('→ ', where, document.createElement('br'), `\u00a0\u00a0${it.log[1]}`)
      note.textContent = it.note
    }
    showAI('gemini')
    ai.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (!button) return
      pick(ai, button)
      showAI(button.dataset.ai)
    })
  }
})()
