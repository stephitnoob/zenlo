/*
  Zenlo – website. Light or dark: follows the computer until the visitor picks one with the
  sun/moon button; the choice is remembered on this browser only.
*/

(function () {
  const KEY = 'zenlo-theme'
  const root = document.documentElement

  function saved () {
    try {
      return localStorage.getItem(KEY)
    } catch (error) {
      return null
    }
  }

  function apply (theme) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
    else delete root.dataset.theme
  }

  function current () {
    if (root.dataset.theme) return root.dataset.theme
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  apply(saved())

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.js-theme').forEach((button) => {
      const label = () => button.setAttribute('aria-label', current() === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối')
      label()
      button.addEventListener('click', () => {
        const next = current() === 'dark' ? 'light' : 'dark'
        apply(next)
        try {
          localStorage.setItem(KEY, next)
        } catch (error) {}
        label()
      })
    })
  })
})()
