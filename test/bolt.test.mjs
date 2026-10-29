import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../scripts/lib/load-bundle.mjs'

const { boltReturnIndex } = loadBundle().module.__internals

const ladder = (ids) => ids.map((id) => ({ key: 'effort:' + id, effort: id, label: id }))
const providerDefault = { key: 'provider-default', effort: undefined, label: 'default' }

test('the bolt returns to the level it remembers, by effort id', () => {
  assert.equal(boltReturnIndex(ladder(['low', 'medium', 'high']), { effort: 'medium', index: 1 }, 'medium'), 1)
  // The remembered index is only a hint — a rebuilt list can move the same id.
  assert.equal(
    boltReturnIndex(ladder(['minimal', 'low', 'medium', 'high']), { effort: 'low', index: 1 }, 'medium'),
    1,
  )
})

test('a remembered id that is gone falls back past the memory', () => {
  assert.equal(boltReturnIndex(ladder(['medium', 'high']), { effort: 'gone', index: 0 }, 'medium'), 0)
})

test('without a memory the bolt returns to the model default', () => {
  assert.equal(boltReturnIndex(ladder(['low', 'medium', 'high']), null, 'medium'), 1)
})

test('a default that IS the top returns to the level below it', () => {
  assert.equal(boltReturnIndex(ladder(['low', 'high']), null, 'high'), 0)
})

test('the provider-default level is a level like any other', () => {
  const levels = [providerDefault, ...ladder(['high'])]
  assert.equal(boltReturnIndex(levels, { effort: undefined, index: 0 }, undefined), 0)
})

test('a ladder with nothing below the top has nowhere to return to', () => {
  assert.equal(boltReturnIndex([], null, undefined), -1)
  assert.equal(boltReturnIndex(undefined, null, undefined), -1)
  assert.equal(boltReturnIndex(ladder(['high']), null, undefined), -1)
})
// ── the hand-over across a restart ──────────────────────────────────────────
// dsh opens a NEW conversation on every launch, so the per-session record can
// never answer there; the mirror from the last launch does, and only at the top.
const { boltMemoryFor } = loadBundle().module.__internals

const MODEL = { provider: 'own', model: 'cn:deepseek-v4.1-flash' }
const jump = { provider: 'own', model: 'cn:deepseek-v4.1-flash', effort: 'medium', index: 1 }

test('a conversation reads its own record before the mirror', () => {
  const records = { 'session-1': jump, last: { ...jump, effort: 'low', index: 0 } }
  assert.deepEqual(boltMemoryFor(records, 'session-1', MODEL.provider, MODEL.model, false), jump)
})

test('a fresh conversation at the top inherits the mirror', () => {
  const records = { 'session-1': jump, last: jump }
  assert.deepEqual(boltMemoryFor(records, 'session-2', MODEL.provider, MODEL.model, true), jump)
})

test('the mirror stays silent until the level is at the top', () => {
  const records = { last: jump }
  assert.equal(boltMemoryFor(records, 'session-2', MODEL.provider, MODEL.model, false), null)
})

test('the mirror speaks for one model only', () => {
  const records = { last: jump }
  assert.equal(boltMemoryFor(records, 'session-2', 'own', 'cn:other-model', true), null)
  assert.equal(boltMemoryFor(records, 'session-2', 'pool', MODEL.model, true), null)
})

test('clearing a conversation keeps the mirror for the next launch', () => {
  // Pressing the bolt back clears the session record; the mirror is untouched,
  // and it is inert anyway once the level is no longer the top.
  const records = { last: jump }
  assert.deepEqual(boltMemoryFor(records, 'session-1', MODEL.provider, MODEL.model, true), jump)
})

test('no records at all means no memory', () => {
  assert.equal(boltMemoryFor({}, 'session-1', MODEL.provider, MODEL.model, true), null)
  assert.equal(boltMemoryFor(null, 'session-1', MODEL.provider, MODEL.model, true), null)
  assert.equal(boltMemoryFor({ last: jump }, 'session-1', null, null, true), null)
})
