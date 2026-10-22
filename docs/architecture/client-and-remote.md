# Typed Remote and Client boundaries

English | [中文](client-and-remote.zh.md)

## Typed Remote
`@Remote` annotations on the Team service are inputs to `scripts/generate-typert.mjs`, which uses Harness `WorkspaceAnalyzer` and `FaceModelEmitter` to emit Host and Client artifacts under `packages/agent-team/lib/`.

```text
Host face declaration → generate:typert → Typert Host + Remote client → ctx.remote.$mount(...) → Client remote service
```

`InvocationDescriptor` is local reflection metadata, not a wire message. Wire fields remain explicit typed values. Update declarations/tests, regenerate, and run typecheck/build; never hand-edit artifacts.

Read requests state their purpose instead of sharing one projection shape. `view` takes `includeCatalog` only when the caller wants the Task/Thread/Claim catalog of the whole request scope — the address book the model-facing `team_view` renders; the Client's reads never ask for it and render the page they requested.

One read needs no Channel at all: `workspaceActivity` folds every Channel of one Workspace into a single page — totals, per-seat shares, Session runs, the newest-first event feed and the per-day spend buckets — so a Workspace answers before any Channel exists. An empty Workspace is a valid empty aggregate, not an error.

## Remote failure vocabulary
Generated Remote methods resolve a `RemoteResult`: `{ ok: true, value }` carries the business result, `{ ok: false, error }` carries a failure whose stable `code` discriminates and whose `details` the code narrows without a cast.

- Business rejections — `unread_required`, `stale_revision`, `confirmation_required` — stay result unions: they are the normal control flow the Client already models, not Remote errors.
- An expected cross-Remote failure that needs its own Client branch is thrown as a `RemoteError`; the owner declares its code by merging it into `RemoteErrorDetailsMap`, and Team merges its codes into the public types entry both faces compile against. Team's first code is `team/attachment-not-found`: the attachment read separates a gone cache entry from every other failure.
- Clients branch on `code`, never on message text — the message is a human diagnostic, not contract. Unknown codes and unclassified Host exceptions arrive as `gateway/internal`, so each branch keeps a generic fallback: the attachment preview settles a not-found into the expired chip, caches no other failure, and lets a later render retry the Host.

## Client plugin and slot composition
The external Client plugin leaves the shipped Shell as outer-layout owner. Team adds one global panel and shadows three seats:

