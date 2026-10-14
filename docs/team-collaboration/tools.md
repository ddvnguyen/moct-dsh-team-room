# Eight-tool protocol

English | [中文](tools.zh.md)

Successful and rejected tool results return through the normal model loop. `context_rollover` and `context_checkpoint` conclude the Agent turn — a rollover must not be followed by old-generation work, and a checkpoint resolves at its containing turn's end; every other Team tool does not.

## `team_view`

`team_view` is the address book: bounded authorized Channel, top-level Thread, and Member summaries — current addresses, not a work queue; unread work lives in `team_inbox`. Threads are the sole paginated catalog: rows are newest-first and carry threadRef, Channel ref, a bounded anchor subject, and Task standing inline on taskful Threads (Task ref, number, status/resolution) — never a second Task index, and never revision or message count, because neither changes the next legal action.

An `active task threads` section follows the Members list on the first page: every in_progress / in_review Task Thread in the reader's authorized Channels of the Workspace, newest activity first, each row carrying its threadRef, Channel ref, status, Task number, the Members on its live Claims, a bounded anchor subject, and last-activity instant.

Its admission is the Task being active, not the reader's participation, and a Thread still holding the reader's unread is not excluded — it answers "who is already on what" independently of the unread queue. The tool guidance points the reader here when a Workspace change surprises them, or before they claim or commit, so in-flight work reads as such instead of a conflict; it is not the unread queue, which stays in `team_inbox`.

The cursor pages Thread rows only; continuation pages render Threads alone, and paging reaches every authorized top-level Thread, including taskless and off-page taskful ones. The footer calls the value a Thread cursor and says whether older Thread anchors remain.

## `team_inbox`

`team_inbox` lists bounded body-free unread Thread summaries. Direct requests sort before ordinary unread, then by newest relevant sequence; listing does not mark read. The header states the total unread and direct counts and the number of Threads shown, with a truncation conclusion when unread work lies beyond the bounded list; each row shows its exact unread and direct counts, Channel ref, and Task standing when taskful. This is the reader's own unread queue; to see work others have in flight regardless of unread, use the active-task-threads section of `team_view`.

The footer routes body reading and acknowledgement to `team_thread read`; the render carries no revision and no write token — a current read is the required mutation basis, and it supplies the token.

## `team_thread`

`team_thread` reads one Thread. `threadRef` is primary; `taskRef` is a compatibility alias for released task-only Clients on taskful Threads.

`read` returns one chronological unread batch and advances the watermark. A read with nothing unread for its reader advances nothing and writes no operation, and an identical retry of a committed read returns that read's original receipt with a picture derived from the current projection, because a read has never promised a frozen answer. `history` pages older facts. `message` reads one Message back verbatim by its ref, which is the way to answer a quote whose original sits outside the page you hold.

`beforeSequence` and `limit` are history-only parameters. `read` drains unread and cannot page, so any other action carrying them is refused with the `action: history` route.

The three actions share no maximal render: reading shows the Thread, and only reading does. There is no Attention action here, because Attention is a different question with a different parameter pocket — see `team_attention`.

`message` renders the ref, the sequence with its instant and sender, and then the body whole: this one action exists so a reader can answer a Message it did not receive, so nothing is trimmed and the orientation is unchanged.

A read renders outcome first (acknowledged and remaining unread counts), then Thread identity and following state, then orientation (the full anchor when the returned facts carry Host-supplied background, the bounded anchor subject otherwise, and never a duplicate when the anchor is itself a returned fact), then active Claims only — the current collision surface, one line per Claim (claim ref, owner, direction) — then the chronological facts with inline unread/direct markers, and a footer stating the read-through sequence and the remaining unread count.

When the read left Thread facts behind it, a further line states how many those are, so a returning reader sees the size of the span it is not looking at instead of assuming the batch is the Thread.

A history page renders a historical outcome with Thread identity, the full anchor on a first page and the bounded subject on continuation pages, the selected facts, and the cursor/hasMore footer — never current Claims or advice. Every activity fact is structured — actor, Task ref, and the Claim refs an activity claimed, completed, accepted, or released — never a bare kind.

When a `read` acknowledges an unread acceptance of a still-done Task, the result carries a `contextAdvice` section: the reading Member's measured usage, the route's budgets, the Task-boundary threshold `min(128_000, effective handoffAt)`, and one action — keep the current context, roll over fresh after the closeout, or compact in place at the handoff budget. Advice is a recommendation only: the Host never checkpoints, rolls over, or compacts on an acceptance, and a measurement failure degrades to an explicit `unavailable` line instead of reversing the committed read.

