import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from '../scripts/lib/load-bundle.mjs'

const { frame, geometryKey } = loadBundle().module.__internals

// Objects built inside the bundle's vm context carry that realm's prototypes,
// so compare their JSON shape rather than their identity.
const plain = (value) => JSON.parse(JSON.stringify(value))
const anchor = (over) => ({ left: 100, top: 700, vw: 1280, vh: 900, ...over })

test('columns layout hangs off the trigger, clamped to the tall frame', () => {
  // B's card, to the pixel: 168 + 236 columns, a 2px gap, 4px of padding a side.
  assert.deepEqual(plain(frame(anchor(), 'columns', 900)), {
    left: 100,
    bottom: 208,
    width: 416,
    height: 420,
    flipped: false,
  })
})

test('the thinking panel is narrower than the model card', () => {
  assert.equal(frame(anchor(), 'panel', 300).width, 300)
  assert.equal(frame(anchor(), 'columns', 300).width, 416)
})

test('a short natural height is lifted to its own layout floor', () => {
  // 0.2.1 gave each layout its own floor: eight rows for the model columns
  // (32 * 8 + 25 + 6.5 + 36 + 8 + 1 = 333) and the panel's own body height (96).
  // A provider with two models used to leave a stub of a card, and moving the
  // pointer from it to a provider with sixty re-framed the whole popover.
  assert.equal(frame(anchor(), 'columns', 300).height, 333)
  assert.equal(frame(anchor(), 'columns', 40).height, 333)
  assert.equal(frame(anchor(), 'panel', 40).height, 96)
})

test('the card flips above a trigger near the top of the window', () => {
  const box = frame(anchor({ top: 120 }), 'columns', 900)
  assert.equal(box.flipped, true)
  assert.equal(box.height, 420)
  // sits CARD_GAP below the anchor when flipped
  assert.equal(box.bottom, 900 - 120 - 8 - 420)
})

test('the flip uses the anchor bottom edge when the host reports one', () => {
  const box = frame(anchor({ top: 120, bottom: 150 }), 'panel', 900)
  assert.equal(box.flipped, true)
  assert.equal(box.height, 420)
  assert.equal(box.bottom, 900 - 150 - 8 - 420)
})

test('a trigger with no room above stays below even when the card is cramped', () => {
  const box = frame(anchor({ top: 400, bottom: 430, vh: 520 }), 'columns', 900)
  assert.equal(box.flipped, false)
  assert.equal(box.height, 380)
  assert.equal(box.bottom, 520 - 400 + 8)
})

test('width and left clamp to the viewport', () => {
  const box = frame(anchor({ left: 290, vw: 300, vh: 400 }), 'columns', 900)
  assert.equal(box.width, 276)
  assert.equal(box.left, 12)
  assert.equal(box.bottom, 12)
})

test('the frozen frame does not depend on the natural height once capped', () => {
  const variants = [420, 500, 900, 4000].map((natural) => plain(frame(anchor(), 'columns', natural)))
  for (const box of variants) {
    assert.deepEqual(box, variants[0])
  }
})

test('geometry key changes with layout, status and level count only', () => {
  assert.equal(geometryKey('columns', 'ready', 4), 'columns|ready|4')
  assert.notEqual(geometryKey('columns', 'ready', 4), geometryKey('panel', 'ready', 4))
  assert.notEqual(geometryKey('columns', 'ready', 4), geometryKey('columns', 'pending', 4))
  assert.notEqual(geometryKey('columns', 'ready', 4), geometryKey('columns', 'ready', 3))
})
test('a shrunk pane keeps the height the card already had', () => {
  // Switching to the short thinking panel would otherwise shrink the card
  // upward and drag its own top edge down under the pointer; the floor keeps
  // the frame fixed within one placement, and only ever lets it grow.
  const tall = anchor()
  const columns = frame(tall, 'columns', 420)
  const results = frame(tall, 'panel', 132, columns.height)
  assert.equal(results.height, columns.height)
  assert.equal(results.bottom, columns.bottom)
  // A shorter anchor floor still lets the frame grow.
  const grown = frame(tall, 'panel', 300, 132)
  assert.equal(grown.height, 300)
  // No floor at all is the old behaviour.
  assert.equal(frame(tall, 'panel', 300).height, 300)
})
