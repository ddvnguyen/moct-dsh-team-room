# D2 — A10 interim Team tab (TEST-3 only)

Lane branch: `lane/d2-team-tab`, base `c6a26ee`
Owned files: `packages/client-agent-team/src/client/team-tab.ts`,
`team-tab-body.tsx`, `tests/team-tab.client.spec.tsx`, plus one editable
hunk in `packages/client-agent-team/src/client/index.ts`.
Status: code complete, unit-verified, revert-checked, baseline-equivalence
proven. Commit/push + PR: pending at pack-write time.

## 1. Host contract — read out of the live bundle, not from documentation

Verified first-hand against
`/home/ddv/dsh-test/profiles/web/node_modules/@michengai/dsh-automation/lib/client.js`
(md5 `32b639211d7e8e3b8c6a08195cd64b22`), version **0.1.61** at PROD
`/home/ddv/.dsh/profiles/web`, PROD trial `/home/ddv/.dsh/profiles/web-trial`,
and TEST `/home/ddv/dsh-test/profiles/web`. Equivalence of the three installs
was checked by `package.json` `version`, all `0.1.61`.

| Fact | Verified value | Evidence in bundle |
|---|---|---|
| Registry key literal | `__dshNativeTabs` | `var mO="__dshNativeTabs"` at offset 633164 |
| Registry shape (v1) | `{version:1, officialTree, sessionFilters, getTabs(), subscribe(fn)->dispose, insert(tab)->dispose, addSessionFilter(fn)->dispose}` | factory `pO(e)` at 633164 |
| Feature-detect | key present AND `typeof t.insert=="function"` | `function KS(e){…let t=e[mO]; if(!(t==null\|\|typeof t!="object")) return typeof t.insert=="function"?t:void 0}` |
| Two-step discovery | `fO(e){ return KS(e) ?? KS(t?.component) }` | owner's own `fO`, immediately after `KS` |
| Attach site | wraps the first `sidebar.workspaces` entry with a `component`; attaches registry to the entry **and** to its wrapper | `w()` body, offsets 709964–712516 |
| Both subscriptions | `r=e.slots.subscribe("sidebar.workspaces",w)` and `T=e.slots.subscribe?.("sidebar",w)` | end of the `slots.inject("sidebar.workspaces", …)` routine |
| Window re-probe event | `window.dispatchEvent(new Event("dsh-native-sidebar-change"))`, plus `window.addEventListener("dsh-native-sidebar-change",w)` | offsets 710077 and 712516 |
| Owner's own retry | `f=window.setInterval(()=>{N+=1,(v()\|\|N>=20)&&x()},250)` — 20 × 250 ms | `C()` in the same routine |
| Slot entry reader | `(e.slots.entriesOfSlot ?? e.slots.entries)?.call(e.slots,t) ?? []` inside try/catch | `oh(e,t)` at 713445 |
| Tab sort | `(a.order ?? 0) - (c.order ?? 0)` | `pO`'s `i()` |
| `insert` semantics | empty id → no-op disposer; map-set by id; re-sorts and notifies only on change; disposer deletes only if identity matches | `insert(a)` in `pO` |
| Strip render order | `Tasks` button, then `k.map(...)` over registry tabs, then `Channels` if ready, then the hard-coded `schedule` button; selected body in `div.dsh-st-shell-body` | offset 662679 (`dsh-st-shell-tabs`, `role=tablist`) and 663471 (`dsh-st-shell-body`) |
| Persistence | key `dsh-automation.sidebar-tab`, whitelist `HC(e){return e==="channels"||e==="schedule"||e==="tasks"?e:"tasks"}`, read once via `useState`, written by an effect on every change | `dh` at 15220, `HC` right after `WC`/`jC`, `localStorage.setItem(dh,g)` at 660126 |

### Consequences this lane acts on

1. **`sidebar.channels` is not the attach slot.** The owner's *channel-readiness*
   subscription is `sidebar.channels`, but the registry is attached only to
   `sidebar.workspaces` entries. D2 uses `sidebar.workspaces` for both reading
   and subscribing.
