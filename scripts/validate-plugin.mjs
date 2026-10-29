#!/usr/bin/env node
/**
 * Contract checks for the published half of the plugin: the manifest the host
 * reads, the cordis patch, the entry module, and the browser bundle after it
 * has actually been loaded the way the app loads it.
 *
 * Everything here fails the process; run it before every hand-off.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, STYLE_ID, fakeSeatHost, loadBundle } from './lib/load-bundle.mjs'

const problems = []
const notes = []
const check = (label, ok, detail) => {
  if (ok) {
    notes.push('ok   ' + label)
  } else {
    problems.push('FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
  }
}
const json = (value) => JSON.stringify(value)
const same = (a, b) => json(a) === json(b)

// ── manifest ────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
check('package name', manifest.name === 'dsh-client-ui-model-seat', manifest.name)
check('version present', /^\d+\.\d+\.\d+/.test(manifest.version), manifest.version)
check('publishable (no private flag)', manifest.private === undefined, String(manifest.private))
check('license', manifest.license === 'MIT', String(manifest.license))
check('repository url', /^git\+https:\/\/github\.com\//.test(manifest.repository?.url ?? ''), String(manifest.repository?.url))
check('author', typeof manifest.author === 'string' && manifest.author.length > 0, String(manifest.author))
check('type module', manifest.type === 'module', manifest.type)
check('exports .', manifest.exports['.'] === './lib/index.js', manifest.exports['.'])
check('exports ./client', manifest.exports['./client'] === './lib/client.js', manifest.exports['./client'])
check('files is an array', Array.isArray(manifest.files))
for (const rel of manifest.files ?? []) {
  check('file exists: ' + rel, existsSync(join(ROOT, rel)))
}
check('dsh.client.platform', manifest.dsh?.client?.platform === 'web', json(manifest.dsh?.client?.platform))
check('dsh.client.immediately', manifest.dsh?.client?.immediately === true)
check(
  'dsh.client.inject',
  same(manifest.dsh?.client?.inject, [
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-model-selection',
  ]),
  json(manifest.dsh?.client?.inject),
)
check('dsh.bundle.patch', manifest.dsh?.bundle?.patch === './cordis.patch.yml', manifest.dsh?.bundle?.patch)
check('engines.dsh', typeof manifest.engines?.dsh === 'string', manifest.engines?.dsh)
check('no postinstall', manifest.scripts?.postinstall === undefined)

// ── storefront assets: the icon and the screenshots the market reads ───────
check('icon asset', existsSync(join(ROOT, 'assets', 'icon-180.png')))
let shots = null
try {
  shots = JSON.parse(readFileSync(join(ROOT, 'screenshots.json'), 'utf8'))
} catch {
  shots = null
}
const shotList = Array.isArray(shots) ? shots : Array.isArray(shots?.screenshots) ? shots.screenshots : null
check('screenshots.json', shotList !== null)
check('screenshots count', (shotList?.length ?? 0) >= 1 && (shotList?.length ?? 0) <= 8, String(shotList?.length))
for (const rel of shotList ?? []) {
  // The market forbids paths that leave the plugin directory.
  check('screenshot is relative: ' + rel, !rel.startsWith('/') && !rel.split('/').includes('..'), rel)
  check('screenshot exists: ' + rel, existsSync(join(ROOT, rel)))
}

// ── cordis patch ────────────────────────────────────────────────────────────
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
check('patch inserts', /- insert:/.test(patch))
check('patch row id', /^\s*-\s*id: model-seat$/m.test(patch))
check('patch row name', /^\s*name: dsh-client-ui-model-seat$/m.test(patch))

// ── node entry ──────────────────────────────────────────────────────────────
const entry = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
check('entry name', entry.name === manifest.name, entry.name)
check('entry apply', typeof entry.apply === 'function')
check('entry touches no dom', !/document\.|window\./.test(readFileSync(join(ROOT, 'lib/index.js'), 'utf8')))

// ── bundle, loaded the way the host loads it ────────────────────────────────
const loaded = loadBundle()
const bundleSource = loaded.source
check('one loader call', (bundleSource.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length === 1)
check(
  'bundle inject',
  same(loaded.module.inject, [
    'slots',
    'modelDirectories',
    'sessions',
    'locale',
    'remote',
    'remote.session',
  ]),
  json(loaded.module.inject),
)
check('bundle apply', typeof loaded.module.apply === 'function')
check('bundle internals', typeof loaded.module.__internals === 'object')

const buildLine = bundleSource.match(/const BUILD = '([^']+)'/)
check('build marker present', buildLine !== null)
if (buildLine !== null) {
  check('build marker tracks version', buildLine[1].startsWith(manifest.version + '+'), buildLine[1])
}

// The merge must not resurrect the originals' identities: those ids would make
// the host treat this file as one of them, and the storage keys belong to code
// that no longer exists here.
check('no upstream module id', !/id: 'dsh-client-ui-gpt-helper'/.test(bundleSource))
check('no model-provider-prefix id', !/dsh-model-provider-prefix'/.test(bundleSource))
check('no upstream config key', !/dsh-client-ui-gpt-helper:config:v1/.test(bundleSource))
check('no upstream fast key', !/dsh-client-ui-gpt-helper:fast:v1/.test(bundleSource))
check('no watchdog aliases', !/data-dsh-pm-/.test(bundleSource))
check('seat config key present', /dsh-client-ui-model-seat:config:v1/.test(bundleSource))
// Fast mode is pinned on: the store, its key and the long press are gone, so a
// bundle that still mentions the key is one that still has the switch in it.
check('no fast-mode store', !/dsh-client-ui-model-seat:fast:v1/.test(bundleSource))
check('no fast-mode switch', !/fast-toggle|fastToggle|useFastLock|LONG_PRESS_MS/.test(bundleSource))
check('no lock drawing', !/function (LockIcon|LockMark)\(/.test(bundleSource))
// The bolt came back in 0.2.1, but as a plain LEVEL JUMP: it drives the same
// levels the slider offers and remembers the one it left. It must not drag
// the removed fast-mode lock back in with it.
check('bolt drawing present', /function Bolt\(/.test(bundleSource))
check('bolt remembers its level', /writeBoltMemory\(sessionKey, \{/.test(bundleSource))
check('bolt restores by effort id', /level\.effort === memory\.effort/.test(bundleSource))
check('bolt jumps to the top level', /applyLevel\(levels\.length - 1/.test(bundleSource))
check('bolt needs two levels', /const hasBolt = levels\.length > 1/.test(bundleSource))
// The memory is a fact about ONE conversation, so it is keyed by the session id
// the seat's own `inject` hands over and persisted, which is what keeps the
// bolt on across a restart of the app.
check('bolt memory is per session', /records\[sessionKey\]/.test(bundleSource))
check(
  'bolt memory survives a restart',
  /const BOLT_KEY = 'dsh-client-ui-model-seat:bolt:v1'/.test(bundleSource) &&
    /writeStorage\(BOLT_KEY, JSON\.stringify\(memory\)\)/.test(bundleSource),
)
// localStorage is bucketed by host AND PORT, and dsh restarts on a new port,
// so the memory also travels in a host-scoped cookie.
check(
  'bolt memory mirrors into a cookie',
  /const BOLT_COOKIE = 'dsh-model-seat-bolt'/.test(bundleSource) &&
    /writeBoltCookie\(memory\)/.test(bundleSource),
)
check(
  'the cookie mirror is host-scoped',
  /path=\/; max-age=31536000; SameSite=Lax/.test(bundleSource),
)
check(
  'the cookie mirror is read when storage is gone',
  /parseBoltMemory\(readCookie\(BOLT_COOKIE\)\)/.test(bundleSource),
)
check(
  'bolt memory belongs to one model',
  /record\.provider === provider/.test(bundleSource) &&
    /record\.model === model/.test(bundleSource),
)
// 0.2.2: sitting at the top is not a press. A model that OPENS at its top level
// (measured on the real app: DeepSeek-V4.1-Flash comes back at Max with an empty
// bolt store) used to show a permanently lit button that nobody had pressed, and
// the user read that as "the bolt is on by default". On now means one thing: a
// memory of the level to go back to.
check('the bolt only lights from a memory', /const boltOn = hasBolt && boltBack !== null/.test(bundleSource))
check(
  'the bolt is inert at the top',
  /const boltIdleAtTop = hasBolt && atTop && boltBack === null/.test(bundleSource) &&
    /disabled: sliderDisabled \|\| boltIdleAtTop/.test(bundleSource),
)
check('turning the bolt off retires the hand-over', /delete next\[BOLT_LAST\]/.test(bundleSource))
// A restart opens a NEW conversation, so the per-session record cannot answer
// there; the mirror from the last launch does, and only while already at the top.
check('bolt outlives its conversation', /const BOLT_LAST = 'last'/.test(bundleSource))
check(
  'the hand-over only speaks at the top',
  /if \(atTop !== true\) return null/.test(bundleSource) &&
    /records\[BOLT_LAST\]/.test(bundleSource),
)
check(
  'the hand-over is never aged out',
  /filter\(\(key\) => key !== BOLT_LAST\)/.test(bundleSource),
)
// One frame floor per layout: a single shared number put the thinking pane's
// slack under the slider (0.2.1), and the models pane wants eight rows.
check(
  'per-layout frame floor',
  /layout === 'columns' \? MODELS_MIN_HEIGHT : PANEL_MIN_HEIGHT/.test(bundleSource),
)
check('eight-row model floor', /MODELS_ROW_HEIGHT \* MODELS_MIN_ROWS/.test(bundleSource))

// The upstream aliases are gone as of 0.1.1: this machine never had the original
// plugin installed, so no third-party CSS can hang off them. Everything the
// runtime and the checks address must be a `data-model-seat` value.
check('no hereditary aliases', !/data-gpt-helper/.test(bundleSource))
const SEAT_VALUES = [
  'root',
  'menu',
  'model-trigger',
  'effort-trigger',
  'thinking-slider',
  'effort-bolt',
  'effort-reset',
  'config-panel',
  'config-backdrop',
]
for (const value of SEAT_VALUES) {
  check('state attribute ' + value, bundleSource.includes("'data-model-seat': '" + value + "'"))
}

// ── apply against a fake host ───────────────────────────────────────────────
const host = fakeSeatHost()
loaded.module.apply(host.ctx)
const registration = host.calls[0]
check('one registration', host.calls.length === 1, String(host.calls.length))
check('slot name', registration?.slot === 'conversation.input.model', registration?.slot)
check('priority -2', registration?.priority === -2, String(registration?.priority))
check('locale namespace', registration?.spec?.locale === 'model-seat', registration?.spec?.locale)
check('per-session inject', typeof registration?.spec?.inject === 'function')
check('boundary component', typeof registration?.component === 'function', typeof registration?.component)

const dictionary = host.dictionaries[0]
check('dictionary registered', dictionary?.namespace === 'model-seat', json(dictionary?.namespace))
check('dictionary zh+en', Boolean(dictionary?.dict?.zh && dictionary?.dict?.en))

const style = loaded.document.getElementById(STYLE_ID)
check('one style element', loaded.document.head.childNodes.length === 1, String(loaded.document.head.childNodes.length))
check('style id', style !== null && style !== undefined)
const css = style?.textContent ?? ''
check('style is substantial', css.length > 20000, String(css.length))
check('style has the frame contract', css.includes('.gptm-menu { box-sizing: border-box; }'))
check('style has card rules', css.includes('.gptm-menu .ms-row'))
check('style keeps the slot animation', css.includes('@keyframes gptm-in'))

// A second apply must reuse the node: two controls mounted at once would
// otherwise stack sheets and the later one would win by accident.
loaded.module.apply(host.ctx)
const again = loaded.document.getElementById(STYLE_ID)
check('style is reused', again === style)
check('head still has one sheet', loaded.document.head.childNodes.length === 1)

// ── report ──────────────────────────────────────────────────────────────────
for (const line of notes) console.log(line)
for (const line of problems) console.log(line)
console.log('')
console.log('validate-plugin: ' + notes.length + ' checks, ' + problems.length + ' problems')
process.exitCode = problems.length === 0 ? 0 : 1
