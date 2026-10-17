# dsh-agent-team Domain Vocabulary

English | [中文](domain-model.zh.md)

## Agent Team

The single shared collaboration domain in one DSH home. It stores cross-member collaboration facts, not model context, session transcripts, or private memory.

## Member

A stable identity authorized to read, speak, claim work, and receive Inbox hints. A Member is identified by an immutable branded ref. Private memory, skills, persona, and model are Member-global facts, not per-Workspace state. The first release has Human and Agent Members.

## Workspace Participation

A join/leave relation between a Member and a Workspace, committed as ledger operations — the same relation shape as Channel membership, one rung above it (Workspace participation → Channel membership → Thread Attention). A Member's `workspaceId` records where it was created and never changes; authorization everywhere reads the current participation set, not the creation field. Joining grants collaboration immediately; it does not move or create the Member's Session. Each Member retains one Session lineage in its creation Workspace.

Joining does not create another Session or offer cwd switching; collaboration in other participated Workspaces uses the same Session. The Human Member participates in every Workspace.

## Human Member

The special Member corresponding to the current Harness user. It participates in Messages, Claims, and Activities and can manage Channels, Members, acceptance, and Task terminal state.

## Agent Member

A Member created and managed by Team. Created inside one Workspace (its creation record), it joins further Workspaces through Workspace Participation. It runs one explicit team-enabled preset Session at a time, rooted in its creation Workspace; ordinary Sessions and forks do not gain membership automatically.

## Member Capabilities

Durable capability intent on the Member entity (optional `capabilities` field: `tools.allow` and `skills.allow`), carried verbatim through every lifecycle operation and restored by Host restart replay. Pure intent: allow-list names are not validated against any known-name set at commit time — a Harness upgrade that renames or removes tools can never make an old ledger unreplayable; divergence from the names known at activation is derived as a runtime warning (`capabilityWarnings`, a projection-derived state, never persisted — persisted warnings would lie after Host restart or upgrades).

## Member Role

An optional `role` field (`architect`, `leader`, `worker`, or `orchestrator`) on the Member entity. It is a label plus a fixed prompt section in the Member's identity block, never a routing rule: unassigned Tasks stay unassigned, and the Orchestrator only reports. `addMember` sets it, `updateMember` changes it, and `null` clears it. It rides `team/member-added` and `team/member-updated`, so an older ledger without it replays unchanged and renders the identity block it had before.

## Workspace

A project and shared working directory. An Agent Member's Session cwd is the Workspace project directory; private memory lives outside the project root.

## Channel

A persistent collaboration place in a Workspace. An Agent must explicitly join to read, speak, claim, or follow; Human Members can manage and view every Workspace Channel.

## Message

Immutable content explicitly sent in a Channel or existing Thread. Every top-level Channel Message atomically creates a Thread; new Clients/tools default to a taskless Thread, while explicit 「作为任务」 creates a real Task in the same commit. A reply continues an existing Thread. Every Message carries the wall-clock instant of its committing operation; agent-facing surfaces render that instant in the fixed UTC+8 coordination zone.

## Task

An optional work-tracking overlay attached to an existing Thread, not a prerequisite for a Thread. It can be created by explicit top-level task intent or added by Human promotion. Promotion also appends a public explanation Message. Task status is derived from Claims; Human acceptance and close are explicit facts. Human-facing `Task #N` is the durable Task creation ordinal within its home Channel: taskful starts and promotions participate, while a taskless anchor's original position does not. It is not identity; stable cross-channel references use branded `taskRef`.

Acceptance normally waits for every Claim to be done (`in_review`). The Human may also accept early from `in_progress`: the accept operation projects the Claims still active at that moment to done and records them in the activity as `completedClaimRefs`, notifying each owner without fabricating owner claim-done events. A `todo` Task that was never claimed is accepted directly, and its activity carries no claim list.

## Thread

An independent, single-level public collaboration aggregate inside a Channel. It always has `threadRef`, an anchor Message, and a revision, but may have no Task. Public Messages increment revision; Taskful Claim and resolution changes do too. Existing-Thread writes require current revision. A taskless Thread still supports replies, follows, structured mentions, Inbox, reads, and history, but has no Claims, Task status, or resolution controls.

Collaboration uses `threadRef` first; a released task-only Client may use `taskRef` as a Host compatibility alias only for taskful Threads, while Task/Claim operations use `taskRef` identity. Revision is an internal concurrency token, not citable message content.

## Claim

A Member's commitment to one Direction in a Task overlay. Taskless Threads have no Claims. States are active, done, and released; after normalization, one Task has at most one active Claim for the same Direction. Multiple Claims intentionally allow different text that may describe duplicate work.

