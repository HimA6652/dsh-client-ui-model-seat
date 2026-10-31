import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBundle } from '../scripts/lib/load-bundle.mjs'

const { hubBadgeInRows, HUB_BADGE, HUB_SLOT } = loadBundle().module.__internals

// The probe reads a real node tree, and the host's row markup is the only anchor
// that survives its CSS-module hashing. A plain object stub mirrors the two
// members it touches (parentElement, querySelector) so the walk can be driven
// through every shape the app can hand it.
const node = (extra = {}) => ({ parentElement: null, querySelector: () => null, ...extra })

// A row as the host lays it out: two display:contents slot wrappers under one
// flex row, the badge inside the right slot, the trigger inside ours.
function row({ badge = '.dim-jh-badge', right = true } = {}) {
  const badgeNode = node()
  const rightSlot = node({ querySelector: (selector) => (badge !== null && selector === HUB_BADGE ? badgeNode : null) })
  const leftSlot = node()
  const rowNode = node({
    querySelector: (selector) => (right && selector === HUB_SLOT ? rightSlot : null),
  })
  rightSlot.parentElement = rowNode
  leftSlot.parentElement = rowNode
  const trigger = node()
  const wrapper = node()
  trigger.parentElement = wrapper
  wrapper.parentElement = rowNode
  return { trigger, rowNode, rightSlot, badgeNode }
}

test('the probe finds the badge the channel prints beside the trigger', () => {
  const { trigger } = row()
  assert.equal(hubBadgeInRows(trigger), true)
})

test('the probe stays quiet when the row has no badge', () => {
  assert.equal(hubBadgeInRows(row({ badge: null }).trigger), false)
  assert.equal(hubBadgeInRows(row({ right: false }).trigger), false)
})

test('the probe ignores a badge that is not in the sibling slot', () => {
  // A badge in the sidebar or a settings panel must not silence the prefix: the
  // query only looks inside the right slot, never at the row's whole subtree.
  const elsewhere = node()
  const rowNode = node({
    querySelector: (selector) => (selector === HUB_BADGE ? elsewhere : null),
  })
  const trigger = node({ parentElement: node({ parentElement: rowNode }) })
  assert.equal(hubBadgeInRows(trigger), false)
})

test('the probe tolerates a detached node and a missing tree', () => {
  assert.equal(hubBadgeInRows(null), false)
  assert.equal(hubBadgeInRows(undefined), false)
  assert.equal(hubBadgeInRows(node()), false)
  assert.equal(hubBadgeInRows({}), false)
})

test('the probe stops after four levels', () => {
  const { rowNode, trigger } = row()
  // The row sits three levels up, inside the walk's reach.
  assert.equal(hubBadgeInRows(trigger), true)
  // Two extra wrappers push it to five, past the cap, so the badge goes unseen
  // instead of the walk climbing into unrelated ancestors.
  const fourth = node({ parentElement: rowNode })
  const third = node({ parentElement: fourth })
  const second = node({ parentElement: third })
  const first = node({ parentElement: second })
  const deep = node({ parentElement: first })
  assert.equal(hubBadgeInRows(deep), false)
})

test('the selectors never collide with the plugin\'s own markup', () => {
  assert.equal(HUB_BADGE.includes('gptm'), false)
  assert.equal(HUB_SLOT, '[data-slot="conversation.input.right"]')
})

test('the trigger asks the probe before printing a provider', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const gate = source.match(/const triggerProvider =\s*([\s\S]{0,120})/)
  assert.notEqual(gate, null)
  assert.equal(gate[1].startsWith('hubBadge ||'), true)
  assert.equal(source.includes('ref: rootRef'), true)
})
