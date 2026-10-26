/*
  Zenlo – trình quản lí hội thoại Zalo

  Settings ("Cài đặt Zenlo", the gear tab of the Zenlo drawer, renderer): choose the AI (Claude Code on
  a Claude Pro/Max plan, Codex on a ChatGPT plan, or Gemini with the user's own API key), default summary lengths, how far
  back unread messages are read, and to clear saved summaries.
*/

(function () {
  const Z = window.ZenloCore
  const { STORAGE_KEYS, MODELS, EFFORTS, CODEX_MODELS, CODEX_EFFORTS, GEMINI_AUTO, GEMINI_EFFORTS, GEMINI_TIMEOUTS, GEMINI_RETRIES, LOOKBACK_DAYS, LENGTHS, escapeHTML } = Z

  const EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'

  const options = (list, selected) => list
    .map((item) => {
      const value = typeof item === 'string' ? item : item.value
      const label = typeof item === 'string' ? item : item.label
      return `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(label)}</option>`
    })
    .join('')

  let overlay = null

  function setTestStatus (text, isError = false) {
    const el = overlay.querySelector('.js-settings-test-status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  // Shows only the chosen provider's options
  function renderProvider () {
    const provider = Z.getAISettings().provider
    overlay.querySelectorAll('[name="zenlo-provider"]').forEach((radio) => {
      radio.checked = radio.value === provider
    })
    overlay.querySelector('.js-settings-claude').hidden = provider !== 'claude'
    overlay.querySelector('.js-settings-codex').hidden = provider !== 'codex'
    overlay.querySelector('.js-settings-gemini').hidden = provider !== 'gemini'
  }

  // What the main process knows: whether Claude Code and Codex are installed (and Codex logged
  // in), the saved Gemini keys
  async function loadMainSettings () {
    const status = overlay.querySelector('.js-settings-claude-status')
    const codexStatus = overlay.querySelector('.js-settings-codex-status')
    if (!window.$zenlo || !window.$zenlo.getSettings) {
      status.textContent = 'Chưa có cầu nối của Zenlo. Hãy cài lại Zenlo rồi mở lại Zalo.'
      return
    }
    try {
      const settings = await window.$zenlo.getSettings()
      status.textContent = settings.claudePath
        ? '✓ Đã tìm thấy Claude Code trên máy.'
        : '✗ Chưa tìm thấy Claude Code. Hãy cài Claude Code và đăng nhập bằng tài khoản Claude.'
      status.classList.toggle('zenlo__status--error', !settings.claudePath)
      const codex = settings.codex || {}
      codexStatus.textContent = !codex.path
        ? '✗ Chưa tìm thấy Codex. Hãy cài Codex rồi chạy "codex login" để đăng nhập bằng tài khoản ChatGPT.'
        : codex.loggedIn === false
          ? '✗ Đã có Codex nhưng chưa đăng nhập ChatGPT. Mở Terminal, chạy "codex login".'
          : codex.loggedIn === true
            ? `✓ Đã tìm thấy Codex${codex.account ? `, ${codex.account}` : ''}.`
            : '✓ Đã tìm thấy Codex trên máy.'
      codexStatus.classList.toggle('zenlo__status--error', !codex.path || codex.loggedIn === false)
      maxKeys = settings.maxKeys || 5
      renderKeys(settings.geminiKeys || [])
    } catch (error) {
      status.textContent = `Lỗi: ${error.message || error}`
    }
  }

  // ---------- Gemini keys ----------

  let maxKeys = 5
  let keyStatus = []

  const maskKey = (key) => key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••'
  const clock = (ms) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  // One row per key: hidden like a password, 👁 to show, ✕ to remove, and which models it ran out of
  function renderKeys (keys) {
    const list = overlay.querySelector('.js-settings-keys')
    const rows = keys.length ? keys : ['']
    list.innerHTML = rows.map((key) => `
      <div class="zenlo-settings__key">
        <span class="zenlo__field">
          <input type="password" class="js-settings-key" value="${escapeHTML(key)}" placeholder="Dán API key vào đây" spellcheck="false" autocomplete="off">
          <button type="button" class="zenlo__now zenlo-settings__icon-btn js-settings-eye" title="Hiện / ẩn key">${EYE_SVG}</button>
          <button type="button" class="zenlo__now zenlo-settings__icon-btn js-settings-remove-key" title="Xoá key này">&times;</button>
        </span>
        <div class="zenlo-settings__key-status js-settings-key-status"></div>
      </div>
    `).join('')
    overlay.querySelector('.js-settings-add-key').hidden = rows.length >= maxKeys
    // First time: show how to get a key
    overlay.querySelector('.js-settings-guide').hidden = keys.some(Boolean)
    renderKeyStatus()
  }

  function renderKeyStatus () {
    overlay.querySelectorAll('.zenlo-settings__key').forEach((row) => {
      const key = row.querySelector('.js-settings-key').value.trim()
      const info = key && keyStatus.find((k) => k.masked === maskKey(key))
      const el = row.querySelector('.js-settings-key-status')
      if (!info) {
        el.textContent = ''
      } else if (!info.exhausted.length) {
        el.textContent = 'Chưa ghi nhận hết lượt hôm nay.'
      } else {
        const names = info.exhausted.map((m) => m.label.replace(/^Gemini /, '')).join(', ')
        el.textContent = `Hết lượt trong ngày: ${names} (mở lại lúc ${clock(Math.min(...info.exhausted.map((m) => m.resetAt)))}).`
      }
    })
  }

  async function saveGeminiKeys () {
    const status = overlay.querySelector('.js-settings-keys-status')
    const keys = [...overlay.querySelectorAll('.js-settings-key')].map((input) => input.value.trim()).filter(Boolean)
    try {
      await window.$zenlo.setGeminiKeys(keys)
      status.textContent = keys.length ? `Đã lưu ${keys.length} key (mã hoá bằng Windows trên máy này).` : 'Đã xoá mọi key.'
      status.classList.remove('zenlo__status--error')
      overlay.querySelector('.js-settings-guide').hidden = keys.length > 0
      loadGeminiModels()
      Z.drawer.refreshNotice()
    } catch (error) {
      status.textContent = `Lỗi: ${error.message || error}`
      status.classList.add('zenlo__status--error')
    }
  }

  // ---------- Gemini model list ----------

  // A custom dropdown, since a native one cannot draw the colored bar:
  // "Từ Gemini 3.8 Flash ▮▮▮", greyed out when every key is out of quota for the day
  const LEVEL_TEXT = { 1: 'Thoáng', 2: 'Vừa', 3: 'Đông' }
  let geminiModelList = []

  const bar = (level) => level ? `<span class="zenlo-settings__bar zenlo-settings__bar--${level}" title="Mức đông người dùng (ước lượng): ${LEVEL_TEXT[level]}"><i></i><i></i><i></i></span>` : ''

  function modelOptions () {
    const usable = geminiModelList.filter((m) => !m.exhausted)
    const newest = usable[0]
    return [
      { value: GEMINI_AUTO, label: newest ? `Mới nhất (${newest.label.replace(/^Gemini /, '')})` : 'Mới nhất', level: newest ? newest.level : 0, disabled: !newest && geminiModelList.length > 0 },
      ...geminiModelList.map((m) => ({
        value: m.id,
        label: `Từ ${m.label}`,
        level: m.level,
        disabled: m.exhausted,
        note: m.exhausted ? `hết lượt, mở lại lúc ${clock(m.resetAt)}` : ''
      }))
    ]
  }

  function renderModelSelect () {
    const select = overlay.querySelector('.js-gemini-model')
    const options = modelOptions()
    const current = Z.getAISettings().model
    const chosen = options.find((o) => o.value === current) || options[0]
    select.querySelector('.zenlo-select__value').innerHTML = `<span>${escapeHTML(chosen.label)}</span>${bar(chosen.level)}`
    select.querySelector('.zenlo-select__list').innerHTML = options.map((o) => `
      <button type="button" class="zenlo-select__option${o.value === chosen.value ? ' zenlo-select__option--active' : ''}" data-value="${escapeHTML(o.value)}" ${o.disabled ? 'disabled' : ''}>
        <span class="zenlo-select__label">${escapeHTML(o.label)}${o.note ? ` <small>· ${escapeHTML(o.note)}</small>` : ''}</span>${bar(o.level)}
      </button>
    `).join('')
  }

  async function loadGeminiModels () {
    if (!window.$zenlo || !window.$zenlo.geminiStatus) return
    try {
      const status = await window.$zenlo.geminiStatus()
      geminiModelList = status.models || []
      keyStatus = status.keys || []
    } catch (error) {
      geminiModelList = []
      keyStatus = []
    }
    renderModelSelect()
    renderKeyStatus()
  }

  // A one-word request, to check that the chosen AI answers. The login, plan and key are the same
  // for every model, so it uses the fastest settings: Haiku for Claude, low effort for Codex and Gemini.
  async function testConnection () {
    const button = overlay.querySelector('.js-settings-test')
    const { provider } = Z.getAISettings()
    const started = Date.now()
    let model = provider === 'claude' ? 'Claude Haiku' : provider === 'codex' ? 'Codex' : 'Gemini'
    const tick = () => setTestStatus(`Đang thử ${model}… ${Math.round((Date.now() - started) / 1000)} giây`)
    button.disabled = true
    tick()
    const timer = setInterval(tick, 1000)
    try {
      const call = Z.runAI({
        systemPrompt: 'Chỉ trả lời đúng một chữ: ok',
        instruction: 'Trả lời "ok".',
        input: '',
        model: provider === 'claude' ? 'haiku' : undefined,
        effort: 'low'
      }, () => {}, (status) => {
        model = Z.describeModelStatus(status)
      })
      const answer = String(await call.promise).trim()
      const seconds = Math.round((Date.now() - started) / 1000)
      setTestStatus(answer ? `✓ Kết nối được: ${model} trả lời sau ${seconds} giây.` : 'AI không trả lời gì.', !answer)
    } catch (error) {
      setTestStatus(`Lỗi: ${error.message || error}`, true)
    } finally {
      clearInterval(timer)
      button.disabled = false
      if (provider === 'gemini') loadGeminiModels()
    }
  }

  // A small "?" that opens the guide on the website at that section
  const help = (anchor) => ` <button type="button" class="zenlo-settings__help" data-guide="${anchor}" title="Xem hướng dẫn">?</button>`

  function buildOverlay () {
    const get = (key, list, fallback) => Z.getSetting(key, list.map((i) => (typeof i === 'string' ? i : i.value)), fallback)

    const el = document.createElement('div')
    el.className = 'zenlo zenlo-settings'
    el.innerHTML = `
      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">AI dùng để tóm tắt${help('chon-ai')}</div>
        <div class="zenlo-settings__choice">
          <label><input type="radio" name="zenlo-provider" value="claude"> Claude</label>
          <label><input type="radio" name="zenlo-provider" value="codex"> Codex (ChatGPT)</label>
          <label><input type="radio" name="zenlo-provider" value="gemini"> Gemini</label>
        </div>

        <div class="js-settings-claude">
          <div class="zenlo__grid">
            <label>Model<select class="js-settings-claude-model">${options(MODELS, get(STORAGE_KEYS.model, MODELS, 'sonnet'))}</select></label>
            <label>Effort<select class="js-settings-claude-effort">${options(EFFORTS, get(STORAGE_KEYS.effort, EFFORTS, 'medium'))}</select></label>
          </div>
          <div class="zenlo-settings__note">Cần gói Claude Pro/Max và Claude Code đã đăng nhập.${help('claude')}</div>
          <div class="zenlo__status js-settings-claude-status"></div>
        </div>

        <div class="js-settings-codex">
          <div class="zenlo__grid">
            <label>Model<select class="js-settings-codex-model">${options(CODEX_MODELS, get(STORAGE_KEYS.codexModel, CODEX_MODELS, 'default'))}</select></label>
            <label>Effort<select class="js-settings-codex-effort">${options(CODEX_EFFORTS, get(STORAGE_KEYS.codexEffort, CODEX_EFFORTS, 'medium'))}</select></label>
          </div>
          <div class="zenlo-settings__note">Cần gói ChatGPT có Codex (Plus, Pro…) và Codex đã đăng nhập.${help('codex')}</div>
          <div class="zenlo__status js-settings-codex-status"></div>
        </div>

        <div class="js-settings-gemini">
          <div class="zenlo-settings__guide js-settings-guide" hidden>
            <b>Chưa có key?</b> Mở <button type="button" class="zenlo__inline-link js-open-aistudio">Google AI Studio</button>, bấm <b>Create API key</b>, dán vào ô dưới.
            <button type="button" class="zenlo__inline-link" data-guide="lay-key">Hướng dẫn có hình</button>
          </div>
          <div class="zenlo-settings__label">API key Gemini <small>(tối đa 5)</small>${help('gemini')}</div>
          <div class="zenlo-settings__keys js-settings-keys"></div>
          <button type="button" class="zenlo-digest__link zenlo-settings__add js-settings-add-key">+ Thêm API key</button>
          <div class="zenlo__status js-settings-keys-status"></div>
          <div class="zenlo__grid">
            <label class="zenlo-settings__wide" title="Thanh màu: mức đông người dùng ước lượng (đỏ đông, vàng vừa, xanh thoáng). Model mờ: mọi key đã hết lượt hôm nay, mở lại khoảng 14–15 giờ chiều.">Model
              <div class="zenlo-select js-gemini-model">
                <button type="button" class="zenlo-select__button"><span class="zenlo-select__value"></span><span class="zenlo-select__arrow">▾</span></button>
                <div class="zenlo-select__list" hidden></div>
              </div>
            </label>
            <label>Effort<select class="js-settings-gemini-effort">${options(GEMINI_EFFORTS, get(STORAGE_KEYS.geminiEffort, GEMINI_EFFORTS, 'high'))}</select></label>
            <span></span>
            <label title="Model chưa phản hồi sau thời gian này thì coi là quá tải và chuyển xuống bản thấp hơn">Chờ model trả lời
              <select class="js-settings-gemini-timeout">${options(GEMINI_TIMEOUTS.map((v) => ({ value: v, label: `${v} giây` })), get(STORAGE_KEYS.geminiTimeout, GEMINI_TIMEOUTS, '10'))}</select>
            </label>
            <label title="Model vừa quá tải bị xếp xuống cuối trong thời gian này, rồi mới được thử lại đầu tiên">Thử lại model quá tải sau
              <select class="js-settings-gemini-retry">${options(GEMINI_RETRIES.map((v) => ({ value: v, label: v === '0' ? 'Luôn thử lại' : `${v} phút` })), get(STORAGE_KEYS.geminiRetry, GEMINI_RETRIES, '5'))}</select>
            </label>
          </div>
          <div class="zenlo-settings__note zenlo-settings__note--warn">Key miễn phí: Google có thể dùng nội dung gửi lên để cải thiện sản phẩm.</div>
        </div>

        <div class="zenlo__actions">
          <button class="zenlo__btn js-settings-test">Kiểm tra kết nối</button>
        </div>
        <div class="zenlo__status js-settings-test-status"></div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Tóm tắt và Bản tin${help('mac-dinh')}</div>
        <div class="zenlo__grid">
          <label>Độ dài Tóm tắt<select class="js-settings-length" data-feature="summary">${options(LENGTHS, Z.getLength('summary'))}</select></label>
          <label>Độ dài Bản tin<select class="js-settings-length" data-feature="digest">${options(LENGTHS, Z.getLength('digest'))}</select></label>
          <label>Tìm tin chưa đọc lùi tối đa<select class="js-settings-lookback">${LOOKBACK_DAYS.map((d) => `<option value="${d}"${String(Z.getLookback() / Z.DAY) === d ? ' selected' : ''}>${d} ngày</option>`).join('')}</select></label>
        </div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Dữ liệu${help('dat-lai')}</div>
        <div class="zenlo__actions">
          <button class="zenlo__btn js-settings-clear">Xoá bản tóm tắt đã lưu</button>
        </div>
        <div class="zenlo-settings__note">Ô tick và thứ tự trong Bản tin được giữ lại.</div>
        <div class="zenlo__status js-settings-clear-status"></div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Đặt lại</div>
        <div class="zenlo__actions">
          <button class="zenlo__btn js-settings-reset">Đặt lại mặc định</button>
        </div>
        <div class="zenlo-settings__note">API key, bản tóm tắt, ô tick và thứ tự được giữ lại.</div>
        <div class="zenlo__status js-settings-reset-status"></div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Về Zenlo</div>
        <div class="zenlo-settings__links">
          ${[['guide', 'Hướng dẫn sử dụng'], ['site', 'Trang chủ'], ['versions', 'Các phiên bản'], ['privacy', 'Quyền riêng tư'], ['terms', 'Điều khoản sử dụng'], ['source', 'Mã nguồn'], ['feedback', 'Góp ý & báo lỗi'], ['treat', '🧋 Mời trà sữa']]
            .filter(([key]) => Z.LINKS[key])
            .map(([key, label]) => `<button type="button" class="zenlo__inline-link" data-link="${key}">${label}</button>`).join('')}
        </div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Phiên bản</div>
        <div class="zenlo__actions zenlo__actions--center">
          <span>Bạn đang dùng Zenlo v${escapeHTML(Z.VERSION)}.</span>
          <button class="zenlo__btn js-settings-update">Kiểm tra bản mới</button>
        </div>
        <div class="zenlo__status js-settings-update-status"></div>
        <label class="zenlo-settings__check"><input type="checkbox" class="js-settings-update-auto"> Tự kiểm tra bản mới mỗi ngày</label>
        <div class="zenlo-settings__note">Chỉ hỏi GitHub bản mới nhất là bản nào, không gửi gì về bạn.</div>
      </section>

      <div class="zenlo-settings__footer">Zenlo v${escapeHTML(Z.VERSION)} · © stephit</div>
    `

    el.querySelectorAll('[name="zenlo-provider"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        Z.setSetting(STORAGE_KEYS.provider, radio.value)
        renderProvider()
        Z.drawer.refreshNotice()
        if (radio.value === 'gemini') loadGeminiModels()
        setTestStatus('')
      })
    })
    const bindSelect = (selector, key) => {
      el.querySelector(selector).addEventListener('change', (event) => {
        Z.setSetting(key, event.target.value)
        setTestStatus('')
      })
    }
    bindSelect('.js-settings-claude-model', STORAGE_KEYS.model)
    bindSelect('.js-settings-claude-effort', STORAGE_KEYS.effort)
    bindSelect('.js-settings-codex-model', STORAGE_KEYS.codexModel)
    bindSelect('.js-settings-codex-effort', STORAGE_KEYS.codexEffort)
    // The custom model dropdown
    const modelSelect = el.querySelector('.js-gemini-model')
    const modelList = modelSelect.querySelector('.zenlo-select__list')
    modelSelect.querySelector('.zenlo-select__button').addEventListener('click', () => {
      modelList.hidden = !modelList.hidden
    })
    modelList.addEventListener('click', (event) => {
      const option = event.target.closest('.zenlo-select__option')
      if (!option || option.disabled) return
      Z.setSetting(STORAGE_KEYS.geminiModel, option.dataset.value)
      modelList.hidden = true
      renderModelSelect()
      setTestStatus('')
    })
    el.addEventListener('mousedown', (event) => {
      if (!event.target.closest('.js-gemini-model')) modelList.hidden = true
    })

    bindSelect('.js-settings-gemini-effort', STORAGE_KEYS.geminiEffort)
    bindSelect('.js-settings-gemini-timeout', STORAGE_KEYS.geminiTimeout)
    bindSelect('.js-settings-gemini-retry', STORAGE_KEYS.geminiRetry)
    bindSelect('.js-settings-lookback', STORAGE_KEYS.lookbackDays)
    el.querySelectorAll('.js-settings-length').forEach((select) => {
      select.addEventListener('change', () => Z.setLength(select.dataset.feature, select.value))
    })

    // Gemini keys: saved when a field changes or a key is removed
    const keyList = el.querySelector('.js-settings-keys')
    keyList.addEventListener('change', (event) => {
      if (event.target.closest('.js-settings-key')) saveGeminiKeys()
    })
    keyList.addEventListener('click', (event) => {
      const row = event.target.closest('.zenlo-settings__key')
      if (!row) return
      const input = row.querySelector('.js-settings-key')
      if (event.target.closest('.js-settings-eye')) {
        input.type = input.type === 'password' ? 'text' : 'password'
      } else if (event.target.closest('.js-settings-remove-key')) {
        const hadKey = !!input.value.trim()
        row.remove()
        if (!keyList.children.length) renderKeys([])
        el.querySelector('.js-settings-add-key').hidden = keyList.children.length >= maxKeys
        if (hadKey) saveGeminiKeys()
      }
    })
    el.querySelector('.js-settings-add-key').addEventListener('click', () => {
      const keys = [...keyList.querySelectorAll('.js-settings-key')].map((input) => input.value.trim())
      if (keys.length >= maxKeys) return
      renderKeys([...keys, ''])
      const inputs = keyList.querySelectorAll('.js-settings-key')
      inputs[inputs.length - 1].focus()
    })

    el.querySelector('.js-settings-test').addEventListener('click', testConnection)
    el.querySelector('.js-open-aistudio').addEventListener('click', () => Z.openLink(Z.LINKS.geminiKey))
    el.querySelectorAll('[data-guide]').forEach((button) => {
      button.addEventListener('click', () => Z.openLink(`${Z.LINKS.guide}#${button.dataset.guide}`))
    })
    el.querySelectorAll('[data-link]').forEach((button) => {
      button.addEventListener('click', () => Z.openLink(Z.LINKS[button.dataset.link]))
    })
    const updateStatus = el.querySelector('.js-settings-update-status')
    el.querySelector('.js-settings-update').addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      updateStatus.textContent = 'Đang hỏi GitHub…'
      updateStatus.classList.remove('zenlo__status--error')
      const result = await Z.checkForUpdate()
      button.disabled = false
      updateStatus.textContent = ''
      if (result.error) {
        updateStatus.textContent = `Không kiểm tra được: ${result.error}`
        updateStatus.classList.add('zenlo__status--error')
      } else if (result.newer) {
        updateStatus.append(`Đã có Zenlo ${result.latest}. `)
        const link = document.createElement('button')
        link.type = 'button'
        link.className = 'zenlo__inline-link'
        link.textContent = 'Xem bản mới'
        link.addEventListener('click', () => Z.openLink(Z.LINKS.versions))
        updateStatus.append(link)
      } else {
        updateStatus.textContent = 'Bạn đang dùng bản mới nhất.'
      }
      Z.drawer.refreshNotice()
    })
    const auto = el.querySelector('.js-settings-update-auto')
    auto.checked = Z.getSetting(STORAGE_KEYS.updateCheck, ['on'], '') === 'on'
    auto.addEventListener('change', () => Z.setSetting(STORAGE_KEYS.updateCheck, auto.checked ? 'on' : 'off'))

    el.querySelector('.js-settings-clear').addEventListener('click', () => {
      if (!window.confirm('Xoá mọi bản tóm tắt và bản tin đã lưu?')) return
      const removed = Z.clearSavedResults()
      el.querySelector('.js-settings-clear-status').textContent = `Đã xoá ${removed} mục.`
    })
    el.querySelector('.js-settings-reset').addEventListener('click', () => {
      if (!window.confirm('Đưa mọi cài đặt của Zenlo về mặc định? API key, bản tóm tắt đã lưu, thứ tự và ô tick trong Bản tin vẫn được giữ.')) return
      Z.resetSettings()
      // Rebuild the page so every field shows its default
      el.remove()
      overlay = null
      Z.drawer.open('settings')
      overlay.querySelector('.js-settings-reset-status').textContent = 'Đã đặt lại mặc định.'
    })

    Z.drawer.pane('settings').appendChild(el)
    return el
  }

  // Each time the drawer shows this tab: build it once, then refresh what may have changed
  Z.drawer.onShow('settings', () => {
    if (!overlay) overlay = buildOverlay()
    // The lengths may have changed in the other tabs since this page was built
    overlay.querySelectorAll('.js-settings-length').forEach((select) => {
      select.value = Z.getLength(select.dataset.feature)
    })
    renderProvider()
    loadMainSettings()
    loadGeminiModels()
  })

  // "Tự kiểm tra bản mới mỗi ngày" (off unless the user turns it on): once a day, a minute after
  // Zalo starts, ask GitHub; a newer version shows in the line above the drawer's tabs
  setTimeout(async () => {
    if (Z.getSetting(STORAGE_KEYS.updateCheck, ['on'], '') !== 'on') return
    let last = 0
    try {
      last = Number(localStorage.getItem(STORAGE_KEYS.updateCheckedAt)) || 0
    } catch (error) {}
    if (Date.now() - last < Z.DAY) return
    const result = await Z.checkForUpdate()
    if (result.newer) Z.drawer.refreshNotice()
  }, 60 * 1000)
})()
