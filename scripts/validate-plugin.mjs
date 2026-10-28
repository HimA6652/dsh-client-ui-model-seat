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
check('seat keys present', /dsh-client-ui-model-seat:config:v1/.test(bundleSource) && /dsh-client-ui-model-seat:fast:v1/.test(bundleSource))

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
  'fast-toggle',
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
