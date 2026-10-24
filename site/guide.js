/*
  Zenlo – website. The guide's table of contents: built from the page's sections, filtered by the
  search box (accents optional, so "tom tat" finds "Tóm tắt"), the current section highlighted while
  scrolling, and a drop-down in its place on small screens.
*/

(function () {
  const toc = document.querySelector('.js-toc')
  const search = document.querySelector('.js-toc-search')
  const empty = document.querySelector('.js-toc-empty')
  const mobile = document.querySelector('.js-toc-mobile')
  if (!toc) return

  const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

  // [{ section, link, children: [{ section, link }] }]
  const parts = []
  const links = new Map()

  function entry (section, className) {
    const heading = section.querySelector('h2, h3')
    const li = document.createElement('li')
    if (className) li.className = className
    const a = document.createElement('a')
    a.href = `#${section.id}`
    a.textContent = heading.textContent
    li.appendChild(a)
    links.set(section.id, a)
    return { section, li, a, text: plain(section.textContent) }
  }

  document.querySelectorAll('.doc section.part').forEach((section) => {
    const part = entry(section, 'group')
    const sub = section.querySelectorAll(':scope > section[id]')
    part.children = [...sub].map((child) => entry(child))
    if (part.children.length) {
      const ol = document.createElement('ol')
      part.children.forEach((child) => ol.appendChild(child.li))
      part.li.appendChild(ol)
    }
    toc.appendChild(part.li)
    parts.push(part)

    const option = document.createElement('option')
    option.value = section.id
    option.textContent = part.a.textContent
    mobile.appendChild(option)
    part.children.forEach((child) => {
      const o = document.createElement('option')
      o.value = child.section.id
      o.textContent = `\u00a0\u00a0\u00a0${child.a.textContent}`
      mobile.appendChild(o)
    })
  })

  mobile.addEventListener('change', () => {
    const target = document.getElementById(mobile.value)
    if (target) target.scrollIntoView()
    window.history.replaceState(null, '', `#${mobile.value}`)
  })

  // ---------- Search ----------

  search.addEventListener('input', () => {
    const words = plain(search.value).split(/\s+/).filter(Boolean)
    const matches = (item) => words.every((word) => item.text.includes(word))
    let shown = 0
    for (const part of parts) {
      let any = false
      for (const child of part.children) {
        const hit = !words.length || matches(child)
        child.li.hidden = !hit
        if (hit) any = true
      }
      // A part shows when its own text matches (headings and intro included) or a child does
      const hit = !words.length || any || matches(part)
      part.li.hidden = !hit
      if (hit) shown++
    }
    empty.hidden = shown > 0
  })

  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const first = toc.querySelector('li:not([hidden]) li:not([hidden]) > a') || toc.querySelector('li:not([hidden]) > a')
    if (first) first.click()
  })

  // ---------- Current section ----------

  if ('IntersectionObserver' in window) {
    const visible = new Set()
    const sections = [...links.keys()].map((id) => document.getElementById(id))
    const mark = () => {
      // The last section whose top has passed the top part of the screen
      const current = sections.filter((s) => visible.has(s.id)).pop() ||
        sections.filter((s) => s.getBoundingClientRect().top < 120).pop()
      links.forEach((a, id) => a.classList.toggle('on', current && id === current.id))
      if (current) mobile.value = current.id
    }
    const spy = new window.IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)))
      mark()
    }, { rootMargin: '-80px 0px -70% 0px' })
    sections.forEach((s) => spy.observe(s))
  }
})()
