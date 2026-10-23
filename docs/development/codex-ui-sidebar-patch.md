# The codex-ui sidebar patch

English | [中文](codex-ui-sidebar-patch.zh.md)

## Why a patch exists

`@michengai/dsh-codex-ui` renders the sidebar the Team Room lives in. Two of the requirements cannot be expressed through its public slots:

- **A plugin tab in the strip.** The strip (`Tasks | Channels | Schedule`) has no public registration API. The automation plugin owns a private registry (`__dshNativeTabs`) that the Team Room already uses to publish its `Teams` tab.
- **A panel next to "New task".** Since codex-ui 1.1.39 every plugin panel is rendered inside the Extensions group, so `Context Insights` and `Team Detail` can no longer sit at the top level.

The patch adds both to the published codex-ui bundle. It is the mechanism; the policy stays in this repository.

## What the patch adds

Two seams, and nothing else:

- `__dshNativeTabs` — the native tab registry, the contract the automation plugin already uses. The Team Room's `Teams` tab renders in the strip through it.
- `__dshTopPanels` — the ids of the panels that render next to "New task" instead of inside Extensions.

The patch also strips the icons from the strip's own tab titles, so the strip reads `Tasks | Teams | Schedule` as text: a plugin tab carries a plain label, and icons on two of three titles made the row read as broken.

The patch is applied by anchored edits (`scripts/codex-ui-sidebar-patch/edits.mjs`), not by a line-based diff. A codex-ui release that keeps the anchors needs no new patch; a release that moves one fails the applier with the id of the edit that no longer matches, and the installed bundle is left untouched.

## Who owns the policy

`@ddvnguyen/dsh-sidebar` publishes the top-level panel ids (`dsh-context`, `agent-team-settings`) through `globalThis.__dshTopPanels` and orders the menu's children with CSS `order`. Without the patch the publication has no effect and the host keeps its own layout; the plugin never moves a React-owned node out of the menu.

## How it is applied and kept applied

`scripts/codex-ui-sidebar-patch/apply.mjs` patches an installed codex-ui in place, is idempotent, keeps the original next to the patched file, and parse-checks the result before it writes; the check's scratch sits beside the bundle being written, never in `tmpdir()`, so a host whose shared `/tmp` is full cannot fail the install (M-66). `deploy-dsh-x-sidebar.sh` runs the whole dsh-x path: profile versions, install, patch, restart.

The dsh-x profile carries a `postinstall` hook that runs the applier after every profile install, so `dsh plugin update @michengai/dsh-codex-ui` re-applies the patch instead of silently dropping the `Teams` tab.

## What to check when codex-ui releases

1. `node scripts/codex-ui-sidebar-patch/apply.mjs <codex-ui-dir> --check` — the patch still applies.
2. If it does not, read the reported edit id, find the new upstream shape, and adjust the anchor. Do not re-author the feature: the edit list is the feature.
3. `node scripts/codex-ui-sidebar-patch/generate.mjs <version>` writes the reviewable diff for the release.
