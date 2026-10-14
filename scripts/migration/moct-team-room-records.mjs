// The MOCT Team Room team's own memory, curated by hand from its contract
// (moct-team-room-contract.md v0.11.0), the human directives it cites and the
// lane Tasks. Nothing here comes from another project. A re-run is keyed by
// (home, type, exact title): the title is the stable key.

export const WORKSPACE_ID = 'eda6b45f-66d5-49da-864b-6079e4b50e9f'
export const CHANNEL_REF = 'channel:7ebe3ec3-32c0-45b4-bed6-86e198e14d93'
const SRC = 'contract'

/** @typedef {{ type: string, home: { kind: 'team'|'channel'|'task', ref: string }, title: string, body: string, attrs?: Record<string, unknown>, source: string }} MigrationRecord */

const team = { kind: 'team', ref: WORKSPACE_ID }
const channel = { kind: 'channel', ref: CHANNEL_REF }
const taskHome = (uuid) => ({ kind: 'task', ref: `task:${uuid}` })
const rule = (title, body, source, level = 'must') => ({ type: 'rule', home: team, title, body, attrs: { level }, source })
const convention = (title, body, source) => ({ type: 'convention', home: team, title, body, source })
const decision = (title, body, source, decidedBy, sourceRef, date) => ({ type: 'decision', home: channel, title, body, attrs: { decidedBy, sourceRef, date }, source })
const task = (uuid, threadUuid, title, body, owner) => ({ type: 'task', home: taskHome(uuid), title, body, attrs: { taskRef: `task:${uuid}`, threadRef: `thread:${threadUuid}`, state: 'open', ...(owner === undefined ? {} : { owner }) }, source: 'lane Task' })

