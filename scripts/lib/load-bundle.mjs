import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '../..')
export const BUNDLE_PATH = resolve(ROOT, 'lib/client.js')

/**
 * A callable nothing: every property read answers another stub, every call
 * answers a stub object. The bundle only needs React to exist at module scope
 * (component bodies never run here), and the DOM only to hand back nodes.
 */
function stub(name) {
  const fn = function () {
    return { stub: name }
  }
  return new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => ''
      if (key === 'toString') return () => name
      if (key === 'then') return undefined
      return stub(name + '.' + String(key))
    },
    apply() {
      return { stub: name }
    },
    construct() {
      return { stub: name }
    },
  })
}

function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    style: {},
    dataset: {},
    textContent: '',
    childNodes: [],
    attributes: {},
    setAttribute(key, value) {
      this.attributes[key] = String(value)
    },
    removeAttribute(key) {
      delete this.attributes[key]
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null
    },
    appendChild(child) {
      this.childNodes.push(child)
      return child
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child)
      if (index >= 0) this.childNodes.splice(index, 1)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    contains() {
      return false
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    closest() {
      return null
    },
    focus() {},
    remove() {},
  }
  return node
}

function makeDocument() {
  const head = makeElement('head')
  const body = makeElement('body')
  const byId = new Map()
  const doc = {
    head,
    body,
    documentElement: makeElement('html'),
    fonts: undefined,
    readyState: 'complete',
    styleSheets: [],
    createElement(tag) {
      const node = makeElement(tag)
      const originalSetAttribute = node.setAttribute
      node.setAttribute = function (key, value) {
        originalSetAttribute.call(this, key, value)
        if (key === 'id') {
          this.id = String(value)
          byId.set(this.id, this)
        }
      }
      if (String(tag).toLowerCase() === 'style') {
        Object.defineProperty(node, 'id', {
          get() {
            return this.attributes.id ?? ''
          },
          set(value) {
            this.attributes.id = String(value)
            byId.set(String(value), this)
          },
        })
      }
      return node
    },
    createElementNS(namespace, tag) {
      return doc.createElement(tag)
    },
    createTextNode(text) {
      return { nodeValue: String(text), textContent: String(text) }
    },
    createDocumentFragment() {
      return makeElement('fragment')
    },
    getElementById(id) {
      return byId.get(String(id)) ?? null
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    addEventListener() {},
    removeEventListener() {},
    get activeElement() {
      return null
    },
  }
  return doc
}

function makeLocalStorage(store) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem(key, value) {
      store[key] = String(value)
    },
    removeItem(key) {
      delete store[key]
    },
    key(index) {
      return Object.keys(store)[index] ?? null
    },
    get length() {
      return Object.keys(store).length
    },
  }
}

/**
 * Loads lib/client.js the way the app does: the bundle calls
 * window.__ModuleLoader__.load(spec), and the host later calls spec.factory
 * with a require that resolves react and react-dom.
 */
export function loadBundle(options = {}) {
  const source = options.source ?? readFileSync(BUNDLE_PATH, 'utf8')
  const document = makeDocument()
  const storage = {}
  const localStorage = makeLocalStorage(storage)
  let spec = null
  const window = {
    __ModuleLoader__: {
      load(loaded) {
        spec = loaded
      },
    },
    document,
    localStorage,
    location: { href: 'http://localhost/', search: '', hash: '' },
    navigator: { language: 'zh-CN', languages: ['zh-CN'], userAgent: 'node' },
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(fn) {
      return setTimeout(() => fn(Date.now()), 0)
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle)
    },
    getComputedStyle() {
      return { getPropertyValue: () => '' }
    },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    console,
  }
  const context = vm.createContext({
    window,
    document,
    localStorage,
    navigator: window.navigator,
    location: window.location,
    matchMedia: window.matchMedia,
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    performance: { now: () => Date.now() },
    URLSearchParams,
    queueMicrotask,
    process,
    globalThis: undefined,
    self: undefined,
  })
  vm.runInContext(source, context, { filename: BUNDLE_PATH })
  if (spec === null) throw new Error('bundle never called window.__ModuleLoader__.load')
  const loaded = spec
  const react = options.react ?? stub('react')
  const reactDom = options.reactDom ?? stub('react-dom')
  const module = loaded.factory((name) => {
    if (name === 'react') return react
    if (name === 'react-dom') return reactDom
    throw new Error('unexpected require: ' + name)
  })
  return { spec: loaded, module, document, window, storage, source, react, reactDom }
}

/** A slots service that records registrations instead of rendering them. */
export function fakeSeatHost(options = {}) {
  const calls = []
  const disposers = []
  const directory = {
    store: {
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return options.snapshot ?? { current: null, groups: [], failures: [], pending: null, status: 'ready' }
      },
    },
    load() {
      return Promise.resolve()
    },
    select() {
      return Promise.resolve({ ok: true })
    },
  }
  const slots = {
    inject(name, callback) {
      const handle = callback()
      disposers.push(typeof handle === 'function' ? handle : () => {})
      return () => {}
    },
    register(spec, component) {
      calls.push({ slot: spec.name, priority: spec.priority, spec, component })
      return { dispose() {} }
    },
  }
  const modelDirectories = {
    directoryFor() {
      return directory
    },
  }
  const sessions = {
    subagentAddress() {
      return undefined
    },
  }
  const dictionaries = []
  const ctx = {
    slots,
    modelDirectories,
    sessions,
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    locale: {
      register(namespace, dict) {
        dictionaries.push({ namespace, dict })
        return () => {}
      },
    },
    inject(deps, callback) {
      callback({ slots, modelDirectories, sessions })
    },
  }
  return { ctx, calls, dictionaries, slots, modelDirectories, sessions, directory, disposers }
}

export const ROW_ATTRIBUTE = 'data-model-seat'
export const STYLE_ID = 'dsh-model-seat-style'