2. **The strip itself owns the selected-tab state and writes it back**, and its
   whitelist collapses any unknown value to `tasks`. D2 therefore writes no
   `localStorage` at all — a competing key would collide, and an inserted tab id
   is not in the whitelist's persist set, so the strip's own round-trip is
   already lossless for us.
3. **A probe that finds nothing is not a verdict.** The owner wraps lazily on
   its own subscription and re-probes on a window event, so D2 subscribes to
   both slots *and* runs a bounded 20 × 250 ms interval — the same budget the
   owner spends on itself.

## 2. What D2 changed

- `team-tab.ts` — reads the registry off `sidebar.workspaces` entries using the
  owner's two-step discovery, feature-detects, inserts `{id:'team', order:3,
  matchSession: () => false, render}` and returns an always-callable, idempotent
  disposer. Nothing throws, ever. Exports `HOST_CONTRACT` as a literal so the
  suite pins the private key, attach slot, tab id/order and retry budget.
- `team-tab-body.tsx` — reuses the already-injected `TeamConversation` seat via
  `createElement`, with `t` bound per render from `ctx.locale.bind('team')` so a
  language switch reaches the tab body; host props are spread through untouched.
- `packages/client-agent-team/src/client/index.ts` — exactly one added
  `ctx.effect(...)` block (plus its two imports and comments) that inserts the
  tab with the localized label and the seat's render. No existing registration
  moved; no new locale key.

## 3. Verification

### 3.0 Repo gates (the repo's own `npm test` chain, minus the suite)

| gate | result |
|---|---|
| `pnpm run typecheck` (all 3 packages) | exit 0 |
| `pnpm run lint` | `Found 3 warnings and 0 errors` — all 3 pre-existing in `packages/agent-team/src/vendor/storage-sqlite/index.ts:161` and `packages/agent-team/tests/context-continuity-host.spec.ts:375,409`; none in D2 files |
| `pnpm run check:facades` | OK — `facades match the generated output (509 Harness mappings)` |
| `pnpm run check:boundaries` | OK — `96 source file(s) in 3 package(s) stay inside their own package` |
| `pnpm run check:versions` | OK — `17 version spots agree on 0.2.0-rc.2 …, plugin 0.2.2` |
| `pnpm run check:docs` | OK — `28 maintained documents, 28 bilingual pairs …` |
| `pnpm run check:core-skills` | OK |

`pnpm run check:facades` initially failed with
`ENOENT: … open '…/.generated-harness'` — that file is gitignored and simply had
not been materialised in this worktree. Copying the fork root's
`.generated-harness` (content `deepseek-harness`) in made the check pass. It is
gitignored, so it is not part of this commit and no committed file changed.

Typecheck's first run found four errors in D2's own new wiring; all four were
fixed *inside the owned hunk*, not worked around:
- `NativeTabRenderProps` was imported from `team-tab.ts` but declared in
  `team-tab-body.tsx` → `team-tab.ts` now re-exports it (`export type {
  NativeTabRenderProps } from './team-tab-body.tsx'`).
- `TeamConversationProps` was referenced without an import → added
  `import type { TeamConversationProps } from './slots.ts'`.
- `sharedRemotes` was out of scope in `applyUi` (it lives inside
  `registerModeShadow`) → the seat share is now built once beside the render
  closure via `teamSharedRemotes(ctx, navigation, queries, reads, drafts,
  humanIdentity)`, which also removes a per-render object rebuild.
- `registry.inserted[0].matchSession(...)` was flagged possibly-undefined →
  the spec now binds `const inserted = registry.inserted[0]` and asserts
  `toBeDefined()` before the call.

### 3.1 Unit suite (this lane's spec)

```
TMPDIR=/home/ddv/work/tmp-d2 pnpm exec vitest run \
  packages/client-agent-team/tests/team-tab.client.spec.tsx
