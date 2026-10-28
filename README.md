# dsh-client-ui-model-seat

The model + thinking control of the dsh composer, merged from two plugins that
both replaced the same seat and therefore could not be installed together:

- **dsh-client-ui-gpt-helper** — the shell: token-driven colours, the particle
  thinking slider, fast mode with its long-press lock, the appearance panel,
  the i18n dictionaries and the per-session wiring.
- **dsh-model-provider-prefix** — the skeleton of the card: a provider column
  beside a model column, hover decides which provider the model column shows,
  and a failed provider turns into a retry row.

![The card: providers on the left, the hovered provider's models on the right](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-1.png)
![Search reaches every provider and the card keeps its size](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-2.png)
![The thinking pane: particle slider, fast toggle, long-press lock](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-3.png)

Use this one **instead of** either original — not beside them:

    dsh plugin remove dsh-client-ui-gpt-helper
    dsh plugin remove dsh-model-provider-prefix

Maintaining this file: see [MAINTENANCE.md](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md) (Chinese) for the
code map, the invariants that keep the card stable, the test matrix and the
real-app verification recipes. Changes per release: [CHANGELOG.md](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/CHANGELOG.md).

Who it is for / 适用场景:

| You are… | This plugin gives you |
| --- | --- |
| Someone who needs the provider next to the model | One trigger showing `provider / model`, one card with both columns. |
| Someone whose provider list is long | Hover the provider column; the model column swaps and the card stays put. |
| Someone who tunes reasoning effort | The effort trigger and its particle slider, plus fast mode with a long-press lock. |
| Someone carrying both original plugins | One seat instead of two that cannot coexist. |

Requires dsh `>= 0.2.1-rc.2` (`engines.dsh`). Client-side only: no network calls,
no credential access, no host module.

## What it does

| Surface | Behaviour |
| --- | --- |
| Model trigger | `provider / model` plus a caret. Opens the card on the provider+model columns; a second click closes it. |
| Effort trigger | The current thinking level (`Max`, `Medium`, …). Opens the card on the particle slider; rendered only when the selected model declares thinking levels, and its label becomes `Fast on` while fast mode is locked. |
| Provider column | Every provider in the session directory with its model count, a check on the current provider, and a retry row for a provider whose list failed to load. |
| Model column | Head shows the provider under the pointer; a 30 px search box sits inside the column. Hovering the provider column swaps the models **without moving the card**. |
| Search | Typing searches **every** provider at once and shows the provider name on each row. The card keeps its two-column shape while typing — a re-shaping card is exactly the resize flicker this plugin removes. |
| Thinking slider | The particle slider from the shell, over the level ladder of the selected model, with keyboard arrows/Home/End. |
| Fast toggle | A 600 ms long-press on the bolt locks fast mode; the lock survives a reload (`…:fast:v1`) and re-arms when the window regains focus. |
| Appearance panel | `Ctrl+Shift+Alt+G`. Colour tokens per side (light/dark), scheme library, JSON import/export, reset, cross-apply to the other side, live preview. |

Geometry: the card is `416 px` wide in the column layout and `300 px` in the
thinking panel, clamped to the viewport; heights clamp to `132…420 px` and the
card flips above the trigger when that gives more room.

## The flicker this merge had to fix

The upstream card was anchored by its **bottom** edge and sized by its
**content**, while its content was chosen by the **row under the pointer**. With
one provider holding more models than the card could show, that closed a loop:

1. the card grows to fit the model list, so its top edge moves up;
2. the pointer, which was over a provider row, is now over a different row (or
   outside the card), so the model column swaps or empties;
3. the card shrinks, the pointer is back over the first row, and the loop runs
   again — measured at **27 height flips in 900 ms** on the old bundle.

The merged card breaks the loop by making the frame a function of the anchor and
the layout only:

- `frame(anchor, layout, natural, floor)` is pure: it clamps width and height to
  the viewport and flips above the trigger when that gives back more room.
- The natural height is measured **once** per (layout, status, level count),
  while the card is still hidden (`data-ready="false"`), and then frozen for as
  long as the card stays open on that key.
- The columns scroll internally (`scrollbar-gutter: stable`), so a long model
  list never changes the card outer height.
- `box-sizing: border-box` keeps the inline height equal to what was measured.
- `floor` is the height the card already had, so any later re-measure inside the
  same placement can only grow the card, never collapse it over the pointer. A
  new anchor (resize, scroll) starts the floor over at zero.
- The query does not change the layout, so typing never resizes the card.

Re-measurement happens only on open, pane change, anchor move (scroll/resize) or
a status change — never on hover.

## Configuration

Everything user-facing is edited in the appearance panel; there is no profile
config key. Two `localStorage` records hold the state:

| Key | Shape |
| --- | --- |
| `dsh-client-ui-model-seat:config:v1` | `{ version: 3, hotkey, paused, crossApply, slots: { light: { scheme }, dark: { scheme } }, schemes: { name: { name, colors } }, sides: { light, dark } }` |
| `dsh-client-ui-model-seat:fast:v1` | `{ fast, locked }` |

`paused: true` switches every custom colour off (the panel master switch);
`slots[side].scheme` names the active scheme for a side, `sides[side]` holds the
per-token tune-ups (they win over the active scheme, so a manual edit is never
swallowed), and `crossApply` makes one side colour both.
Records written by the shell plugin (`dsh-client-ui-gpt-helper:config:v1`) are
**not** read: the schema changed and a silent half-migration would be worse than
the defaults. Both records are read on load, on a `storage` event, and when the
window regains focus.

## DOM contract

Stable hooks, for CSS and for tests:

| Element | Attribute |
| --- | --- |
| Root | `[data-model-seat="root"]`, plus `data-build` |
| Triggers | `[data-model-seat="model-trigger"]`, `[data-model-seat="effort-trigger"]` |
| Card | `[data-model-seat="menu"]` with `data-pane`, `data-layout`, `data-ready`, `data-flipped`, `data-fast`, `data-ultra`, `data-locked` |
| Columns | `.ms-col[data-col="providers"]`, `.ms-col[data-col="models"]` |
| Column head | `.ms-colHead`, separator `.ms-sep` |
| Search | `.ms-search` (inside the models column) |
| Rows | `.ms-row[data-kind="provider"\|model\|retry"]`, `data-active`, `data-current`, count `.ms-count`, note `.ms-rowNote` |
| Slider / fast toggle | `[data-model-seat="thinking-slider"]`, `[data-model-seat="fast-toggle"]` |
| Colour panel | `[data-model-seat="config-panel"]`, backdrop `[data-model-seat="config-backdrop"]` |
| Fallback | `[data-model-seat="fallback"]` — what the error boundary renders |

That is the whole contract: since 0.1.1 nothing emits `data-gpt-helper` or
`data-dsh-pm-*`. CSS written against either upstream plugin no longer matches,
which is the point — a leftover `[data-gpt-helper]` rule from the shell plugin
would otherwise restyle this card. `npm run validate` fails if either prefix
comes back.

## Install

    dsh plugin add dsh-client-ui-model-seat                              # from the registry (0.1.2+)
    dsh plugin add github:HimA6652/dsh-client-ui-model-seat              # from source
    dsh plugin add link:/absolute/path/to/dsh-client-ui-model-seat       # local checkout

Both channels ship the same tree. The npm page is
[npmjs.com/package/dsh-client-ui-model-seat](https://www.npmjs.com/package/dsh-client-ui-model-seat);
the first release on it is `0.1.2`. A pnpm profile with `minimumReleaseAge` may
ask once before accepting a version published in the last day.

The plugin bundle inserts one row into the profile (`id: model-seat`) and
registers its seat at `priority: -2`, so a leftover copy of either original
(`-1`) or the shipped control (`0`) is shadowed instead of colliding.

A `desktop` profile cannot be edited by the plain CLI — it answers
`profile "desktop" is managed exclusively by the Electron application`. Use the
desktop host CLI instead (see MAINTENANCE.md, "安装、升级、回滚").

Screenshots are generated, not hand-cropped: `npm run shots` renders the real
bundle in the harness over a demo provider set and clips each PNG at 2x.

## Verifying on a real dsh

`npm run e2e` runs the bundle against a fixture page. To check the same bundle
inside a real dsh web app without touching your own store, give it a throwaway
`DSH_HOME`:

    SEAT_HOME=C:/Users/you/AppData/Local/Temp/seat-live-home
    mkdir -p "$SEAT_HOME" && cp ~/.dsh/.credentials.yaml "$SEAT_HOME/"
    export DSH_HOME=$SEAT_HOME
    DSH=<checkout>/node_modules/@deepseek-ai/dsh/lib/bin.js
    node "$DSH" --profile seatcheck --from-default-profile web --help   # creates seatcheck from the web template
    node "$DSH" plugin --profile seatcheck add link:$PWD
    node "$DSH" --profile seatcheck --port 6124 --host 127.0.0.1 --no-open

The credentials copy is what makes the account model directory resolve; without
it the card is empty. The banner prints the URL with its `?token=`; hand that to

    npm run live -- --url "http://127.0.0.1:6124/?token=..."

`--publish` also clicks a model row and asserts the trigger relabels. That writes
the account model selection, which is why it is off by default and why the run
belongs on a throwaway `DSH_HOME`. The check reports the trigger labels, the
card layout/height/width, a 900 ms frame sample, the thinking pane, and any
console error naming the seat; it exits non-zero on a problem. Your own `~/.dsh`
store and the desktop app are never involved.

## Development

    npm run check       # secrets + pack + validate + css audit + load check + tests
    npm run check:secret # dev paths, tokens, private keys in every text file
    npm run check:pack   # `files` vs the real npm artifact, in both directions
    npm run validate     # manifest, patch row, entry module, bundle load, apply
    npm run css          # stylesheet scoping and dead-class audit
    npm run loadcheck    # against the installed dsh checkout (skips when absent)
    npm test             # node:test unit and integration tests
    npm run e2e          # drives the real bundle in headless Edge over CDP
    npm run check:all    # check + e2e
    npm run live -- --url URL   # the same checks inside a real dsh
    npm run release 0.2.0       # gates → npm → commit → tag → push (see CHANGELOG rule)

`npm run e2e` serves `test/harness/` on a loopback port, opens it in headless
Edge over CDP and asserts, in nine sections: the two-column card, a constant
height while the pointer rests over 60 models, close/reopen determinism, the
cross-provider query, the empty-query note (one padded `.ms-empty`, zero rows),
the slider keyboard path, the fast toggle (click, long-press lock, unlock), the
head status button returning to the columns, the colour-panel hotkey, and a
clean console. `--shot DIR` writes screenshots;
`--dump` prints the card box and its children. The e2e loads React from the
committed `test/vendor/` UMD builds, so a fresh clone needs no external
directory and no network; `--vendor DIR` / `REACT_VENDOR=DIR` override it.

`lib/client.js` is **hand-written** — a 3642-line single-file bundle with no
build step, because `dsh.client` takes one `./client` entry. `tools/merge/gen-client.mjs`
produced the first draft from the shell bundle and is kept only as a record. It
now refuses to run without `--force`, and even then backs the current file up to
`lib/client.js.bak-gen-<timestamp>` first.

## Known limitations

- **One seat, one owner.** The plugin registers at `priority: -2` for
  `conversation.input.model`. Another plugin registering the same priority for the
  same slot is resolved by mount order, not by this plugin.
- **No column-to-column keyboard navigation.** Arrows move inside the focused
  column (the slider, the search box, the rows); Tab leaves the card. Hover and
  clicks are the way to change provider.
- **The card does not animate.** Switching panes or providers relayouts in one
  frame by design — an animated height is the resize loop this merge removes.
  A window resize re-measures the clamp, so an open card follows the viewport.
- **Colours live in `localStorage`** (`dsh-client-ui-model-seat:config:v1`) per
  browser profile. They do not follow the account across machines; the panel's
  JSON import/export is the only way to move them.
- **Search covers model name and id, not provider names.** Typing `ollama` finds
  `ollama/qwen` through the model, not through the provider column.
- **Web client surface only** (`dsh.client.platform: "web"`, which the desktop app
  renders). The terminal surface is untouched.
- **`lib/client.js` is one hand-written file** with no build step; `dsh.client`
  takes a single `./client` entry. There is no per-model override layer: the
  plugin edits the seat, not the model list.

## License

MIT, see LICENSE.