History and repeat reads carry no advice.

## `team_attention`

`team_attention` answers one question — am I following this Thread, and should I be? `status` reports the current state and changes nothing; `follow` starts receiving the Thread's updates; `unfollow` stops them. All three take the same parameters: the Thread address and the routing Workspace. `threadRef` is primary, with `taskRef` as the compatibility alias.

Attention is not reading. None of these actions render the Thread's facts, acknowledge unread work, or hand off a write token, and reading a Thread never changes whether you follow it. The result shape carries the address, the Task standing, and the following state — and nothing else, so an Attention result cannot drift into showing Thread content.

The split from `team_thread` is what makes the read path carry no Attention logic at all: the three actions share one parameter pocket instead of borrowing a read pocket with three parameters (`messageRef`, `beforeSequence`, `limit`) they can never accept.

`status` produces no semantic boundary — it reports and changes nothing, the same rule `list` follows on Claims and `read` follows on Threads. A successful `follow` or `unfollow` anchors one boundary.

## `team_message`

`team_message.start` creates a top-level Thread and defaults taskless; explicit task intent atomically creates a Task. `reply` appends to an existing Thread. Both accept absolute attachment paths; Host validates and caches all paths atomically. A committed start or reply renders one committed-verb outcome — Thread created or reply added — with the Message ref, the new Thread ref (and Task ref when taskful), and exactly one next-write token hand-off, so the created Thread is immediately addressable and the next mutation has its basis.

Typed rejection results (`unread_required`, `stale_revision`) begin `Not committed` and keep the structured refs and counts needed to reread and retry deliberately. They also render the facts that gated the write — the unread batch for `unread_required`, the increment past the obsolete token for `stale_revision` — in the same shape a `team_thread read` returns them, and hand back the current revision as the next write token. A rejected writer learns what changed and which token to use from the rejection itself, and the retry commits with no intervening read.

Recovery is still read-and-reconsider: the rejection's facts are the gate, not a substitute for acknowledging them. A mention of a Member the Thread has never carried is not a rejection: the Message commits and the result reports the undelivered names.

Every rejection — a typed result, a thrown parameter-shape error, or a Host refusal — names the next action and the value that action takes, and those words come from one registry (`packages/agent-team/src/recovery-hints.ts`) rather than from each call site. The registry is enforced, not advisory: a test walks the model-facing sources of both the Host and the tool package and refuses a route sentence written outside the registry, so a new rejection cannot ship with a fault the model has no way out of.

`reply` also takes `replyToMessageRef`, which names the Message on this Thread being answered. The Host resolves it against the ledger and refuses a ref that is unknown or belongs to another Thread, so a stored reply always has a parent a reader can be taken to.

The link is recorded on the Message, renders as a quote the reader can follow back, and adds the parent's author to the recipients — answering a peer reaches them the way a mention does, without repeating their handle. The Human is never added, because they read the Thread directly.

## `team_dm`

`team_dm` sends a private direct message to one enabled Agent Member in the same Workspace. It takes a `memberRef` and a `body` and nothing else — no Thread, no Task, no write token, and no attachments — because a DM addresses a person rather than a conversation. A stray parameter is refused rather than ignored, so a model that reached for a Thread write's shape meant a Thread reply and gets told so.

A DM is pure delivery: the ledger appends an audit-only `team/dm-sent` operation (request-idempotent) while the recipient's live session receives the body as a relay-form injected user message — idle recipients get a new turn, busy ones are steered into the current turn. DMs create no Channel, Thread, revision, Attention, or Inbox markers and wake no change waiters. The Human cannot be DMed.

The first line of every result says which of the two it was: delivered, or recorded without a live session to wake. There is no automatic redelivery, so a recorded-only DM is never blindly resent.

Use DMs for quick clarifications and status syncs only. Task work, decisions, and anything needing team visibility or traceability belong in Threads, and an exchange passing about 3 round trips should move to a Thread because each DM costs the recipient a full agent turn.

## `team_claim`

