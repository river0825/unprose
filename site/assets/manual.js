// The manual's small enhancements. Without this script every agent's setup is shown one after another.
(function () {
  var zh = document.documentElement.lang !== 'en'
  var COPY = zh ? '複製' : 'Copy'
  var COPIED = zh ? '已複製' : 'Copied'
  var KEY = 'unprose.manual.agent'

  // The table of contents starts folded on narrow screens, where it would push the manual a screen down.
  var toc = document.querySelector('.toc details')
  if (toc && window.matchMedia && !window.matchMedia('(min-width: 980px)').matches) toc.open = false

  // Copy buttons on the code boxes.
  document.querySelectorAll('.code').forEach(function (box) {
    if (!navigator.clipboard) return
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'copy'
    b.textContent = COPY
    b.setAttribute('aria-live', 'polite')
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(box.querySelector('code').textContent).then(function () {
        b.textContent = COPIED
        setTimeout(function () { b.textContent = COPY }, 1600)
      })
    })
    box.appendChild(b)
  })

  // "Your agent" tabs: one setup at a time, the choice remembered per viewer.
  document.querySelectorAll('[data-picker]').forEach(function (picker) {
    var list = picker.querySelector('[role=tablist]')
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role=tab]'))
    var panelOf = function (tab) { return document.getElementById(tab.getAttribute('aria-controls')) }

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab
        t.setAttribute('aria-selected', on ? 'true' : 'false')
        t.tabIndex = on ? 0 : -1
        panelOf(t).hidden = !on
      })
      if (focus) tab.focus()
    }
    function remember(tab) {
      try { localStorage.setItem(KEY, tab.id) } catch (e) { /* storage blocked: the choice lasts this visit */ }
    }
    function fromHash() {
      var id = location.hash.slice(1)
      return tabs.filter(function (t) { return t.getAttribute('aria-controls') === id })[0]
    }

    var saved = null
    try { saved = document.getElementById(localStorage.getItem(KEY) || '') } catch (e) { /* ignore */ }
    picker.classList.add('js')
    list.hidden = false
    select(fromHash() || (tabs.indexOf(saved) >= 0 ? saved : tabs[0]), false)

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); remember(tab) })
      tab.addEventListener('keydown', function (e) {
        var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
        if (next === undefined) return
        e.preventDefault()
        var t = tabs[(next + tabs.length) % tabs.length]
        select(t, true)
        remember(t)
      })
    })
    window.addEventListener('hashchange', function () {
      var t = fromHash()
      if (t) { select(t, false); picker.scrollIntoView() }
    })
  })
})()
