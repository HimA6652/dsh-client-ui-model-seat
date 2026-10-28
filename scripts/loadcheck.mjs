#!/usr/bin/env node
/**
 * Load check against the machine this plugin runs on.
 *
 * The manifest makes three claims that only the host can confirm: the slot the
 * control replaces exists, the two packages listed in dsh.client.inject exist,
 * and the slot registry really orders by priority. Each is checked against the
 * installed dsh checkout, and a missing checkout downgrades the run to a note
 * instead of a failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './lib/load-bundle.mjs'

const problems = []
const notes = []
const check = (label, ok, detail) => {
  if (ok) notes.push('ok   ' + label)
  else problems.push('FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}
const skip = (label, why) => notes.push('skip ' + label + ' — ' + why)

const SLOT = 'conversation.input.model'
const DSH_ROOT = process.env.DSH_ROOT ?? ''

// ── the installed host ──────────────────────────────────────────────────────
if (DSH_ROOT === '' || !existsSync(DSH_ROOT)) {
  skip('host checkout', DSH_ROOT === '' ? 'set DSH_ROOT=/path/to/dsh to run' : DSH_ROOT + ' not present')
} else {
  const modules = join(DSH_ROOT, 'node_modules', '@deepseek-ai')
  for (const name of ['dsh-client-ui-conversation', 'dsh-client-ui-model-selection']) {
    const manifestPath = join(modules, name, 'package.json')
    check('inject target installed: ' + name, existsSync(manifestPath), manifestPath)
  }

  // The slot name must exist somewhere the browser actually loads: the web
  // frontend bundle, or one of the UI packages that declares seats.
  const roots = [
    join(modules, 'dsh-web-frontend'),
    join(modules, 'dsh-client-ui-conversation'),
    join(modules, 'dsh-client-ui-model-selection'),
  ].filter((path) => existsSync(path))

  const hits = []
  const walk = (dir, budget) => {
    if (budget.left <= 0) return
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (budget.left <= 0) return
      const path = join(dir, entry)
      let info
      try {
        info = statSync(path)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        if (entry === 'node_modules' || entry === '.git') continue
        walk(path, budget)
        continue
      }
      if (!/\.(js|mjs|cjs)$/.test(entry)) continue
      if (info.size > 8 * 1024 * 1024) continue
      budget.left -= 1
      let text = ''
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      if (text.includes(SLOT)) {
        hits.push({ path, priority: text.includes('priority') })
      }
    }
  }
  walk(roots[0] ?? modules, { left: 4000 })
  for (const root of roots.slice(1)) walk(root, { left: 2000 })

  check('slot declared in the loaded frontend', hits.length > 0, roots.join(', '))
  if (hits.length > 0) {
    notes.push('info slot found in ' + hits.length + ' file(s), first: ' + hits[0].path)
    check('registry orders by priority', hits.some((hit) => hit.priority))
  }
}

// ── this package ────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const entry = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
check('entry name matches package', entry.name === manifest.name, entry.name)
check('entry apply exported', typeof entry.apply === 'function')
check(
  'client entry exists',
  existsSync(join(ROOT, manifest.exports['./client'])),
  manifest.exports['./client'],
)

const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
check('patch row id is new', /-\s*id: model-seat/.test(patch) && !/id: gpt-helper/.test(patch))
check('patch inserts one row', (patch.match(/-\s*id: /g) ?? []).length === 1)

// ── report ──────────────────────────────────────────────────────────────────
for (const line of notes) console.log(line)
for (const line of problems) console.log(line)
console.log('')
console.log('loadcheck: ' + notes.length + ' checks, ' + problems.length + ' problems')
process.exitCode = problems.length === 0 ? 0 : 1