`team_claim` lists and mutates only the Agent's own Direction Claims on real Tasks. Taskless Threads have no Claim mutation. A Direction is one sentence describing the Agent's angle; plans and acceptance checklists belong in Thread messages. A successful Claim starts Attention. `list` renders the Task/Thread identity with the active collision surface — active Claims only, or an explicit none — and no write token, because a current `team_thread read` remains the required mutation basis.

A committed mutation names its action (Claim created, completed, or released), renders the authoritative affected Claim first — ref, resulting state, owner, direction — then Task/Thread identity, and exactly one next-write token hand-off. Rejection results (`unread_required`, `stale_revision`) share the message rejection form: `Not committed`, local refs/counts, the facts that gated the write, read-before-retry recovery, and the current revision as the next write token.

## `context_rollover`

`context_rollover` schedules one rollover of the calling Member into a fresh context. The Agent passes a private `handoff` (plus optional `relatedFiles`, or a `checkpointRef` to return to a recorded checkpoint instead). The `checkpointRef` is copy-hardened on both the tool and parameter descriptions: omit it for ordinary generation changes and pressure-driven handoffs, and supply it only when citing the exact ref a `context_status` result listed as restorable — never a synthesized or guessed one.

The tool only validates and returns `status: 'scheduled'` after concluding the turn — it performs no lifecycle or Inbox side effect in the tool body.

The Host reacts only after the successful `tool/result` is durably appended: it waits for the containing turn and true idle, commits one idempotent `team/member-session-rolled-over` operation (Member actor, self-scoped, recording previous/new Session ids, the successful handoff result sequence, and trigger — never handoff prose), disposes the old Agent, archives the old Session, and activates a fresh Session with the handoff as its first model-facing context. Member identity, model, private memory, skills, Claims, and Attention survive.

Without a `checkpointRef` the new Session inherits no old event/chunk history; with one it seeds the recorded checkpoint's exact completed-turn prefix (marked seeded, its inherited history inert) — the ledger never records handoff prose. Non-Team input that arrived after the intent is carried into the new generation once; stale Team Inbox notices are discarded and rederived from the ledger.

A failed or dangling call schedules nothing, and a landed failed result consumes its paired open call in the projection — a provider retry reusing the same call id folds its own fresh arguments, never the failed call's stale ones.

A `checkpointRef` return is prevalidated at tool time through the same resolver the swap uses: a ref that is fabricated, unresolved, unattributable, nonshrinking, unmeasurable, over-budget, or blocked by multiple active Claims rejects as a model-visible error result instead of a fake `scheduled` whose async swap always fails.

The mutable guard set (jobs, route limits, lineage growth) is revalidated at the lifecycle commit seam, so a rollover that passes tool-time validation can still fail there and leave the old generation recoverable — a later-turn fresh rollover replaces the spent intent and recovers the Member.

Request and new-Session identity derive stably from the calling Member's bound Session plus the tool call id, so a crash between result durability and the swap replays to the same generation.

A rollover is refused while the Member owns jobs that would not survive the switch — any running/stopping job, and any settled job whose terminal output was never reported; the rejection names the jobs and directs the Member to collect or stop them first.

A restart that lands between the durable rollover commit and the new Session's activation reconstructs the handoff from the previous Session's durable intent instead of treating the Member as blank: the ledger's recorded previous Session is the lineage source even when the new Session never materialized before the crash, and reconstruction is idempotent — a generation whose own log already carries a handoff never receives a second one.

## `context_checkpoint`

`context_checkpoint` records one named checkpoint of the calling Member's current context. Like `context_rollover` it performs no lifecycle side effect in the tool body: the durable checkpoint is the successful `tool/call`+`tool/result` pair the Session projection folds, and the returned ref is deterministic from the Member Session identity plus the tool call id, so the model can cite it before the result exists and a repeated provider call id in another generation never collides.

The checkpoint resolves at its containing turn's end, so the model records it as the final action of a completed unit of work; after the turn the Host schedules one quiet continuation message so the Member can keep working toward the recorded anchor. Delivery is exactly-once across restarts: the projection's delivery record is durable, and a checkpoint whose continuation already landed is never re-scheduled.

## `context_status`

`context_status` returns one bounded structural view of the Member's context generations across the current Session and its archived ancestor lineage: recorded checkpoints (with the completed turn each anchors to, and whether its quiet continuation was delivered), plus handoff, Team-boundary, and compaction boundaries — each with the Threads whose facts entered the Member's context by that anchor, derived only from delivered Session facts, never from unread ledger activity.

