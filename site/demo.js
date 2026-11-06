/*
  Zenlo – website. The pretend Zalo windows on the home page: a summary that streams out, a digest
  with ticks and drag to reorder, citations that scroll the chat, length and AI switches, and the
  reaction bar with its "+" panel.
  Everything here is made up and runs in the page; nothing is sent anywhere.
*/

(function () {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, still ? 0 : ms))

  // The letter Zenlo shows while the AI has written nothing yet (ZenloCore.letterLoader in the app).
  // It follows the clock, so every letter on the page moves together.
  let letters = 0
  function letter (small) {
    const clip = `letter-clip-${++letters}`
    return `<svg class="letter${small ? ' letter--small' : ''}" viewBox="0 0 120 90" style="--letter-phase: ${-(Date.now() % 3200)}ms" aria-hidden="true">
      <defs><clipPath id="${clip}"><rect width="120" height="79"/></clipPath></defs>
      <rect class="letter__body" x="30" y="42" width="60" height="38" rx="4"/>
      <g clip-path="url(#${clip})"><g class="letter__paper">
        <rect class="letter__body" x="38" y="12" width="44" height="62" rx="3"/>
        <line class="letter__line" x1="45" y1="23" x2="75" y2="23"/>
        <line class="letter__line" x1="45" y1="31" x2="71" y2="31"/>
        <line class="letter__line" x1="45" y1="39" x2="65" y2="39"/>
      </g></g>
      <path class="letter__body" d="M30 52 L60 68 L90 52 L90 76 Q90 80 86 80 L34 80 Q30 80 30 76 Z"/>
    </svg>`
  }

  // ---------- Summaries ----------

  // A summary is a list of blocks: { h: 'heading' } or { li: 'text', cite: ['dd/mm hh:mm', ...] }
  // The "Team Marketing" chat of the first window
  const TEAM = {
    short: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa slide trước 9h mai.', cite: ['19/10 08:30'] },
      { li: 'Gửi Quang ảnh sản phẩm gốc tối nay.', cite: ['19/10 17:45'] },
      { li: 'Nộp báo cáo trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt thứ 6 (23/10).', cite: ['19/10 11:40'] }
    ],
    medium: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai.', cite: ['19/10 08:30'] },
      { li: 'Gửi Quang file ảnh sản phẩm gốc ngay tối nay, khách cần gấp.', cite: ['19/10 17:45'] },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt sản phẩm thứ 6 (23/10).', cite: ['19/10 11:40'] },
      { li: 'Khách ABC đổi logo sang xanh đậm.', cite: ['19/10 09:10'] },
      { li: 'Mừng sinh nhật chị Hoa lúc 15h ở pantry.', cite: ['19/10 15:00'] }
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
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai.', cite: ['19/10 08:30'] },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai.', cite: ['19/10 17:30'] },
      { h: 'Còn lại' },
      { li: 'Ra mắt chốt thứ 6 (23/10); Quang làm việc lại với khách.', cite: ['19/10 11:40'] }
    ]
  }

  // A citation is 'dd/mm hh:mm', or { label, t } for a message whose time another one may share
  function citeButton (cite) {
    const label = cite.label || cite
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cite'
    button.dataset.t = cite.t || label.slice(-5)
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
    // Screen readers read the finished text once instead of every few letters
    box.setAttribute('aria-busy', 'true')
    try {
      await streamInto(box, blocks, isStopped)
    } finally {
      box.removeAttribute('aria-busy')
    }
  }

  async function streamInto (box, blocks, isStopped) {
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

  // ---------- The message box: what is typed stays in the page ----------

  const HOI_AN = [
    ['Vy', 'ủa ai đây'],
    ['Trang', 'nhầm nhóm hả bạn'],
    ['Nam', 'vào rồi thì góp 300k nha'],
    ['Huy', 'thứ 7 đi chung không'],
    ['Khánh', '👍']
  ]
  const REPLIES = {
    'demo-summary': [
      ['Chị Hoa', '@Minh slide đâu em'],
      ['Quang', 'file ảnh gốc nữa Minh ơi'],
      ['Tuấn', 'ủa Minh giờ mới đọc tin à'],
      ['Linh', 'đọc hết 35 tin chưa đó'],
      ['Phương', '😆']
    ],
    'demo-cite': HOI_AN,
    'demo-react': HOI_AN
  }

  // What was said in Team Marketing, for its summary
  const talk = { added: 0, sent: 0, last: null, reply: null }

  const two = (n) => String(n).padStart(2, '0')

  function setupComposers () {
    let keys = 0
    document.querySelectorAll('.zw').forEach((win) => {
      const box = win.querySelector('.zw__composer')
      const msgs = win.querySelector('.zw__msgs')
      if (!box || !msgs) return

      const form = document.createElement('form')
      form.className = 'zw__composer'
      const input = document.createElement('input')
      input.placeholder = box.textContent
      input.setAttribute('aria-label', box.textContent)
      input.maxLength = 120
      input.autocomplete = 'off'
      input.enterKeyHint = 'send'
      const send = document.createElement('button')
      send.type = 'submit'
      send.setAttribute('aria-label', 'Gửi')
      send.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
      form.append(input, send)
      box.replaceWith(form)

      const replies = REPLIES[win.id] || []
      const isTeam = win.id === 'demo-summary'
      let answered = 0
      let waiting = false
      let dayShown = false

      // Adds a message with today's date and time; returns how to cite it
      function add (name, text) {
        if (!dayShown) {
          dayShown = true
          const day = document.createElement('div')
          day.className = 'zw__day'
          day.textContent = 'Hôm nay'
          msgs.appendChild(day)
        }
        const now = new Date()
        const time = `${two(now.getHours())}:${two(now.getMinutes())}`
        const cite = { label: `${two(now.getDate())}/${two(now.getMonth() + 1)} ${time}`, t: `typed-${++keys}` }
        const msg = document.createElement('div')
        msg.className = name ? 'msg' : 'msg msg--me'
        msg.dataset.t = cite.t
        const head = document.createElement('b')
        if (name) head.append(`${name} `)
        const stamp = document.createElement('span')
        stamp.textContent = time
        head.appendChild(stamp)
        msg.append(head, text)
        msgs.appendChild(msg)
        msgs.scrollTop = msgs.scrollHeight
        if (isTeam) talk.added++
        return cite
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const text = input.value.trim()
        if (!text) return
        input.value = ''
        const cite = add('', text)
        if (isTeam) {
          talk.sent++
          talk.last = { text, cite }
        }
        // One person answers at a time, and after the last one the group goes quiet
        if (waiting || answered >= replies.length) return
        waiting = true
        await wait(1800)
        const [name, reply] = replies[answered++]
        const replyCite = add(name, reply)
        if (isTeam && !talk.reply) talk.reply = replyCite
        waiting = false
      })
    })
  }

  // The summary of Team Marketing, with what the visitor said in it
  function teamSummary () {
    if (!talk.last) return TEAM.medium
    const { text, cite } = talk.last
    const quoted = text.length > 60 ? `${text.slice(0, 60)}…` : text
    const said = talk.sent > 1 ? `Bạn nhắn ${talk.sent} tin, mới nhất là “${quoted}”` : `Bạn nhắn “${quoted}”`
    const line = talk.reply
      ? { li: `${said}, chị Hoa hỏi lại về slide.`, cite: [cite, talk.reply] }
      : { li: `${said}.`, cite: [cite] }
    // Under "Liên quan tới bạn", before "Còn lại"
    const blocks = TEAM.medium.slice()
    blocks.splice(blocks.findIndex((block, i) => i > 0 && block.h), 0, line)
    return blocks
  }

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
      const total = 35 + talk.added
      summary.querySelector('.js-netlog-n').textContent = total
      hint.textContent = `Đang đọc ${total} tin…`
      log.classList.remove('show')
      out.textContent = ''
      await wait(500)
      hint.textContent = `Đang tóm tắt ${total} tin…`
      out.innerHTML = letter()
      await wait(1800)
      hint.textContent = ''
      out.textContent = ''
      await stream(out, teamSummary())
      log.classList.add('show')
      hint.textContent = 'thử bấm vào một mốc giờ'
      run.textContent = 'Tóm tắt'
      run.disabled = false
      busy = false
    })
  }

  // ---------- 2. Digest ----------

  const DIGEST = {
    team: { text: 'Gửi chị Hoa slide trước 9h mai, gửi Quang ảnh gốc tối nay; cả nhóm nộp báo cáo trước 12h trưa mai.', cite: ['19/10 08:30', '19/10 17:45', '19/10 17:30'], chat: 'demo-summary', count: 35 },
    ph: { text: 'Họp phụ huynh 19h thứ 5; nộp quỹ lớp 200k trước thứ 6.', cite: ['19/10 20:05'], count: 37 },
    run: { text: 'Chạy sáng chủ nhật 5h30 ở biển Mỹ Khê; đăng ký giải 10K trước thứ 6.', cite: ['19/10 20:15'], count: 52 },
    nha: { text: 'Giỗ ông trưa chủ nhật, 9h cả nhà về quê.', cite: ['19/10 16:40'], count: 4 },
    cc: { text: 'Cúp nước 8h–12h sáng thứ 4 để sửa đường ống.', cite: ['19/10 09:12'], count: 23 },
    shop: { text: 'Đơn hàng đang giao, kèm mã giảm 10%.', cite: ['19/10 10:12'], count: 6 }
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
      const unticked = () => !card.querySelector('.dcard__check').checked
      for (let i = 0; i < item.text.length; i += 3) {
        if (mine !== round || unticked()) return
        node.data = item.text.slice(0, i + 3)
        await wait(16)
      }
      caret.remove()
      if (unticked()) return
      for (const label of item.cite) {
        // Only the Team Marketing chat is on the page: its citations scroll it; the others are labels
        if (item.chat) {
          const button = citeButton(label)
          button.dataset.chat = item.chat
          box.appendChild(button)
        } else {
          const span = document.createElement('span')
          span.className = 'cite cite--static'
          span.textContent = label
          box.appendChild(span)
        }
      }
    }

    async function make () {
      const mine = ++round
      cards.querySelectorAll('.dcard__sum').forEach((box) => { box.textContent = '' })
      const chosen = ticked()
      // Every chosen card waits with a small letter until its part of the answer arrives
      for (const card of chosen) card.querySelector('.dcard__sum').innerHTML = `<span class="letter-row">${letter(true)}Đang tóm tắt…</span>`
      // Zenlo writes the whole digest in one answer; two cards at a time keeps the demo short
      let next = 0
      const worker = async () => {
        while (next < chosen.length) {
          if (mine !== round) return
          const card = chosen[next++]
          if (!card.querySelector('.dcard__check').checked) continue
          await wait(900)
          await fill(card, mine)
        }
      }
      await Promise.all([worker(), worker()])
    }

    run.addEventListener('click', make)
    // A citation on the Team Marketing card scrolls to that chat and to the message
    cards.addEventListener('click', (event) => {
      const cite = event.target.closest('.cite[data-chat]')
      const win = cite && document.getElementById(cite.dataset.chat)
      if (!win) return
      const box = win.getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + box.top - Math.max(16, (window.innerHeight - box.height) / 2), behavior: still ? 'auto' : 'smooth' })
      setTimeout(() => jump(win, cite.dataset.t), still ? 0 : 450)
    })
    // Alt + ↑/↓ moves the focused card, for keyboards and phones where dragging does not work
    cards.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      const card = event.target.closest('.dcard')
      if (!card) return
      event.preventDefault()
      if (event.key === 'ArrowUp' && card.previousElementSibling) cards.insertBefore(card, card.previousElementSibling)
      if (event.key === 'ArrowDown' && card.nextElementSibling) cards.insertBefore(card.nextElementSibling, card)
      event.target.focus()
    })
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
        note: 'Cần gói Claude Pro hoặc Max, và Claude Code đã cài và đăng nhập.'
      },
      codex: {
        field: ['Codex', 'đã đăng nhập ChatGPT'],
        log: ['Codex trên máy bạn → máy chủ OpenAI', 'HTTPS · bằng gói ChatGPT của bạn'],
        note: 'Cần gói ChatGPT có Codex (Plus, Pro…) và Codex đã cài, đăng nhập bằng tài khoản ChatGPT.'
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

  // ---------- Reactions ----------

  // 82 reactions, as many as the app shows; the page draws them with the system's emoji
  const QUICK = ['👍', '❤️', '😆', '😮', '😭', '😡']
  const ALL = QUICK.concat([
    '😍', '😘', '😂', '🤣', '😊', '🥰', '😎', '🤩', '🥳', '😇', '🙂', '😉', '😋', '🤤',
    '😜', '🤪', '😏', '😌', '🤗', '🤭', '🤔', '🤫', '😴', '🥱', '😢', '🥺', '😤', '😱',
    '😨', '😰', '😳', '🤯', '😵', '🤐', '🤢', '🤧', '😷', '🤒', '👏', '🙏', '💪', '👌',
    '✌️', '🤝', '👋', '🙌', '👎', '💯', '🔥', '✨', '🎉', '🎊', '💔', '💕', '💖', '💙',
    '💚', '💛', '💜', '🖤', '🌹', '🌸', '☕', '🍻', '🎂', '🍀', '🌟', '⭐', '🌈', '🤮', '😪', '💗', '🎄', '⛄', '🎁', '🧧'
  ])

  function setupReact () {
    const box = document.getElementById('demo-react')
    if (!box) return
    const chips = box.querySelector('.js-chips')
    const plus = box.querySelector('.js-plus')
    const hint = box.querySelector('.js-hint')
    const pick = box.querySelector('.js-pick')
    const recentBox = box.querySelector('.js-recent')
    let recent = ['🤤', '🥳', '🙏']

    const emojiButtons = (list) => list.map((e) => `<button type="button" data-e="${e}" aria-label="Thả ${e}">${e}</button>`).join('')
    const showRecent = () => { recentBox.innerHTML = emojiButtons(recent) }

    box.querySelector('.js-quick').innerHTML = emojiButtons(QUICK)
    box.querySelector('.js-all').innerHTML = emojiButtons(ALL)
    box.querySelector('.js-total').textContent = ALL.length
    showRecent()

    function open (yes) {
      pick.hidden = !yes
      plus.setAttribute('aria-expanded', String(yes))
    }

    plus.addEventListener('click', () => {
      hint.hidden = true
      open(pick.hidden)
    })

    box.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-e]')
      if (!button) return
      const e = button.dataset.e
      chips.innerHTML = `<span class="rx-chip">${e} 1</span>`
      hint.hidden = true
      // As in the app: what was just sent from the panel goes to the top of "Gần đây"
      if (pick.contains(button)) {
        recent = [e].concat(recent.filter((r) => r !== e)).slice(0, 12)
        showRecent()
      }
      open(false)
    })
  }

  // Each demo on its own: one that fails leaves the others working
  for (const setup of [setupComposers, setupSummary, setupDigest, setupYours, setupNote, setupReact]) {
    try {
      setup()
    } catch (error) {
      console.error('Zenlo demo:', error)
    }
  }
})()
