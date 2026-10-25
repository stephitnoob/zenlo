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
  // The "Team Marketing" chat of the first window
  const TEAM = {
    short: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa slide trước 9h mai.', cite: ['19/10 08:30'] },
      { li: 'Gửi Quang ảnh sản phẩm gốc tối nay.', cite: ['19/10 17:45'] },
      { li: 'Nộp báo cáo trước 12h trưa mai.', cite: ['19/10 17:30'] }
    ],
    medium: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai.', cite: ['19/10 08:30'] },
      { li: 'Gửi Quang file ảnh sản phẩm gốc ngay tối nay, khách cần gấp.', cite: ['19/10 17:45'] },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt sản phẩm thứ 6 (23/10).', cite: ['19/10 11:40'] },
      { li: 'Khách ABC đổi logo sang xanh đậm.', cite: ['19/10 09:10'] }
    ],
    long: [
      { h: 'Liên quan tới bạn' },
      { li: 'Chị Hoa nhắc tên bạn: gửi bản slide trước 9h sáng mai để chị xem lại số liệu.', cite: ['19/10 08:30'] },
      { li: 'Quang cần file ảnh sản phẩm bản gốc ngay tối nay vì khách cần gấp.', cite: ['19/10 17:45'] },
      { li: 'Cả nhóm (@All) nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt sản phẩm thứ 6 (23/10): Linh lo bài đăng Facebook, Quang làm việc lại với khách.', cite: ['19/10 11:40'] },
      { li: 'Khách ABC muốn đổi logo sang xanh đậm, lần đổi thứ 4.', cite: ['19/10 09:10'] },
      { li: 'Chuyện khác: gọi cà phê, rủ ăn bún bò, bánh sinh nhật chị Hoa lúc 15h.', cite: ['19/10 08:12', '19/10 15:00'] }
    ]
  }

  // The same chat with a note for the AI
  const NOTED = {
    none: TEAM.medium,
    deadline: [
      { h: 'Hạn chót' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai.', cite: ['19/10 08:30'] },
      { li: 'Gửi Quang file ảnh sản phẩm gốc ngay tối nay.', cite: ['19/10 17:45'] },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { li: 'Ra mắt sản phẩm thứ 6 (23/10).', cite: ['19/10 11:40'] }
    ],
    client: [
      { h: 'Liên quan tới bạn' },
      { li: 'Khách ABC muốn đổi logo sang xanh đậm, đây là lần đổi thứ 4.', cite: ['19/10 09:10'] },
      { li: 'Quang cần file ảnh sản phẩm gốc ngay tối nay vì khách cần gấp.', cite: ['19/10 17:45'] },
      { li: 'Ra mắt chốt thứ 6 (23/10); Quang làm việc lại với khách.', cite: ['19/10 11:40'] },
      { h: 'Còn lại' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai.', cite: ['19/10 08:30'] },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] }
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
    // Only the message just cited lights up
    msgs.querySelectorAll('.msg--flash').forEach((m) => m.classList.remove('msg--flash'))
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

  function setupSummary () {
    const summary = document.getElementById('demo-summary')
    if (!summary) return
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
      hint.textContent = 'Đang đọc 35 tin…'
      log.classList.remove('show')
      out.textContent = ''
      await wait(700)
      hint.textContent = ''
      await stream(out, TEAM.medium)
      log.classList.add('show')
      hint.textContent = 'thử bấm vào một mốc giờ'
      run.textContent = 'Tóm tắt lại'
      run.disabled = false
      busy = false
    })
  }

  // ---------- 2. Digest ----------

  const DIGEST = {
    team: { text: 'Gửi chị Hoa slide trước 9h mai, gửi Quang ảnh sản phẩm tối nay.', cite: '19/10 08:30', count: 35 },
    ph: { text: 'Họp phụ huynh 19h thứ 5; nộp quỹ lớp 200k trước thứ 6.', cite: '20/10 20:05', count: 37 },
    run: { text: 'Chạy sáng chủ nhật 5h30 ở biển Mỹ Khê; đăng ký giải 10K trước thứ 6.', cite: '19/10 20:15', count: 52 },
    nha: { text: 'Cuối tuần về quê ăn giỗ ông, đi lúc 6h sáng thứ 7.', cite: '20/10 16:40', count: 4 },
    cc: { text: 'Cúp nước 8h–12h sáng thứ 4 để sửa đường ống.', cite: '20/10 09:12', count: 23 },
    shop: { text: 'Đơn hàng đang giao, kèm mã giảm 10%.', cite: '20/10 10:12', count: 6 }
  }

  function setupDigest () {
    const digest = document.getElementById('demo-digest')
    if (!digest) return
    const run = digest.querySelector('.js-run')
    const cards = digest.querySelector('.js-cards')
    const count = digest.querySelector('.js-count')
    let round = 0

    // A card without a made-up summary is left out instead of breaking the demo
    const ticked = () => [...cards.querySelectorAll('.dcard')].filter((card) => DIGEST[card.dataset.id] && card.querySelector('.dcard__check').checked)
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

  function setupYours () {
    const yours = document.getElementById('demo-yours')
    if (!yours) return
    const lengthOut = yours.querySelector('.js-length-out')
    const pick = (group, button) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))

    const lengths = yours.querySelector('.js-length')
    render(lengthOut, TEAM.medium)
    lengths.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (!button) return
      pick(lengths, button)
      render(lengthOut, TEAM[button.dataset.len])
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

  function setupNote () {
    const box = document.getElementById('demo-note')
    if (!box) return
    const out = box.querySelector('.js-note-out')
    const choice = box.querySelector('.js-note')
    render(out, NOTED.none)
    choice.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (!button) return
      choice.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
      render(out, NOTED[button.dataset.note])
    })
  }

  // Each demo on its own: one that fails leaves the others working
  for (const setup of [setupSummary, setupDigest, setupYours, setupNote]) {
    try {
      setup()
    } catch (error) {
      console.error('Zenlo demo:', error)
    }
  }
})()
