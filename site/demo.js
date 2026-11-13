/*
  Zenlo – website. The demos on the home page: one Zalo window with Zenlo docked in it ("Thử ngay":
  a summary that streams out, sources that scroll the chat, a note for the AI, the digest, the AI
  to use), and the reaction band with its "+" panel.
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

  // A summary is a list of blocks: { h: 'heading' } or { li: 'text [dd/mm hh:mm], text [dd/mm hh:mm].' },
  // each citation right after the words it comes from, as the app's prompt asks. The "Team Marketing"
  // chat of the "Thử ngay" window; "now" is after its last message (18:02), so 15h is "(đã qua)".
  const TEAM = {
    short: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa slide trước 9h mai [19/10 08:30].' },
      { li: 'Gửi Quang ảnh sản phẩm gốc tối nay [19/10 17:45].' },
      { li: 'Nộp báo cáo trước 12h trưa mai [19/10 17:30].' },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt thứ 6 (23/10) [19/10 11:40].' }
    ],
    medium: [
      { h: 'Liên quan tới bạn' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai [19/10 08:30].' },
      { li: 'Gửi Quang file ảnh sản phẩm gốc ngay tối nay, khách cần gấp [19/10 17:45].' },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai [19/10 17:30].' },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt sản phẩm thứ 6 (23/10) [19/10 11:40].' },
      { li: 'Khách ABC đổi logo sang xanh đậm [19/10 09:10].' },
      { li: 'Mừng sinh nhật chị Hoa lúc 15h ở pantry (đã qua) [19/10 15:00].' }
    ],
    long: [
      { h: 'Liên quan tới bạn' },
      { li: 'Chị Hoa nhắc tên bạn: gửi bản slide trước 9h sáng mai để chị xem lại số liệu [19/10 08:30].' },
      { li: 'Quang cần file ảnh sản phẩm bản gốc ngay tối nay vì khách cần gấp [19/10 17:45].' },
      { li: 'Cả nhóm (@All) nộp báo cáo tuần trước 12h trưa mai [19/10 17:30].' },
      { h: 'Còn lại' },
      { li: 'Chốt ra mắt sản phẩm thứ 6 (23/10): Linh lo bài đăng Facebook, Quang làm việc lại với khách [19/10 11:40].' },
      { li: 'Khách ABC muốn đổi logo sang xanh đậm [19/10 09:10], lần đổi thứ 4 [19/10 09:13].' },
      { li: 'Chuyện khác: gọi cà phê [19/10 08:12], rủ ăn bún bò [19/10 11:02], bánh sinh nhật chị Hoa lúc 15h (đã qua) [19/10 15:00].' }
    ]
  }

  // The same chat with a note for the AI
  const NOTED = {
    none: TEAM.medium,
    deadline: [
      { h: 'Hạn chót' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai [19/10 08:30].' },
      { li: 'Gửi Quang file ảnh sản phẩm gốc ngay tối nay [19/10 17:45].' },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai [19/10 17:30].' },
      { li: 'Ra mắt sản phẩm thứ 6 (23/10) [19/10 11:40].' }
    ],
    client: [
      { h: 'Liên quan tới bạn' },
      { li: 'Khách ABC muốn đổi logo sang xanh đậm [19/10 09:10], đây là lần đổi thứ 4 [19/10 09:13].' },
      { li: 'Quang cần file ảnh sản phẩm gốc ngay tối nay vì khách cần gấp [19/10 17:45].' },
      { li: 'Gửi chị Hoa bản slide trước 9h sáng mai [19/10 08:30].' },
      { li: 'Nộp báo cáo tuần trước 12h trưa mai [19/10 17:30].' },
      { h: 'Còn lại' },
      { li: 'Ra mắt chốt thứ 6 (23/10); Quang làm việc lại với khách [19/10 11:40].' }
    ]
  }

  // The text and citations of a point, in order: { text } and { cite }. A point written in the page
  // (what the visitor typed, which may hold brackets of its own) comes as a list already: strings
  // and citations.
  const CITE = /\[(\d{2}\/\d{2} \d{2}:\d{2})\]/g
  function pieces (li) {
    if (Array.isArray(li)) return li.map((piece) => typeof piece === 'string' ? { text: piece } : { cite: piece })
    const out = []
    let last = 0
    for (const match of li.matchAll(CITE)) {
      if (match.index > last) out.push({ text: li.slice(last, match.index) })
      out.push({ cite: match[1] })
      last = match.index + match[0].length
    }
    if (last < li.length) out.push({ text: li.slice(last) })
    return out
  }

  // As pieces, with the space before each citation dropped: a footnote sits right against its clause
  function footed (li) {
    const out = pieces(li)
    out.forEach((piece, i) => {
      if (piece.text && out[i + 1] && out[i + 1].cite) piece.text = piece.text.replace(/[ \t]+$/, '')
    })
    return out
  }

  // A citation is 'dd/mm hh:mm', or { label, t } for a message whose time another one may share.
  // It is drawn as a small footnote "[n]", numbered through one summary like Zenlo does: the same
  // message keeps its number (numbers: Map key -> n, one per summary).
  // isStatic: a chat that is not on the page, so a label instead of a button.
  function citeButton (cite, numbers = new Map(), isStatic = false) {
    const label = cite.label || cite
    const t = cite.t || label.slice(-5)
    const key = t + '|' + label
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1)
    const sup = document.createElement('sup')
    sup.className = 'cites'
    const button = document.createElement(isStatic ? 'span' : 'button')
    if (isStatic) button.className = 'cite cite--static'
    else {
      button.type = 'button'
      button.className = 'cite'
      button.dataset.t = t
    }
    button.dataset.label = label
    button.textContent = numbers.get(key)
    sup.appendChild(button)
    return sup
  }

  // Draws a summary at once
  function render (box, blocks) {
    box.textContent = ''
    const numbers = new Map()
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
        for (const piece of footed(block.li)) li.append(piece.cite ? citeButton(piece.cite, numbers) : piece.text)
        list.appendChild(li)
      }
    }
  }

  // Types text into target, before the caret, a few characters at a time; false once stopped
  async function typeInto (target, caret, text, isStopped, ms) {
    const node = document.createTextNode('')
    target.insertBefore(node, caret)
    for (let i = 0; i < text.length; i += 3) {
      if (isStopped()) return false
      node.data = text.slice(0, i + 3)
      await wait(ms)
    }
    return true
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
    const numbers = new Map()
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
      target.appendChild(caret)
      for (const piece of block.h ? [{ text: block.h }] : footed(block.li)) {
        if (isStopped()) return
        if (piece.cite) target.insertBefore(citeButton(piece.cite, numbers), caret)
        else if (!await typeInto(target, caret, piece.text, isStopped, 18)) return
      }
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

  // Hovering a footnote shows the message it cites, as Zenlo does: "20/10 18:02 · Trang: …"
  const tip = document.createElement('div')
  tip.className = 'cite-tip'
  tip.hidden = true
  document.body.appendChild(tip)
  function citedLine (cite) {
    // A footnote outside the demo (the questions) names its chat with data-to
    const win = cite.closest('.zw') || (cite.dataset.to && document.getElementById(cite.dataset.to))
    const msg = win && cite.dataset.t && win.querySelector(`.msg[data-t="${cite.dataset.t}"]`)
    if (!msg) return cite.dataset.label
    const name = msg.querySelector('b')
    // The name is the text of <b> without its time; the user's own messages read "Tôi", as in Zenlo
    const who = name ? [...name.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim() || (msg.classList.contains('msg--me') ? 'Tôi' : '') : ''
    const text = [...msg.childNodes].filter((node) => node !== name).map((node) => node.textContent).join('').trim()
    return `${cite.dataset.label} · ${who ? who + ': ' : ''}${text}`
  }
  function showTip (event) {
    const cite = event.target.closest && event.target.closest('.cite')
    if (!cite) return
    tip.textContent = citedLine(cite)
    tip.hidden = false
    const rect = cite.getBoundingClientRect()
    const width = Math.min(300, window.innerWidth - 16)
    tip.style.width = `${width}px`
    tip.style.left = `${Math.max(8, Math.min(rect.left - 12, window.innerWidth - width - 8))}px`
    tip.style.top = `${rect.bottom + 6}px`
  }
  function hideTip (event) {
    if (event.target.closest && event.target.closest('.cite')) tip.hidden = true
  }
  document.addEventListener('mouseover', showTip)
  document.addEventListener('focusin', showTip)
  document.addEventListener('mouseout', hideTip)
  document.addEventListener('focusout', hideTip)
  window.addEventListener('scroll', () => { tip.hidden = true }, { passive: true })

  // ---------- The message box: what is typed stays in the page ----------

  const REPLIES = {
    'demo-play': [
      ['Chị Hoa', '@Minh slide đâu em'],
      ['Quang', 'file ảnh gốc nữa Minh ơi'],
      ['Tuấn', 'ủa Minh giờ mới đọc tin à'],
      ['Linh', 'đọc hết 35 tin chưa đó'],
      ['Phương', '😆']
    ]
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
      const isTeam = win.id === 'demo-play'
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
  function teamSummary (base = TEAM.medium) {
    if (!talk.last) return base
    const { text, cite } = talk.last
    const quoted = text.length > 60 ? `${text.slice(0, 60)}…` : text
    const said = talk.sent > 1 ? `Bạn nhắn ${talk.sent} tin, mới nhất là “${quoted}”` : `Bạn nhắn “${quoted}”`
    const line = talk.reply
      ? { li: [`${said} `, cite, ', chị Hoa hỏi lại về slide ', talk.reply, '.'] }
      : { li: [`${said} `, cite, '.'] }
    // Under "Liên quan tới bạn", before "Còn lại"
    const blocks = base.slice()
    blocks.splice(blocks.findIndex((block, i) => i > 0 && block.h), 0, line)
    return blocks
  }

  // ---------- Digest ----------

  // One sentence per point, as the digest prompt asks
  const DIGEST = {
    team: { text: 'Gửi chị Hoa slide trước 9h mai [19/10 08:30]. Gửi Quang ảnh gốc tối nay [19/10 17:45]. Cả nhóm nộp báo cáo trước 12h trưa mai [19/10 17:30].', live: true, count: 35 },
    ph: { text: 'Họp phụ huynh 19h thứ 5 [19/10 20:05]. Nộp quỹ lớp 200k trước thứ 6 [19/10 20:12].', count: 37 },
    run: { text: 'Chạy sáng chủ nhật 5h30 ở biển Mỹ Khê [19/10 20:15]. Đăng ký giải 10K trước thứ 6 [19/10 20:21].', count: 52 },
    nha: { text: 'Giỗ ông trưa chủ nhật, 9h cả nhà về quê [19/10 16:40].', count: 4 },
    cc: { text: 'Cúp nước 8h–12h sáng thứ 4 để sửa đường ống [19/10 09:12].', count: 23 },
    shop: { text: 'Đơn hàng đang giao, kèm mã giảm 10% [19/10 10:12].', count: 6 }
  }

  // In the box digest, inside the Zalo window; onMake: "Tạo bản tin" was pressed. Returns how to
  // make it and how to empty it again.
  function setupDigest (digest, { onMake = () => {} } = {}) {
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
      const caret = document.createElement('span')
      caret.className = 'caret'
      box.append(caret)
      const stopped = () => mine !== round || !card.querySelector('.dcard__check').checked
      const numbers = new Map()
      for (const piece of footed(item.text)) {
        if (stopped()) return
        if (!piece.cite) {
          if (!await typeInto(box, caret, piece.text, stopped, 16)) return
        } else {
          // Only the Team Marketing chat is on the page: its citations scroll it; the others are labels
          box.insertBefore(citeButton(piece.cite, numbers, !item.live), caret)
        }
      }
      caret.remove()
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
          // "Tạo bản tin" pressed again meanwhile: this card belongs to the new round now
          if (mine !== round) return
          await fill(card, mine)
        }
      }
      await Promise.all([worker(), worker()])
    }

    run.addEventListener('click', () => {
      onMake()
      make()
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
    return {
      make,
      // Back to empty cards, as before the first "Tạo bản tin"
      reset () {
        round++
        cards.querySelectorAll('.dcard__sum').forEach((box) => { box.textContent = '' })
      }
    }
  }

  // ---------- The AI to use ----------

  const AI = {
    gemini: {
      field: ['API key Gemini', 'AIza…k3Qf'],
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

  // The three AIs Zenlo can use, switched in a ".js-ai" group inside root
  function setupAI (root) {
    const pick = (group, button) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    const ai = root.querySelector('.js-ai')
    const field = root.querySelector('.js-ai-field')
    const log = root.querySelector('.js-ai-log')
    const note = root.querySelector('.js-ai-note')
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

  // One big message, its quick bar, and every reaction going by in two rows (each row holds its list
  // twice, so the loop has no seam). The rows are not for pressing: "+" turns on a claw machine over
  // them, the one way to take a stamp off a belt and throw it onto the message, order after order.
  // With a keyboard, or reduced motion, "+" opens Zenlo's panel instead. The quick bar and the panel
  // throw at once. The corner shows the three most used and the total, as Zalo does.
  function setupReact () {
    const box = document.getElementById('demo-react')
    if (!box) return
    const band = box.closest('.rx-show') || box
    const bubble = box.querySelector('.js-react-msg')
    const chips = box.querySelector('.js-chips')
    const plus = box.querySelector('.js-plus')
    const hint = box.querySelector('.js-hint')
    const pick = box.querySelector('.js-pick')
    const river = band.querySelector('.js-river')
    const counts = new Map()
    const recent = []

    // The river is decoration (every reaction is also in the panel), so its buttons take no focus
    const button = (e, quiet) => quiet
      ? `<button type="button" data-e="${e}" tabindex="-1">${e}</button>`
      : `<button type="button" data-e="${e}" aria-label="Thả ${e}">${e}</button>`
    box.querySelector('.js-quick').innerHTML = QUICK.map((e) => button(e)).join('')
    if (river) {
      const rows = river.querySelectorAll('.js-row')
      const half = Math.ceil(ALL.length / 2)
      ;[ALL.slice(0, half), ALL.slice(half)].forEach((list, i) => {
        if (rows[i]) rows[i].innerHTML = list.concat(list).map((e) => button(e, true)).join('')
      })
      setupBelts(river)
    }
    if (pick) {
      pick.querySelector('.js-all').innerHTML = ALL.map((e) => button(e)).join('')
      pick.querySelector('.js-pick-count').textContent = String(ALL.length)
    }

    function draw () {
      const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e).join('')
      chips.textContent = total ? `${top} ${total}` : ''
      chips.classList.remove('rx-pop')
      chips.getBoundingClientRect() // restart the pop
      chips.classList.add('rx-pop')
    }
    const land = (e) => {
      counts.set(e, (counts.get(e) || 0) + 1)
      draw()
    }

    // From where it was clicked, up in an arc, down onto the corner of the message; then done()
    function fly (from, e, done = () => {}) {
      if (still || !from.animate) {
        land(e)
        return done()
      }
      const a = from.getBoundingClientRect()
      const onChips = !!chips.textContent
      const b = (onChips ? chips : bubble).getBoundingClientRect()
      const x0 = a.left + a.width / 2
      const y0 = a.top + a.height / 2
      const dx = (onChips ? b.left + b.width / 2 : b.right - 36) - x0
      const dy = (onChips ? b.top + b.height / 2 : b.bottom) - y0
      const ghost = document.createElement('span')
      ghost.className = 'rx-ghost'
      ghost.textContent = e
      ghost.style.left = `${x0}px`
      ghost.style.top = `${y0}px`
      document.body.appendChild(ghost)
      ghost.animate([
        { transform: 'translate(-50%, -50%) scale(1)' },
        { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 110}px)) scale(1.5) rotate(-12deg)`, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.55)`, opacity: 0.6 }
      ], { duration: 720, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' }).onfinish = () => {
        ghost.remove()
        land(e)
        done()
      }
    }

    // "Gần đây" in the panel: the last reactions dropped, newest first, as in Zenlo
    function remember (e) {
      if (!pick) return
      const at = recent.indexOf(e)
      if (at >= 0) recent.splice(at, 1)
      recent.unshift(e)
      recent.length = Math.min(recent.length, 8)
      pick.querySelector('.js-recent').innerHTML = recent.map((r) => button(r)).join('')
      pick.querySelector('.js-recent-part').hidden = false
    }

    // The panel opens under the bar, out of the message's way, and closes on a pick, a click
    // elsewhere or Esc
    function setOpen (open, refocus) {
      if (!pick || open === !pick.hidden) return
      pick.hidden = !open
      plus.setAttribute('aria-expanded', String(open))
      band.classList.toggle('rx-show--picking', open)
      if (open) {
        pick.querySelector('.js-all').scrollTop = 0
        const first = pick.querySelector('button[data-e]')
        if (first) first.focus({ preventScroll: true })
        const r = pick.getBoundingClientRect()
        if (r.bottom > window.innerHeight) window.scrollBy({ top: r.bottom - window.innerHeight + 16, behavior: still ? 'auto' : 'smooth' })
      } else if (refocus) {
        plus.focus()
      }
    }

    const machine = setupClaw(band, { fly, remember, bubble })

    band.addEventListener('click', (event) => {
      // With the machine on, a click on the belts sends the claw there instead
      if (machine && machine.isOn() && machine.floor.contains(event.target)) return machine.dropAt(event.clientX, event.clientY, event.target.closest('button[data-e]'))
      const pressed = event.target.closest('button[data-e]')
      // The belts give their stamps to the claw only
      if (!pressed || (river && river.contains(pressed))) return
      if (hint) hint.hidden = true
      fly(pressed, pressed.dataset.e)
      remember(pressed.dataset.e)
      if (pick && pick.contains(pressed)) setOpen(false, true)
    })

    // A mouse or a finger turns the machine on and off; a keyboard (no pointer: detail 0) opens the panel
    plus.addEventListener('click', (event) => {
      if (hint) hint.hidden = true
      if (machine && machine.isOn()) return machine.set(false)
      if (machine && event.detail > 0) {
        setOpen(false)
        return machine.set(true)
      }
      setOpen(!!pick && pick.hidden)
    })
    document.addEventListener('click', (event) => {
      if (pick && !pick.hidden && !pick.contains(event.target) && !plus.contains(event.target)) setOpen(false)
    })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (pick && !pick.hidden) setOpen(false, true)
      if (machine && machine.isOn()) machine.set(false)
    })
  }

  // The two rows of stamps run by the page's clock, moved a step each frame: the front row left in
  // 70 s, the back row right in 80 s, half a row (one list) per loop, as the CSS animation they
  // replace. On an iPhone (Safari, and the browsers inside Zalo and Messenger) a row that long moved
  // by a CSS animation could go blank after a while of scrolling: Safari stopped painting the part
  // of the big moving layer that came into view. Moved from here, it is painted where it is each
  // frame. The rows rest while off screen and go on from where they were.
  function setupBelts (river) {
    const rows = [...river.querySelectorAll('.js-row')]
    if (still || !rows.length || !window.requestAnimationFrame) return
    river.classList.add('rx-river--js')
    const LOOP = [[70, -1], [80, 1]] // seconds per loop, direction
    let ran = 0 // seconds the rows have run
    let last = 0
    let frame = 0
    let shown = true
    function step (time) {
      ran += Math.min(0.1, (time - (last || time)) / 1000)
      last = time
      rows.forEach((row, i) => {
        const [seconds, direction] = LOOP[i] || LOOP[0]
        const f = (ran / seconds) % 1
        const half = row.offsetWidth / 2
        row.style.transform = `translateX(${(direction < 0 ? -f : f - 1) * half}px)`
      })
      if (shown) {
        frame = requestAnimationFrame(step)
      } else {
        frame = 0
        last = 0
      }
    }
    frame = requestAnimationFrame(step)
    if ('IntersectionObserver' in window) {
      new window.IntersectionObserver((entries) => {
        shown = entries.some((entry) => entry.isIntersecting)
        if (shown && !frame) frame = requestAnimationFrame(step)
      }).observe(river)
    }
  }

  // The claw machine over the belts. The claw runs on the rail after the mouse (or goes where a finger
  // taps); a click lowers it to that row, following the stamp clicked, so it shuts on that stamp and
  // not the next one; it lifts it and throws it onto the message, which gets a postmark, and the belt
  // pushes a new stamp up into the gap. The ticket asks for a stamp that will stay on screen a while
  // (and for another if it runs off all the same); three tickets make an order, and the next order
  // comes, without end. Not with reduced motion: the rows stand still.
  function setupClaw (band, { fly, remember, bubble }) {
    const floor = band.querySelector('.js-floor')
    const claw = floor && floor.querySelector('.js-claw')
    if (!claw || still) return null
    const rope = claw.querySelector('.js-rope')
    const ticket = floor.querySelector('.js-rx-ticket')
    const river = floor.querySelector('.js-river')
    const rows = [...river.querySelectorAll('.js-row')]
    const plus = band.querySelector('.js-plus')
    const REST = 4
    let on = false
    let busy = false
    let x = 0
    let toX = 0
    let ropeH = REST
    let toH = REST
    let frame = 0
    let last = 0
    let order = 1 // counted for as long as the page is open
    let round = 0 // tickets of this order delivered
    let want = ''
    let swapping = false // from the stamp wanted landing to the next ticket
    let take = 0 // bumped each time the machine is turned on or off, to drop a swap under way
    let watch = 0 // the check, once a second, that the stamp wanted is still on screen
    let follow = null // the stamp clicked, which the claw keeps above until it shuts
    const centre = (b) => {
      const r = b.getBoundingClientRect()
      return r.left + r.width / 2 - left()
    }

    const left = () => floor.getBoundingClientRect().left
    // A claw following a stamp trails it by a few pixels: close enough
    const near = () => Math.abs(x - toX) < (follow ? 10 : 2) && Math.abs(ropeH - toH) < 2
    // Resolves true once the claw has got where it was sent, false if the machine was turned off
    const arrive = () => new Promise((resolve) => {
      const check = () => !on ? resolve(false) : near() ? resolve(true) : requestAnimationFrame(check)
      check()
    })
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    function tick (time) {
      // By the clock, not by frames: a slow or busy page gets there just as fast, in bigger steps
      const dt = Math.min(1000, time - (last || time)) / 1000
      last = time
      if (follow) toX = centre(follow)
      x += (toX - x) * Math.min(1, dt * 8)
      ropeH += (toH - ropeH) * Math.min(1, dt * 9)
      claw.style.transform = `translateX(${x - 15}px)`
      rope.style.height = `${ropeH}px`
      if (on || busy || !near()) {
        frame = requestAnimationFrame(tick)
      } else {
        frame = 0
        last = 0
      }
    }
    const run = () => { if (!frame) frame = requestAnimationFrame(tick) }

    // The stamp of a row under the claw, by the screen's x
    function under (row, cx) {
      return [...row.children].find((b) => {
        const r = b.getBoundingClientRect()
        return b.style.visibility !== 'hidden' && cx >= r.left + 3 && cx <= r.right - 3
      })
    }
    // The gap a stamp leaves stays open while the claw goes up, then a new stamp comes up into it
    function refill (b) {
      b.style.visibility = 'hidden'
      setTimeout(() => {
        b.style.visibility = ''
        b.classList.remove('is-new')
        b.getBoundingClientRect() // restart the animation
        b.classList.add('is-new')
      }, 600)
    }
    // How far the rope must go for the claw to close on the middle of a row (22: the claw's height)
    function depth (row) {
      const r = row.getBoundingClientRect()
      const top = rope.getBoundingClientRect().top
      return Math.max(REST, r.top + r.height * 0.5 - top - 22)
    }

    // A stamp in view now that will stay a good while: in the front row (running left) on the right
    // half of the screen, in the back row (running right) on the left half
    function newWant () {
      const w = window.innerWidth
      const soon = []
      rows.forEach((row, i) => {
        for (const b of row.children) {
          const r = b.getBoundingClientRect()
          const coming = i === 0 ? r.left > w * 0.45 && r.right < w * 0.92 : r.left > w * 0.08 && r.right < w * 0.55
          if (coming && b.dataset.e !== want) soon.push(b.dataset.e)
        }
      })
      want = soon.length ? soon[Math.floor(Math.random() * soon.length)] : rows[0].children[0].dataset.e
    }
    // "đã nhận", pressed on the message and left to fade
    function received () {
      const m = document.createElement('span')
      m.className = 'rx-mark'
      m.setAttribute('aria-hidden', 'true')
      m.textContent = 'đã nhận'
      bubble.appendChild(m)
      setTimeout(() => m.remove(), 1700)
    }
    function drawTicket () {
      ticket.textContent = ''
      const no = document.createElement('span')
      no.className = 'rx-ticket__no'
      no.textContent = `Đơn #${order} · ${round + 1}/3`
      const stamp = document.createElement('span')
      stamp.className = 'rx-ticket__stamp'
      stamp.textContent = want
      ticket.append(no, 'Thả ', stamp, ' lên tin của Huy')
    }

    function set (value) {
      if (value === on) return
      on = value
      take++
      swapping = false
      band.classList.toggle('rx-show--machine', on)
      plus.setAttribute('aria-expanded', String(on))
      if (on) {
        // It comes in from the right, a little above the belts
        x = floor.clientWidth + 30
        toX = floor.clientWidth * 0.7
        ropeH = toH = REST
        // Turned off just after the third ticket of an order: on with the next order
        if (round >= 3) {
          order++
          round = 0
        }
        newWant()
        drawTicket()
        watch = setInterval(() => { if (!busy && !swapping && gone()) swap() }, 1000)
      } else {
        clearInterval(watch)
        toH = REST
        ticket.textContent = ''
        claw.classList.remove('is-shut')
        const load = claw.querySelector('.rx-claw__load')
        if (load) load.remove()
      }
      run()
    }

    async function dropAt (clientX, clientY, clicked) {
      if (!on || busy) return
      busy = true
      run()
      try {
        follow = clicked || null
        toX = follow ? centre(follow) : Math.max(16, Math.min(floor.clientWidth - 16, clientX - left()))
        claw.classList.remove('is-shut')
        if (!await arrive()) return
        // Down to the row of the stamp clicked; between stamps, the row nearest the click
        const nearest = () => rows.reduce((best, r) => {
          const b = r.getBoundingClientRect()
          const d = Math.abs(clientY - (b.top + b.height / 2))
          return !best || d < best.d ? { r, d } : best
        }, null).r
        const row = follow ? follow.closest('.js-row') : nearest()
        toH = depth(row)
        if (!await arrive()) return
        const got = follow || under(row, left() + x)
        follow = null
        claw.classList.add('is-shut')
        let load = null
        if (got) {
          refill(got)
          load = document.createElement('span')
          load.className = 'rx-claw__load'
          load.textContent = got.dataset.e
          claw.appendChild(load)
        }
        await pause(160)
        toH = REST
        if (!await arrive()) return
        if (load) {
          const e = load.textContent
          fly(load, e, () => delivered(e))
          remember(e)
          load.remove()
        }
        claw.classList.remove('is-shut')
      } finally {
        follow = null
        busy = false
        run()
      }
    }

    // Every copy of the stamp wanted has run off the screen (the next would be half a minute coming)
    function gone () {
      const w = window.innerWidth
      return !rows.some((row) => [...row.children].some((b) => {
        if (b.dataset.e !== want) return false
        const r = b.getBoundingClientRect()
        return r.left > w * 0.04 && r.right < w * 0.96
      }))
    }

    // The ticket goes up off the rail and a new one comes in from the right: the next ticket of the
    // order, the next order after the third, or the same ticket asking for another stamp. Timed by
    // the clock, so a slow page cannot leave it half done.
    function swap (wait = 0) {
      swapping = true
      const now = take
      setTimeout(() => {
        if (now !== take) return
        const out = ticket.animate([
          { opacity: 1 },
          { opacity: 0, transform: 'translateY(-12px) rotate(-4deg)' }
        ], { duration: 220, easing: 'ease-in', fill: 'forwards' })
        setTimeout(() => {
          out.cancel()
          if (now !== take) return
          if (round >= 3) {
            order++
            round = 0
          }
          newWant()
          drawTicket()
          swapping = false
          ticket.animate([
            { opacity: 0, transform: 'translateX(28px)' },
            { opacity: 1, transform: 'none' }
          ], { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' })
        }, 220)
      }, wait)
    }

    // Every stamp thrown gets "đã nhận"; the one wanted brings the next ticket
    function delivered (e) {
      received()
      if (!on || swapping || e !== want) return
      round++
      swap(500)
    }

    floor.addEventListener('pointermove', (event) => {
      if (on && !busy && event.pointerType === 'mouse') {
        toX = Math.max(16, Math.min(floor.clientWidth - 16, event.clientX - left()))
        run()
      }
    })

    return { floor, set, dropAt, isOn: () => on }
  }

  // ---------- Try it: one window that plays once by itself, then the visitor's turn ----------

  // Zalo's window with Zenlo docked on the right, as in the app: the button on the title bar opens
  // "Tóm tắt", the one in the left bar "Bản tin". When it comes into view, a pretend pointer opens
  // Zenlo, summarizes and presses a source, then hands over. The visitor's first click or key
  // stops it at once. From then on the ticket above the window counts five things to try, stamps
  // each one done, and a pulse sits on what to press next.
  const PLAY_ORDER = ['open', 'sum', 'cite', 'note', 'digest']
  const PLAY_LOG = {
    gemini: ['generativelanguage.googleapis.com', 'bằng key Gemini của bạn · gemini-3.6-flash · 6 giây'],
    claude: ['Claude Code trên máy bạn → api.anthropic.com', 'bằng gói Claude của bạn'],
    codex: ['Codex trên máy bạn → máy chủ OpenAI', 'bằng gói ChatGPT của bạn']
  }
  const PLAY_NOTES = { none: 'Chưa có ghi chú cho AI.', deadline: 'Ghi chú cho AI: Chỉ cần hạn chót', client: 'Ghi chú cho AI: Mình theo dõi khách ABC' }

  function setupPlay () {
    const win = document.getElementById('demo-play')
    if (!win) return
    const section = win.closest('.play') || win.parentElement
    const ticket = section.querySelector('.js-ticket')
    const line = ticket.querySelector('.js-ticket-line')
    const stamps = [...ticket.querySelectorAll('[data-step]')]
    const msgs = win.querySelector('.js-msgs')
    const zp = win.querySelector('.play__zp')
    const openBtn = win.querySelector('.js-p-open')
    const railBtn = win.querySelector('.js-p-digest')
    const closeBtn = win.querySelector('.js-p-close')
    const tabs = [...win.querySelectorAll('.play__tabs [data-tab]')]
    const tabBtn = (name) => tabs.find((t) => t.dataset.tab === name)
    const panes = [...win.querySelectorAll('.play__pane')]
    const run = win.querySelector('.js-p-run')
    const hint = win.querySelector('.js-p-hint')
    const out = win.querySelector('.js-p-out')
    const netlog = win.querySelector('.js-p-netlog')
    const lengths = win.querySelector('.js-p-length')
    const noteLine = win.querySelector('.js-p-note-line')
    const notes = win.querySelector('.js-p-notes')
    const digestPane = win.querySelector('.js-p-digest-pane')
    const digestRun = digestPane.querySelector('.js-run')
    const cursor = win.querySelector('.play__cursor')
    const phone = window.matchMedia('(max-width: 900px)')

    let tab = 'sum'
    let length = 'medium'
    let note = 'none'
    let ai = 'gemini'
    let summed = false // a finished summary is on show
    let busy = false
    let sumRound = 0
    let mode = 'idle' // idle, then auto (plays by itself), then yours
    let take = 0 // bumped to stop the run by itself
    const done = new Set()

    const isOpen = () => win.classList.contains('is-open')
    const press = (group, value, key) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === value)))

    // ----- Zenlo opens, closes and changes tab -----
    function show (name) {
      tab = name
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)))
      panes.forEach((p) => { p.hidden = p.dataset.pane !== name })
      railBtn.setAttribute('aria-pressed', String(isOpen() && name === 'digest'))
    }
    function setOpen (open, name) {
      win.classList.toggle('is-open', open)
      zp.inert = !open
      openBtn.setAttribute('aria-expanded', String(open))
      if (name) show(name)
      railBtn.setAttribute('aria-pressed', String(open && tab === 'digest'))
      if (open) mark('open')
      else update()
    }
    // The same button again closes it, as in the app
    openBtn.addEventListener('click', () => setOpen(!(isOpen() && tab === 'sum'), 'sum'))
    railBtn.addEventListener('click', () => setOpen(!(isOpen() && tab === 'digest'), 'digest'))
    closeBtn.addEventListener('click', () => {
      setOpen(false)
      openBtn.focus({ preventScroll: true })
    })
    tabs.forEach((t) => t.addEventListener('click', () => {
      show(t.dataset.tab)
      update()
    }))
    win.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return
      setOpen(false)
      openBtn.focus({ preventScroll: true })
    })

    // ----- Tóm tắt -----
    const blocks = () => note !== 'none' ? NOTED[note] : teamSummary(TEAM[length])

    function drawLog () {
      const [where, how] = PLAY_LOG[ai]
      netlog.textContent = ''
      const n = document.createElement('span')
      n.textContent = 35 + talk.added
      const b = document.createElement('b')
      b.textContent = where
      netlog.append('→ gửi ', n, ' tin tới ', b, document.createElement('br'), `\u00a0\u00a0${how}`)
    }

    async function summarize () {
      if (busy) return
      const mine = ++sumRound
      busy = true
      summed = false
      run.disabled = true
      const total = 35 + talk.added
      netlog.classList.remove('show')
      hint.textContent = `Đang đọc ${total} tin…`
      out.textContent = ''
      update()
      await wait(450)
      if (mine !== sumRound) return
      hint.textContent = `Đang tóm tắt ${total} tin…`
      out.innerHTML = letter()
      await wait(1600)
      if (mine !== sumRound) return
      hint.textContent = ''
      out.textContent = ''
      await stream(out, blocks(), () => mine !== sumRound)
      if (mine !== sumRound) return
      drawLog()
      netlog.classList.add('show')
      summed = true
      busy = false
      run.disabled = false
      mark('sum')
    }
    run.addEventListener('click', summarize)

    // A summary on show is drawn again at once with the new length or note
    const redraw = () => { if (summed && !busy) render(out, blocks()) }
    lengths.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-len]')
      if (!button) return
      length = button.dataset.len
      press(lengths, length, 'len')
      redraw()
    })

    // "Ghi chú cho AI" under the conversation's name, as in the app; here, two sample notes
    function drawNote () {
      noteLine.textContent = ''
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'play__inline'
      edit.textContent = note === 'none' ? 'Thêm ghi chú' : 'Sửa'
      edit.setAttribute('aria-expanded', String(!notes.hidden))
      edit.addEventListener('click', () => {
        notes.hidden = !notes.hidden
        drawNote()
        update()
      })
      noteLine.append(PLAY_NOTES[note], ' ', edit)
    }
    notes.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-note]')
      if (!button) return
      note = button.dataset.note
      press(notes, note, 'note')
      notes.hidden = true
      drawNote()
      redraw()
      if (note !== 'none') mark('note')
      else update()
    })
    drawNote()

    // A source pressed: the chat goes to the message (the .zw handler); on a phone Zenlo steps
    // out of the way so the message shows
    win.addEventListener('click', (event) => {
      if (!event.target.closest('.cite')) return
      if (phone.matches && isOpen()) setOpen(false)
      mark('cite')
    })

    // ----- Bản tin and Cài đặt -----
    const digest = setupDigest(digestPane, { onMake: () => mark('digest') })
    const settings = win.querySelector('.js-p-set')
    setupAI(settings)
    settings.querySelector('.js-ai').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-ai]')
      if (!button) return
      ai = button.dataset.ai
      if (netlog.classList.contains('show')) drawLog()
    })

    // ----- The ticket and the pulse -----
    // Where the next step is pressed, and what the line says
    function where (step) {
      const toSum = () => !isOpen()
        ? { el: openBtn, say: 'Bấm nút <b>Zenlo</b> ở góc trên khung chat.' }
        : tab !== 'sum' ? { el: tabBtn('sum'), say: 'Mở thẻ <b>Tóm tắt</b> của Zenlo.' } : null
      if (step === 'open') return { el: openBtn, say: 'Bấm nút <b>Zenlo</b> ở góc trên khung chat để mở Zenlo.' }
      if (step === 'sum') return toSum() || (busy ? { el: null, say: 'Zenlo đang đọc 35 tin…' } : { el: run, say: 'Bấm <b>Tóm tắt</b>: Zenlo đọc hết 35 tin cho bạn.' })
      if (step === 'cite') {
        const cite = !busy && out.querySelector('.cite')
        if (cite) return { el: cite, say: 'Bấm một <b>số nguồn</b> nhỏ cuối câu: khung chat cuộn tới đúng tin gốc.' }
        return toSum() || (busy ? { el: null, say: 'Đợi Zenlo viết xong…' } : { el: run, say: 'Bấm <b>Tóm tắt</b> trước, rồi bấm một số nguồn.' })
      }
      if (step === 'note') {
        const sum = toSum()
        if (sum) return sum
        return notes.hidden
          ? { el: noteLine.querySelector('button'), say: 'Bấm <b>Thêm ghi chú</b>: dặn AI để ý chuyện bạn cần.' }
          : { el: notes, say: 'Chọn một <b>ghi chú mẫu</b>: Zenlo tóm tắt lại theo đó.' }
      }
      // Bản tin
      if (!isOpen()) {
        return phone.matches
          ? { el: openBtn, say: 'Mở <b>Zenlo</b>, rồi sang thẻ Bản tin.' }
          : { el: railBtn, say: 'Bấm nút <b>Zenlo</b> trên thanh bên trái: nút này mở Bản tin.' }
      }
      if (tab !== 'digest') return { el: tabBtn('digest'), say: 'Mở thẻ <b>Bản tin</b>.' }
      return { el: digestRun, say: 'Bấm <b>Tạo bản tin</b>: mọi nhóm chưa đọc gom lại một trang.' }
    }

    let beacon = null
    function setBeacon (el) {
      if (beacon === el) return
      if (beacon) beacon.classList.remove('play-beacon')
      beacon = el || null
      if (beacon) beacon.classList.add('play-beacon')
    }
    function say (html) {
      if (line.innerHTML !== html) line.innerHTML = html
    }

    let next = null
    function update () {
      next = mode === 'yours' ? PLAY_ORDER.find((step) => !done.has(step)) : null
      ticket.dataset.mode = mode
      stamps.forEach((s) => {
        s.classList.toggle('is-done', mode === 'yours' && done.has(s.dataset.step))
        s.classList.toggle('is-next', s.dataset.step === next)
      })
      const spot = next ? where(next) : null
      setBeacon(spot && spot.el)
      if (mode === 'auto') say('Zenlo đang tự chạy thử một lượt. Bấm vào khung bất kỳ lúc nào để tự làm.')
      else if (mode === 'idle') say('Kéo tới khung bên dưới, Zenlo sẽ tự chạy thử một lượt.')
      else say(spot ? spot.say : 'Đủ năm dấu. Cài vào Zalo của bạn, Zenlo cũng chạy y như vậy: <a class="link" href="./#cai-dat">tải về</a>.')
    }
    function mark (step) {
      done.add(step)
      update()
    }
    phone.addEventListener('change', update)

    // ----- Back to the start -----
    function reset () {
      done.clear()
      sumRound++
      busy = false
      summed = false
      run.disabled = false
      out.textContent = ''
      hint.textContent = ''
      netlog.classList.remove('show')
      length = 'medium'
      press(lengths, length, 'len')
      note = 'none'
      press(notes, note, 'note')
      notes.hidden = true
      drawNote()
      digest.reset()
      msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'instant' })
      setOpen(false, 'sum')
    }

    // ----- The first run, by itself -----
    function pointAt (el, fx = 0.5, fy = 0.5) {
      const a = win.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      const x = b.left - a.left + b.width * fx
      const y = b.top - a.top + b.height * fy
      cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`
      return [x, y]
    }
    function tap ([x, y]) {
      cursor.classList.add('is-down')
      setTimeout(() => cursor.classList.remove('is-down'), 160)
      const ring = document.createElement('span')
      ring.className = 'play__tap'
      ring.style.left = `${x}px`
      ring.style.top = `${y}px`
      win.appendChild(ring)
      setTimeout(() => ring.remove(), 700)
    }
    // Waits, then says whether this run is still the one going
    const going = (mine, ms) => wait(ms).then(() => mine === take)

    async function autoplay () {
      const mine = ++take
      mode = 'auto'
      update()
      cursor.style.transition = 'none'
      pointAt(msgs, 0.55, 0.75)
      cursor.getBoundingClientRect()
      cursor.style.transition = ''
      cursor.classList.add('is-on')
      if (!await going(mine, 600)) return
      let at = pointAt(openBtn)
      if (!await going(mine, 900)) return
      tap(at)
      setOpen(true, 'sum')
      if (!await going(mine, 750)) return
      at = pointAt(run)
      if (!await going(mine, 900)) return
      tap(at)
      await summarize()
      if (mine !== take) return
      const cite = out.querySelector('.cite')
      if (cite) {
        at = pointAt(cite)
        if (!await going(mine, 900)) return
        tap(at)
        cite.click()
      }
      if (!await going(mine, 1800)) return
      cursor.classList.remove('is-on')
      say('Tới lượt bạn.')
      if (!await going(mine, 1000)) return
      reset()
      mode = 'yours'
      update()
    }
    function stopAuto () {
      take++
      cursor.classList.remove('is-on')
    }

    // The visitor's first click or key in the demo stops the run by itself where it is
    const takeOver = (event) => {
      if (mode === 'yours' || !event.isTrusted) return
      stopAuto()
      mode = 'yours'
      update()
    }
    section.addEventListener('click', takeOver, true)
    section.addEventListener('keydown', takeOver, true)

    // A footnote in the questions cites a message of this chat: the page goes up to it and it
    // lights up, as a footnote in Zenlo does. The run by itself would cover it, so it stops.
    document.addEventListener('click', (event) => {
      const cite = event.target.closest && event.target.closest('.cite[data-to="demo-play"]')
      if (!cite) return
      if (mode !== 'yours') {
        stopAuto()
        mode = 'yours'
        update()
      }
      // The message lights up once the page has arrived (a long way up can take over a second)
      let lit = false
      const light = () => {
        if (lit) return
        lit = true
        window.removeEventListener('scrollend', light)
        jump(win, cite.dataset.t)
      }
      const rect = win.getBoundingClientRect()
      if (still || (rect.top >= 0 && rect.bottom <= window.innerHeight)) {
        win.scrollIntoView({ block: 'center' })
        light()
        return
      }
      window.addEventListener('scrollend', light)
      setTimeout(light, 1800)
      win.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })

    ticket.querySelector('.js-again').addEventListener('click', () => {
      stopAuto()
      reset()
      if (still) {
        mode = 'yours'
        update()
      } else {
        autoplay()
      }
    })

    if (still || !('IntersectionObserver' in window)) {
      mode = 'yours'
      update()
      return
    }
    update()
    new window.IntersectionObserver((entries) => {
      if (mode === 'idle' && entries.some((entry) => entry.isIntersecting)) autoplay()
    }, { threshold: 0.85 }).observe(win)
  }

  // ---------- Highlighter marks ----------

  // A few words carry a violet highlighter stroke, drawn the first time they come into view
  function setupMarks () {
    const marks = [...document.querySelectorAll('.hl')]
    if (still || !marks.length || !('IntersectionObserver' in window)) return
    marks.forEach((mark) => mark.classList.add('hl--wait'))
    const seen = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.remove('hl--wait')
        seen.unobserve(entry.target)
      }
    }, { threshold: 1 })
    marks.forEach((mark) => seen.observe(mark))
  }

  // Each demo on its own: one that fails leaves the others working
  for (const setup of [setupComposers, setupReact, setupPlay, setupMarks]) {
    try {
      setup()
    } catch (error) {
      console.error('Zenlo demo:', error)
    }
  }
})()
