/*
 * Mounts the seat the way the app does — through slots.register — so the card
 * geometry, the portal and the pointer handlers all run for real.
 *
 * Query: providers=N models=M long=I current=K
 *   one provider owns M models (the rest own three), which is the shape that
 *   used to make the popover grow and shrink under a still pointer.
 * Query: hub=1
 *   mounts the seat the way a channel plugin's composer row does: a sibling
 *   `conversation.input.right` anchor carrying the channel's provider badge.
 *   The seat hides its own provider prefix while that badge is there.
 * Query: demo=1
 *   the same seat over a realistic provider set, for the storefront
 *   screenshots (scripts/shots.mjs). Nothing else reads it.
 */
(function () {
  window.__errors = []
  window.addEventListener('error', function (event) {
    window.__errors.push(String(event.message))
  })
  var query = new URLSearchParams(location.search)
  var N = Number(query.get('providers') || '6')
  var M = Number(query.get('models') || '60')
  var LONG = Number(query.get('long') || '0')
  var CURRENT = Number(query.get('current') || '0')
  var DEMO = query.get('demo') === '1'

  // Every model carries reasoning levels: the thinking pane renders a slider
  // for whichever model is current, and a switched model must not empty it.
  function mkModels(prefix, count) {
    var out = []
    for (var i = 0; i < count; i++) {
      out.push({
        id: prefix + '-' + i,
        name: prefix + ' model ' + i,
        reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
          defaultEffort: 'medium',
        },
      })
    }
    return out
  }

  function mkNamed(prefix, names) {
    var out = []
    for (var i = 0; i < names.length; i++) {
      out.push({
        id: prefix + '-' + i,
        name: names[i],
        reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
          defaultEffort: 'medium',
        },
      })
    }
    return out
  }

  // Storefront fixture: real-looking providers, one of them with enough models
  // to scroll, so a screenshot shows the card doing what it is for.
  var DEMO_GROUPS = [
    ['DeepSeek', ['DeepSeek-V4.1-Flash', 'DeepSeek-V4.1', 'deepseek-reasoner', 'deepseek-coder']],
    ['StepFun', ['step-3', 'step-3-mini', 'step-2-16k']],
    ['本地 Ollama', ['qwen3:32b', 'llama4:70b', 'gemma3:27b']],
    ['阿里云百炼', ['qwen3-max', 'qwen3-coder-plus', 'qwen-long', 'qwen3-vl-plus', 'qwen-math-plus']],
    ['OpenRouter', ['claude-sonnet-4', 'gemini-2.5-pro', 'gpt-5.1', 'mistral-large-3', 'grok-4', 'kimi-k2']],
  ]

  var groups = []
  if (DEMO) {
    for (var d = 0; d < DEMO_GROUPS.length; d++) {
      groups.push({
        id: 'demo-' + d,
        name: DEMO_GROUPS[d][0],
        models: mkNamed('demo' + d, DEMO_GROUPS[d][1]),
      })
    }
  } else {
    for (var p = 0; p < N; p++) {
      groups.push({ id: 'prov-' + p, name: 'Provider ' + p, models: mkModels('p' + p, p === LONG ? M : 3) })
    }
  }
  var currentGroup = groups[CURRENT] || groups[0]
  // dsh persists the chosen reasoning level per session on the Host, so a restart
  // comes back on the level the user left it on - across a new port, because that
  // state never lived in the browser. The harness has to do the same, or a reload
  // would silently reset the level and the seating logic would look wrong for a
  // reason that only exists in the test bed. It therefore uses a cookie, not
  // localStorage: the desktop host serves every launch from a new port, and
  // localStorage is bucketed by host AND port while a cookie is not.
  var EFFORT_COOKIE = 'harness-effort'
  function readEffortCookie() {
    var jar = ''
    try { jar = String(document.cookie || '') } catch (error) { return null }
    var parts = jar.split(';')
    for (var e = 0; e < parts.length; e++) {
      var at = parts[e].indexOf('=')
      if (at === -1) continue
      if (parts[e].slice(0, at).trim() !== EFFORT_COOKIE) continue
      try { return decodeURIComponent(parts[e].slice(at + 1)) } catch (error) { return null }
    }
    return null
  }
  function writeEffortCookie(value) {
    try { document.cookie = EFFORT_COOKIE + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax' } catch (error) { /* private mode */ }
  }
  var savedEffort = readEffortCookie()
  var snapshot = {
    current: { provider: currentGroup.id, model: currentGroup.models[0].id, reasoningEffort: savedEffort || 'medium' },
    groups: groups,
    failures: [],
    pending: null,
    status: 'ready',
  }
  var listeners = new Set()
  var store = {
    subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
    getSnapshot: function () { return snapshot },
  }
  var directory = {
    store: store,
    load: function () { return Promise.resolve() },
    select: function (selection) {
      (window.__selections || (window.__selections = [])).push(selection)
      // The real directory store publishes the new current selection, and the
      // card reads it back through useSyncExternalStore. Recording the call is
      // not enough: the slider, the check mark and the trigger label only move
      // once the snapshot changes.
      snapshot = Object.assign({}, snapshot, { current: Object.assign({}, snapshot.current, selection) })
      if (snapshot.current.reasoningEffort) writeEffortCookie(snapshot.current.reasoningEffort)
      listeners.forEach(function (fn) { fn() })
      return Promise.resolve({ ok: true })
    },
  }
  var modelDirectories = { directoryFor: function () { return directory } }
  var sessions = { subagentAddress: function () { return undefined } }

  // The app hands a slot component its translations through the `locale` field
  // it declared at registration; the harness does the same, from the dictionary
  // the plugin registered.
  // ?lang=zh|en pins the language. Without it the harness follows the browser,
  // which on a CI runner is en-US while the assertions read the Chinese
  // dictionary.
  var forcedLang = new URLSearchParams(location.search).get('lang')
  var lang = forcedLang === 'zh' || forcedLang === 'en'
    ? forcedLang
    : (/^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en')
  window.__lang = lang

  function translator(namespace) {
    var entry = dictionaries.filter(function (item) { return item.namespace === namespace }).pop()
    var dict = entry === undefined ? {} : entry.dict
    var table = dict[lang] || dict.zh || dict.en || {}
    return function (key, vars) {
      var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
      if (typeof text !== 'string') return key
      if (vars === undefined) return text
      return text.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
      })
    }
  }

  // The app hands each mounted seat the id of the conversation it belongs to. A
  // restart opens a NEW conversation, so a scenario has to be able to say which
  // id it is mounting under; `?session=` does that and defaults to session-1.
  function sessionId() {
    var match = /[?&]session=([^&]*)/.exec(window.location.search)
    return match === null || match[1] === '' ? 'session-1' : decodeURIComponent(match[1])
  }

  // ?hub=1 reproduces the composer row a channel plugin builds (dsh-providers-hub's
  // JetHub): one flex row holding two `display: contents` slot anchors, the
  // channel's provider badge in `conversation.input.right` and the seat in
  // `conversation.input.model`. The seat steps its provider prefix aside while
  // that badge is there. Without the flag the seat mounts into a bare div, which
  // is what every other scenario wants: no badge anywhere on the page.
  //
  // The class name is the channel's own createElement literal (`.dim-jh-badge`),
  // not a hashable CSS-module name, and `data-hub-badge` marks it for the script
  // so a scenario can remove it without guessing a selector.
  var mountSlot = document.getElementById('slot')
  var mountParent = mountSlot
  var HUB = query.get('hub') === '1'
  if (HUB) {
    var hubRow = document.createElement('div')
    hubRow.className = 'FIXTURE_standardControls'
    hubRow.style.cssText = 'display:flex;align-items:center;gap:8px'
    var hubRight = document.createElement('div')
    hubRight.setAttribute('data-slot', 'conversation.input.right')
    hubRight.style.display = 'contents'
    var hubBadge = document.createElement('span')
    hubBadge.className = 'dim-jh-badge'
    hubBadge.setAttribute('data-hub-badge', '1')
    hubBadge.textContent = 'JetHub'
    hubRight.appendChild(hubBadge)
    mountSlot.parentNode.appendChild(hubRow)
    hubRow.appendChild(hubRight)
    // The mount point itself becomes the channel's model slot: the host anchors
    // the two slots as siblings, one level above, exactly like the real composer
    // row. Adding another wrapper here would put the row one ancestor deeper than
    // the app has it and the seat's bounded walk would stop one step short - a
    // test bed that fails for a reason the product does not have.
    mountParent = hubRow
  }

  var slots = {
    inject: function (name, callback) {
      var handle = callback()
      return function () { if (handle && typeof handle.dispose === 'function') handle.dispose() }
    },
    register: function (spec, Component) {
      var host = document.createElement('div')
      host.setAttribute('data-host', 'seat')
      // Under ?hub=1 the seat's own host is the slot anchor the composer row
      // holds; its parent is the row, which also holds the channel's badge.
      if (HUB) {
        host.setAttribute('data-slot', 'conversation.input.model')
        host.style.display = 'contents'
      }
      mountParent.appendChild(host)
      var root = ReactDOM.createRoot(host)
      var props = spec.inject(sessionId())
      props.t = translator(spec.locale)
      root.render(React.createElement(Component, props))
      return { dispose: function () { root.unmount(); host.remove() } }
    },
  }

  var dictionaries = []
  var ctx = {
    slots: slots,
    modelDirectories: modelDirectories,
    sessions: sessions,
    effect: function (fn) { var dispose = fn(); return function () { if (typeof dispose === 'function') dispose() } },
    locale: {
      register: function (namespace, dict) { dictionaries.push({ namespace: namespace, dict: dict }); return function () {} },
    },
    inject: function (deps, callback) { callback({ slots: slots, modelDirectories: modelDirectories, sessions: sessions }) },
  }

  var loaded = window.__MOD
  var api = loaded.factory(function (name) {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error('unexpected require ' + name)
  })
  window.__api = api
  window.__session = sessionId()
  window.__host = { ctx: ctx, store: store, snapshot: snapshot, dictionaries: dictionaries, directory: directory }
  api.apply(ctx)
  window.__ready = true
})()