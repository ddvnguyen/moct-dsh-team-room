import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Stable identifier of one Agent Team operation. */
export type AgentTeamOperationId = Branded<'AgentTeamOperationId'>

/** Caller-supplied idempotency identifier for one business operation. */
export type AgentTeamRequestId = Branded<'AgentTeamRequestId'>

/** Stable identifier of one uploaded composer attachment (cache, not archive). */
export type AgentTeamAttachmentId = Branded<'AgentTeamAttachmentId'>

/** Stable identifier of one Team member. */
export type AgentTeamMemberId = Branded<'AgentTeamMemberId'>

/** Stable identifier of one Workspace-scoped Channel. */
export type AgentTeamChannelRef = Branded<'AgentTeamChannelRef'>

/** Stable identifier of one immutable Message. */
export type AgentTeamMessageRef = Branded<'AgentTeamMessageRef'>

/** Stable identifier of one Task. */
export type AgentTeamTaskRef = Branded<'AgentTeamTaskRef'>

/** Stable identifier of one Thread. */
export type AgentTeamThreadRef = Branded<'AgentTeamThreadRef'>

/** Stable identifier of one Claim. */
export type AgentTeamClaimRef = Branded<'AgentTeamClaimRef'>

/** Stable identifier of one public Thread Activity. */
export type AgentTeamActivityRef = Branded<'AgentTeamActivityRef'>

/**
 * Opaque, restorable reference to one completed-turn context checkpoint in a
 * Member's private Session lineage. Selection authority is the ref itself;
 * the human-readable name is display data only.
 */
export type AgentTeamContextCheckpointRef = Branded<'AgentTeamContextCheckpointRef'>

/** Process-local one-use authorization for one Human invitation. */
export type AgentTeamConfirmationToken = Branded<'AgentTeamConfirmationToken'>

