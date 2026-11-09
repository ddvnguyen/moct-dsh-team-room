# @ddvnguyen/mmx-customization

The MMX customization of DeepSeek Harness, in one plugin, with no upstream
patch. Two halves, one row:

- **Host half** — the public listener. dsh serves its own `webServer` on a
  loopback address and answers `401` to a browser that presents neither the
  launch token nor a session cookie. This listener terminates the public
  connection, mints the cookie in-process for the browser's `Host`, and forwards
  to the stock listener. The browser holds no token and no cookie at any point.
- **Client half** — the MOCT sidebar: the top-level panel policy, the menu
  order, and the hidden "IM Assistant" entry.

It replaces the two `fork:` overlay rows (`web-startup.fork.allowWildcardHost`
and `connection.fork.noAuth`) that the lanes carried as a patch: every seam it
uses is stock public API.

## Config

```yaml
- id: mmx-customization
  name: '@ddvnguyen/mmx-customization'
  config:
    publicPort: 3180        # the number the browser/tunnel reaches
    publicHost: 0.0.0.0     # optional; omitted listens on every interface
    trustedHosts: []        # optional narrowing; the Connection fence still decides
```

The stock listener keeps a **loopback** port of its own: a wildcard listener and
a loopback listener cannot share one number. The start command therefore keeps
`--port` on loopback and this row owns the public number.

## The security shape

- The browser's `Host` survives the hop, so Connection's own Host/Origin fence
  decides admission, with its `trustedHosts`. The plugin asks the fence first
  (`connection.requestRejection`) and refuses `403` before forwarding anything.
  Its optional `trustedHosts` can only narrow that list, never widen it.
- The cookie is minted per request for the request authority, because the cookie
  audience *is* the authority (`requestAudience` in `browser-auth.ts`).
  `connection.authenticatedUrl()` is the only place the process launch token
  surfaces; it is spent inside `connection.authorizeIndex()` and discarded.
- The client's own `Cookie` and `Authorization` are dropped and replaced with
  the minted cookie; hop-by-hop headers and client forwarding claims
  (`x-forwarded-*`, `forwarded`, `x-real-ip`) are dropped; a client-supplied
  `?token=` is never forwarded.
- Every `set-cookie` is stripped on the way back, HTTP and WebSocket handshake
  alike.
- An upstream `401` re-mints once and replays the request (GET/HEAD only — a
  body-bearing request is not buffered); a second `401` is relayed as-is. Fail
  closed, never loop.
- SSE bodies are piped chunk by chunk; WebSocket upgrades are tunnelled with the
  same minted cookie.
- The loopback listener keeps its own authentication: a local process without
  the cookie is still `401`. This proxy adds no loopback trust. Admission ends
  at the same shared `browserPeer` the retired `noAuth` row produced, so the
  security boundary is not widened — and, by that same token, not narrowed.

## Install

```sh
dsh plugin --profile web add @ddvnguyen/mmx-customization@0.1.0
```

The published package carries `lib/index.js` (host half), `lib/client.js`
(browser bundle) and `lib/types/**`.

## Build from a checkout

```sh
pnpm install
npm run build          # repository root: tsc for every package, then the client bundles
node scripts/quality/dsh-smoke.mjs
```

## Verification

`npm test` at the repository root runs the package's specs:

- `tests/listener.spec.ts` — the gate against a plain HTTP upstream: credential
  swap, hop-by-hop and forwarding-claim removal, token stripping, untrusted
  `Host` `403` (page and loopback-only API path), one `401` re-mint then fail
  closed, SSE chunking, WebSocket tunnelling and its handshake cookie strip.
- `tests/client.spec.ts` — the sidebar behaviour moved here unchanged from
  `@ddvnguyen/dsh-sidebar`.

## The sidebar alias

`@ddvnguyen/dsh-sidebar` stays published for one release as a re-export alias of
`./client`. Its browser bundle is built from this package's client source (an
alias in its `tsdown.config.ts`, not a second copy), and this client entry owns
one scheduled pass per page so a profile carrying both rows runs the pass once.
