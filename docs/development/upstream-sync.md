# Upstream Sync

English | [中文](upstream-sync.zh.md)

This repository is a fork of [Contexera/dsh-agent-team](https://github.com/Contexera/dsh-agent-team). Upstream changes come over by `git cherry-pick -x`, in small batches, never by a full merge. Pull requests here are merged by hand, so a merge would record no shared history, and the fork already rewrote too much for one merge to stay reviewable.

## Sync state

`scripts/upstream-sync.json` is the one record of where the fork stands:

- `forkPoint`: the last upstream commit both sides share.
- `lastReviewed` and `lastReviewedOn`: the newest upstream commit a sync has decided on, and when.
- `taken`: every upstream commit brought over, with its batch, and a note when only part of it came.
- `skipped`: every upstream commit left out, with the reason. A later sync may revisit a reason.
- `renames`: the upstream package names this fork renamed.
- `hotspots`: shared files where MOCT changed the most, so conflicts there need the most care.

A `(cherry picked from commit …)` trailer on our history also counts as taken, but the JSON list is the record, because a hand merge may drop commit bodies.

## The report

`node scripts/upstream-sync.mjs` adds the `upstream` remote when it is missing, fetches it, and lists every upstream commit after `lastReviewed`:

- `new`: not yet decided. `unrecorded`: older than `lastReviewed` but in neither list, which means the JSON is incomplete.
- Each file names how far MOCT's copy differs from `lastReviewed`. A large number means the pick will conflict there.
- `renamed package name`: the commit mentions an upstream package name, so import lines need the rename.
- The last section lists files on our side that still name an upstream package. New files apply without conflict, so this is the only place that catches them.

Pass `--all` to include decided commits, `--ours <ref>` to compare another branch, `--no-fetch` to skip the fetch, and `--json` for machine-readable output.

## Procedure

1. Run the report and read each `new` commit. Group them into batches that share files, in upstream order, and decide take or skip for each.
2. Branch from `integration/test-4` and run `git cherry-pick -x <commit>` for each commit of the first batch. Stack later batches as branches on the one before, each with its own draft PR.
3. Resolve a conflict by keeping MOCT's implementation and applying what upstream meant. Keep our `CHANGELOG.md`, rename upstream package imports, and check `git status` for a modify/delete conflict an editor resolved silently.
4. Run `npm run build`, `node scripts/sync-paths.mjs`, `npm run typecheck`, `npm test`, `npm run check:docs`, and `npm run lint` on every batch. Tests import the bundle by package name, so they need the build first. A batch that changes visible UI also needs `npm run test:browser`.
5. Rerun the report: the stale package name list must be empty.
6. In the same PR as the last batch, move `lastReviewed` and `lastReviewedOn` forward and add every decided commit to `taken` or `skipped`.

## MOCT-only areas

These areas exist only in this fork. Upstream never touches them, so a conflict next to them is always ours to keep:

- MOCT storage: `moct-table.ts` and the `MOCT_TEAM_URL` routing.
- Member memory: `team-memory*.ts`, `seat-memory.ts`, `memory-tools.ts`, and the memory panel.
- Team Documents: `team-docs.ts`, `doc-tools.ts`, and the `TeamDoc*` components.
- Multi-instance seats: `member-instances.ts`, `instance-router.ts`, `warm-limit.ts`, and the `slotHandles` paths in the Host.
- Turn records and summaries: `turn-recorder.ts`, `turn-threads.ts`, `thread-summary*.ts`, `session-turn-usage.ts`.
- The two-lane view (`TeamLanes.tsx`, `lane-width.ts`), the Agent detail and Settings pages, and the composer agent picker.
- `scripts/migration/` and the `@ddvnguyen/moct-dsh-team-room` package name.

The report counts every such file as existing only here.

## Known traps

- An upstream series can be red between its own commits. On 2026-10-16, `4c9dae7` and `5ff1e8a` left two tests failing until `9a29b27` and `3a8865d`. Test each batch and pull the later fix forward into it.
- Upstream offers a mention to the whole Workspace. MOCT's agent picker keeps the Channel or Thread roster, so a pick never pulls in a stranger.
- A seat with several instances shares one Member id, so per-Member probes from upstream must read `slotHandles` as well as `handles`.