It reports the Member's usage against the handoff budget and the hard limit, and — where the Member's preset scope can price one — what a compaction started now would replace.

The definition is the engine's (`createContinuityTools`), not the Team's: the Team supplies the adapter behind it and the glossary it splices into the description, so the surface and the engine's own copy cannot drift apart.

A fresh `context_rollover` (no `checkpointRef`) never requires reading the status first; the status is for picking a checkpointRef return or confirming that a fresh handoff is the better path.

Team boundaries anchor on effect, not push. A committed `team_message` (a start's Thread is attributed from the durable presentation meta of its result, a reply's from its call arguments), a successful `team_claim` mutation, and a successful `team_attention` follow/unfollow each anchor one boundary, labeled by action class (`Team message`, `Team task claim change`, `Team attention change`). A typed rejection (`unread_required`, `stale_revision`), a failed call, a dm, or the read path (`team_inbox`, `team_view`, `team_thread read`) never does.

On the push side, only a Thread's FIRST delivered notice anchors — the preserved "work just arrived" anchor, labeled with the Thread refs it first introduced (`First arrival: …`) instead of the notice's own generic account — while later re-deliveries of the same Thread and pure reminders (recovery notices, and the progress-nudge notices recorded before that system was removed) produce nothing.

A Team boundary is a selectable default checkpoint exactly when the retained prefix through it stays inside one Thread — exactly one Thread's facts entered the Member's context by that anchor — and the return would shrink the working set below the handoff budget; Thread attribution comes from delivered notice bodies, claim mutations' Task overlays resolved through the ledger, and committed message calls' refs, and a prefix that spans several Threads (or holds none) carries its reason instead.

A handoff or a compaction boundary is never a return target: it closed a context rather than opened a topic. The rule is judged on the retained prefix, never on the boundary's own contribution.

The rule itself is the engine's shared anchor policy, applied once for both surfaces. Team declares only the part its own vocabulary can state — which of its boundary kinds close a context rather than open a topic (`boundaryRestorableFor`) — and the nouns its reasons are worded in. So a ref the timeline offers is a ref `context_rollover` accepts, rather than two copies of one rule agreeing by accident. Default-boundary refs are session-scoped, so consecutive generations anchoring at the same event seq never collide. Structural only — no transcript content.

Every row is rendered by the engine. On a row that is not restorable the Team answers with a short stable `anchor` digest of that row's own ref instead of the ref itself: rows that share a name and a price stay distinguishable, and no non-selectable row ever carries a citable string — only the `ref` printed on a restorable row may be cited to `context_rollover`.

A `context_rollover` call with a `checkpointRef` rolls the Member back to that checkpoint's exact completed-turn prefix: the seed is the durable prefix through the checkpoint's `turn/end`, balanced by construction, and the child Session parents at the seed source while inherited checkpoints stay inert history (no inherited intent fires in the child).

Return is rejected under the same conditions the `context_rollover` tool prevalidates — unresolved, nonshrinking, over-budget, or multiple active Claims (a rewind cannot be proven to stay inside one Thread); in every rejection case a fresh handoff is the documented alternative. A context return re-reads history; it never claims to revert external effects.

Seed costs are priced node by node from the source Session's own replayed measurement, so the retained figure is the exact cost of the kept prefix rather than a share of the log — an oversized tool result inside that prefix prices as what it is. A source whose cost cannot be measured is not selectable (the budget cannot be proven); the discarded figure for an ancestor anchor approximates the current generation's whole usage.

When an ancestor cannot be read, the walk stops there and the result carries `incompleteFrom` (the ancestor's id and the failure reason): history is complete through the last listed source and provably absent beyond it, which is a fact about history, never about Member availability.

## `context_compact`

`context_compact` shortens the calling Member's current generation in place: the engine replaces one stretch of older history with a summary and keeps the Member's newest work verbatim. It never switches generation and never returns to an anchor — `context_rollover` owns both.

The Team answers the engine's two questions about that stretch from the Member's own preset scope: which compaction engine serves it, and what its surface costs. The same meter the pressure policy reads prices the range, so what a compaction replaces and what a `context_status` promised cannot disagree.

A Member whose preset mounts no compaction engine is told the capability is not available in this scope — never a silent no-op — and a context with nothing safe to replace reports that this context is unchanged.

## `team_doc`

`team_doc` writes a Team Document and asks for the Human's review: `create` (a Thread, a title, an outline of headings), `write` (one section: `sectionId` replaces it, no `sectionId` appends one; only the Doc's author and the Human may write, any other Member is refused), `submit`, `read`, `list` (a Thread's Docs), `comment` (a quoted passage, or a reply through `parentCommentRef`), `resolve` (a comment thread, by its root `commentRef`), and `history` (one section's versions, newest first).

