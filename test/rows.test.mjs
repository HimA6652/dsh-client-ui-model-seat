import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../scripts/lib/load-bundle.mjs'

const { groupById, providerRows, modelRows, providerLabel } = loadBundle().module.__internals

// vm-realm arrays/objects: compare shapes, not prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value))

const state = {
  current: { provider: 'deepseek-account', model: 'deepseek-chat' },
  groups: [
    {
      id: 'deepseek-account',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
    },
    { id: 'openrouter', models: [{ id: 'x/y' }] },
  ],
  failures: [{ id: 'broken', name: 'Broken' }, 'bare-id'],
}

test('groupById finds by id and tolerates missing input', () => {
  assert.equal(groupById(state, 'openrouter').id, 'openrouter')
  assert.equal(groupById(state, 'nope'), null)
  assert.equal(groupById(null, 'openrouter'), null)
  assert.equal(groupById(state, null), null)
})

test('providerLabel prefers the group name and echoes unknown ids', () => {
  assert.equal(providerLabel(state, 'deepseek-account'), 'DeepSeek')
  assert.equal(providerLabel(state, 'openrouter'), 'openrouter')
  assert.equal(providerLabel(state, 'gone'), 'gone')
})

test('provider rows carry one entry per provider plus one retry row per failure', () => {
  const rows = plain(providerRows(state, 'deepseek-account'))
  assert.deepEqual(
    rows.map((row) => [row.key, row.kind]),
    [
      ['provider:deepseek-account', 'provider'],
      ['provider:openrouter', 'provider'],
      ['failed:broken', 'retry'],
      ['failed:bare-id', 'retry'],
    ],
  )
  assert.equal(rows[0].checked, true)
  assert.equal(rows[1].checked, false)
  assert.equal(rows[0].count, 2)
  assert.equal(rows[1].count, 1)
  assert.equal(rows[2].label, 'Broken')
  assert.equal(rows[3].label, 'bare-id')
  assert.equal(rows[2].note, 'retry')
})

test('provider rows survive a state with no groups or failures', () => {
  assert.deepEqual(plain(providerRows({}, null)), [])
  assert.deepEqual(plain(providerRows(null, null)), [])
})

test('retry rows fall back to their position when the failure has no id', () => {
  const rows = plain(providerRows({ groups: [], failures: [{ name: 'nameless' }] }, null))
  assert.equal(rows[0].key, 'failed:0')
  assert.equal(rows[0].provider, '0')
  assert.equal(rows[0].label, 'nameless')
})

test('model rows mark the current model and filter case-insensitively', () => {
  const group = state.groups[0]
  const all = plain(modelRows(group, '', state.current))
  assert.deepEqual(
    all.map((row) => row.key),
    ['model:deepseek-account/deepseek-chat', 'model:deepseek-account/deepseek-reasoner'],
  )
  assert.equal(all[0].checked, true)
  assert.equal(all[1].checked, false)

  assert.deepEqual(
    plain(modelRows(group, 'REASON', state.current)).map((row) => row.model),
    ['deepseek-reasoner'],
  )

  const byId = plain(modelRows(group, 'chat', null))
  assert.deepEqual(
    byId.map((row) => row.model),
    ['deepseek-chat'],
  )
  assert.equal(byId[0].checked, false)
})

test('model rows handle a missing group and models without a name', () => {
  assert.deepEqual(plain(modelRows(null, '', null)), [])
  const rows = plain(modelRows({ id: 'p', models: [{ id: 'only-id' }] }, '', null))
  assert.equal(rows[0].label, 'only-id')
})
