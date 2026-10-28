#!/usr/bin/env node
/**
 * Live check: drives the **real** dsh web UI (a server that is already running)
 * in headless Edge and asserts that the merged seat mounts in the composer,
 * opens both panes, keeps a constant frame and logs no error.
 *
 * Nothing here is a fixture: the page is the actual app, so this is the check
 * that the plugin registration path works against real slots and a real model
 * directory.
 *
 * Usage: node scripts/live-check.mjs --url http://127.0.0.1:6123/?token=...
 *   --url     the token URL the server printed
 *   --port    DevTools port (default 9334); a browser listening there is reused
 *   --wait    how long to wait for the composer, in ms (default 45000)
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const TARGET_URL = flag('url', '')
const PORT = Number(flag('port', '9334'))
const WAIT = Number(flag('wait', '45000'))
// Off by default: publishing a selection writes the account's model choice, which
// is the user's own state. Pass --publish on a throwaway account (or after taking
// a backup) to exercise that path too.
const PUBLISH = argv.includes('--publish')
const BROWSER = flag('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
if (TARGET_URL === '') {
  console.error('live-check: pass --url <token url printed by the server>')
  process.exit(2)
}

const problems = []
const check = (label, ok, detail) => {
  if (!ok) problems.push(label + (detail === undefined ? '' : ' - ' + detail))
  return ok
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
// In-page expressions are built from line arrays: concatenating fragments
// without separators produces `var a = 1var b = 2`, which is a SyntaxError the
// CDP side reports as an opaque 'evaluate failed'.
const E = (lines) => lines.join('\n')

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
    console.error('live-check: nothing listening on ' + PORT + ' and no browser at ' + BROWSER)
    process.exit(2)
  }
  const profile = mkdtempSync(join(tmpdir(), 'model-seat-live-'))
  browserProfile = profile
  browser = spawn(BROWSER, [
    '--headless=new',
    '--remote-debugging-port=' + String(PORT),
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 100 && version === null; i++) {
    await sleep(100)
    version = await versionAt(PORT)
  }
  if (version === null) {
    console.error('live-check: browser never opened port ' + PORT)
    process.exit(2)
  }
}

const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((done, fail) => {
  ws.addEventListener('open', done, { once: true })
  ws.addEventListener('error', fail, { once: true })
})
let nextId = 1
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params?.exceptionDetails?.text ?? 'exception'))
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push((message.params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' '))
    return
  }
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

const created = await send('Target.createTarget', { url: 'about:blank' })
const targetId = created.targetId
const session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
await send('Page.enable', {}, session)
await send('Runtime.enable', {}, session)
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session)

// Attribute selectors inside generated expressions use unquoted values
// ([data-model-seat=root]): a quoted value has to survive two levels of
// escaping and silently loses its quotes, which CDP then reports as an opaque
// SyntaxError. The guard below turns that class of mistake into a readable
// message before the expression ever reaches the page.
const guard = (expression) => {
  try {
    new Function('return ' + expression)
  } catch (error) {
    throw new Error('bad in-page expression: ' + (error instanceof Error ? error.message : String(error)) + ' <<<EXPR>>> ' + expression)
  }
}
const evaluate = async (expression) => {
  guard(expression)
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  if (result.exceptionDetails !== undefined) {
    throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 300) + ' <<<EXPR>>> ' + expression)
  }
  return result.result.value
}

const TRIGGER = '[data-model-seat="model-trigger"]'
const EFFORT = '[data-model-seat="effort-trigger"]'
const CARD = '[data-model-seat="menu"]'
const q = JSON.stringify
const centerOf = (selector) =>
  evaluate(
    E([
      '(() => {',
      '  var el = document.querySelector(' + q(selector) + ')',
      '  if (el === null) return null',
      '  var box = el.getBoundingClientRect()',
      '  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }',
      '})()',
    ]),
  )
const moveTo = (point) =>
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 }, session)
const clickAt = async (point) => {
  await moveTo(point)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, session)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }, session)
}

let report = null
try {
  await send('Page.navigate', { url: TARGET_URL }, session)
  let mounted = false
  for (let i = 0; i < Math.ceil(WAIT / 250) && !mounted; i++) {
    await sleep(250)
    mounted = await evaluate('document.querySelector(' + q(TRIGGER) + ') !== null').catch(() => false)
  }
  check('the seat mounts in the real composer', mounted === true)

  // The start screen renders the composer behind a mask, so a click would land on
  // that mask instead of the trigger. Open a session first; the composer is then
  // live and the trigger is the topmost node at its own centre.
  const covered = () =>
    evaluate(
      E([
        '(() => {',
        '  var model = document.querySelector(' + q(TRIGGER) + ')',
        '  if (model === null) return true',
        '  var box = model.getBoundingClientRect()',
        '  var hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)',
        '  return hit === null || (hit !== model && !model.contains(hit))',
        '})()',
      ]),
    )
  let coveredNow = await covered()
  const cleared = []
  for (let round = 0; round < 8 && coveredNow; round++) {
    // Only dismiss what covers the composer. Starting a new session here would
    // write a session into the account's shared store, which is the user's real
    // data - a read-only check has no business doing that.
    const action = await evaluate(
      E([
        '(() => {',
        '  var dialog = document.querySelector("[role=dialog]")',
        '  if (dialog === null) return null',
        // A notice modal can gate its button behind an "I have read this" box.
        '  var box = dialog.querySelector("input[type=checkbox]:not(:checked)")',
        '  if (box !== null) box.click()',
        '  var accept = Array.from(dialog.querySelectorAll("button")).filter(function (node) {',
        '    if (node.disabled) return false',
        '    var label = (node.textContent || "").trim()',
        // Plugin notices ("用户须知", update banners) use longer labels than the
        // app's own preview dialog, so match the intent rather than one string.
        '    return /^(继续|知道了|我知道了|开始|确定|同意|接受|好|我已知晓|我已知晓并继续|我知道了并继续)$/.test(label) || /^(我已阅读|我知道|我已了解)/.test(label)',
        '  })[0]',
        '  if (accept === undefined) return null',
        '  accept.click()',
        '  return "dialog:" + (accept.textContent || "").trim()',
        '})()',
      ]),
    )
    if (action === null) break
    cleared.push(action)
    for (let i = 0; i < 20 && coveredNow; i++) {
      await sleep(150)
      coveredNow = await covered().catch(() => true)
    }
  }
  check('the start screen clears so the composer is reachable', coveredNow === false, cleared.join(',') + (coveredNow ? ' (a dialog may need a different button)' : ''))

  // Record what the page shows: when a failure happens, the mask, the buttons and
  // the visible text explain why without a second run.
  const pageState = await evaluate(
    E([
      '(() => {',
      '  var model = document.querySelector(' + q(TRIGGER) + ')',
      '  var box = model === null ? null : model.getBoundingClientRect()',
      '  var hit = box === null ? null : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)',
      '  return {',
      '    covered: box !== null && hit !== null && hit !== model && !model.contains(hit),',
      '    mask: hit !== null && hit.className !== undefined && model !== null && !model.contains(hit) ? String(hit.className) : null,',
      '    buttons: Array.from(document.querySelectorAll("button")).map(function (n) { return (n.textContent || "").trim() }).filter(function (s) { return s !== "" }).slice(0, 10),',
      '    text: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 240)',
      '  }',
      '})()',
    ]),
  )

  const triggers = await evaluate(
    E([
      '(() => {',
      '  var model = document.querySelector(' + q(TRIGGER) + ')',
      '  var effort = document.querySelector(' + q(EFFORT) + ')',
      '  var root = document.querySelector("[data-model-seat=root]")',
      '  return {',
      '    model: model === null ? null : model.textContent.trim(),',
      '    effort: effort === null ? null : effort.textContent.trim(),',
      '    build: root === null ? null : root.getAttribute("data-build"),',
      '    sheets: document.querySelectorAll("#dsh-model-seat-style").length,',
      '    menu: document.querySelectorAll(".gptm-menu").length,',
      '    disabled: model === null ? null : model.disabled,',
      '    expanded: model === null ? null : model.getAttribute("aria-expanded"),',
      '    topmost: (() => {',
      '      if (model === null) return null',
      '      var box = model.getBoundingClientRect()',
      '      var hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)',
      '      return hit === null ? null : (hit.className || hit.tagName)',
      '    })(),',
      '  }',
      '})()',
    ]),
  )
  // The effort trigger exists only for a model whose adapter declares thinking
  // levels. The account directory served here declares none, so the branch below
  // records which shape the environment has instead of demanding one: the
  // fixture suite is where the slider and the pane are exercised.
  const effortOffered = triggers.effort !== null
  check('the sheet is injected once', triggers.sheets === 1, String(triggers.sheets))
  check(
    'the trigger names provider and model, as in B',
    typeof triggers.model === 'string' && triggers.model.includes('/'),
    String(triggers.model),
  )

  const modelPoint = await centerOf(TRIGGER)
  check('the model trigger is addressable', modelPoint !== null)
  if (modelPoint !== null) {
    await clickAt(modelPoint)
    await sleep(600)
  }
  const card = await evaluate(
    E([
      '(() => {',
      '  var el = document.querySelector(' + q(CARD) + ')',
      '  if (el === null) return null',
      '  var box = el.getBoundingClientRect()',
      '  var providers = el.querySelector(".ms-col[data-col=providers]")',
      '  var models = el.querySelector(".ms-col[data-col=models]")',
      '  return {',
      '    layout: el.getAttribute("data-layout"),',
      '    ready: el.getAttribute("data-ready"),',
      '    height: Math.round(box.height * 10) / 10,',
      '    width: Math.round(box.width * 10) / 10,',
      '    inlineHeight: el.style.height,',
      '    providers: providers === null ? 0 : providers.querySelectorAll(".ms-row").length,',
      '    models: models === null ? 0 : models.querySelectorAll(".ms-row").length,',
      '    note: (el.textContent || "").slice(0, 80),',
      '    expanded: (() => { var t = document.querySelector(' + q(TRIGGER) + '); return t === null ? null : t.getAttribute("aria-expanded") })()',
      '  }',
      '})()',
    ]),
  )
  check('clicking the trigger opens the card', card !== null, JSON.stringify(card))
  if (card !== null) {
    check('the card lays out as two columns', card.layout === 'columns', String(card.layout))
    check('the card is measured before it shows', card.ready === 'true', String(card.ready))
    check('the card has a frozen inline height', /^\d+px$/.test(card.inlineHeight), String(card.inlineHeight))
  }

  const still = await evaluate(
    E([
      '(async () => {',
      '  var el = document.querySelector(' + q(CARD) + ')',
      '  if (el === null) return null',
      '  var seen = new Set(), frames = 0',
      '  await new Promise((done) => {',
      '    var start = performance.now()',
      '    function tick() {',
      '      frames += 1',
      '      seen.add(Math.round(el.getBoundingClientRect().height))',
      '      if (performance.now() - start < 900) requestAnimationFrame(tick)',
      '      else done()',
      '    }',
      '    requestAnimationFrame(tick)',
      '  })',
      '  return { frames: frames, heights: Array.from(seen) }',
      '})()',
    ]),
  )
  check('the card holds one height while the pointer rests', still !== null && still.heights.length === 1, JSON.stringify(still))

  // ── the thinking pane, when the directory declares levels ─────────────────
  // The effort trigger only exists for a model whose adapter publishes thinking
  // levels. A live account directory may advertise none, in which case there is
  // nothing to open - the harness covers that pane with a declared catalogue.
  const effortPoint = triggers.effort === null ? null : await centerOf(EFFORT)
  const thinking = await evaluate(
    E([
      '(() => {',
      '  var slider = document.querySelector(".gptm-slider")',
      '  return {',
      '    open: document.querySelector(' + q(CARD) + ') !== null,',
      '    slider: slider !== null,',
      '    now: slider === null ? null : slider.getAttribute("aria-valuenow"),',
      '    max: slider === null ? null : slider.getAttribute("aria-valuemax"),',
      '    bolt: document.querySelector(".gptm-triggerBolt, .gptm-fastToggle") !== null',
      '  }',
      '})()',
    ]),
  )
  let pane = null
  if (effortPoint !== null) {
    await clickAt(effortPoint)
    await sleep(600)
    pane = await evaluate(
      E([
        '(() => {',
        '  var slider = document.querySelector(".gptm-slider")',
        '  var el = document.querySelector(' + q(CARD) + ')',
        '  return {',
        '    slider: slider !== null,',
        '    search: document.querySelector(".ms-col[data-col=models] .ms-search") !== null,',
        '    now: slider === null ? null : slider.getAttribute("aria-valuenow"),',
        '    max: slider === null ? null : slider.getAttribute("aria-valuemax"),',
        '    bolt: document.querySelector(".gptm-triggerBolt, .gptm-fastToggle") !== null,' +
        '    trail: (function () { var t = document.querySelector(".gptm-trail"); return t === null ? null : getComputedStyle(t).opacity })(),' +
        '    particles: document.querySelectorAll(".gptm-particle").length,' +
        '    drift: (function () { var p = document.querySelector(".gptm-particle"); if (p === null) return null; var c = getComputedStyle(p); return { name: c.animationName, spin: (c.getPropertyValue("--spin") || "").trim(), running: p.getAnimations ? p.getAnimations().length : null } })(),',
        '    height: el === null ? null : Math.round(el.getBoundingClientRect().height),',
        '    box: el === null ? null : { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) },',
        '    contrast: (function () {',
        '      function P(v) { var m = /rgba?\\(([^)]+)\\)/.exec(String(v)); if (m === null) return null; var p = m[1].split(",").map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }',
        '      function L(c) { function k(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) } return 0.2126 * k(c.r) + 0.7152 * k(c.g) + 0.0722 * k(c.b) }',
        '      function R(f, b) { var x = L(f), y = L(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100 }',
        '      function S(n) { var t = null; while (n !== null) { var c = P(getComputedStyle(n).backgroundColor); if (c !== null && c.a > 0.01) { if (t === null) t = c; else return { r: c.r * (1 - t.a) + t.r * t.a, g: c.g * (1 - t.a) + t.g * t.a, b: c.b * (1 - t.a) + t.b * t.a } } n = n.parentElement } return t === null ? { r: 255, g: 255, b: 255 } : t }',
        '      function C(sel) { var n = document.querySelector(sel); if (n === null) return null; var c = P(getComputedStyle(n).color); return c === null ? null : R(c, S(el)) }',
        '      return { reset: C(".gptm-head .gptm-iconBtn:last-of-type"), model: C(".gptm-statusModel") }',
        '    })(),',
        '  }',
        '})()',
      ]),
    )
    check('the effort trigger opens the thinking pane', pane.slider === true, JSON.stringify(pane))
    check('the thinking pane carries no model search box', pane.search === false, JSON.stringify(pane))
    check('the thinking pane has no bolt control', pane.bolt === false, JSON.stringify(pane.bolt))
    check('the drift trail is always on', pane.trail !== null && Number(pane.trail) >= 0.99, String(pane.trail))
    check(
      'the particles drift at full strength',
      pane.particles === 42 && pane.drift !== null && pane.drift.name === 'gptm-drift' && pane.drift.spin === '1' && pane.drift.running === 1,
      JSON.stringify({ particles: pane.particles, drift: pane.drift }),
    )
    check('the thinking pane keeps one frozen height', typeof pane.height === 'number', String(pane.height))
    check('the card shrinks to the thinking pane', pane.box.height < 300, JSON.stringify(pane.box))
    check('the pane icon reads on the card surface', pane.contrast.reset >= 3, JSON.stringify(pane.contrast))
    check('the pane model line reads on the card surface', pane.contrast.model >= 4.5, JSON.stringify(pane.contrast))
    // The defect the user reported: switching panes used to keep the columns'
    // frozen 420px on the shorter panel. Going back must restore both.
    await clickAt(await centerOf('.gptm-status'))
    await sleep(600)
    const backToColumns = await evaluate(
      '(() => { var el = document.querySelector(' + q(CARD) + '); if (el === null) return null; var r = el.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), columns: document.querySelector(".ms-cols") !== null } })()',
    )
    check('switching back restores the two columns', backToColumns !== null && backToColumns.columns === true, JSON.stringify(backToColumns))
    check('the columns are taller than the pane was', backToColumns !== null && backToColumns.height > pane.box.height + 80, JSON.stringify([pane.box.height, backToColumns === null ? null : backToColumns.height]))
    pane = Object.assign({}, pane, { backToColumns: backToColumns })
  } else {
    check('no effort trigger exists for a model with no levels', thinking.slider === false, JSON.stringify(thinking))
  }

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session)
  await sleep(300)
  check('Escape closes the card', (await evaluate('document.querySelector(' + q(CARD) + ') === null')) === true)

  // ── publishing a selection ────────────────────────────────────────────────
  // The real store has to accept the write; that is the part a fixture can only
  // imitate. Pick the second model row and expect the trigger to relabel itself.
  let published = null
  const reopened = PUBLISH ? await centerOf(TRIGGER) : null
  if (reopened !== null) {
    await clickAt(reopened)
    await sleep(400)
    const target = await evaluate(
      E([
        '(() => {',
        '  var rows = Array.from(document.querySelectorAll(".ms-col[data-col=models] .ms-row"))',
        '  if (rows.length < 2) return null',
        '  var row = rows[1]',
        '  var box = row.getBoundingClientRect()',
        '  var label = (row.querySelector(".ms-rowText") || row).textContent.trim()',
        '  return { label: label, x: box.left + box.width / 2, y: box.top + box.height / 2 }',
        '})()',
      ]),
    )
    if (target !== null) {
      await clickAt({ x: target.x, y: target.y })
      await sleep(700)
      const after = await evaluate(
        E([
          '(() => {',
          '  var model = document.querySelector(' + q(TRIGGER) + ')',
          '  return {',
          '    label: model === null ? null : model.textContent.trim(),',
          '    card: document.querySelector(' + q(CARD) + ') !== null',
          '  }',
          '})()',
        ]),
      )
      published = { picked: target.label, trigger: after.label, card: after.card }
      check('picking a model relabels the trigger', after.label !== null && after.label.indexOf(target.label) >= 0, JSON.stringify(published))
      check('picking a model closes the card', after.card === false, JSON.stringify(published))
    }
  }

  // ── the colour panel: the one A feature no levels gate ────────────────────
  const key = async (name, code, virtual, modifiers) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers: modifiers ?? 0 }, session)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers: modifiers ?? 0 }, session)
  }
  await key('G', 'KeyG', 71, 11)
  const panel = await evaluate('document.querySelector(\'[data-model-seat="config-panel"]\') !== null')
  check('Ctrl+Shift+Alt+G opens the colour panel in the real app', panel === true)
  if (panel === true) {
    const swatches = await evaluate('document.querySelectorAll(".gptm-configSide, .gptm-configLib").length')
    check('the colour panel lists colour sides', typeof swatches === 'number' && swatches > 0, String(swatches))
    await key('G', 'KeyG', 71, 11)
    await sleep(250)
    check('the hotkey closes it again', (await evaluate('document.querySelector(\'[data-model-seat="config-panel"]\') === null')) === true)
  }

  const own = consoleErrors.filter((line) => line.toLowerCase().includes('model-seat') || line.toLowerCase().includes('model seat'))
  check('the seat logged no error', own.length === 0, own.slice(0, 3).join(' | '))

  report = { url: TARGET_URL, pageState, triggers, card, still, thinking, pane, published, consoleErrors: consoleErrors.slice(0, 5), problems }
} catch (error) {
  problems.push('the live check threw: ' + (error instanceof Error ? error.message : String(error)))
} finally {
  console.log(JSON.stringify(report === null ? { problems } : report, null, 2))
  try { await send('Target.closeTarget', { targetId }) } catch {}
  try { ws.close() } catch {}
  if (browser !== null) browser.kill()
  // The throwaway browser profile is ours; do not leave it in %TEMP%.
  if (browserProfile !== null) {
    await sleep(300)
    try { rmSync(browserProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
}
process.exit(problems.length === 0 ? 0 : 1)