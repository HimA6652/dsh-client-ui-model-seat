#!/usr/bin/env node
/**
 * Stylesheet audit.
 *
 * The sheet lands in the app's <head>, so a rule that is not rooted in the
 * control's own classes leaks into every other surface; and the merge added
 * classes by hand, so a rule can exist for a class the component never renders.
 * Both are checked here against the sheet apply() really produced.
 */
import { STYLE_ID, fakeSeatHost, loadBundle } from './lib/load-bundle.mjs'

const problems = []
const notes = []
const check = (label, ok, detail) => {
  if (ok) notes.push('ok   ' + label)
  else problems.push('FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

const loaded = loadBundle()
const host = fakeSeatHost()
loaded.module.apply(host.ctx)
const css = loaded.document.getElementById(STYLE_ID)?.textContent ?? ''
check('sheet injected', css.length > 0, String(css.length))

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

// ── balance ─────────────────────────────────────────────────────────────────
{
  let depth = 0
  let bad = -1
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth < 0) { bad = i; break }
    }
  }
  check('braces balance', depth === 0 && bad < 0, depth === 0 ? 'trailing open block' : 'extra } at ' + bad)
}

// ── declarations ────────────────────────────────────────────────────────────
check('no !important', !stripped.includes('!important'))
check('no unresolved colour markers', !stripped.includes('var(--c-'))
check('no template placeholders', !/__[A-Z][A-Z0-9_]*__/.test(stripped))
check('no upstream attribute selectors', !/\[data-dsh-pm-/.test(stripped))

// ── every selector, including the ones nested in @media and theme blocks ────
const selectors = []
for (const match of stripped.matchAll(/([^{}]+)\{/g)) {
  const selector = match[1].trim()
  if (selector === '') continue
  // @keyframes steps are not selectors
  if (/^(@|\d+%|from$|to$)/.test(selector)) continue
  if (/^\d+%/.test(selector)) continue
  selectors.push(selector)
}
check('rules found', selectors.length > 60, String(selectors.length))

const flat = selectors
  .flatMap((selector) => selector.split(',').map((part) => part.trim()))
  .filter((part) => part !== '')
  .filter((part) => !/^(\d+%|from|to)$/.test(part))

// .ms- classes only ever appear under the card.
const msLeaks = flat.filter((selector) => selector.includes('.ms-') && !selector.includes('.gptm-menu'))
check('no unscoped .ms- selectors', msLeaks.length === 0, msLeaks.slice(0, 4).join(' | '))

// Nothing is rooted outside the control: every compound starts at .gptm-,
// at the theme attribute the panel itself sets, or at the document root.
const foreign = flat.filter((selector) => {
  if (selector.startsWith('@')) return false
  const head = selector.trim()
  if (head.startsWith('html') || head.startsWith(':root')) return false
  if (head.startsWith('.gptm-')) return false
  if (head.startsWith('.gptm-menu')) return false
  return true
})
check('every rule is rooted in the control', foreign.length === 0, foreign.slice(0, 6).join(' | '))

// ── class inventory ─────────────────────────────────────────────────────────
const styledClasses = new Set()
for (const selector of flat) {
  for (const match of selector.matchAll(/\.(ms-[A-Za-z][A-Za-z0-9-]*)/g)) styledClasses.add(match[1])
}
const bundleSource = loaded.source
const usedClasses = new Set()
for (const match of bundleSource.matchAll(/className:\s*'([^']*)'/g)) {
  for (const token of match[1].split(/\s+/)) if (/^ms-/.test(token)) usedClasses.add(token)
}
const missingRules = [...usedClasses].filter((name) => !styledClasses.has(name)).sort()
check('every rendered .ms- class has a rule', missingRules.length === 0, missingRules.join(', '))

const deadRules = [...styledClasses].filter((name) => !usedClasses.has(name)).sort()
if (deadRules.length > 0) notes.push('warn dead .ms- rules: ' + deadRules.join(', '))

// ── the frame contract ──────────────────────────────────────────────────────
check('card is border-box', css.includes('.gptm-menu { box-sizing: border-box; }'))
check(
  'card hides before measurement',
  /\.gptm-menu\[data-ready="false"\]\s*\{[^}]*visibility:\s*hidden/.test(stripped),
)
// The row list scrolls inside a column whose head stays put; a column that
// scrolled instead would drag its own head out of view.
check(
  'row lists scroll inside their column',
  /\.gptm-menu \.ms-rows\s*\{[^}]*overflow-y:\s*auto/.test(stripped),
)
check(
  'columns do not scroll',
  !/\.gptm-menu \.ms-col\s*\{[^}]*overflow/.test(stripped),
)

// ── report ──────────────────────────────────────────────────────────────────
for (const line of notes) console.log(line)
for (const line of problems) console.log(line)
console.log('')
console.log(
  'css-audit: ' + selectors.length + ' rules, ' + flat.length + ' selectors, ' +
    styledClasses.size + ' .ms- classes styled, ' + usedClasses.size + ' rendered, ' +
    problems.length + ' problems',
)
process.exitCode = problems.length === 0 ? 0 : 1