/** Snapshot of the Human authority authorized for an operation. */
export interface AgentTeamHumanActor {
  readonly kind: 'human'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

/** Snapshot of the exact Agent Member authorized by its live Agent binding. */
export interface AgentTeamMemberActor {
  readonly kind: 'member'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

export type AgentTeamActor = AgentTeamHumanActor | AgentTeamMemberActor

/** Provider route plus provider-owned model id one Member can be pinned to. */
export interface AgentTeamModelSelection {
  readonly provider: string
  readonly model: string
  /** Adapter-owned reasoning effort, or the model's provider/default behavior when absent. */
  readonly reasoningEffort?: ReasoningEffortId
}

/**
 * Durable capability intent of one Member, carried verbatim on the Member
 * entity through every lifecycle operation. Pure intent: names are not
 * validated against any known-tool list at commit time, so a Harness upgrade
 * that renames or removes tools can never make an old ledger unreplayable.
 * Divergence surfaces at activation as runtime-derived warnings, never as
 * persisted facts (stale persisted warnings would lie after Host restart or
 * Harness upgrades).
 */
export interface AgentTeamMemberCapabilities {
  /**
   * Deliberate interface reservation, no UI writes it today: Runtime Revision
   * manifests depend on this seam — do not remove during cleanup.
   * Absent = the Member sees all standard tools; present = the activation
   * allow-list (unknown names drop with a warning; the Host always unions
   * the five Team tools over it).
   */
  readonly tools?: { readonly allow?: readonly string[] } | undefined
  /**
   * Absent = auto-load every skill in the Member's private skills directory;
   * present = only the listed skill names.
   */
  readonly skills?: { readonly allow?: readonly string[] } | undefined
}

/** Team role label; a prompt and display fact, never a routing rule. */
export type AgentTeamMemberRole = 'architect' | 'leader' | 'worker' | 'orchestrator'

/** Durable identity and lifecycle intent of one team-managed Agent. */
export interface AgentTeamAgentMember {
  readonly memberId: AgentTeamMemberId
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  readonly description: string
  readonly presetId: string
  /** Absent inherits the Host default model selection at every activation. */
  readonly model?: AgentTeamModelSelection | undefined
  /** Durable capability intent; see AgentTeamMemberCapabilities. */
  readonly capabilities?: AgentTeamMemberCapabilities | undefined
  /**
   * Role label shown in the UI and rendered as a prompt section. Absent means
   * no role: no pill and no role section. It never routes work automatically.
   */
  readonly role?: AgentTeamMemberRole | undefined
  /**
   * Concurrent instances (slots) this seat may run, one Session each; Threads
   * bind to a slot (multi-instance contract v2). An integer from 1 to 5;
   * absent reads as the default, 2 (`memberInstances` in member-instances.ts).
   */
  readonly instances?: number | undefined
  /** Host-internal namespace; never exposed through Client projections. */
  readonly privateMemoryPath: string
  /**
   * Durable lifecycle state. `enabled`/`suspended` are the reversible working
   * pair; `archived` hides the Member from every surface while keeping its
   * Session log and private memory recoverable (no restore entry point yet,
   * mirroring archived dsh sessions); `inactive` is irreversible removal with
   * data cleanup.
   */
  readonly state: 'enabled' | 'suspended' | 'inactive' | 'archived'
}

/**
 * Runtime-derived capability divergence between a Member's persisted intent
 * and the names known at activation time (for example after a Harness
 * upgrade renamed or removed a tool). Derived state only — never persisted;
 * recomputed at every activation so warnings never go stale.
 */
export interface AgentTeamCapabilityWarning {
  /** The persisted allow-list entry that resolved to no known capability. */
  readonly name: string
  /** Digest of the names that were known when the entry was dropped. */
  readonly knownNames: readonly string[]
}

/**
 * Host projection combining durable intent with process-local availability.
 * The optional diagnostic is structured: `class` routes which action actually
 * helps (restart heals, restart is useless, transient), `detail` is the
 * human-readable reason, and a refused session carries its artifact location.
 */
/** One instance slot of a seat (multi-instance contract v2). Slot 0 is the seat's home Session. */
export interface AgentTeamMemberInstanceStatus {
  readonly slot: number
  /** The live Session behind the slot. Absent when nothing runs there: never spawned yet, or ended while idle. */
  readonly sessionId?: SessionId
  /** Slot 0 mirrors the seat's own presence. Extra slots never report 'error'. */
  readonly presence: 'available' | 'working' | 'error' | 'unavailable'
  /** Threads whose live binding (slot < N) points at this slot, in binding order. */
  readonly threadRefs: readonly AgentTeamThreadRef[]
}

export interface AgentTeamAgentMemberStatus {
  readonly member: AgentTeamAgentMember
  /** Always present: length = the seat's instances (N), in slot order. N=1 gives [slot 0]. */
  readonly instances: readonly AgentTeamMemberInstanceStatus[]
  readonly availability: 'active' | 'suspended' | 'inactive' | 'archived' | 'unavailable'
  readonly presence: 'available' | 'working' | 'error' | 'unavailable'
  readonly diagnostic?: AgentTeamMemberDiagnostic
  /**
   * Runtime-derived, activation-scoped capability warnings (see
   * AgentTeamCapabilityWarning); empty while capabilities resolve cleanly.
   */
  readonly capabilityWarnings?: readonly AgentTeamCapabilityWarning[] | undefined
  /**
   * Whether the live runtime surface reflects the stored configuration:
   * 'applied' after a successful apply (edit or activation), 'pending' while
   * there is no proof of effect (no live handle, a deferred edit, or a failed
   * apply). Always present so readers never mistake absence for applied.
   */
  readonly capabilityState: 'applied' | 'pending'
}

/** Which action actually helps an unavailable or erroring Member; the diagnostic's policy axis. */
export type AgentTeamMemberDiagnosticClass =
  | 'session-refused' // deterministic format refusal of a Session the activation needed
  | 'session-unreadable' // missing, corrupt, io, or unknown Session read failure
  | 'preset-composition' // preset mount/validation failure (often an install/runtime split)
  | 'rollover' // transient context-rollover window
  | 'runtime' // live runtime or compaction failure
  | 'activation' // unclassified activation failure
  | 'capability-apply' // post-commit configuration apply failed at the runtime

/** One Member failure's structured reason; rendered, never persisted. */
export interface AgentTeamMemberDiagnostic {
  readonly class: AgentTeamMemberDiagnosticClass
  readonly detail: string
  /** The refused artifact's location, when a format refusal reported one. */
  readonly location?: { readonly kind: string; readonly path: string }
  /** The Session the failure is about, when it is about one. */
  readonly sessionId?: SessionId
}

/** Browser-safe Member identity with Host-only paths removed. */
export type AgentTeamClientMember = Omit<AgentTeamAgentMember, 'privateMemoryPath'>

/** Browser-safe lifecycle projection. */
export interface AgentTeamClientMemberStatus extends Omit<AgentTeamAgentMemberStatus, 'member'> {
  readonly member: AgentTeamClientMember
  readonly workspaceIds: readonly WorkspaceId[]
}

/** Human roster: omit Workspace to select from the global Member catalog. */
export interface AgentTeamMembersRequest {
  readonly workspaceId?: WorkspaceId
}

/** Look up navigation facts for branded Task refs found in message bodies. */
export interface AgentTeamResolveTaskRefsRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRefs: readonly AgentTeamTaskRef[]
}

/** One resolved Task; refs that do not exist in the workspace are omitted. */
export interface AgentTeamResolvedTaskRef {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber: number
}

export interface AgentTeamResolveTaskRefsResult {
  readonly resolved: readonly AgentTeamResolvedTaskRef[]
}

/** Look up navigation facts for branded Thread refs found in message bodies. */
export interface AgentTeamResolveThreadRefsRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRefs: readonly AgentTeamThreadRef[]
}

