# @ddvnguyen/dsh-sidebar

A client-only DeepSeek Harness plugin that organises the codex-ui sidebar and
hides the hardcoded "IM Assistant" entry. It merges the two behaviours that
previously shipped as two separate build artefacts (the sidebar layout and the
hidden IM Assistant entry) into one package, one plugin row and one browser
bundle.

## What it does

- **Top-level panel policy.** The panels listed in the plugin's policy
  (`dsh-context`, `agent-team-settings`, `agent-team-board`) are rendered next
  to "New task" instead of inside the Extensions group. The patched codex-ui
  owns the mechanism; this plugin owns the policy and publishes it through
  `globalThis.__dshTopPanels`. Without the patch the host keeps every plugin
  panel inside Extensions and the layout stays the host's.
- **Menu order.** The entries that stay at the top level are ordered with CSS
  `order` and the ones inside Extensions are indented under the chevron.
  Nothing is detached from React's tree: the order is a style, not a move.
- **IM Assistant.** The hardcoded "IM Assistant" / "IM助理" entry (expanded
  sidebar button, collapsed icon button, command-palette row) is hidden in
  place with `display:none` and a `data-hide-im-assistant` marker. No React
  node is removed and codex-ui is not patched.

Both behaviours touch the same sidebar DOM, so they run in one scheduled pass.
The IM-assistant rule marks the elements it hides, and the layout never clears
a `display` the rule owns: the entry stays hidden when the Extensions group
expands again.

## Install

```sh
dsh plugin --profile web add @ddvnguyen/dsh-sidebar@0.1.0
```

The published package carries `lib/index.js` (the host half, an empty `apply`),
`lib/client.js` (the browser bundle) and `lib/types/**` (the declarations).

## Build from a checkout

```sh
corepack pnpm install          # in the repository root
cd packages/sidebar && npm run build
```

`tsc` emits the host half and the declarations under `lib/types`; the browser
bundle comes from the Harness `tsdown` through the repository's own
`scripts/build-client.mjs`, so a sibling `../deepseek-harness` checkout is
required — the same contract the repository's other client bundle has.

## Peer dependencies

`@deepseek-ai/cordis` and `@deepseek-ai/dsh-client-ui-slots` are declared as
peers because the plugin row is loaded through the Harness module table. The
sources import neither at runtime: the client half works on the DOM alone and
the host half is an empty `apply`.

## License

[MIT](LICENSE)