→ Test Files 1 passed (1) / Tests 13 passed (13)
```

Note: the filter must be a path relative to the worktree root; run from inside
`packages/client-agent-team` vitest finds no test files.

### 3.2 Revert check (the suite can detect its own production delete)

Mutated `readRegistry`'s predicate from the three-verb check to
`registry.version === 1` at team-tab.ts:130 → **3 failed / 10 passed** (the
feature-detect rejection test, the "stands down over a registry whose insert is
not a function" test, and the revert-check test itself).

Restored byte-identical: `md5 8840739e0611aa8c32f282044bc46b75`, matching the
pre-mutation value. Backup of the mutated-out original:
`/home/ddv/work/a9/d2-team-tab.ts.bak-revertcheck`.

### 3.3 Full-suite baseline equivalence — proven, not argued

A full-suite run at a *clean* tree in the same worktree (D2 files stashed away,
`git status --porcelain` empty) produced:

```
Test Files  20 failed | 59 passed | 2 skipped (81)
Tests       633 passed | 2 skipped (635)
```

The same run with D2 in place (measured earlier in the lane):

```
Test Files  20 failed | 60 passed | 2 skipped (82)
Tests       646 passed | 2 skipped (648)
```

- Failure *count* is identical: 20 before, 20 after.
- Failure *set* is identical. Both runs' 20 failures are import-time errors, not
  test failures, and both runs contain exactly two distinct causes:
  `Cannot find package '@deepseek-ai/dsh-tools'` (from
  `.pnpm/@contexera+dsh-context-continuity@0.4.0_*/node_modules/@contexera/dsh-context-continuity/lib/tools.js`)
  and `Cannot find package '@deepseek-ai/cordis'` (from
  `.pnpm/@contexera+dsh-jev@0.1.2_*/node_modules/@contexera/dsh-jev/lib/service.js`).
- Test count delta is exactly the 13 tests D2 adds: 646 − 633 = 13, and
  60 − 59 = 1 file.

So the 20 failures are pre-existing and environmental (worktree pnpm link
layout — two workspace packages are not linked into the nested `.pnpm` store),
the same class of failure D1 recorded, and D2 neither causes nor masks one.

Note on the earlier attempted baseline: `/home/ddv/workplace/cert-c6a26ee`
cannot run the suite at all — `pnpm exec vitest run` dies inside pnpm's own
`runDepsStatusCheck` before any test runs. It was abandoned in favour of the
in-worktree clean-tree run above, which is the stronger comparison anyway
(same worktree, same link layout, same environment).

### 3.4 Restore integrity after the stash round-trip

All four files re-hashed after restore — identical to pre-stash:

| file | md5 |
|---|---|
| `packages/client-agent-team/src/client/team-tab.ts` | `8840739e0611aa8c32f282044bc46b75` |
| `packages/client-agent-team/src/client/team-tab-body.tsx` | `c0c461c0464de0a5cdfb81a2c7737a71` |
| `packages/client-agent-team/src/client/index.ts` | `d945c5fb57fb8719a25c5814827f0e78` |
| `packages/client-agent-team/tests/team-tab.client.spec.tsx` | `c70727a1d08923f9e01a91725f88e5c4` |

Working tree after restore: ` M packages/client-agent-team/src/client/index.ts`
plus the three untracked new files — no generated drift from `generate:typert`.

Baseline suite log: `d2-baseline-suite.log` (this directory).
Staged pre-stash backups: `/home/ddv/work/a9/d2-backup/`.

## 5. Live-bundle cross-check script

A machine fact, deliberately outside the repo: `evidence/live-bundle-check.sh`
prints every row of the §1 table straight out of
`/home/ddv/dsh-test/profiles/web/node_modules/@michengai/dsh-automation/lib/client.js`
(md5 included), so a re-run against a future version is a one-command audit
rather than a re-read.

## 6. Scope and safety boundaries honoured

- No `pnpm add`. No new dependency anywhere.
- No `apps/web/dist` build in the shared harness checkout.
- No `git add -A`; only the four owned files are staged.
- `generate:typert` run before the suite (produces no diff in this worktree).
- No live-service mutation: TEST (pid up, `NRestarts=0`) untouched; ledger head
  is whatever Lead/DevOps last reported, not something D2 changed.
- Private-key insert used for TEST-3 only per ruling v0.6.1. It is never
  promoted to PROD without a separate human decision, and it stands down (no
  throw, rail entry preserved) if the key or `insert` ever disappears.
