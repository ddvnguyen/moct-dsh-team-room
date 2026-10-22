# The dsh-market trusted-authority patch

English | [中文](dsh-market-trusted-host-patch.zh.md)

## Why a patch exists

The dsh-market's ordinary routes honour the host's **declared** authorities (`dsh web --trusted-host <name>`) through `sameOrigin`. Its privileged routes — the backup export, the self-uninstall, the one-click restart — did not: they demanded a direct loopback peer.

A lane reached through a Cloudflare tunnel dials `10.88.0.1:318x`, so the peer is the proxy and every privileged route answered 403 while every ordinary route answered 200. The user has no way to satisfy the rule: a tunnel's peer is never loopback.

The patch gives the privileged routes the same authority rule the ordinary ones already have, and keeps everything that protects them: an undeclared name is still refused, a loopback `Host` still has to arrive from a loopback peer, a cross-site browser is refused outright, and a present `Origin` must still name the `Host`.

## What the patch is

Three files, and the split between them matters:

- `scripts/dsh-market-trusted-host-patch/edits.mjs` — the anchored edits, one per file, with the security argument written down next to them.
- `scripts/dsh-market-trusted-host-patch/apply.mjs` — the applier: anchored, idempotent, parse-checked before it writes, with `--check` and `--verify`.
- `scripts/check-dsh-market-patch.mjs` — the check, run against the **real published package**.

The edits are anchored, not a diff: a market release that keeps the anchors needs no new patch file, and a release that moves one fails loudly with the edit's id, leaving the installed package untouched.

## The upstream change it mirrors

The upstream change is **dsh-market PR #958**, merged into `main` on 2026-10-20 from `fix/956-serving-port`. It carries the same fence change and completes PR #956, which was closed without being merged (its base was `nightly1014`).

Upstream named the same two symbols this patch introduces — `declaredTrustedHosts` in the fence's own module, `servedAuthority` in the restart fence — so the applier recognises a release that shipped the fix and leaves it alone. `1.66.37` and `1.66.45` lack them, but `1.66.46` (published 2026-10-21) and every later release carry both: the check detects that shape and treats the patch as a no-op.

## The two shapes of a published package

A published `dshmarket` is in one of two shapes, and each has its own expectations:

| shape | what the release is | what the check asserts |
| --- | --- | --- |
| pre-fix | the release does not carry the fix yet | the patch applies; `--verify` fails on an unpatched copy; a moved anchor fails loudly, names the edit, and leaves the package untouched |
| upstream-shaped | the release ships PR #958 and already carries the fix | the patch is a no-op: nothing is written, `--verify` exits 0 |

The check exercises **both** shapes whichever one it downloaded. A pre-fix package is patched and then stripped of the pristine backups the applier keeps beside the files it patched — which is the state a release that shipped the fix is in. The applier recognises that state by its marker and writes nothing, so the day the upstream release ships, this check still passes.

## The decisions

### `--verify` proves the marker, not the behaviour

**Decision:** keep the split. `--verify` asserts that the package carries the fix — the marker the applier looks for — and nothing about how the fence answers.

**Why:** the deploy can only ask "did the patch land?", and the marker is exactly that answer. The behaviour is asserted where it can be observed against a real artifact: in `scripts/check-dsh-market-patch.mjs`, against the published package, and at the lane by the deployment's own probe.

**Consequence:** `--verify` exiting 0 is not a statement about the fence. Anyone reading it as a guarantee reads this section first.

### The check skips when the registry is unreachable

**Decision:** keep the skip (exit 0, with `skipped` in the output).

**Why:** the check asserts something about a published artifact, and a machine that cannot reach the registry cannot assert anything about it. A hard failure would make every offline development machine red for a reason that has nothing to do with the patch.

**Consequence:** a green `npm test` does **not** prove the patch — a skipped check is green. At the head of PR #159 CI did not skip: it downloaded `1.66.37` and ran every assertion. A CI job that must prove the patch reads the log for `skipped`, or the check is changed to fail there — a deliberate change, not an accident.

### The `.orig` backups land inside the installed package

**Decision:** keep the backups where the applier puts them, next to the files it patched.

**Why:** they are the pristine copy the applier compares against, and the only rollback that does not need the registry.

**Consequence:** the lane's copy of `dshmarket` carries `lib/http.js.orig` and `lib/restart.js.orig`, two files the published package does not have. Nothing imports them, and the deploy's rollback — which removes the patched target and reinstalls it — clears them. The deploy runbook in the train repository states this in one line; that line is still owed to the train repository (M-43) and is not written yet.

## What to check when dshmarket releases

1. `npm run check:market-patch` downloads the published version and prints which shape it found.
2. A pre-fix release that moves an anchor fails the check with the edit's id: adjust the anchor, do not re-author the edit.
3. An upstream-shaped release means the patch has nothing left to do — the lanes can drop the patch step in a later change.
