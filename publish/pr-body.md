## What

Adds one entry: `HimA6652/dsh-client-ui-model-seat` (category `ui`).

```text
url: https://github.com/HimA6652/dsh-client-ui-model-seat
name: HimA6652/dsh-client-ui-model-seat
category: ui
```

It is a **merge** of two entries already in this list:

- `AprilCrystal/dsh-client-ui-gpt-helper`
- `zszz3/dsh-model-provider-prefix`

## Why not a duplicate

The two upstreams are not alternatives — they are mutually destructive. Both register a seat on the same slot `conversation.input.model` at the same priority (`-1`), and the host's `register()` throws on a duplicate registration for one slot at one priority, so installing both means one of them is silently dropped and the UI depends on install order. Neither upstream can be fixed to coexist without changing its priority, which is why the merge exists rather than a bug report.

This package is the union of both behaviours behind one control, registered at `priority: -2` (the lowest renders), so it coexists with either upstream if a user keeps one installed — and it is installable on its own, with no peer requirements.

Feature union, all verifiable in `lib/client.js`:

- `Provider / Model` trigger opening a two-column card; hovering the provider column swaps the model column **without moving the card** (geometry is measured once per open and frozen, which also fixes the popover resize loop the prefix plugin shows when one provider has many models).
- A separate reasoning-effort trigger with a particle slider, fast-mode long-press lock, and a two-theme appearance panel.
- One cross-provider model search; typing never changes the card's size.

## Attribution

Both upstreams are MIT. `LICENSE` keeps their copyright lines (AprilCrystal 2026, zszz3 2026) alongside the new one, and both authors are listed in `package.json` → `contributors`.

## Scope

- No network access at all: no `fetch`, no `XMLHttpRequest`, no dynamic code evaluation.
- No credential or filesystem access; `localStorage` is used only for the colour config and the fast-mode lock.
- Single-file client bundle, no build step, no dependencies (`dependencies: {}`, no `peerDependencies`).

## For maintainers, if you would rather cap the list

Happy to see this entry replace the two upstreams. If you prefer that, I can open a follow-up PR setting `deprecated: true` + `replacement: https://github.com/HimA6652/dsh-client-ui-model-seat` on `AprilCrystal__dsh-client-ui-gpt-helper.yml` and `zszz3__dsh-model-provider-prefix.yml` (one PR ≤ 3 entries), or you can do it directly in this one — say which you prefer.