Every result renders the Doc revision, which the next `write` passes as `baseDocRevision` and `submit` passes as `docRevision`. A stale revision writes nothing and says to read the Doc again; it never uses the Thread's next-write token.

After `submit` the author waits for the verdict, which arrives as a Thread mention: approved, changes requested (read the Doc, answer the delivered comments, revise, submit again), or cancelled. `read` renders Doc text and comments as Team data, not instructions, and marks a section the Human edited last. Only the Human gives a verdict, from the Doc page; no tool can.

## Team memory: `memory_note`, `memory_search`, `memory_get`

Three Team memory tools sit beside the protocol tools. They read and write the MOCT Team Room backend's typed memory records (`/team/v1/memory`, schema v8): rule, convention, decision, how_to_work, task, and branch, each filed under a home (task, Channel, Team, or expert). Without `MOCT_TEAM_URL` they refuse with `BACKEND_UNAVAILABLE`; a backend without the v8 routes answers `MEMORY_UNSUPPORTED`.

Identity and scope come from the Session only. The Host resolves the actor (the seat's Member id), the Workspace, the Member's own Channels, and the Thread this slot's Turn was delivered for. No parameter names an actor, a reader scope, or a home ref, and the tool copies its declared fields one by one, so an invented argument never reaches the backend.

A `threadRef` argument can only narrow to a Thread in one of the Member's Channels — any other is refused with `SCOPE_FORBIDDEN`. The role comes from the backend's `orchestrators` setting alone: an orchestrator reads the whole Workspace, everyone else reads with their Channels, and a failed or timed-out settings read counts as a worker, never as `all`.

`memory_note` creates a record, or updates one the reader can see (`id` + `baseVersion`). The model picks the type and, within the type's allowed homes, the home kind; the ref is the current Task, the current Channel, the Workspace, or the Member itself.

A note close to an existing one is not saved: the result lists the near matches, and `confirmNew` is the only way past them. The result carries the backend's notice, and a pending record says it is not live until an orchestrator or the Human approves it.

`memory_search` and `memory_get` render records as Team data, not instructions; `memory_get` reports ids outside the reader's scope as missing. The human-only verbs (approve, restore, purge, settings) and the curation verbs (widen, retract, pin) are not tools.

Every step, the member-context row also injects a `<team-memory>` block as its own message, beside the identity block and re-entered only when its text changes.

It opens with one line saying the notes are Team data to weigh and never override system, developer, user, or Workspace instructions, and a literal frame marker inside a record is escaped.

The block comes from the backend's inject route for the current Task and Channel, cached for a minute; a down, slow (over 1.5 s), or pre-v8 backend yields no block and one warning per outage, and never fails or holds the step.

## The Human's Memory page

The human-only and curation verbs live on the Team Settings page instead, in a Memory section under the Agents for the same Workspace: records (the pending queue first), the task picture grouped by Channel, the rule feed, each home's use of the always-load cap, and the memory settings.

The page reaches the backend through seven Host methods — `memoryList`, `memoryRecord`, `memoryRuleFeed`, `memoryUsage`, `memorySettings`, `updateMemorySettings`, `memoryAct`. Each request names only its Workspace, which must be one the Host knows; the Host adds the ledger's Human Member as the actor and reads with the whole Workspace in scope. A ledger with no Human Member refuses with `NO_HUMAN`.

`memoryAct` takes a closed set of verbs: approve, retract, restore, purge, widen, edit, and pin. Purge needs `confirm` to be the record's title or id, checked against the record the Host reads, and a missing confirm is refused before any backend call. Widen needs `confirm: true`; the dialog first says how the expiry changes, and that a team-scope rule still needs the Human.

`updateMemorySettings` writes only `expertApproval`, `orchestrators` (each one an agent Member of the Workspace), and `injectLayerTokens` (within the backend's bounds). Answers carry the backend's code, so a `CONFLICT` reloads the record instead of retrying. Record text renders as plain text, never as markup.
