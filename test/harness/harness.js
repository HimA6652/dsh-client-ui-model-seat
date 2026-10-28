/*
 * Mounts the seat the way the app does — through slots.register — so the card
 * geometry, the portal and the pointer handlers all run for real.
 *
 * Query: providers=N models=M long=I current=K
 *   one provider owns M models (the rest own three), which is the shape that
 *   used to make the popover grow and shrink under a still pointer.
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
  var snapshot = {
    current: { provider: currentGroup.id, model: currentGroup.models[0].id, reasoningEffort: 'medium' },
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
      listeners.forEach(function (fn) { fn() })
      return Promise.resolve({ ok: true })
    },
  }
  var modelDirectories = { directoryFor: function () { return directory } }
  var sessions = { subagentAddress: function () { return undefined } }

  // The app hands a slot component its translations through the `locale` field
  // it declared at registration; the harness does the same, from the dictionary
  // the plugin registered.
  function translator(namespace) {
    var entry = dictionaries.filter(function (item) { return item.namespace === namespace }).pop()
    var dict = entry === undefined ? {} : entry.dict
    var lang = /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en'
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

  var slots = {
    inject: function (name, callback) {
      var handle = callback()
      return function () { if (handle && typeof handle.dispose === 'function') handle.dispose() }
    },
    register: function (spec, Component) {
      var host = document.createElement('div')
      host.setAttribute('data-host', 'seat')
      document.getElementById('slot').appendChild(host)
      var root = ReactDOM.createRoot(host)
      var props = spec.inject('session-1')
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
  window.__host = { ctx: ctx, store: store, snapshot: snapshot, dictionaries: dictionaries, directory: directory }
  api.apply(ctx)
  window.__ready = true
})()