## Direction

Free-text work direction for a Claim. Comparisons apply Unicode normalization, trim, whitespace compression, and case folding; synonyms are not inferred.

## Thread Attention

A private persistent attention period for one Member and Thread: the current period's start and a contiguous read watermark. Its presence is what following means, and it is not public revision. What starts and ends a period is in [attention-and-messaging.md](team-collaboration/attention-and-messaging.md).

## Thread Inbox

Member-level unread projection derived from Thread Attention and direct mentions. It is not a Session queue, browser state, or per-message read table; its derivation and read semantics are in [attention-and-messaging.md](team-collaboration/attention-and-messaging.md), and the tool contract in [tools.md](team-collaboration/tools.md).

## Follow

An operation on Thread Attention, not an independent subscription object. Follow controls whether ordinary updates create Inbox work and does not revoke Channel visibility.

## Activity

A recorded collaboration-state fact. Claim create/done/release, Task accept/close/reopen, and promotion are public revisioned Thread facts; follow/unfollow and read watermarks are private Attention audit facts. Runtime errors may be current Human UI risk but are not ledger Activity or Inbox facts.

## Inbox Hint

A safe-boundary hint derived from durable Thread Inbox state. A hint is bounded and may wake an idle Agent or arrive at a running Agent's next safe step; it does not mean the model read, handled, replied to, or accepted anything. Durable Inbox is rediscovered after resume.

## Operation

One immutable atomic business commit in the Team ledger. Each operation has global sequence, stable operation ID, idempotent request ID, actor, one business fact, and a wall-clock `occurredAt`. Sequence — never the instant — is the ordering and concurrency authority; Thread fact envelopes project the committing operation's instant so every reread path sees one value per fact.

## Revision

The sequence of the latest operation relevant to a Thread. It is an optimistic concurrency fence, not a Message count.

## Ref

A restart-stable, typed identifier that callers cannot safely construct by concatenation. Member, Channel, Task, Thread, Message, Claim, and Operation use distinct branded refs. Attention is identified by Member plus Thread.

## Direct Message

A private Member-to-Member message, not part of any Thread. The ledger appends one audit-only `team/dm-sent` operation (request-idempotent; sender and recipient must be enabled Agent Members of the same Workspace) while the projection deliberately stays unchanged — no Channel, Thread, revision, Attention, or Inbox markers. Delivery is a transient runtime effect: an idle recipient opens a followup turn with the body as a relay-form user message, a busy one is steered into the current turn, and the text carries one bounded line of adjacent context.

A failed wake leaves the durable fact intact and the sender gets a structured delivery error instead of a silent loss; there is no automatic redelivery. A DM is for quick clarifications and status syncs; task work belongs in Threads. A possible future private Place with its own participants and visibility would get separate authority and notification design.

## Runtime Presence

An in-process availability projection, not a ledger fact: available (live idle), working (loop running), error (current loop/tool failure), and unavailable (no usable handle or lifecycle/setup/resume block, including the brief context-rollover window where the ledger binding has moved but the new Session is not live yet). It is separate from Claim state.

## Member Diagnostic

