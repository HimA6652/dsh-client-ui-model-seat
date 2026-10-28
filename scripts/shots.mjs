#!/usr/bin/env node
/**
 * Storefront screenshots for the market listing.
 *
 * Renders the real bundle in the harness over a realistic provider set
 * (test/harness/harness.js?demo=1) and clips the PNG to the card plus its
 * trigger, at 2x, so the listing shows the control and nothing else.
 *
 * Usage: node scripts/shots.mjs [--vendor DIR] [--browser PATH] [--port 9334]
 *                               [--scale 2] [--out assets] [--scheme dark|light]
 *   --scheme  which theme the shots are taken in (default dark). The bundle emits
 *             its tokens inside @media (prefers-color-scheme: dark), so a headless
 *             browser left on the default "light" paints the light-theme greys on
 *             the dark page — the reason the trigger once looked washed out here.
 * Writes screenshot-1.png (columns), screenshot-2.png (search across
 * providers), screenshot-3.png (thinking pane) and prints their sizes.
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

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const VENDOR = flag('vendor', process.env.REACT_VENDOR ?? join(ROOT, 'test', 'vendor'))
const BROWSER = flag('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
const PORT = Number(flag('port', '9334'))
const SCALE = Number(flag('scale', '2'))
const OUT = resolve(ROOT, flag('out', 'assets'))
const SCHEME = flag('scheme', 'dark') === 'light' ? 'light' : 'dark'

if (!existsSync(join(VENDOR, 'react.js')) || !existsSync(join(VENDOR, 'react-dom.js'))) {
  console.error('shots: no react vendor in ' + VENDOR)
  process.exit(2)
}

// ── stage the page ─────────────────────────────────────────────────────────
const stage = mkdtempSync(join(tmpdir(), 'model-seat-shots-'))
for (const [from, to] of [
  [join(HARNESS, 'index.html'), 'index.html'],
  [join(HARNESS, 'harness.js'), 'harness.js'],
  [join(ROOT, 'lib', 'client.js'), 'client.js'],
  [join(VENDOR, 'react.js'), 'react.js'],
  [join(VENDOR, 'react-dom.js'), 'react-dom.js'],
]) copyFileSync(from, join(stage, to))

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

// ── browser ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const versionAt = async (port) => {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/json/version')
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
let browser = null
let browserProfile = null
let version = await versionAt(PORT)
if (version === null) {
  if (!existsSync(BROWSER)) {
    console.error('shots: no browser at ' + BROWSER)
    process.exit(2)
  }
  const profile = mkdtempSync(join(tmpdir(), 'model-seat-shots-profile-'))
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
  for (let i = 0; i < 120 && version === null; i++) {
    await sleep(100)
    version = await versionAt(PORT)
  }
  if (version === null) {
    console.error('shots: browser never opened port ' + PORT)
    process.exit(2)
  }
}

// ── CDP ────────────────────────────────────────────────────────────────────
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
  return new Promise((ok, fail) => pending.set(id, { resolve: ok, reject: fail }))
}

const written = []
mkdirSync(OUT, { recursive: true })
try {
  const created = await send('Target.createTarget', { url: 'about:blank' })
  const session = (await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })).sessionId
  await send('Page.enable', {}, session)
  await send('Runtime.enable', {}, session)
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false }, session)
  // The page must be read in the theme whose tokens it renders with.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: SCHEME }] }, session)

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
    if (result.exceptionDetails !== undefined) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300))
    return result.result.value
  }
  const click = async (selector) => {
    const box = await evaluate(
      '(() => { var el = document.querySelector(' + JSON.stringify(selector) + '); if (el === null) return null;' +
        ' var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()',
    )
    if (box === null) throw new Error('missing ' + selector)
    const point = { x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 }, session)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point }, session)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, buttons: 0 }, session)
  }
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression).catch(() => false)) return true
      await sleep(50)
    }
    throw new Error('timed out waiting for ' + label)
  }
  const shoot = async (selectors, file) => {
    const list = Array.isArray(selectors) ? selectors : [selectors]
    const box = await evaluate(
      '(() => { var list = ' + JSON.stringify(list) + '; var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;' +
        ' for (var i = 0; i < list.length; i++) { var el = document.querySelector(list[i]); if (el === null) continue;' +
        ' var r = el.getBoundingClientRect(); left = Math.min(left, r.left); top = Math.min(top, r.top);' +
        ' right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom) }' +
        ' if (left === Infinity) return null;' +
        ' return { x: left, y: top, width: right - left, height: bottom - top } })()',
    )
    if (box === null) throw new Error('missing ' + list.join(' '))
    const pad = 16
    const clip = {
      x: Math.max(0, Math.round(box.x - pad)),
      y: Math.max(0, Math.round(box.y - pad)),
      width: Math.round(box.width + pad * 2),
      height: Math.round(box.height + pad * 2),
      scale: SCALE,
    }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }, session)
    const target = join(OUT, file)
    writeFileSync(target, Buffer.from(shot.data, 'base64'))
    const bytes = readFileSync(target)
    written.push({ file, width: clip.width * SCALE, height: clip.height * SCALE, bytes: bytes.length })
  }

  const navigate = async () => {
    await send('Page.navigate', { url: origin + '/index.html?demo=1&current=4' }, session)
    await waitFor('window.__ready === true', 'harness')
    // The canvas, not the card: on the harness's own #0f1115 the card edge and
    // its shadow disappear, and a storefront thumbnail turns into a black square.
    // A one step lighter surface keeps every colour the app itself would paint.
    const canvas = SCHEME === 'light' ? '#f6f7f9' : '#1a1d22'
    const transcript = SCHEME === 'light' ? '#d8dbe0' : '#4b5058'
    await evaluate(
      '(() => { document.body.style.background = ' + JSON.stringify(canvas) + ';' +
        ' document.getElementById("transcript").style.color = ' + JSON.stringify(transcript) + ' })()',
    )
  }

  // 1 — the two-column card, a provider with enough models to scroll.
  await navigate()
  await click('[data-model-seat="model-trigger"]')
  await waitFor('document.querySelector("[data-model-seat=menu]") !== null', 'card')
  await click('[data-model-seat="menu"] [data-col="providers"] .ms-row:nth-child(5)')
  await sleep(300)
  await shoot(['[data-model-seat="menu"]', '[data-model-seat="model-trigger"]'], 'screenshot-1.png')

  // 2 — search that reaches every provider, card geometry unchanged.
  const typed = await evaluate(
    '(() => { var el = document.querySelector("[data-model-seat=menu] .ms-search");' +
      ' if (el === null) return false;' +
      ' var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;' +
      ' set.call(el, "qwen"); el.dispatchEvent(new Event("input", { bubbles: true })); return true })()',
  )
  if (typed !== true) throw new Error('search input not found')
  await sleep(300)
  await shoot(['[data-model-seat="menu"]', '[data-model-seat="model-trigger"]'], 'screenshot-2.png')

  // 3 — the thinking pane: the particle slider and its status head.
  await navigate()
  await click('[data-model-seat="effort-trigger"]')
  await waitFor('document.querySelector("[data-model-seat=menu] .gptm-slider") !== null', 'thinking pane')
  await sleep(300)
  await shoot('[data-model-seat="menu"]', 'screenshot-3.png')
} finally {
  try {
    ws.close()
  } catch {}
  if (browser !== null) browser.kill()
  server.close()
  await sleep(150)
  if (browserProfile !== null) rmSync(browserProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  rmSync(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

console.log(JSON.stringify({ out: OUT, shots: written }, null, 1))