/** @type {readonly MigrationRecord[]} */
export const RECORDS = [
  // ---- team home: rules and conventions ----
  rule('Fail closed when the MOCT backend is down',
    'A ledger write fails with a visible banner when the MOCT backend is down. There is no local fallback store, because two stores would split the brain. Reads of cached data may continue; writes do not.', `${SRC} §0 rule 4, §2`),
  rule('Never fabricate: unknown is null, shown as an em dash',
    'Unknown usage, cache or input split is stored as null and shown as an em dash, never as 0. An unrecorded Turn is counted and logged, not folded into zero. A session with unknownInputTurns > 0 carries a partial marker.', `${SRC} §0 rule 3, §3.2`),
  rule('Additive only: new op kinds and RPCs are added, never changed',
    'The agentTeam RPC stays byte-compatible with upstream; only methods are added. New operation kinds are forward-only: a build that does not know a kind cannot open the log, so rollback is a fresh MOCT_TEAM_WORKSPACE, never record deletion. Send the Architect the shape before adding any op kind or schema change.', `${SRC} §0 rule 2, §19`),
  rule('Gates: the Architect gates TEST, the human gates PROD',
    'The Architect gates every TEST deploy and merges by sha. The human gates PROD; PROD stays untouched until the human validates TEST and says go. The Lead role is read-only: it dispatches and verifies, workers implement.', `${SRC} header, §0 rule 6`),
  rule('DONE only on measurement: a separate read after the write',
    'A status line saying done, verified or fixed cites a measurement taken in the same turn by a separate read performed after the write it describes (ledger head, md5/sha, HTTP status with URL, file path, Playwright/DOM measurement). The command that performs a change is never its own evidence. Verdict labels STUB-LOGIC-VERIFIED and BLOCKED-REAL-PROVIDER are never rounded up to PASS.', `${SRC} §16 rules 1-2, §0 rule 5`),
  rule('Announce live-service mutations; high-blast operations are two-phase',
    'Restarts, live-tree edits and config changes are announced one line before execution. High-blast operations (credentials, restarts, live-tree mutations) are two-phase: the executing seat posts "executed - awaiting verification" with its evidence and an independent verifier posts DONE. No seat self-certifies. Corrections to an unverified claim are published as fast as the claim, in the same thread.', `${SRC} §16 rules 3-5`),
  rule('Credentials never appear in threads, logs, commits, artifacts or memory',
    'A secret is never printed in a thread, log, journal line, commit, artifact or memory record. It is applied through a mode-600 EnvironmentFile or the dsh credentials store via a systemd drop-in, and verified by one call that returns 200, not by showing the key. Never read keys from /proc, never disguise requests, no IP pool or rate-limit evasion.', `${SRC} §12.1 Q2, §16 incident log`),
  rule('Scratch and work trees live under /mnt/workspace, never /tmp',
    'No agent keeps a workspace, clone, build tree or scratch file under /tmp (a 4 GB tmpfs that filled to 100%). Use /mnt/workspace (XFS). Do not create anything new under /mnt/WorkDisk (NTFS, no free inodes). Clean shared /tmp only as a joint human and DevOps action.', `${SRC} §18`),
  rule('List every seat\'s provider before any preset or restart change',
    'The team-member preset stays native. team-member-ptc (PTC) is for native dsh-provider seats only: claude-code seats cannot use PTC because their MCP bridge exposes only run_code under PTC. A Member\'s presetId is fixed at addMember. A PTC preset applied without checking seat providers broke the claude-code seats on PROD and was rolled back; keep an auto-rollback script for preset changes.', `${SRC} §17, §16 incident log`, 'should'),
  convention('Planning lives in GitHub issues and a Project; each issue is a Thread Task',
    'Detailed planning is in GitHub issues and a Project in ddvnguyen/moct-dsh-team-room (board: github.com/users/ddvnguyen/projects/4 "MOCT Team Room"). Each issue is assigned as a Thread Task to 1-2 Members to keep team noise low. The Task carries its issue and PR, so the Task overview is the one place showing summary, progress, issue and PR.', `${SRC} §15.1, §19.3 (human fact 3709)`),
  convention('Environments, repos and ports',
    'Backend: ddvnguyen/moct (TypeScript daemon, embedded Turso, /team/v1, loopback, no auth). Client plugin: ddvnguyen/moct-dsh-team-room (fork of Contexera/dsh-agent-team), PRs into integration/test-4. Ports are loopback only: TEST 8110, PROD 8111. TEST has its own fresh DB; the plugin is deployed by copying a build to ~/.dsh/plugins/moct-dsh-team-room/<version>/ and repointing the profile (rollback = repoint).', `${SRC} §1, §8 items 1, 6, 7`),

  // ---- channel home: decisions ----
  decision('One MOCT database, event-sourced; replace the storage seam, not the ledger',
    'The Team Room ledger is event-sourced: every change is an append-only operation and state is a replay. The ledger uses one table (put/entries), so the MOCT-backed table replaces that seam. The ledger itself is not rewritten and old ledgers replay unchanged. Task mirroring to Python MOCT is the only bridge and is post-first-PROD.', 'contract §0 finding 1, §1', 'Architect', 'contract:§0', '2026-10-11'),
  decision('Sessions: history per Agent now, a session per Thread and Channel as the end state',
    'Human answer (thread:39694c74 fact 1268): per-Agent session history is fine now; the END STATE is each Thread and each Channel having its own session, while the seat shares memory and the context summary. The Agent detail view must not assume one session per Member: the list is keyed by sessionId with threadRefs. Concurrent per-Thread sessions arrive as task #16 (threadSessions, same SessionRun shape).', 'contract §11, §12.1 Q1', 'human', 'thread:39694c74', '2026-10-11'),
  decision('Summary model, cache TTL and thread lock settings',
    'Summary model is configurable; default dsh-opencode-go/mimo-v2.6-flash (alternative gpt-6-luna). Cache TTL is one global 5 minutes first, but the config shape is per-provider (cacheTtlSeconds: {default: 300, "<provider>": n}). No hard thread lock in v1; when summaries exist, renewal happens in the same Thread from the summary with a visible "resumed from summary" marker (bind reason resumed-from-summary).', 'contract §8 items 2-4', 'human', 'thread:39694c74', '2026-10-11'),
  decision('TEST carries the PROD OpenCode credential and most PROD plugins',
    'The human decided that TEST uses the same OpenCode credential as PROD and carries most PROD plugins (Group B mirror). Held exceptions: wowyuarm-agent-team-host and any row that registers the agent-team service (conflicts with the fork), and mcp-moct until a TEST target is chosen (it would write to the live Python MOCT). DevOps posts the exact row list before applying; each tranche carries a token-less boot check.', 'contract §12.1 Q2', 'human', 'thread:39694c74', '2026-10-11'),
  decision('PROD cutover: runbook yes, deploy only after the human validates TEST',
    'The PROD cutover runbook is written (backup via SQLite backup API, freeze, export, import, switch by systemd drop-in, after-set, unfreeze) but PROD deploy waits for the human\'s validation on TEST and an explicit go. Rollback after the first fork write loses new facts unless a replay script exists; the human must decide that policy before PROD. Task mirroring and the leader heartbeat move to a later release.', 'contract §12.1 Q3, Q5, §13', 'human', 'thread:39694c74', '2026-10-11'),
  decision('Agent detail: session history first; Member private memory stays out of the UI',
    'Agent detail (A14) lists every session run newest first: short id with copy, active marker, Channel and Thread names (+N), start/end, turns, tokens in/out/cache read/write (em dash for null, partial marker), tool calls, run time, model. Clicking a row opens the native dsh session view, or shows "not available". A Member\'s private memory is not Team data and is not shown (A15); Team memory records may be read by the human.', 'contract §11, ruling at thread:b14dcda0 fact 3769', 'human', 'thread:9fa1ae3a', '2026-10-15'),
  decision('Team tab strip uses the native tab registry; not promoted to PROD without a human decision',
    'The sidebar tab strip is owned by @michengai/dsh-automation. The Team and Agents tabs are inserted through its undocumented __dshNativeTabs registry, feature-detected (never throw), with the automation package version pinned and a test that fails loudly if the key disappears. This depends on a private key of a third-party package, so it is not promoted to PROD without a separate human decision.', 'contract §10 A10 ruling', 'Architect', 'contract:§10', '2026-10-11'),
  decision('Team Room Next batch L1-L5 and what needs a contract change',
    'Human batch (facts 3696/3709): L1 Thread header and members, L2 Agents tab and Agent detail, L4 Team Settings tabs need no contract change. L3 Room detail adds one read RPC (roomActivity), no new op. L5 adds task.link.set / task.link.remove (forward-only; the URL is never stored, the client builds it from repo and number) and a taskOverview read. Noise rule: a Thread Task has 1-2 Members.', 'contract §19', 'human', 'thread:9fa1ae3a', '2026-10-15'),
  decision('Status snapshot of the MOCT Team Room track (2026-10-15)',
    'TEST runs integration/test-4 with the Agents tab (#56) and the A7b seed (#55). Merged: #62 Agent detail Sessions tab. Open PRs: #63 Agent row opens detail, #64 Agent detail Memory tab; #16 per-Thread sessions (DevWorker#02/Leader); L1 Thread header (DevWorker#01); L3, L4, L5 not started. Memory M1-M3 (typed-record backend, tools and injection, Human Memory page) are owned by the memory threads. PROD untouched and human-gated.', 'state snapshot (latest-status.md is a rolling log from 2026-10-11; this record is the current state)', 'Architect', 'thread:b14dcda0', '2026-10-15'),

  // ---- task home: one record per lane Task ----
  task('faa32e44-5d65-4d1e-bbe9-16dee55eafd6', 'dab7d42b-4d14-4a8a-9c65-92022966e4a3', 'Expert Agent multiple session support (#16)', 'Concurrent per-Thread sessions per Agent (threadSessions, same SessionRun shape as memberSessions). Owner lanes: DevWorker#02 and Leader.', 'DevWorker#02'),
  task('b2adb9ec-bc59-44c1-970f-8737ede47c4d', '34759ca5-e571-4a49-a0c8-e37fe2554a68', 'L6 planning: break the batch into GitHub issues and a Project (#17)', 'Plan for L1-L5 as GitHub issues #57-#61 and the Project; includes the MOCT-Team-only memory migration.', 'Leader'),
  task('cc14f01a-dbaf-48f1-b09d-d2de20757a17', 'bf28e46d-3fa2-4799-96d3-bf90f8991f0f', 'L1 Thread header and members (#18, issue #57)', 'Convert-to-Task far right, open-sidebar button, Manage members, Thread activity line. Client plus existing ops.', 'DevWorker#01'),
  task('bb5e1158-5ee0-4b8a-a3b7-2336dc95a981', '296a6378-85b3-40f9-b968-774a4cd08dd7', 'L2 Agents tab, Agent detail and MOCT Team memory (#19, issue #58)', 'Strip Tasks | Team | Agents | Scheduled; Agent detail with Sessions first, a Session opens the native chat view; Memory tab reads Team memory. PRs #56 and #62 merged; #63 and #64 open.', 'Claude Engineer'),
  task('7deb1072-aa65-4e35-b49d-7b090b104be9', '0acdd8e4-aee3-4f00-ae62-4e489a33bbc4', 'L4 Team Settings redesign (#20, issue #59)', 'Team Settings in DSH style, one tab per section.'),
  task('dec811d9-2f54-4d4b-a155-af510702dd4b', '9e1b314b-f37d-43a5-b88a-a71184e1f87a', 'L3 Room detail view (#21, issue #60)', 'roomActivity read RPC plus per-agent analytics (contract §19.1). No new op kind.'),
  task('66675f32-ecbc-4137-8213-b3757039a975', '14d78582-71ce-4c31-a285-5c6f851b9da3', 'L5 Task overview and GitHub issue/PR links (#22, issue #61)', 'task.link.set / task.link.remove ops and taskOverview read (contract §19.2).'),
]
