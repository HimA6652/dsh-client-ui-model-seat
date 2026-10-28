import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSeatHost, loadBundle } from '../scripts/lib/load-bundle.mjs'

const bundle = loadBundle()
const host = fakeSeatHost()
const before = host.dictionaries.length
bundle.module.apply(host.ctx)
const dict = host.dictionaries[0]
const zh = dict.dict.zh
const en = dict.dict.en
const source = bundle.source

// t('literal') calls, and the families built with a template literal.
const literals = new Set()
for (const match of source.matchAll(/\bt\(\s*'([^']+)'\s*[,)]/g)) literals.add(match[1])
const families = new Set()
for (const match of source.matchAll(/\bt\(\s*[\u0060]([^\u0060]*?)\$\{/g)) families.add(match[1])

test('one namespace, registered before the first render', () => {
  assert.equal(before, 0)
  assert.equal(host.dictionaries.length, 1)
  assert.equal(dict.namespace, 'model-seat')
  assert.ok(zh && en)
})

test('both languages carry the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('every literal key resolves in both languages', () => {
  const missing = []
  for (const key of literals) {
    if (typeof zh[key] !== 'string' || zh[key] === '') missing.push('zh:' + key)
    if (typeof en[key] !== 'string' || en[key] === '') missing.push('en:' + key)
  }
  assert.deepEqual(missing, [])
})

test('every template family has entries in both languages', () => {
  assert.deepEqual([...families].sort(), ['config.section.', 'config.side.'])
  for (const prefix of families) {
    for (const entry of [['zh', zh], ['en', en]]) {
      const hits = Object.keys(entry[1]).filter((key) => key.startsWith(prefix))
      assert.ok(hits.length > 0, entry[0] + ' has no key under ' + prefix)
    }
  }
})

test('no dictionary entry is unreachable from the bundle', () => {
  const orphans = Object.keys(zh).filter(
    (key) => !literals.has(key) && ![...families].some((prefix) => key.startsWith(prefix)),
  )
  assert.deepEqual(orphans, [])
})

test('Chinese and English text differ where it should', () => {
  const same = Object.keys(zh).filter((key) => zh[key] === en[key])
  // Only keys whose value is a placeholder, a hotkey or a symbol may coincide.
  const suspicious = same.filter((key) => /[A-Za-z]{3,}/.test(zh[key]) && !/[0-9]/.test(zh[key]))
  assert.deepEqual(suspicious, [])
})
