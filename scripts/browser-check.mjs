#!/usr/bin/env node
/**
 * Browser regression for the seat, run in a real Edge/Chrome over CDP.
 *
 * The flicker this guards: the card used to hang off the trigger by its bottom
 * edge and grow with its content, while the pointer chose the provider — and
 * therefore the length of the model list, and therefore the height. Pointer
 * still, the card shrank and grew: 27 height changes in 900 ms, one per frame,
 * between 428 px and 263.5 px. Here the same pointer motion has to leave the
 * frame untouched.
 *
 * It then exercises the rest of the merged behaviour a unit test cannot reach:
 * the thinking pane (slider, keyboard, fast toggle, long-press lock), the
 * cross-provider search with its empty state, the head status button that
 * returns to the columns, and the config panel hotkey.
 *
 * Usage: node scripts/browser-check.mjs [--vendor DIR] [--port 9333] [--dwell 900]
 *   --vendor  directory holding react.js and react-dom.js
 *   --port    DevTools port; a browser already listening there is reused,
 *             otherwise a headless Edge/Chrome is launched
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const HARNESS = join(ROOT, 'test', 'harness')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const PORT = Number(flag('port', '9333'))
const DWELL = Number(flag('dwell', '900'))
// The React UMD builds live in test/vendor (committed, 1.2 MB) so the harness
// runs offline on a fresh clone. --vendor DIR / REACT_VENDOR still override it;
const VENDOR = flag('vendor', process.env.REACT_VENDOR ?? join(ROOT, 'test', 'vendor'))
const BROWSER = flag('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
// --shot DIR writes PNGs of each card state; --dump prints the card's child
// geometry once, which is how the "blank at the top" class of defect gets
// measured instead of guessed.
const SHOT = flag('shot', null)
const DUMP = argv.includes('--dump')

const problems = []
const check = (label, ok, detail) => {
  if (!ok) problems.push(label + (detail === undefined ? '' : ' — ' + detail))
  return ok
}

// ── stage the page: harness + the bundle under test + vendor react ─────────
if (!existsSync(join(VENDOR, 'react.js')) || !existsSync(join(VENDOR, 'react-dom.js'))) {
  console.error('browser-check: no react vendor in ' + VENDOR + ' (pass --vendor DIR)')
  process.exit(2)
}
const stage = mkdtempSync(join(tmpdir(), 'model-seat-browser-'))
mkdirSync(stage, { recursive: true })
copyFileSync(join(HARNESS, 'index.html'), join(stage, 'index.html'))
copyFileSync(join(HARNESS, 'harness.js'), join(stage, 'harness.js'))
copyFileSync(join(ROOT, 'lib', 'client.js'), join(stage, 'client.js'))
copyFileSync(join(VENDOR, 'react.js'), join(stage, 'react.js'))
copyFileSync(join(VENDOR, 'react-dom.js'), join(stage, 'react-dom.js'))

// Served over http rather than opened as file://: localStorage (the card
// remembers fast mode and the colour table) needs a real origin.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
const server = createServer(async (request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0])
  const file = join(stage, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + String(server.address().port)

// ── a browser to drive ─────────────────────────────────────────────────────
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const versionAt = async (port) => {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/json/version')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

let browser = null
let browserProfile = null
let version = await versionAt(PORT)
if (version === null) {
  if (!existsSync(BROWSER)) {
    console.error('browser-check: nothing listening on ' + PORT + ' and no browser at ' + BROWSER)
    process.exit(2)
  }
  const profile = mkdtempSync(join(tmpdir(), 'model-seat-profile-'))
  browserProfile = profile
  browser = spawn(
    BROWSER,
    [
      '--headless=new',
      '--remote-debugging-port=' + String(PORT),
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 100 && version === null; i++) {
    await sleep(100)
    version = await versionAt(PORT)
  }
  if (version === null) {
    console.error('browser-check: browser never opened port ' + PORT)
    process.exit(2)
  }
}

// ── CDP plumbing ───────────────────────────────────────────────────────────
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((done, fail) => {
  ws.addEventListener('open', done, { once: true })
  ws.addEventListener('error', fail, { once: true })
})
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) return
  const waiter = pending.get(message.id)
  if (waiter === undefined) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
  else waiter.resolve(message.result)
})
const send = (method, params, sessionId) => {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId !== undefined) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }))
}

let session = null
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  if (result.exceptionDetails !== undefined) {
    throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 400))
  }
  return result.result.value
}

const url = origin + '/index.html?providers=6&models=60&long=0&current=0'
const created = await send('Target.createTarget', { url: 'about:blank' })
const targetId = created.targetId
session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
await send('Page.enable', {}, session)
await send('Runtime.enable', {}, session)
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false }, session)
await send('Page.navigate', { url }, session)

let ready = false
for (let i = 0; i < 120 && !ready; i++) {
  await sleep(50)
  ready = await evaluate('window.__ready === true').catch(() => false)
}
if (!check('harness mounts the seat', ready)) {
  console.log(JSON.stringify({ stage, url, problems }, null, 2))
  server.close()
  process.exit(1)
}

const CARD = '[data-model-seat="menu"]'
const CARD_Q = JSON.stringify(CARD)
const TRIGGER = '[data-model-seat="model-trigger"]'
const EFFORT_TRIGGER = '[data-model-seat="effort-trigger"]'

const centerOf = (selector) =>
  evaluate(
    '(() => {\n' +
      '  var el = document.querySelector(' + JSON.stringify(selector) + ')\n' +
      '  if (el === null) return null\n' +
      '  var box = el.getBoundingClientRect()\n' +
      '  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }\n' +
      '})()',
  )
const moveTo = async (point) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 }, session)
}
const clickAt = async (point) => {
  await moveTo(point)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, session)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }, session)
}
const key = async (name, code, virtual, modifiers) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers: modifiers ?? 0 }, session)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers: modifiers ?? 0 }, session)
}

const shots = []
const shot = async (name) => {
  if (SHOT === null) return null
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session)
  mkdirSync(SHOT, { recursive: true })
  const file = join(SHOT, name + '.png')
  writeFileSync(file, Buffer.from(result.data, 'base64'))
  shots.push(file)
  return file
}

const record = async (label, ms) => {
  await evaluate(
    '(() => {\n' +
      '  window.__flips = { heights: [], start: performance.now() }\n' +
      '  var tick = function () {\n' +
      '    var el = document.querySelector(' + CARD_Q + ')\n' +
      '    if (el !== null) window.__flips.heights.push(Math.round(el.getBoundingClientRect().height * 10) / 10)\n' +
      '    if (performance.now() - window.__flips.start < ' + ms + ') requestAnimationFrame(tick)\n' +
      '  }\n' +
      '  requestAnimationFrame(tick)\n' +
      '})()',
  )
  await sleep(ms + 150)
  return evaluate(
    '(() => {\n' +
      '  var heights = window.__flips.heights\n' +
      '  var changes = 0\n' +
      '  for (var i = 1; i < heights.length; i += 1) if (heights[i] !== heights[i - 1]) changes += 1\n' +
      '  var el = document.querySelector(' + CARD_Q + ')\n' +
      '  var models = document.querySelector(".ms-col[data-col=\\"models\\"] .ms-rows")\n' +
      '  var providers = document.querySelector(".ms-col[data-col=\\"providers\\"] .ms-rows")\n' +
      '  return {\n' +
      '    label: ' + JSON.stringify(label) + ',\n' +
      '    samples: heights.length,\n' +
      '    changes: changes,\n' +
      '    distinctHeights: Array.from(new Set(heights)),\n' +
      '    height: el === null ? null : Math.round(el.getBoundingClientRect().height * 10) / 10,\n' +
      '    modelsScroll: models === null ? null : models.scrollHeight + "/" + models.clientHeight,\n' +
      '    providersScroll: providers === null ? null : providers.scrollHeight + "/" + providers.clientHeight\n' +
      '  }\n' +
      '})()',
  )
}
let report = null

try {
  // ═══ 1. the card opens in the two-column layout ════════════════════════════
  const trigger = await centerOf(TRIGGER)
  if (!check('model trigger is rendered', trigger !== null)) {
    console.log(JSON.stringify({ problems }, null, 2))
    server.close()
    process.exit(1)
  }
  await clickAt(trigger)
  await sleep(250)

  const shape = await evaluate(
    '(() => {\n' +
      '  var el = document.querySelector(' + CARD_Q + ')\n' +
      '  if (el === null) return null\n' +
      '  var box = el.getBoundingClientRect()\n' +
      '  return {\n' +
      '    layout: el.getAttribute("data-layout"),\n' +
      '    ready: el.getAttribute("data-ready"),\n' +
      '    height: Math.round(box.height * 10) / 10,\n' +
      '    width: Math.round(box.width * 10) / 10,\n' +
      '    heads: Array.from(document.querySelectorAll(".ms-colHead")).map(function (n) { return n.textContent }),\n' +
      '    searchInColumn: document.querySelector(".ms-col[data-col=\\"models\\"] .ms-search") !== null,\n' +
      '    searchBorder: (function () {\n' +
      '      var s = document.querySelector(".ms-search")\n' +
      '      if (s === null) return null\n' +
      '      var cs = getComputedStyle(s)\n' +
      '      return cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor + " | h=" + Math.round(s.getBoundingClientRect().height)\n' +
      '    })(),\n' +
      '    colsTop: (function () {\n' +
      '      var cols = document.querySelector(".ms-cols")\n' +
      '      if (cols === null) return null\n' +
      '      return Math.round(cols.getBoundingClientRect().top - box.top)\n' +
      '    })(),\n' +
      '    popPadding: getComputedStyle(el).padding,\n' +
      '    triggerParts: (function () {\n' +
      '      var t = document.querySelector(' + JSON.stringify('[data-model-seat="model-trigger"]') + ')\n' +
      '      if (t === null) return null\n' +
      '      var part = function (sel) { var n = t.querySelector(sel); return n === null ? null : n.textContent }\n' +
      '      return { provider: part(".gptm-triggerProvider"), slash: part(".gptm-triggerSlash"), model: part(".gptm-triggerModel") }\n' +
      '    })(),\n' +
      '    providerRows: document.querySelectorAll(".ms-col[data-col=\\"providers\\"] .ms-row").length,\n' +
      '    modelRows: document.querySelectorAll(".ms-col[data-col=\\"models\\"] .ms-row").length,\n' +
      '    rootBuild: (document.querySelector("[data-model-seat=\\"root\\"]") || {}).getAttribute\n' +
      '      ? document.querySelector("[data-model-seat=\\"root\\"]").getAttribute("data-build")\n' +
      '      : null\n' +
      '  }\n' +
      '})()',
  )
  check('card opens', shape !== null)
  check('card opens in the two-column layout', shape !== null && shape.layout === 'columns', String(shape && shape.layout))
  check('both columns are labelled', shape !== null && shape.heads.length === 2, JSON.stringify(shape && shape.heads))
  check('the search box lives inside the model column', shape !== null && shape.searchInColumn === true)
  // 0.5px is what the rule says; a 1x screen rounds it up to one device pixel.
  check(
    'the search box has a visible hairline frame',
    shape !== null && /^(0\.5px|1px) solid /.test(String(shape.searchBorder)) && !String(shape.searchBorder).includes('rgba(0, 0, 0, 0)'),
    String(shape && shape.searchBorder),
  )
  check('the search box is 30px tall', shape !== null && /h=30$/.test(String(shape.searchBorder)), String(shape && shape.searchBorder))
  check('the card carries 4px of popover padding', shape !== null && shape.popPadding === '4px', String(shape && shape.popPadding))
  check(
    'the columns start at the card top edge (no blank band)',
    shape !== null && shape.colsTop !== null && shape.colsTop <= 5,
    String(shape && shape.colsTop),
  )
  check(
    'the trigger names provider and model, as in B',
    shape !== null &&
      shape.triggerParts !== null &&
      shape.triggerParts.provider === 'Provider 0' &&
      shape.triggerParts.slash === '/' &&
      shape.triggerParts.model === 'p0 model 0',
    JSON.stringify(shape && shape.triggerParts),
  )
  check('the long provider has a row', shape !== null && shape.providerRows === 6, String(shape && shape.providerRows))
  check('the model column lists the long provider', shape !== null && shape.modelRows === 60, String(shape && shape.modelRows))
  check(
    'the root carries the build marker',
    shape !== null && shape.rootBuild === VERSION + '+merge',
    String(shape && shape.rootBuild) + ' vs ' + VERSION + '+merge',
  )

  // A screenshot of the state the user sees, and — with --dump — the card's own
  // box next to each child's, so a "blank band" complaint has numbers behind it.
  await shot('01-columns-card')
  if (DUMP) {
    const geometry = await evaluate(
      '(() => {\n' +
        '  var el = document.querySelector(' + CARD_Q + ')\n' +
        '  if (el === null) return null\n' +
        '  var card = el.getBoundingClientRect()\n' +
        '  var style = getComputedStyle(el)\n' +
        '  var kids = Array.from(el.children).map(function (node) {\n' +
        '    var box = node.getBoundingClientRect()\n' +
        '    return {\n' +
        '      cls: node.className,\n' +
        '      attrs: Array.from(node.attributes).map(function (a) { return a.name }).join(","),\n' +
        '      top: Math.round(box.top - card.top),\n' +
        '      height: Math.round(box.height),\n' +
        '      width: Math.round(box.width),\n' +
        '      text: (node.textContent || "").slice(0, 40)\n' +
        '    }\n' +
        '  })\n' +
        '  var first = kids.length === 0 ? null : kids[0]\n' +
        '  var last = kids.length === 0 ? null : kids[kids.length - 1]\n' +
        '  return {\n' +
        '    card: { height: Math.round(card.height), width: Math.round(card.width), top: Math.round(card.top) },\n' +
        '    padding: style.padding,\n' +
        '    justifyContent: style.justifyContent,\n' +
        '    gapTop: first === null ? null : first.top,\n' +
        '    gapBottom: last === null ? null : Math.round(card.height - (last.top + last.height)),\n' +
        '    kids: kids\n' +
        '  }\n' +
        '})()',
    )
    report = { geometry }
    console.log(JSON.stringify({ geometry }, null, 2))
  }

  // ═══ 2. the pointer held still over a provider with sixty models ═══════════
  const hoverRow = (index) =>
    evaluate(
      '(() => {\n' +
        '  var rows = Array.from(document.querySelectorAll(".ms-col[data-col=\\"providers\\"] .ms-row"))\n' +
        '  var el = rows[' + index + ']\n' +
        '  if (el === undefined) return null\n' +
        '  var box = el.getBoundingClientRect()\n' +
        '  return { x: box.left + box.width / 2, y: box.top + box.height / 2, label: el.textContent.trim() }\n' +
        '})()',
    )

  const longRow = await hoverRow(0)
  check('the long provider row is addressable', longRow !== null)
  await moveTo(longRow)
  const still = await record('still over 60 models', DWELL)
  check('no height change while the pointer is still', still.changes === 0, JSON.stringify(still.distinctHeights))
  check(
    'the sixty models scroll inside their column',
    typeof still.modelsScroll === 'string' && Number(still.modelsScroll.split('/')[0]) > Number(still.modelsScroll.split('/')[1]),
    String(still.modelsScroll),
  )

  const otherRow = await hoverRow(1)
  if (otherRow !== null) {
    await moveTo(otherRow)
    await sleep(150)
    await moveTo(longRow)
  }
  const swapped = await record('after swapping providers twice', DWELL)
  check('no height change after provider swaps', swapped.changes === 0, JSON.stringify(swapped.distinctHeights))
  check('the frame is identical before and after the swaps', still.height === swapped.height, still.height + ' vs ' + swapped.height)

  // ═══ 3. close and reopen: the frozen frame is deterministic ════════════════
  await key('Escape', 'Escape', 27)
  await sleep(200)
  check('Escape closes the card', (await evaluate('document.querySelector(' + CARD_Q + ') === null')))
  await clickAt(await centerOf(TRIGGER))
  await sleep(250)
  const reopened = await record('reopened', 400)
  check('the reopened card is the same size', reopened.height === shape.height, reopened.height + ' vs ' + shape.height)

  // ═══ 4. a query searches every provider, not just the visible column ═══════
  const search = await centerOf('.ms-search')
  check('the model pane offers a search box', search !== null)
  if (search !== null) {
    await clickAt(search)
    await send('Input.insertText', { text: 'p3' }, session)
    await sleep(250)
  }
  const filtered = await evaluate(
    '(() => {\n' +
      '  var el = document.querySelector(' + CARD_Q + ')\n' +
      '  var rows = Array.from(document.querySelectorAll(".ms-col[data-col=\\"models\\"] .ms-row"))\n' +
      '  return {\n' +
      '    layout: el === null ? null : el.getAttribute("data-layout"),\n' +
      '    height: el === null ? null : Math.round(el.getBoundingClientRect().height * 10) / 10,\n' +
      '    labels: rows.map(function (row) { return row.textContent.trim() }),\n' +
      '    notes: rows.map(function (row) { var n = row.querySelector(".ms-rowNote"); return n === null ? null : n.textContent })\n' +
      '  }\n' +
      '})()',
  )
  check('a query keeps the two-column layout (no resize while typing)', filtered.layout === 'columns', String(filtered.layout))
  check('the query reaches models outside the visible column', filtered.labels.length === 3, JSON.stringify(filtered.labels))
  check('every cross-provider row names its provider', filtered.notes.every((note) => note === 'Provider 3'), JSON.stringify(filtered.notes))
  check('the card keeps one height across layouts', filtered.height === shape.height, filtered.height + ' vs ' + shape.height)

  // A query that matches nothing must leave one quiet line of copy in the model
  // column — padded and dimmed, not flush against the column head, and not an
  // empty white box.
  await evaluate('document.querySelector(".ms-search").select()')
  await send('Input.insertText', { text: 'zzz-no-such-model' }, session)
  await sleep(250)
  const emptyState = await evaluate(
    '(() => {\n' +
      '  var note = document.querySelector(".ms-col[data-col=\\"models\\"] .ms-empty")\n' +
      '  var rows = document.querySelectorAll(".ms-col[data-col=\\"models\\"] .ms-row").length\n' +
      '  if (note === null) return { found: false, rows: rows }\n' +
      '  var style = getComputedStyle(note)\n' +
      '  return { found: true, rows: rows, text: note.textContent, padTop: style.paddingTop, fontSize: style.fontSize }\n' +
      '})()',
  )
  check(
    'a query with no match leaves one line of copy',
    emptyState.found === true && emptyState.rows === 0,
    JSON.stringify(emptyState),
  )
  check(
    'the empty line is padded and dimmed, not flush',
    emptyState.found === true && emptyState.padTop === '8px' && emptyState.fontSize === '12px',
    JSON.stringify(emptyState),
  )
  await shot('03-empty-query')
  // Back to a query with results for the pick that follows.
  await evaluate('document.querySelector(".ms-search").select()')
  await send('Input.insertText', { text: 'p3' }, session)
  await sleep(250)

  const firstResult = await centerOf('.ms-col[data-col="models"] .ms-row')
  if (firstResult !== null) {
    await clickAt(firstResult)
    await sleep(250)
  }
  const picked = await evaluate('window.__selections ?? []')
  check(
    'clicking a search result submits the selection',
    Array.isArray(picked) && picked.length === 1 && picked[0].provider === 'prov-3' && picked[0].model === 'p3-0',
    JSON.stringify(picked),
  )
  check('the card closes after the pick', await evaluate('document.querySelector(' + CARD_Q + ') === null'))

  // ═══ 5. the thinking pane: slider, keyboard, fast toggle, long-press lock ══
  await clickAt(await centerOf(EFFORT_TRIGGER))
  await sleep(250)
  const effort = await evaluate(
    '(() => {\n' +
      '  var el = document.querySelector(' + CARD_Q + ')\n' +
      '  var slider = document.querySelector(".gptm-slider")\n' +
      '  return {\n' +
      '    layout: el === null ? null : el.getAttribute("data-layout"),\n' +
      '    slider: slider !== null,\n' +
      '    min: slider === null ? null : slider.getAttribute("aria-valuemin"),\n' +
      '    max: slider === null ? null : slider.getAttribute("aria-valuemax"),\n' +
      '    now: slider === null ? null : slider.getAttribute("aria-valuenow"),\n' +
      '    text: slider === null ? null : slider.getAttribute("aria-valuetext"),\n' +
      '    ticks: document.querySelectorAll(".gptm-ticks > *").length,\n' +
      '    fastToggle: document.querySelector(".gptm-fastToggle") !== null,\n' +
      '    panes: Array.from(document.querySelectorAll(".gptm-hint")).length\n' +
      '  }\n' +
      '})()',
  )
  check('the effort trigger opens the thinking pane', effort.slider === true, JSON.stringify(effort))
  check('the slider spans the three reasoning levels', effort.max === '2' && effort.now === '1', JSON.stringify([effort.max, effort.now]))
  check('the slider shows a tick per level', effort.ticks >= 3, String(effort.ticks))
  check('the fast toggle is present', effort.fastToggle === true)
  await shot('02-thinking-pane')

  const sliderFocused = await evaluate(
    '(function () {\n' +
      '  var el = document.querySelector(".gptm-slider")\n' +
      '  if (el === null) return false\n' +
      '  el.focus()\n' +
      '  return document.activeElement === el\n' +
      '})()',
  )
  check('the slider takes focus', sliderFocused === true)
  await key('ArrowRight', 'ArrowRight', 39)
  await sleep(200)
  const afterKey = await evaluate(
    '(() => ({\n' +
      '  now: document.querySelector(".gptm-slider").getAttribute("aria-valuenow"),\n' +
      '  text: document.querySelector(".gptm-slider").getAttribute("aria-valuetext"),\n' +
      '  selections: window.__selections ?? []\n' +
      '}))()',
  )
  check('ArrowRight raises the level', afterKey.now === '2', String(afterKey.now))
  check(
    'the keyboard submits the new effort',
    afterKey.selections.length === 2 && afterKey.selections[1].reasoningEffort === 'high',
    JSON.stringify(afterKey.selections),
  )

  // Every probe below is written so a missing node reports a failed check with
  // the state it found, instead of throwing and taking the rest of the run down.
  // Selecting the top level flashes the quota hint for 1.35 s, and while it is
  // up the head collapses its icon buttons (A's own behaviour). Waiting it out
  // is part of the contract, not a workaround: the toggle has to come back.
  await sleep(1700)
  const headReady = await evaluate(
    '(() => {\n' +
      '  var head = document.querySelector(".gptm-head")\n' +
      '  var toggle = document.querySelector(".gptm-fastToggle")\n' +
      '  var box = toggle === null ? null : toggle.getBoundingClientRect()\n' +
      '  var top = box === null ? null : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)\n' +
      '  return {\n' +
      '    quota: head === null ? null : head.getAttribute("data-quota"),\n' +
      '    toggle: toggle !== null,\n' +
      '    topmost: top !== null && (top === toggle || toggle.contains(top))\n' +
      '  }\n' +
      '})()',
  )
  check('the quota hint clears and the head folds back', headReady.quota === 'false' && headReady.toggle === true, JSON.stringify(headReady))
  check('the fast toggle is the topmost node at its own centre', headReady.topmost === true, JSON.stringify(headReady))

  const fastPoint = await centerOf('.gptm-fastToggle')
  check('the fast toggle is addressable', fastPoint !== null)
  if (fastPoint !== null) {
    await clickAt(fastPoint)
    await sleep(250)
  }
  const fastOn = await evaluate(
    '(() => {\n' +
      '  var card = document.querySelector(' + CARD_Q + ')\n' +
      '  var toggle = document.querySelector(".gptm-fastToggle")\n' +
      '  var raw = localStorage.getItem("dsh-client-ui-model-seat:fast:v1")\n' +
      '  return {\n' +
      '    open: card !== null,\n' +
      '    layout: card === null ? null : card.getAttribute("data-layout"),\n' +
      '    menu: card === null ? null : card.getAttribute("data-fast"),\n' +
      '    pressed: toggle === null ? null : toggle.getAttribute("aria-pressed"),\n' +
      '    stored: raw === null ? null : JSON.parse(raw)\n' +
      '  }\n' +
      '})()',
  )
  check('a click turns fast mode on', fastOn.menu === 'true' && fastOn.pressed === 'true', JSON.stringify(fastOn))
  check('fast mode is persisted under the new key', fastOn.stored !== null && fastOn.stored.fast === true, JSON.stringify(fastOn.stored))

  // Holding the button is the lock; a click is not.
  const holdPoint = await centerOf('.gptm-fastToggle')
  check('the fast toggle stays on screen after the click', holdPoint !== null, JSON.stringify(fastOn))
  if (holdPoint !== null) {
    await moveTo(holdPoint)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: holdPoint.x, y: holdPoint.y, button: 'left', buttons: 1, clickCount: 1 }, session)
    await sleep(700)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: holdPoint.x, y: holdPoint.y, button: 'left', buttons: 0, clickCount: 1 }, session)
    await sleep(300)
  }
  const locked = await evaluate(
    '(() => {\n' +
      '  var trigger = document.querySelector(' + JSON.stringify(EFFORT_TRIGGER) + ')\n' +
      '  var card = document.querySelector(' + CARD_Q + ')\n' +
      '  var raw = localStorage.getItem("dsh-client-ui-model-seat:fast:v1")\n' +
      '  return {\n' +
      '    trigger: trigger === null ? null : trigger.getAttribute("data-locked"),\n' +
      '    menu: card === null ? null : card.getAttribute("data-locked"),\n' +
      '    stored: raw === null ? null : JSON.parse(raw)\n' +
      '  }\n' +
      '})()',
  )
  check('holding the fast toggle locks it', locked.trigger === 'true' && locked.menu === 'true', JSON.stringify(locked))
  check('the lock is persisted too', locked.stored !== null && locked.stored.locked === true, JSON.stringify(locked.stored))

  // Holding again releases the lock, and the level stays where it was.
  const releasePoint = await centerOf('.gptm-fastToggle')
  if (releasePoint !== null) {
    await moveTo(releasePoint)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: releasePoint.x, y: releasePoint.y, button: 'left', buttons: 1, clickCount: 1 }, session)
    await sleep(700)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: releasePoint.x, y: releasePoint.y, button: 'left', buttons: 0, clickCount: 1 }, session)
    await sleep(300)
  }
  const unlocked = await evaluate(
    '(() => {\n' +
      '  var card = document.querySelector(' + CARD_Q + ')\n' +
      '  var raw = localStorage.getItem("dsh-client-ui-model-seat:fast:v1")\n' +
      '  return { open: card !== null, stored: raw === null ? null : JSON.parse(raw) }\n' +
      '})()',
  )
  check('holding again releases the lock', unlocked.stored !== null && unlocked.stored.locked === false, JSON.stringify(unlocked))

  // ═══ 6. the thinking pane's head switches back to the model columns ════════
  await key('Escape', 'Escape', 27)
  await sleep(150)
  await clickAt(await centerOf(EFFORT_TRIGGER))
  await sleep(250)
  await clickAt(await centerOf('.gptm-status'))
  await sleep(250)
  const back = await evaluate(
    'document.querySelector(".ms-cols") !== null && document.querySelector(".ms-search") !== null',
  )
  check('the head status button returns to the model columns', back === true)

  // ═══ 7. the colour panel hotkey ════════════════════════════════════════════
  await key('G', 'KeyG', 71, 11)
  await sleep(250)
  const panelOpen = await evaluate('document.querySelector("[data-model-seat=\\"config-panel\\"]") !== null')
  check('Ctrl+Shift+Alt+G opens the colour panel', panelOpen === true)
  const panelBits = await evaluate(
    '(() => ({\n' +
      '  swatches: document.querySelectorAll(".gptm-configSide, .gptm-configLib").length,\n' +
      '  hotkey: (document.querySelector(".gptm-configInput") || {}).value ?? null\n' +
      '}))()',
  )
  check('the colour panel lists colour sides', panelBits.swatches > 0, String(panelBits.swatches))
  await key('G', 'KeyG', 71, 11)
  await sleep(250)
  check('the hotkey closes it again', (await evaluate('document.querySelector("[data-model-seat=\\"config-panel\\"]") === null')))

  // ═══ 8. nothing the seat did leaked a console error ════════════════════════
  const consoleErrors = await evaluate('(window.__errors ?? []).length')
  check('the seat logged no errors', consoleErrors === 0, String(consoleErrors))

  report = {
    stage,
    origin,
    viewport: '1200x900',
    dwellMs: DWELL,
    shape,
    still,
    swapped,
    reopened: { height: reopened.height, changes: reopened.changes },
    filtered,
    selections: await evaluate('window.__selections ?? []'),
    fast: { on: fastOn, locked, unlocked },
    problems,
    shots,
  }
  } catch (error) {
    problems.push('the check script threw: ' + (error && error.message ? error.message : String(error)))
  } finally {
    console.log(JSON.stringify(report === null ? { problems } : report, null, 2))
    await send('Target.closeTarget', { targetId }).catch(() => {})
    ws.close()
    if (browser !== null) browser.kill()
    server.close()
    // Leave nothing behind: the staged page and the throwaway browser profile
    // are both ours, and a few hundred of them pile up in %TEMP% over a week.
    for (const dir of [stage, browserProfile]) {
      if (dir === null) continue
      await sleep(300)
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      } catch {
        // A locked file in the browser profile is not worth failing the run.
      }
    }
  }
  process.exitCode = problems.length === 0 ? 0 : 1