/** One resolved Thread; refs that do not exist in the workspace are omitted. */
export interface AgentTeamResolvedThreadRef {
  readonly threadRef: AgentTeamThreadRef
  readonly channelRef: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly taskNumber?: number
  /** Opening-line gist distinguishing one Thread chip from another: first line, trimmed, capped at 40 characters. */
  readonly title: string
}

export interface AgentTeamResolveThreadRefsResult {
  readonly resolved: readonly AgentTeamResolvedThreadRef[]
}

/**
 * Look up the context of Messages cited by `replyToMessageRef`. A reply stores
 * only its parent's identity, so the author and the excerpt a reader sees are
 * resolved here from the ledger's own record — the quote can never disagree
 * with the Message it points at, and a parent outside the reader's loaded
 * history window still resolves.
 */
export interface AgentTeamResolveMessageRefsRequest {
  readonly workspaceId: WorkspaceId
  readonly messageRefs: readonly AgentTeamMessageRef[]
}

/** One resolved Message; refs the workspace cannot resolve are omitted. */
export interface AgentTeamResolvedMessageRef {
  readonly messageRef: AgentTeamMessageRef
  readonly threadRef: AgentTeamThreadRef
  readonly sender: AgentTeamMemberId
  /** Body gist for the quote block: first line, trimmed, capped at 120 characters. */
  readonly excerpt: string
}

export interface AgentTeamResolveMessageRefsResult {
  readonly resolved: readonly AgentTeamResolvedMessageRef[]
}

export interface AgentTeamOperationBase {
  readonly sequence: number
  readonly operationId: AgentTeamOperationId
  readonly requestId: AgentTeamRequestId
  readonly occurredAt: string
  readonly actor: AgentTeamActor
  readonly previousOperationId: AgentTeamOperationId | null
}

/** One Workspace-scoped collaboration Channel. */
export interface AgentTeamChannel {
  readonly channelRef: AgentTeamChannelRef
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly description: string
  readonly createdAtSequence: number
  /**
   * Durable lifecycle state. `archived` hides the Channel and its Threads from
   * every surface while keeping all facts recoverable (no restore entry point
   * yet, mirroring archived dsh sessions). Ledgers written before Channel
   * archival existed omit the field; the record schema normalizes it to
   * `active` at load time.
   */
  readonly state: 'active' | 'archived'
}

