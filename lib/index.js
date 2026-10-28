/**
 * Host half of `dsh-client-ui-model-seat`.
 *
 * Nothing runs on the Host: the whole plugin is the browser half in
 * `lib/client.js`, which shadows the composer's model seat. This file exists
 * because the profile expects a resolvable entry point with `name` and
 * `apply`, exactly as both plugins this one merges did.
 */
export const name = 'dsh-client-ui-model-seat'

export function apply() {}
