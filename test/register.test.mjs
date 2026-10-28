import test from 'node:test'
import assert from 'node:assert/strict'
import { STYLE_ID, fakeSeatHost, loadBundle } from '../scripts/lib/load-bundle.mjs'

/** Just enough React to render the error boundary without a DOM. */
function treeReact() {
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState(patch) {
      this.state = { ...this.state, ...patch }
    }
  }
  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(),
  })
  return { Component, createElement, Fragment: 'fragment' }
}

// vm-realm objects: compare shapes, not prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value))

const mount = (host) => {
  const bundle = loadBundle()
  bundle.module.apply(host.ctx)
  return { ...bundle, host }
}

test('apply registers exactly one seat, at the lowest priority', () => {
  const host = fakeSeatHost()
  mount(host)
  assert.equal(host.calls.length, 1)
  const [call] = host.calls
  assert.equal(call.slot, 'conversation.input.model')
  assert.equal(call.priority, -2)
  assert.equal(call.spec.locale, 'model-seat')
})

test('the seat reads one directory per session and hides itself for subagents', async () => {
  const host = fakeSeatHost()
  mount(host)
  const inject = host.calls[0].spec.inject

  const loads = []
  const selects = []
  host.directory.load = () => {
    loads.push('load')
    return Promise.resolve()
  }
  host.directory.select = (selection) => {
    selects.push(selection)
    return Promise.resolve({ ok: true })
  }

  const main = inject('session-1')
  assert.equal(main.available, true)
  assert.equal(main.directory, host.directory.store)
  main.load()
  assert.deepEqual(loads, ['load'])
  await main.select({ provider: 'p', model: 'm' })
  assert.deepEqual(selects, [{ provider: 'p', model: 'm' }])

  // An addressed subagent session cannot pick a model: no load, no selection.
  host.sessions.subagentAddress = () => 'agent:child'
  const child = inject('session-2')
  assert.equal(child.available, false)
  child.load()
  assert.deepEqual(loads, ['load'])
  assert.equal(await child.select({ provider: 'p', model: 'm' }), undefined)
  assert.deepEqual(selects, [{ provider: 'p', model: 'm' }])
})

test('the sheet lands in <head> once and stays there across applies', () => {
  const host = fakeSeatHost()
  const { document, module } = mount(host)
  const styles = () => document.head.childNodes.filter((node) => node.id === STYLE_ID)

  assert.equal(styles().length, 1)
  const node = styles()[0]
  const text = node.textContent
  assert.ok(text.length > 20000, 'sheet length ' + text.length)
  assert.ok(text.includes('[data-ready="false"]'))
  assert.ok(text.includes('.gptm-menu'))
  assert.equal(text.includes('__MARKER__'), false)
  assert.equal(text.includes('var(--c-'), false)

  // A second apply (another fiber, a hot reload) must reuse the node and text.
  module.apply(host.ctx)
  assert.equal(styles().length, 1)
  assert.equal(styles()[0], node)
  assert.equal(styles()[0].textContent, text)
})

test('a scope without direct services still registers through inject', () => {
  const host = fakeSeatHost()
  const ctx = { ...host.ctx }
  delete ctx.slots
  delete ctx.modelDirectories
  delete ctx.sessions
  const forwarded = []
  ctx.inject = (deps, callback) => {
    forwarded.push(deps)
    callback({ slots: host.slots, modelDirectories: host.modelDirectories, sessions: host.sessions })
  }
  loadBundle().module.apply(ctx)
  assert.deepEqual(plain(forwarded), [['slots', 'modelDirectories', 'sessions']])
  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].priority, -2)
})

test('the dictionaries register even without an effect runner', () => {
  const host = fakeSeatHost()
  const ctx = { ...host.ctx }
  delete ctx.effect
  loadBundle().module.apply(ctx)
  assert.equal(host.dictionaries.length, 1)
  assert.equal(host.dictionaries[0].namespace, 'model-seat')
})

test('the error boundary swaps the picker for a one-word fallback', () => {
  const host = fakeSeatHost()
  const bundle = loadBundle({ react: treeReact() })
  bundle.module.apply(host.ctx)
  const boundary = host.calls[0].component
  assert.deepEqual(plain(boundary.getDerivedStateFromError()), { failed: true })

  const instance = new boundary(boundary.prototype ? {} : {})
  instance.state = { failed: true }
  const markup = instance.render()
  assert.equal(markup.props.className, 'gptm-fallback')
  assert.equal(markup.props['data-model-seat'], 'fallback')
  assert.deepEqual(plain(markup.children), ['Model'])
})