/** One durable Channel membership fact derived from the operation ledger. */
export interface AgentTeamChannelMembership {
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** One immutable top-level or reply Message. */
export interface AgentTeamMessageAttachment {
  readonly attachmentId: AgentTeamAttachmentId
  readonly name: string
  readonly byteSize: number
  readonly mediaType: string
}

export interface AgentTeamMessage {
  readonly messageRef: AgentTeamMessageRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  /** Absent on Messages committed while the Thread had no Task; promotion does not rewrite prior Messages. */
  readonly taskRef?: AgentTeamTaskRef
  readonly sender: AgentTeamMemberId
  readonly body: string
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  /**
   * The Message this reply answers, inside the same Thread. Absent on every
   * Message that is not a reply, including every Message recorded before
   * replies existed, so an older ledger reads back unchanged and needs no
   * normalization. It stores the parent's identity only: the author and the
   * excerpt are resolved at read time from the ledger's own ref index, so a
   * reply can never disagree with the Message it quotes.
   */
  readonly replyToMessageRef?: AgentTeamMessageRef
  readonly topLevel: boolean
  readonly sequence: number
  /** Wall-clock instant of the wrapping ledger operation; pre-occurredAt ledgers normalize on replay. */
  readonly occurredAt: string
}

/**
 * One comment thread's resolution: who closed it, and when.
 *
 * The Host derives it from the ledger's own resolution operations, so a reader
 * takes the answer and never invents it.
 */
export interface AgentTeamCommentResolution {
  readonly memberId: AgentTeamMemberId
  /** The instant of the operation that closed the thread. */
  readonly resolvedAt: string
}

/** The four lifecycle categories a Board list can carry; accept/close/reopen stay category-driven. */
export type AgentTeamStatusCategory = 'unstarted' | 'started' | 'done' | 'closed'

/**
 * One Board list in a Workspace's status catalog.
 *
 * The five built-ins are a constant (`AGENT_TEAM_BUILTIN_STATUSES`): never
 * stored, never editable. Every other entry is durable — created by
 * `team/status-created`, renamed by `team/status-updated`, archived by
 * `team/status-archived` — and its `key` is the column id's own key, so a
 * column stays `status:<key>` and the hidden / collapsed sets keep working.
 * An archived list stays in the catalog (a Task that still points at it reads
 * back), but it draws no column and refuses a rename.
 */
export interface AgentTeamBoardStatus {
  readonly key: string
  readonly label: string
  readonly category: AgentTeamStatusCategory
  readonly builtin: boolean
  readonly archived: boolean
}

/** Task overlay created by an atomic start or Human promotion. */
export interface AgentTeamTask {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed'
  readonly resolution: 'open' | 'accepted' | 'closed'
  /**
   * Board title. Absent on Tasks created before the board existed; readers fall
   * back to the first line of the opening Message.
   */
  readonly title?: string | undefined
  /** Board priority; absent reads as `none`, so old ledgers replay unchanged. */
  readonly priority?: AgentTeamTaskPriority | undefined
  /**
   * The Member the Human assigned, independent of Claims. Claims still derive
   * `in_progress`/`in_review`; assigning wakes the Member and makes it follow.
   */
  readonly assignee?: AgentTeamMemberId | null | undefined
  /** Fractional order within a status column; absent reads as 0. */
  readonly position?: number | undefined
  /**
   * The description's own fence — NOT the Thread revision.
   *
   * The description has two writers (the Human's inline edit and an approved
   * plan's promotion) and neither is fenced by the Thread revision, so each
   * description write checks this counter and bumps it. Optional and
   * forward-only: a Task whose description was never written has no counter,
   * and every ledger written before the description existed replays unchanged.
   */
  readonly descriptionRevision?: number | undefined
  /**
   * The description itself, once it is a fact of its own: the body a reader
   * sees, and where it came from.
   *
   * Absent on a Task whose description was never written — the issue view
   * then reads the Thread's opening Message. Optional and forward-only: a
   * ledger written before the description existed replays unchanged.
   */
  readonly description?: AgentTeamTaskDescription | undefined
  /**
   * The parent Task, or `null` when the Human cleared it. Support the same
   * `assignee` convention: omitting the key in a patch leaves it unchanged,
   * `null` clears it. Sub-issues are never stored: the Host derives them from
   * a reverse index over this field, so a stored copy could never contradict
   * the parent. Optional and forward-only: ledgers written before the field
   * existed replay unchanged.
   */
  readonly parentTaskRef?: AgentTeamTaskRef | null | undefined
  /** Links only — the PRs the Human attached. No status is fetched. */
  readonly pullRequests?: readonly AgentTeamTaskPullRequest[] | undefined
  /** Free-form labels: trimmed, at most 40 chars each, at most 20, case-insensitively deduped. */
  readonly labels?: readonly string[] | undefined
  /** The due date, `YYYY-MM-DD`; `null` clears. Absent reads as none. */
  readonly dueDate?: string | null | undefined
  /**
   * The custom Board list the Human placed this card in. Absent means "the
   * built-in column for my derived status": the card sits in the column its
   * `status` names.
   *
   * Placement only — it never moves `status`, whose derivation stays the one
   * authority accept/close/reopen read. A lifecycle change clears it to `null`
   * (Q5, the board never disagrees with the issue view), and archiving a list
   * is refused while any Task still holds it. Optional and forward-only: a
   * ledger written before the catalog exists replays unchanged, and absent and
   * `null` both read as "the built-in column for my status".
   */
  readonly statusKey?: string | null | undefined
}

/** One PR link the Human attached to a Task: a link, not a status. */
export interface AgentTeamTaskPullRequest {
  readonly url: string
  /** Optional display title; absent renders the URL. */
  readonly title?: string | undefined
}

/**
 * The durable description record of one Task: the body a reader sees, and the
 * facts that say who wrote it and where it came from.
 *
 * One shape, declared once: the issue view's description region is this
 * record plus the description's own fence (`AgentTeamIssueDescription`), so
 * the client builds against the region and the ledger writes the record.
 */
export interface AgentTeamTaskDescription {
  readonly body: string
  /**
   * Who wrote the body: the Human — its own edit, or the approval that
   * promoted a plan. The Member who wrote the plan is named by the plan
   * itself (`planRef`), not by this field.
   */
  readonly author: AgentTeamMemberId
  /** Instant of the write that produced this body. */
  readonly occurredAt: string
  /** What the body was derived from: the Thread's opening Message, or an approved plan. */
  readonly source: 'anchor' | 'approvedPlan'
  /** The plan the body came from; present exactly when `source` is `approvedPlan`. */
  readonly planRef?: AgentTeamDocRef
  /** Set when the Human edited the body directly. Absent means never edited. */
  readonly editedAt?: string
}

/** Board priority of one Task. */
export type AgentTeamTaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

/** Current projection of one collaboration Thread. */
export interface AgentTeamThread {
  readonly threadRef: AgentTeamThreadRef
  /** Present after atomic Task creation or Human promotion; absent on taskless Threads. */
  readonly taskRef?: AgentTeamTaskRef
  /** Last public Message, Claim, or Task-resolution sequence. */
  readonly revision: number
}

/**
 * A Member's current attention period for one Thread.
 *
 * Its absence means the Member is not following. Read state is compact: all
 * follower-visible facts from `startSequence` through `readThroughSequence`
 * are acknowledged, except for sparse direct markers retained separately.
 */
export interface AgentTeamThreadAttention {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly startSequence: number
  readonly readThroughSequence: number
}

/** Identity of one Member × Thread attention period. */
export interface AgentTeamThreadAttentionKey {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
}

/** Sparse direct-priority marker for one structured Message mention. */
export interface AgentTeamDirectMarker {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly messageRef: AgentTeamMessageRef
  readonly sequence: number
}

/** Sparse marker retaining a relevant Task or Claim Activity after Attention ends. */
export interface AgentTeamActivityMarker {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly activityRef: AgentTeamActivityRef
  readonly sequence: number
}

/** Durable changes to private Member inbox state carried by one operation. */
export interface AgentTeamInboxDelta {
  readonly attention: {
    /** New or replacement current Attention records. */
    readonly set: readonly AgentTeamThreadAttention[]
    /** Attention periods ended by this operation. */
    readonly removed: readonly AgentTeamThreadAttentionKey[]
  }
  readonly directMarkers: {
    readonly added: readonly AgentTeamDirectMarker[]
    readonly removed: readonly AgentTeamDirectMarker[]
  }
  readonly activityMarkers: {
    readonly added: readonly AgentTeamActivityMarker[]
    readonly removed: readonly AgentTeamActivityMarker[]
  }
}

/** One Direction Claim retained as Task progress history. */
export interface AgentTeamClaim {
  readonly claimRef: AgentTeamClaimRef
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly owner: AgentTeamMemberId
  readonly direction: string
  readonly normalizedDirection: string
  readonly state: 'active' | 'done' | 'released'
}

interface AgentTeamActivityBase {
  readonly activityRef: AgentTeamActivityRef
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly actor: AgentTeamMemberId
  readonly sequence: number
}

export interface AgentTeamClaimActivity extends AgentTeamActivityBase {
  readonly kind: 'claim' | 'done' | 'release'
  readonly claimRef: AgentTeamClaimRef
}

export interface AgentTeamTaskActivity extends AgentTeamActivityBase {
  readonly kind: 'promote' | 'assign' | 'accept' | 'close' | 'reopen' | 'patch'
  /** The Member a Human assigned the Task to; present exactly when `kind` is `assign`. */
  readonly assignee?: AgentTeamMemberId | undefined
  /**
   * One entry per Task property the patch moved, in patch order; present
   * exactly when `kind` is `patch`. Machine values only — the client composes
   * the sentence, the Host never renders display text.
   */
  readonly change?: readonly AgentTeamTaskChange[] | undefined
  /** Claims atomically released by close; absent for other Task transitions. */
  readonly releasedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
  /** Active claims the Human acceptance completed alongside the Task; absent when none were active. */
  readonly completedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
  /**
   * Every done Claim at acceptance time, including pre-finished ones — the
   * durable discriminator accept markers deliver from. Always present on
   * new accepts (possibly empty); legacy records predate it and keep the
   * completed-only wake semantics.
   */
  readonly acceptedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
}

/** One Task property a `patch` moved. Values are machine facts the client renders. */
export interface AgentTeamTaskChange {
  readonly field: 'parentTaskRef' | 'pullRequests' | 'labels' | 'dueDate'
  /**
   * The value after the write. `parentTaskRef`/`dueDate` are strings or `null`
   * (cleared); `pullRequests`/`labels` carry the list after the write.
   */
  readonly value: string | readonly string[] | null
  /** Values the write added; present only when the field was list-shaped and something was added. */
  readonly added?: readonly string[]
  /** Values the write removed; present only when the field was list-shaped and something was removed. */
  readonly removed?: readonly string[]
  /**
   * The Task-ref display the ledger composed at write time from the same
   * numbering authority the issue view reads (`#12`); present exactly when a
   * `value` names a Task. A reader renders the answer and never re-resolves.
   */
  readonly label?: string | undefined
}

/** One automatic, public release summary caused by a membership lifecycle action. */
export interface AgentTeamClaimsReleasedActivity extends AgentTeamActivityBase {
  readonly kind: 'claims_released'
  readonly claimRefs: readonly AgentTeamClaimRef[]
}

/** One ordered public Thread Activity. */
export type AgentTeamActivity = AgentTeamClaimActivity | AgentTeamTaskActivity | AgentTeamClaimsReleasedActivity

/** One public, revisioned fact in a Thread timeline. */
export type AgentTeamThreadFact =
  | {
    readonly kind: 'message'
    readonly sequence: number
    readonly message: AgentTeamMessage
    /** Structured Member refs from the originating send operation; empty when the Message mentions nobody. */
    readonly mentions: readonly AgentTeamMemberId[]
    /**
     * The resolution the Host records for this comment's thread, present
     * exactly while that thread is closed. An overlay, not a stored fact: the
     * ledger keeps resolutions in their own index, and every read that
     * presents comments attaches it here, so the newest page and an older page
     * cannot disagree about a closed thread.
     */
    readonly resolved?: AgentTeamCommentResolution | undefined
    /** Wall-clock instant of the committing ledger operation; message facts read through to their Message. */
    readonly occurredAt: string
  }
  | { readonly kind: 'activity'; readonly sequence: number; readonly activity: AgentTeamActivity
    /** Wall-clock instant of the committing ledger operation; activities have no instant of their own. */
    readonly occurredAt: string }

/** One fact returned by a durable Thread read. */
export interface AgentTeamThreadReadFact {
  readonly fact: AgentTeamThreadFact
  /** This fact was part of the unread batch advanced by this read. */
  readonly unread: boolean
  /** This fact carries one of the recipient's structured direct mentions. */
  readonly direct: boolean
}

/** Stored form of a Message inside durable operations; pre-occurredAt ledgers omit it and normalize on load. */
export type AgentTeamStoredMessage = Omit<AgentTeamMessage, 'occurredAt'> & { readonly occurredAt?: string | undefined }

/** Stored form of one Thread timeline fact; mirrors AgentTeamThreadFact with stored messages. */
export type AgentTeamStoredThreadFact =
  | { readonly kind: 'message'; readonly sequence: number; readonly message: AgentTeamStoredMessage;
    readonly mentions: readonly AgentTeamMemberId[]
    /** Ledger-operation instant; pre-envelope ledgers omit it and normalize on load. */
    readonly occurredAt?: string | undefined }
  | { readonly kind: 'activity'; readonly sequence: number; readonly activity: AgentTeamActivity
    /** Ledger-operation instant; pre-envelope ledgers omit it and normalize on load. */
    readonly occurredAt?: string | undefined }

/** Stored form of one durable Thread read fact. */
export interface AgentTeamStoredThreadReadFact {
  readonly fact: AgentTeamStoredThreadFact
  readonly unread: boolean
  readonly direct: boolean
}


/** Stable identifier of one Team Document. */
export type AgentTeamDocRef = Branded<'AgentTeamDocRef'>

/** Stable identifier of one comment on a Team Document. */
export type AgentTeamDocCommentRef = Branded<'AgentTeamDocCommentRef'>

/**
 * Identity of one Team Document: a Member-written Markdown document that lives
 * in one Thread. Its sections, comments and review state are separate facts.
 */
export interface AgentTeamDoc {
  readonly docRef: AgentTeamDocRef
  readonly channelRef: AgentTeamChannelRef
  /** The Thread the Doc belongs to; its submit and review notices are Messages there. */
  readonly threadRef: AgentTeamThreadRef
  /**
   * The Task the Doc is bound to, when it is a plan for one issue.
   *
   * The binding is explicit, never derived from the Thread: a taskless Thread
   * can be promoted into a Task, so a derived binding would retroactively
   * attach old Docs to a Task they were never written for. Optional and
   * forward-only: a Doc written before the binding existed carries none.
   */
  readonly taskRef?: AgentTeamTaskRef | undefined
  /** The Member that created the Doc; the Human's verdict is delivered to it. */
  readonly author: AgentTeamMemberId
  readonly title: string
  readonly createdAtSequence: number
}

/** One section of a Team Document. A Doc is the ordered list of its sections. */
export interface AgentTeamDocSection {
  /** Stable within its Doc: `s1`, `s2`, … in the order sections were first written. */
  readonly sectionId: string
  readonly heading: string
  /** May be empty while the section is only an outline heading. */
  readonly markdown: string
}

/** One comment anchored to a quoted passage of one section. */
export interface AgentTeamDocComment {
  readonly commentRef: AgentTeamDocCommentRef
  readonly docRef: AgentTeamDocRef
  readonly sectionId: string
  /** The passage the comment is about, as the commenter selected it; empty for a reply. */
  readonly quote: string
  readonly body: string
  readonly author: AgentTeamMemberId
  /** The comment this one answers, inside the same Doc. */
  readonly parentCommentRef?: AgentTeamDocCommentRef
  readonly sequence: number
}

/**
 * Review state of one Team Document. `approved` and `cancelled` are final; the
 * other three follow submit and review notices.
 */
export type AgentTeamDocStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'cancelled'

/** The Human's verdict on a Doc: accept it, send the pending comments back for revision, or drop it. */
export type AgentTeamDocVerdict = 'approve' | 'review' | 'cancel'

/** Stable identifier of one decision card. */
export type AgentTeamDecisionRef = Branded<'AgentTeamDecisionRef'>

/**
 * Stable identifier of one recorded decision.
 *
 * A stored record is minted once, when the operation that carries it is
 * written, and is durable with that operation. A record derived from an
 * operation written before decision records existed takes the derived form
 * `decisionRecord:<operationId>`, so the same ledger derives the same ref on
 * every replay.
 */
export type AgentTeamDecisionRecordRef = Branded<'AgentTeamDecisionRecordRef'>

/** One choice on a decision question. */
export interface AgentTeamDecisionOption {
  /** One or two words, shown on the button. */
  readonly label: string
  /** One sentence: what happens if this option is picked. */
  readonly description?: string
}

/**
 * One question on a decision card. Every question also takes a free-text
 * answer beside its options, so the Human is never boxed in.
 */
export interface AgentTeamDecisionQuestion {
  readonly prompt: string
  /** Whether several options may be picked together. */
  readonly multiple: boolean
  readonly options: readonly AgentTeamDecisionOption[]
  /** Option indexes the asking Member will act on while the card is open; at most one for a single-choice question. */
  readonly recommended: readonly number[]
}

/** The Human's answer to one question: the picked option indexes, free text, or both. */
export interface AgentTeamDecisionAnswer {
  readonly selected: readonly number[]
  readonly text?: string
}

/**
 * The decision event one Thread reply announces. A Member asks (the reply
 * mentions the Human, or the addressed seat when the card names one), the
 * addressee answers (the reply mentions the asker, so the existing mention
 * wake carries the answer), or the asker withdraws a card it no longer needs.
 */
export type AgentTeamDecisionNotice =
  | {
    readonly decisionRef: AgentTeamDecisionRef
    readonly event: 'asked'
    /** Background the Human needs to answer, shown above the questions. */
    readonly context?: string
    /**
     * The seat the card is addressed to, when it names one. Absent on every
     * card recorded before targeted asks existed: those address the Human.
     */
    readonly target?: AgentTeamMemberId
    readonly questions: readonly AgentTeamDecisionQuestion[]
  }
  | {
    readonly decisionRef: AgentTeamDecisionRef
    readonly event: 'answered'
    /** One answer per question, in question order. */
    readonly answers: readonly AgentTeamDecisionAnswer[]
  }
  | {
    readonly decisionRef: AgentTeamDecisionRef
    readonly event: 'withdrawn'
  }

/** Where a decision card stands: open until the Human answers it or its asker withdraws it. */
export type AgentTeamDecisionStatus = 'open' | 'answered' | 'withdrawn'

/** The Doc event one Thread reply announces; the Message is the notice, this is the fact it carries. */
export type AgentTeamDocNotice =
  | {
    readonly docRef: AgentTeamDocRef
    readonly event: 'submitted'
    /** The Doc revision the Member asked the Human to review. */
    readonly docRevision: number
  }
  | {
    readonly docRef: AgentTeamDocRef
    readonly event: 'reviewed'
    /** The Doc revision the Human reviewed. */
    readonly docRevision: number
    readonly verdict: AgentTeamDocVerdict
    /** The Human's pending comments this verdict delivered to the author, oldest first. */
    readonly commentRefs: readonly AgentTeamDocCommentRef[]
  }