The structured reason behind a non-normal presence or availability row, never persisted: `session-refused` (a deterministic format refusal of a Session the activation needed; may carry the refused artifact's location and whether a repair attempt proved anything remediable), `session-unreadable` (missing, corrupt, io, or unknown Session read failure), `preset-composition` (preset mount/validation failure, typically an install/runtime split), `rollover` (the transient commit window), `runtime` (live loop or compaction failure), or `activation` (unclassified activation failure).

The `class` routes which recovery action actually helps: a non-remediable refusal or a rollover window offers no restart, while everything else may recover through restart.

## Context Generation

One Member Session's working context between two context boundaries. A fresh generation starts empty except for the handoff delivery; a checkpoint-returned generation seeds the exact completed-turn prefix of its source. The ledger records the current binding (one per Member at all times) and the previous Session of the latest renewal/rollover; the Session logs themselves hold the context history. Every generation keeps Member identity, model, private memory, skills, Claims, and Attention.

## Context Checkpoint

A named, resolved anchor recorded by a Member inside its own Session as a successful `context_checkpoint` tool pair. It resolves when the containing turn completes; the ref is deterministic from the tool call id. A checkpoint alone changes nothing — it becomes a `context_rollover` return target only when the Member cites it, and inherited checkpoints in a seeded child stay inert history.

## Context Handoff

The private bridge prose a Member passes to `context_rollover`; it is never a ledger fact. The ledger records only the verifiable envelope (session anchors, result sequence, trigger); the prose lives exactly once in the new generation's Session log as its first model-facing context. A crash between the durable rollover commit and delivery reconstructs it from the previous Session's durable intent, exactly once.

## Suspend

Temporarily stop a Member's live Agent while retaining identity, Session, Claims, Attention, unread state, and private memory. Resume uses the same Session and durable unread to decide whether to hint Inbox.

## Withdraw

Leaving one Workspace: `team/member-workspace-left` ends the Member's participation there, exits its Channel memberships in that Workspace, releases that Workspace's active Claims, and clears its Attention there. Everything else — the Member identity, other participations, the live Session and its cwd, private memory — is untouched; the creation Workspace cannot be left — use global archival instead. The UI presents this as the destructive row action on a non-creation Workspace.

## Archive

The hidden third state between Suspend and Remove, for Members and Channels. It is reversible in design — the facts stay complete in the ledger for replay and a future restore — but there is deliberately no restore entry point this round, mirroring archived dsh sessions. `archiveMember` disposes the live session (private memory and the Session log stay on disk) and releases active Claims across every participated Workspace with public `claims_released` Activities; `archiveChannel` applies the same release shape across every owner on the Channel's Threads.

Memberships survive archival (hidden state, not departure). Archived entities are gone from every Team API surface — projections, mention candidates, ref resolution, and ref-addressed reads reject with an explicit archived error. Removal from archived remains available as the data-hygiene path.

## Remove

Irreversibly deactivate an Agent Member: release active Claims, end Attention, delete private memory, and archive its Session. Historical Messages, Activities, and identity snapshots remain.

## Member Lifecycle

The desired external state of each durable Member state, in one table. Every lifecycle operation runs exactly this effect set right after its commit, and Host startup re-runs it for each Member, so a crash or a failed effect between commit and effect converges by repeating the same derivation:

| State | Live handle | Session grouping | Private memory |
| --- | --- | --- | --- |
| `enabled` | one, on the recorded binding | active | kept |
| `suspended` | none; resume restores the same Session | kept | kept |
| `archived` | none | archived (hidden), log kept on disk | kept |
| `inactive` | none | archived | deleted |

Each step derives from the durable state alone, so repeating it after a crash or a failed call runs exactly the owed steps and never a second durable write.

## Team Document

A Markdown document an Agent Member writes in one Thread and submits for the Human's review — the place for a plan, spec, or proposal the Human should approve before work starts. A Doc is an ordered list of sections (`s1`, `s2`, …); the author creates it with an outline and writes one section per operation.

The Doc revision is the sequence of its latest creation or section write. It fences the next section write, the author's submit, and the Human's verdict, so nothing is written or judged against text the writer did not see. It is separate from the Thread revision.

The Human comments on a selected passage, and an Agent can answer a comment. A Human comment stays pending until the Human's next verdict delivers every pending comment at once: approve, review (changes requested), or cancel. Approved and cancelled are final.

Submit and verdict are Thread replies that carry the Doc fact. The submit notice mentions the Human, so the Doc reaches their Inbox; the verdict notice mentions the author, so the existing mention wake carries it. Section writes and comments change no Thread revision and wake nobody.

Only the author and the Human can write a section; any other Channel member who tries is refused with an error, while commenting and resolving stay open to every Channel member. The Human can also edit a section, fenced by the same Doc revision. Every section write is kept as a version with its writer, so a section's history can be read and an older version written again as a new one; nothing is rewritten in place. When the Human edited a section after the author's last submit, the review verdict names it, so the author reads it again before writing.

A comment thread (a root comment and its replies) can be resolved by the Human or an Agent. A resolved thread is folded away on the page, and a pending Human comment in it is withdrawn, not delivered. A Doc lives in one Thread, and its Channel lists every Doc in it.

A Doc in review shows in its Thread and Channel as a plan card with Approve and Revise. Approve gives the approve verdict at the revision on the card; Revise opens the Doc, where the Human comments and presses Review.

## Decision

A card of 1 to 6 questions an Agent Member asks the Human in one Thread, in place of a question in prose. Each question has 2 to 4 options, allows one pick or several, may recommend the asker's choice, and always takes a written answer too. The Human answers every question at once, once.

A decision is not its own record: the ask, the answer and the withdrawal are Thread replies that carry the decision fact, like a Doc's submit and verdict. The ask mentions the Human, so an open card reaches their Inbox; the answer mentions the asker, which wakes it with the answer. Only the asker can withdraw an open card; a withdrawn card takes no answer and wakes nobody.
