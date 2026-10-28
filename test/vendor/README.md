# test/vendor

`react.js` + `react-dom.js` are the React **development** UMD builds (MIT, © Meta
Platforms and affiliates) that `scripts/browser-check.mjs` and
`scripts/live-check.mjs` load into the throwaway page/profile. They are committed
so `npm run e2e` works on a fresh clone with no local dsh checkout and no
network.

They are **not** part of the plugin runtime: the browser half of
`dsh-client-ui-model-seat` reads React from the host page's module loader
(`__ModuleLoader__`), never from this folder.

Override the location with `--vendor DIR` or `REACT_VENDOR=DIR`.