```text
sidebar.panellist           additive Team row, order 20
main (key agent-team)       Team panel, priority -100
sidebar.workspaces          Team shadow, priority -100
main (key conversation)     Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

Activation mounts `agentTeamRemote`, waits for `remote.agentTeam`, then registers the Team panel, its rail row, and the mode shadows. `dsh.client.inject` describes the module graph but does not guarantee apply order or service readiness; use `ctx.slots.inject()` when a declaration may appear later.

The panel row and Team mode are one fact: the row is the shell's own rail button, selecting it enters the mode, and another panel taking the column leaves it. A null selection is left alone — an embedded Member Session view clears the panel to own the column and the mode has to survive that — while the mode's own foot row clears the panel itself. A restored mode re-selects its panel unless a panel was already selected at mount, in which case that panel keeps the column and the mode stands down.

The Team tab lives in the sidebar's tab strip. The strip has no public registration API: its owner attaches a private `__dshNativeTabs` registry to its `sidebar.workspaces` component, and `team-tab.ts` inserts into it, standing down (rail row kept) when none is found. The workspace Overview is not a tab: it is a section of the Team Detail page (`agent-team-settings`), the side menu's row that carries the Overview, Agents, memory and the team's own settings.

Two hosts own a strip. The official sidebar with `@michengai/dsh-automation` attaches the registry. `@michengai/dsh-codex-ui` replaces the official sidebar, which makes automation stand down, and as of 1.1.33 attaches nothing, so the tabs need codex-ui to host the registry (same key, same attach site, same `{ id, label, order, matchSession, render }` descriptor).

Team registers no second `sidebar.workspaces` entry for this: codex-ui's patch warns that duplicate child slots fail its activation.

A slot parent's `children` declaration is both render site and authority. Team's `sidebar.workspaces` shadow must not redeclare shipped `sidebar.workspaces.directoryFlow`; Harness SlotCore rejects duplicate live declarations. Do not copy private WorkspaceBrowser, ConversationRoot, Shell, or private CSS. Use public Harness services and exports, such as `ctx.workspaces.pickDirectory()`, and record limitations rather than depending silently on private implementation.

## Client data and presentation boundary
Client components do not reach into `ctx`, the operation ledger, or Host classes. Data and callbacks arrive through slot owner props, runtime props, declared stores, or injected faces. Presentation consumes Host projections and local navigation state and does not invent durable facts.

New Channel composition defaults to taskless and exposes default-off 「作为任务」 for atomic Task creation. Taskless Threads retain reply/read/follow/Inbox behavior but gate status, Claims, and resolution controls until promotion. Promotion is non-optimistic and followed by rereading Thread and supplemental projections.

The Human Client consumes the Host's Inbox projection (the 「收件箱 / Inbox」 queue: the merged per-Workspace badge and page, covering each reader's whole unread slice — mentions are counted inside it, never its admission rule, plus a second 「最近活跃」 slice — the Threads that reader has written a Message in, so a Thread they replied to is theirs whether or not they follow it, newest activity first, each Workspace's own slice bounded to ten while the merged page shows at most five, which an Agent's Inbox never carries); it never keeps a parallel Inbox authority, and opening the page acknowledges nothing.

Team navigation mode, Workspace selection, the last Channel/Thread, the Inbox page position and the Board page position are browser-persisted; unread and Attention are Host-owned. The workspace Overview is not a navigation face: it lives in the Team Detail page, keeps its own Workspace scope, and always reads its data live.

The browser's own back and forward buttons walk those positions. The Team keeps a history stack over the navigation snapshot: one `pushState` entry per navigation — the same URL and a state object only, so the app keeps its mount path and the URL stays out of the routing business — and `popstate` is the only way a position comes back, so the browser's button and the seat's own back control cannot disagree.

The stack holds positions, not rendered views: the face flags, the refs, and the issue slot with its variant. Only a change of where the reader is creates an entry — a filter, a picker, a disclosure and an inline edit are not places — the stack is bounded at 32 entries with the oldest dropped, and it survives a reload.

Closing the issue consumes the entry its open pushed, so the browser's back closes the slice instead of walking out from under it. The slice itself is transient: a reload restores the face without it.

The issue surface is an orthogonal slot over those faces, not a face of its own: the snapshot carries the Task whose issue is open and how it is presented (the whole-column page, or the dialog over the live face), the face behind it stays where it was, and closing the issue returns the reader to it. The issue's content is the Host's `issueView` snapshot — one read per issue, variant-agnostic — and the client renders the seven regions it carries; the presentation is the client's, never a field on the read model.

The Team sidebar keeps Channels/Agents ordering as a browser-only `localStorage` preference, merged over Remote defaults.

An embedded Member Session uses the shipped composer unmodified: the Team registers no member-session composer surface — no seat shadow, no trigger sources, no dock strip. rc.1 moved the trigger-menu overlay into `conversation.composer.bar`'s children (a shadowing entry would inherit — and strand — the overlay), and the Team's own command/member reference entry points carried no irreplaceable value over the shipped vocabulary, so they were removed together.

Ordinary and member sessions share the same composer and vocabulary. Reuse public primitives and `--dsw-*` tokens, keep CSS in CSS Modules, and preserve Team mode restoration and narrow layouts.

The issue's comment region reads the contract's `comments` region and pages the same facts the Thread page pages, through the same history read: one store, two views. There is one paging call — the issue page's — and it states its limit (`limit: 20`, inside the Host's 1–100 bound). The decision region owns the ask message, so the comment region skips it, and a reply hangs under its parent one level deep because the ledger records one parent per message. Editing a comment, resolve and reactions are not in this cut: the ledger is append-only.
