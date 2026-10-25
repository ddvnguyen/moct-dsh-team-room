import type { AgentTeamDecisionRecordSource, AgentTeamSessionRun, AgentTeamSessionTurnRecordedData } from "./operations.ts"
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace"
import type { SessionId as AgentTeamMemberSessionId, SessionLogOffset as AgentTeamMemberSessionLogOffset, SessionSeq as AgentTeamMemberSessionSeq } from "@deepseek-ai/dsh-session"
import type {
  AgentTeamActivity,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamAttachmentId,
  AgentTeamChannel,
  AgentTeamChannelMembership,
  AgentTeamChannelRef,
  AgentTeamClaim,
  AgentTeamClaimActivity,
  AgentTeamClaimRef,
  AgentTeamConfirmationToken,
  AgentTeamContextCheckpointRef,
  AgentTeamDirectMarker,
  AgentTeamDecisionAnswer,
  AgentTeamDecisionNotice,
  AgentTeamDecisionQuestion,
  AgentTeamDecisionRecordRef,
  AgentTeamDecisionRef,
  AgentTeamDecisionStatus,
  AgentTeamDoc,
  AgentTeamDocComment,
  AgentTeamDocCommentRef,
  AgentTeamDocNotice,
  AgentTeamDocRef,
  AgentTeamDocSection,
  AgentTeamDocStatus,
  AgentTeamDocVerdict,
  AgentTeamMemberCapabilities,
  AgentTeamMemberId,
  AgentTeamMemberRole,
  AgentTeamMessageRef,
  AgentTeamMessage,
  AgentTeamModelSelection,
  AgentTeamOperationId,
  AgentTeamRequestId,
  AgentTeamTask,
  AgentTeamTaskDescription,
  AgentTeamTaskPriority,
  AgentTeamTaskActivity,
  AgentTeamTaskRef,
  AgentTeamThread,
  AgentTeamThreadAttention,
  AgentTeamThreadAttentionKey,
  AgentTeamThreadFact,
  AgentTeamThreadReadFact,
  AgentTeamThreadRef,
} from "./entities.ts"

/** Receipt returned after an operation is durable or an identical retry resolves it. */
export interface AgentTeamOperationReceipt {
  readonly operationId: AgentTeamOperationId
  readonly requestId: AgentTeamRequestId
  readonly sequence: number
  /** Wall-clock instant of the committing operation; the one source results carry for optimistic fact instants. */
  readonly occurredAt: string
}

/** Human intent to create a Workspace Channel with its initial Members. */
export interface AgentTeamCreateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly name: string
  /** Display purpose text; may be empty and filled in later through an edit. */
  readonly description: string
  readonly memberIds?: readonly AgentTeamMemberId[]
}

/** Result of creating or idempotently resolving a Channel and its initial Members. */
export interface AgentTeamCreateChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
  readonly memberIds: readonly AgentTeamMemberId[]
}

/** Human intent to provision one team-managed Agent Member with initial Channels. */
export interface AgentTeamAddMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  /** Display purpose text; may be empty and filled in later through an edit. */
  readonly description: string
  readonly presetId: string
  /** Absent inherits the Host default model selection. */
  readonly model?: AgentTeamModelSelection
  /** Durable capability intent; see AgentTeamMemberCapabilities. */
  readonly capabilities?: AgentTeamMemberCapabilities
  /** Concurrent instances, an integer from 1 to 5; absent takes the default (2). */
  readonly instances?: number
  /** Role label and prompt section; absent means no role: no pill and no role section. */
  readonly role?: AgentTeamMemberRole
  /** Existing Channels in this Workspace; may be empty — the Member joins Channels later and stays reachable through its DM view. */
  readonly channelRefs: readonly AgentTeamChannelRef[]
}

/** Human intent to rename one Channel's display facts. */
export interface AgentTeamUpdateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly name: string
  /** Display purpose text; may be empty, matching creation. */
  readonly description: string
}

/** Result of updating or idempotently resolving one Channel's display facts. */
export interface AgentTeamUpdateChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
}

/** Human intent to archive one Channel: hidden everywhere, facts kept. */
export interface AgentTeamArchiveChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
}

/**
 * Result of Channel archival: the Channel is hidden with every fact
 * recoverable. Active Claims on the Channel's Threads were released.
 */
export interface AgentTeamArchiveChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
  readonly releasedClaims: readonly AgentTeamClaim[]
}

/**
 * Human intent to edit one Member's mutable facts. This is a partial update:
 * an absent optional field keeps the value the Member already has, and an
 * explicit `null` clears that override (inheriting the Host default model /
 * the full standard capability surface). Callers only state what they mean to
 * change, so they never have to echo stored values back.
 */
export interface AgentTeamUpdateMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
  readonly handle: string
  /** Display purpose text; may be empty, matching creation. */
  readonly description: string
  /** Absent keeps the current selection; `null` clears it back to the Host default. */
  readonly model?: AgentTeamModelSelection | null
  /** Absent keeps the current override; `null` clears it back to the full surface. */
  readonly capabilities?: AgentTeamMemberCapabilities | null
  /** Absent keeps the current count; `null` clears it back to the default (2). */
  readonly instances?: number | null
  /** Absent keeps the current role; `null` clears it. */
  readonly role?: AgentTeamMemberRole | null
}

/** Human intent to suspend or resume one Agent Member. */
export interface AgentTeamSetMemberStateRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

/** Human intent to archive one Agent Member: hidden everywhere, data kept. */
export interface AgentTeamArchiveMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

/**
 * Result of archival: the Member is hidden with its data recoverable. Active
 * Claims the Member held were released, so those Tasks are no longer stuck
 * in progress behind a hidden Member.
 */
export interface AgentTeamArchiveMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Result of a Member lifecycle operation. */
export interface AgentTeamMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly status: AgentTeamAgentMemberStatus
}

/**
 * How a configuration edit's committed runtime effects landed: installed now,
 * already in force, or saved but deferred to the next activation (with the
 * reason). A failed apply never appears here — it stays a rejection.
 */
export type AgentTeamMemberEffect =
  | 'applied'
  | 'already-applied'
  | 'deferred:no-live-handle'
  | 'deferred:generation-changed'

/** Result of a configuration edit: lifecycle status plus its effect outcome. */
export interface AgentTeamUpdateMemberResult extends AgentTeamMemberResult {
  readonly effect: AgentTeamMemberEffect
}

/** Result of creating a Member: lifecycle status plus the participation set the Host seeded at creation. */
export interface AgentTeamAddMemberResult extends AgentTeamMemberResult {
  /** Workspaces the new Member participates in — creation always seeds exactly the creation Workspace. */
  readonly workspaceIds: readonly WorkspaceId[]
}

/** Operator intent to nudge one error-stopped Member into continuing its work. */
export interface AgentTeamRecoverMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

/** Result of a recovery nudge; runtime-only steering, so there is no ledger receipt. */
export interface AgentTeamRecoverMemberResult {
  readonly status: AgentTeamAgentMemberStatus
  /**
   * Present exactly when recovery refused to steer: the Member's Session is
   * provider-poisoned (task-11 item 4) — its last consecutive Turns were all
   * rejected by the provider with an identical signature before any usage, so
   * re-queuing would replay the same error. The caller switches the model or
   * starts the Member from a new context instead.
   */
  readonly sameError?: {
    readonly detail: string
    readonly failedTurns: number
  }
}

/** Human intent to start one enabled Member's next turn from an empty context. */
export interface AgentTeamClearMemberContextRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

/** The Member keeps identity, memory, and binding; its sessionId moves to a fresh Session and the previous log stays archived on disk. */
export interface AgentTeamClearMemberContextResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly status: AgentTeamAgentMemberStatus
}

/**
 * Member-authored intent (carried by its live Agent) to continue in its next
 * private context generation. The requestId and new Session id derive stably
 * from the successful `context_rollover` tool call so crash replay converges on
 * one operation and one generation.
 */
export interface AgentTeamRolloverSessionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
  /** The Session the Member must still be bound to at commit time. */
  readonly previousSessionId: AgentTeamMemberSessionId
  /** The next generation Session, derived from the successful tool call. */
  readonly newSessionId: AgentTeamMemberSessionId
  /** Seq of the successful `context_rollover` tool result in the previous Session log. */
  readonly handoffEventSeq: AgentTeamMemberSessionSeq
  /** Why the rollover happened: the model asked, or honored a pressure notice. */
  readonly trigger: 'model' | 'pressure'
  /** Seed source Session for a checkpoint return; absent on a fresh rollover. */
  readonly sourceSessionId?: AgentTeamMemberSessionId
  /** Exclusive end of the seeded source prefix (its exact length in the source log). */
  readonly sourceThroughSeq?: AgentTeamMemberSessionLogOffset
  /** The checkpoint a return was addressed to; absent on a fresh rollover. */
  readonly checkpointRef?: AgentTeamContextCheckpointRef
}

export interface AgentTeamRolloverSessionResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
}

/** Human intent to remove one Agent Member from one Channel. */
export interface AgentTeamRemoveChannelMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** Result of Channel-scoped member cleanup. */
export interface AgentTeamRemoveChannelMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Human intent to join one Agent Member to one additional Workspace. */
export interface AgentTeamJoinWorkspaceRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamJoinWorkspaceResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly memberId: AgentTeamMemberId
  readonly workspaceId: WorkspaceId
}

/**
 * Human intent to withdraw one Agent Member from one of its non-default
 * Workspaces: participation ends, Workspace-scoped Claims release, and the
 * Member's Attention/markers on that Workspace's Threads clear.
 */
export interface AgentTeamLeaveWorkspaceRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamLeaveWorkspaceResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly memberId: AgentTeamMemberId
  readonly workspaceId: WorkspaceId
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Human intent to add one Agent Member to one Channel. */
export interface AgentTeamJoinChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamJoinChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** Intent to create one top-level Message and Thread, with an optional Task. */
export interface AgentTeamSendMessageRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients?: readonly AgentTeamMemberId[]
  /** Uploaded attachments to reference; the Host resolves and verifies each id. */
  readonly attachments?: readonly AgentTeamAttachmentId[] | undefined
  /**
   * Agent-supplied absolute file paths; the Host validates each one, copies the
   * bytes into the attachment cache, and turns them into the same metadata.
   */
  readonly attachmentPaths?: readonly string[] | undefined
  readonly confirmationToken?: AgentTeamConfirmationToken
  /**
   * When true, create a Task over the new Thread. Omitted/false sends a plain
   * message. Callers that want the Task overlay must ask for it.
   */
  readonly asTask?: boolean
}

/** Upload one composer attachment into the Team attachment cache. */
export interface AgentTeamPutAttachmentRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly mediaType?: string | undefined
  readonly bytesBase64: string
}

export interface AgentTeamPutAttachmentResult {
  readonly attachmentId: AgentTeamAttachmentId
  /** Absolute path members read the bytes from; stable for the cache lifetime. */
  readonly path: string
  readonly name: string
  readonly byteSize: number
  readonly mediaType: string
}

/** Read one uploaded attachment back for client-side display. */
export interface AgentTeamGetAttachmentRequest {
  readonly attachmentId: AgentTeamAttachmentId
}

export interface AgentTeamGetAttachmentResult {
  readonly name: string
  readonly mediaType: string
  readonly byteSize: number
  readonly bytesBase64: string
}

/** Human profile read: name + avatar reference + version footnote facts. */
export interface AgentTeamHumanProfileRequest {
}

export interface AgentTeamHumanProfileResult {
  readonly name: string
  readonly avatarRef?: string | undefined
  /** Bundle version shown in the settings footnote. */
  readonly version: string
  /** Repository home the footnote links to. */
  readonly repoUrl: string
  /**
   * Whether a newer release is known. Best-effort and cached Host-side
   * (npm `latest`, 12 h TTL, silent on any failure), so this stays false
   * until a background refresh actually observes one; the footnote shows
   * only the version + link until then.
   */
  readonly updateAvailable: boolean
  readonly latestVersion?: string | undefined
}

/** Local environment read: how the running DSH compares to the declared support line. */
export interface AgentTeamEnvironmentRequest {
}

/**
 * The one of three shapes the page renders. `undetermined` is the answer for
 * every fact this Host cannot establish — an unreadable runtime version, a
 * support range the manifest does not state — and never a guessed verdict; its
 * two causes are not distinguished to the reader, only recorded in `reason`.
 */
export type AgentTeamEnvironmentVerdict = 'ok' | 'out-of-range' | 'undetermined'

/** Declared DSH support line, stated in words by the page rather than as a range string. */
export interface AgentTeamEnvironmentSupportRange {
  /** Lower bound of the declared range, which is also the certified baseline. */
  readonly lower: string
  /** Exclusive upper bound of the declared range. */
  readonly upper: string
}

export interface AgentTeamEnvironmentResult {
  readonly verdict: AgentTeamEnvironmentVerdict
  /** Host-side diagnostic behind an `undetermined` verdict; not rendered as user copy. */
  readonly reason?: string | undefined
  // Every fact below is optional by contract: a missing one is never a
  // mismatch, it only withholds the line that would have stated it.
  /** Version of the bundle this Host runs from. */
  readonly bundleVersion?: string | undefined
  /**
   * The running DSH version, which is what the page states it is running.
   * Distinct from `certifiedDshVersion`: one is the environment, the other is
   * the line this bundle declares support for.
   */
  readonly dshVersion?: string | undefined
  /** Lower bound of the declared range: the certified, actually-tested DSH line. */
  readonly certifiedDshVersion?: string | undefined
  readonly supportRange?: AgentTeamEnvironmentSupportRange | undefined
}

/** Relatedness-judge read: carries no input; the answer is the Host's own state. */
export interface AgentTeamContextJudgeRequest {
}

/**
 * What the Team settings surface states about the long-gap gate's judge. It
 * carries only what the settings document cannot: whether a judge is actually
 * reachable, why it is not, and the gate's effective thresholds — which are row
 * configuration, so the Host resolves an omitted field against the engine's own
 * default rather than letting a second copy of those numbers exist.
 */
export interface AgentTeamContextJudgeResult {
  /** Whether a judge is reachable for the next step. */
  readonly enabled: boolean
  /** Why no judge is reachable; absent when one is. */
  readonly reason?: 'no-key' | 'unavailable' | undefined
  /** Host-side diagnostic behind `unavailable`; not rendered as user copy. */
  readonly detail?: string | undefined
  /** The environment variable this deployment reads the judge's key from. */
  readonly keyEnv: string
  /** The gate's thresholds in force: row configuration resolved against the engine's defaults. */
  readonly gate: {
    readonly tokens: number
    readonly idleMs: number
    readonly judgeTimeoutMs: number
  }
}

/**
 * Human profile write: the fields the Client supplies, each one optional and
 * independent of the others.
 */
export interface AgentTeamSetHumanProfileRequest {
  /** New display name; omitted keeps the current one. */
  readonly name?: string | undefined
  /**
   * New avatar reference; `null` clears the stored one and omitted keeps it.
   * Clearing needs its own shape because a merge patch cannot remove a field.
   */
  readonly avatarRef?: string | null | undefined
}

/** Resolved Human profile after a write; the same two fields the read returns. */
export interface AgentTeamSetHumanProfileResult {
  readonly name: string
  readonly avatarRef?: string | undefined
}

/** Upload one human avatar image into the persistent avatar store. */
export interface AgentTeamPutHumanAvatarRequest {
  readonly name: string
  readonly mediaType?: string | undefined
  readonly bytesBase64: string
}

export interface AgentTeamPutHumanAvatarResult {
  readonly avatarRef: string
  /** Absolute path members read the bytes from; stable until removed. */
  readonly path: string
  readonly name: string
  readonly byteSize: number
  readonly mediaType: string
}

/** Read one human avatar back for client-side display. */
export interface AgentTeamGetHumanAvatarRequest {
  readonly avatarRef: string
}

export interface AgentTeamGetHumanAvatarResult {
  readonly name: string
  readonly mediaType: string
  readonly byteSize: number
  readonly bytesBase64: string
}

/** Remove one human avatar entry; the profile falls back to hue/initial. */
export interface AgentTeamRemoveHumanAvatarRequest {
  readonly avatarRef: string
}

export interface AgentTeamRemoveHumanAvatarResult {
  readonly removed: boolean
}

/** Intent to append one public Message to an existing Thread. */
export interface AgentTeamReplyRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly body: string
  readonly baseRevision: number
  readonly recipients?: readonly AgentTeamMemberId[]
  /**
   * The Message this reply answers. The Host resolves it against the ledger and
   * refuses a ref that is unknown or belongs to another Thread; the parent's
   * author then joins the recipients, so answering a Member reaches them.
   */
  readonly replyToMessageRef?: AgentTeamMessageRef
  /** Agent-supplied absolute file paths, resolved like sendMessage's. */
  readonly attachmentPaths?: readonly string[] | undefined
  /** Attachment cache IDs from the Human picker, resolved like sendMessage's. */
  readonly attachments?: readonly AgentTeamAttachmentId[] | undefined
  readonly confirmationToken?: AgentTeamConfirmationToken
}

/** A Human must send the same invitation one more time with this token. */
export interface AgentTeamConfirmationRequired {
  readonly kind: 'confirmation_required'
  readonly confirmationToken: AgentTeamConfirmationToken
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly recipients: readonly AgentTeamMemberId[]
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly revision?: number
}

/** Existing unread work must be read before this Thread mutation can proceed. */
export interface AgentTeamUnreadRequired {
  readonly kind: 'unread_required'
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly revision: number
  readonly unreadCount: number
  readonly directCount: number
}

/** A public Thread mutation used an obsolete optimistic-concurrency revision. */
export interface AgentTeamStaleRevision {
  readonly kind: 'stale_revision'
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly expectedRevision: number
  readonly revision: number
}

/** Agent-only request to propose a plan on one Task. */
export interface AgentTeamCreatePlanRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly title: string
  /** Section headings in order; each becomes an empty section to fill later. */
  readonly outline: readonly string[]
}

/**
 * One Task's plan and the description it produced.
 *
 * The plan is the Doc bound to the Task; the description is the Task's own
 * record, so a reader learns both what was proposed and whether it became the
 * issue's description.
 */
export interface AgentTeamPlanStatus {
  readonly taskRef: AgentTeamTaskRef
  /** Absent when the Task has no plan. */
  readonly plan?: {
    readonly docRef: AgentTeamDocRef
    readonly title: string
    readonly status: AgentTeamDocStatus
    readonly revision: number
  }
  /** Absent when the Task's description was never written. */
  readonly description?: {
    readonly source: 'anchor' | 'approvedPlan'
    readonly planRef?: AgentTeamDocRef
    /** The description's own fence. */
    readonly revision: number
  }
}

/** An Agent tried to address an Agent who is not already following. */
export interface AgentTeamMemberNotFollowing {
  readonly kind: 'member_not_following'
  readonly memberIds: readonly AgentTeamMemberId[]
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly revision?: number
}

export interface AgentTeamSendMessageCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention: readonly AgentTeamThreadAttention[]
  readonly directMarkers: readonly AgentTeamDirectMarker[]
}

export type AgentTeamSendMessageResult =
  | AgentTeamSendMessageCommittedResult
  | AgentTeamConfirmationRequired
  | AgentTeamMemberNotFollowing

export interface AgentTeamReplyCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention: readonly AgentTeamThreadAttention[]
  readonly directMarkers: readonly AgentTeamDirectMarker[]
  /**
   * Agents named in the body that this Thread has never carried. The Message
   * still commits; these Members simply receive no notification, and the
   * author is told so it can ask the Human to invite them.
   */
  readonly undeliveredMentions?: readonly AgentTeamMemberId[]
}

export type AgentTeamReplyResult =
  | AgentTeamReplyCommittedResult
  | AgentTeamConfirmationRequired
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision
  | AgentTeamMemberNotFollowing

/**
 * Human or entitled Member intent to close or reopen one comment thread.
 * The root Message addresses the thread; a reply is refused.
 */
export interface AgentTeamResolveCommentRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  /** The thread's root comment. */
  readonly messageRef: AgentTeamMessageRef
  /** `true` closes the thread; `false` reopens it. */
  readonly resolved: boolean
  /** The Thread revision on screen: the other Thread writes' optimistic fence. */
  readonly baseRevision: number
}

export interface AgentTeamResolveCommentCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly threadRef: AgentTeamThreadRef
  readonly messageRef: AgentTeamMessageRef
  /** Present when the write closed the thread; absent when it reopened it. */
  readonly resolved?: AgentTeamCommentResolution | undefined
}

/** A stale Thread revision is a business outcome; a reply ref or a repeat is refused. */
export type AgentTeamResolveCommentResult = AgentTeamResolveCommentCommittedResult | AgentTeamStaleRevision

/** Human intent to create one Task with an opening Message. */
export interface AgentTeamCreateTaskRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  /** Opening Message body; also the fallback title when `title` is absent. */
  readonly body: string
  readonly title?: string
  readonly priority?: AgentTeamTaskPriority
  /** Omit or `null` for an unassigned Task; assigning wakes the Member. */
  readonly assignee?: AgentTeamMemberId | null
  readonly position?: number
  readonly attachments?: readonly AgentTeamAttachmentId[]
  readonly attachmentPaths?: readonly string[]
}

export interface AgentTeamCreateTaskCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention: readonly AgentTeamThreadAttention[]
  readonly directMarkers: readonly AgentTeamDirectMarker[]
}

export type AgentTeamCreateTaskResult = AgentTeamCreateTaskCommittedResult

/** Human intent to change a Task's board fields without moving its status. */
export interface AgentTeamUpdateTaskRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly baseRevision: number
  readonly patch: AgentTeamTaskPatchRequest
}

export interface AgentTeamTaskPatchRequest {
  readonly title?: string
  readonly priority?: AgentTeamTaskPriority
  /** `null` clears the assignment; omitting the key leaves it unchanged. */
  readonly assignee?: AgentTeamMemberId | null
  readonly position?: number
  /**
   * The new description body. The Human sends the text; the Host composes the
   * rest of the record (who wrote it, when, where it came from), so a client
   * cannot forge "this came from an approved plan".
   */
  readonly description?: string
  /**
   * The description fence the Human read. A description write is fenced by
   * the description's own counter, not by the Thread revision, so this is a
   * sibling of `baseRevision` — and a stale one is a business outcome.
   */
  readonly baseDescriptionRevision?: number
}

export interface AgentTeamUpdateTaskCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
}

export type AgentTeamUpdateTaskResult =
  | AgentTeamUpdateTaskCommittedResult
  | AgentTeamStaleRevision
  | AgentTeamStaleDescriptionRevision

/**
 * A description write whose base fence is stale.
 *
 * A business outcome, not an error, and the same shape as `staleRevision`:
 * the description's own counter moved since the writer read it, so the write
 * was refused and the writer re-reads.
 */
export interface AgentTeamStaleDescriptionRevision {
  readonly kind: 'stale_description_revision'
  readonly taskRef?: AgentTeamTaskRef
  /** The fence the writer based the write on. */
  readonly expectedRevision: number
  /** The fence now. */
  readonly revision: number
}

/** Human Task resolution intent. */
export interface AgentTeamTaskRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'accept' | 'close' | 'reopen'
  readonly baseRevision: number
}

export interface AgentTeamTaskCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamTaskActivity
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
}

export type AgentTeamTaskResult =
  | AgentTeamTaskCommittedResult
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision

/** Human intent to attach a real Task overlay to a taskless Thread. */
export interface AgentTeamPromoteThreadRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  readonly baseRevision: number
}

export interface AgentTeamPromoteThreadCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamTaskActivity
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
}

export type AgentTeamPromoteThreadResult =
  | AgentTeamPromoteThreadCommittedResult
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision

/** Human intent to permanently remove one Agent Member. */
export interface AgentTeamRemoveMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamRemoveMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Personal Thread Attention mutation; it is exempt from public mutation fences. */
export interface AgentTeamThreadAttentionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly action: 'follow' | 'unfollow'
}

/**
 * Agent-only direct message to one enabled Agent Member in the same
 * Workspace. Delivery is pure injection: the ledger records the send, and the
 * recipient's live session receives the body as a relay-form user message.
 */
export interface AgentTeamDmRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly recipientMemberId: AgentTeamMemberId
  readonly body: string
}

export interface AgentTeamDmResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly recipient: AgentTeamAgentMember
}

export interface AgentTeamThreadAttentionResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  /** Present after follow, absent after unfollow. */
  readonly attention?: AgentTeamThreadAttention
}

export interface AgentTeamThreadAttentionStatus {
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention?: AgentTeamThreadAttention
}

/** Direction Claim mutation. `baseRevision` fences every non-list public mutation. */
export interface AgentTeamClaimRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'claim' | 'done' | 'release'
  readonly baseRevision: number
  readonly direction?: string
  readonly claimRef?: AgentTeamClaimRef
}

export interface AgentTeamClaimCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamClaimActivity
  readonly claim: AgentTeamClaim
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention?: AgentTeamThreadAttention
}

export type AgentTeamClaimResult =
  | AgentTeamClaimCommittedResult
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision

export interface AgentTeamClaimList {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
}

/** Read-only, personal Workspace Inbox projection. */
export interface AgentTeamInboxRequest {
  readonly workspaceId: WorkspaceId
  /** Unread Threads to return: an integer from 1 to 100, default 50. */
  readonly limit?: number
}

/**
 * One person as an Inbox row draws them: the Member id carries the shared
 * identity hue, the handle the initial. A row names who moved a Thread without
 * a per-row Member view, the same way it already carries its Channel's name.
 */
export interface AgentTeamInboxActor {
  readonly memberId: AgentTeamMemberId
  /** Public handle, or the raw Member id when the roster no longer names them. */
  readonly name: string
}

/** One Thread summary containing no Message bodies. */
export interface AgentTeamInboxItem {
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  /** The owning Channel's display name, so a row renders without a per-row Channel view. */
  readonly channelName?: string
  readonly task?: AgentTeamTask
  /** The Task's ordinal inside its home Channel; absent on taskless Threads. */
  readonly taskNumber?: number
  readonly thread: AgentTeamThread
  /** Unread facts waiting for this reader; always zero on the 「最近活跃」 slice. */
  readonly unreadCount: number
  /** How many of them name this reader; always zero on the 「最近活跃」 slice. */
  readonly directCount: number
  /**
   * The Thread's opening line, trimmed and capped at 120 characters — the same
   * bound the Thread page applies to its Task title. Row material only: it
   * never reaches model-visible notification text.
   */
  readonly previewText?: string
  readonly newestSequence: number
  /** Instant of the newest unread fact — on the 「最近活跃」 slice, of the newest fact. */
  readonly newestOccurredAt: string
  /**
   * Who committed the fact those two fields name — the person waiting for this
   * reader on the queue, and whoever moved the Thread on the tail. Every Thread
   * fact is committed by exactly one actor, so a row always names one.
   */
  readonly newestActor: AgentTeamInboxActor
  /**
   * The people still on this Thread's Task: owners of its live Claims, in claim
   * order, deduped — the same rule, and the same words, the Channel feed's Thread
   * entry row already uses for the same Task. Resolved here because a row draws
   * handles and has no Member view of its own to turn ids into them. Empty on a
   * taskless Thread, and on a done or closed one, whose Claims are history that
   * the state word already tells.
   */
  readonly claimOwners: readonly AgentTeamInboxActor[]
  readonly attention?: AgentTeamThreadAttention
}

export interface AgentTeamInbox {
  /**
   * The ledger's Human Member id — the durable identity a row matches to know
   * which of its actors is the reader, so a seat can draw that one actor from
   * its own Human identity (name and avatar) instead of the row's initials
   * fallback. The same id `AgentTeamView` carries, from the same initialization
   * record.
   */
  readonly humanMemberId: AgentTeamMemberId
  /**
   * The unread queue, mentions first then newest: the Threads holding at least
   * one unread fact for this reader, at most `limit` of them. `hasMore` says
   * whether the queue continues past this page; reading a Thread drains it from
   * the queue, which is how a reader reaches the rows a full page hides.
   */
  readonly items: readonly AgentTeamInboxItem[]
  /** Whether unread Threads exist beyond `items` — the queue is bounded, this is its disclosure. */
  readonly hasMore: boolean
  /**
   * Human readers only: the 「最近活跃」 slice — Threads this reader took part in,
   * newest activity first, at most ten, excluding every Thread the queue above
   * already carries. Agent readers always receive an empty slice, so the
   * model-facing Inbox stays exactly the unread queue.
   */
  readonly recent: readonly AgentTeamInboxItem[]
  readonly totalUnreadCount: number
  readonly totalDirectCount: number
}

/** Request to atomically receive and acknowledge one contiguous Thread batch. */
export interface AgentTeamThreadReadRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
}

/**
 * Private, read-time context guidance for one acceptance the reading Member
 * just acknowledged. Host-computed after the durable read committed; never a
 * ledger fact, never persisted, and absent unless this read acknowledged an
 * unread acceptance of a Task that is still done.
 */
export interface AgentTeamContextAdvice {
  /** Current measured usage of the reading Member's context; absent when unmeasured. */
  readonly usageTokens?: number | undefined
  /** Usage at or above which a fresh rollover is advised; min(128K, handoffAt); absent when unmeasured. */
  readonly taskBoundaryThreshold?: number | undefined
  /** Effective handoff budget of the Member's current route; absent when unmeasured. */
  readonly handoffAt?: number | undefined
  /** Effective hard limit of the Member's current route; absent when unmeasured. */
  readonly hardLimit?: number | undefined
  /** keep | rollover | compact-now | unavailable. */
  readonly action: 'keep' | 'rollover' | 'compact-now' | 'unavailable'
  readonly guidance: string
}

export interface AgentTeamThreadReadResult {
  /**
   * Receipt of the durable read this response committed; absent when the read
   * made no progress — an already-read Thread whose watermark did not move —
   * so no operation was appended and there is nothing to point at.
   */
  readonly receipt?: AgentTeamOperationReceipt
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
  readonly anchor: AgentTeamMessage
  /** Structured Member refs of the anchor Message, from its originating send operation. */
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly facts: readonly AgentTeamThreadReadFact[]
  readonly readThroughSequence: number
  /** Number of unread facts left after this bounded read. */
  readonly remainingUnreadCount: number
  /**
   * Public Thread facts that precede the watermark this read reaches — where
   * the reader now stands in the Thread, and how much of it that position has
   * never shown it. A returning reader's batch answers with the newest facts
   * alone, so this is the span it is not looking at; the count never depends on
   * whether this particular response happened to carry background. Zero means
   * the Thread holds nothing before the reader's position. Absent on a legacy
   * read snapshot, whose stored shape stays frozen.
   */
  readonly earlierFactCount?: number
  readonly attention?: AgentTeamThreadAttention
  readonly consumedDirectMarkers: readonly AgentTeamDirectMarker[]
  /** Present only when this read acknowledged an unread acceptance of a still-done Task. */
  readonly contextAdvice?: AgentTeamContextAdvice
}

/** Non-mutating Thread history request. */
export interface AgentTeamThreadHistoryRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly beforeSequence?: number
  readonly limit?: number
}

export interface AgentTeamThreadHistory {
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly anchor: AgentTeamMessage
  /** Structured Member refs of the anchor Message, from its originating send operation. */
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly claims: readonly AgentTeamClaim[]
  readonly facts: readonly AgentTeamThreadFact[]
  readonly cursor: number
  readonly hasMore: boolean
}

/** Human-only observation of a durable personal Attention change. */
export interface AgentTeamThreadAttentionObservation {
  readonly sequence: number
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly memberId: AgentTeamMemberId
  readonly action: 'follow' | 'unfollow'
}

export interface AgentTeamThreadObservationsRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly limit?: number
}

export interface AgentTeamThreadObservations {
  /** The newest observations up to `limit` (default 50, at most 100); `hasMore` says whether older ones exist. */
  readonly items: readonly AgentTeamThreadAttentionObservation[]
  /** Members whose Attention currently follows the Thread — the state the replayed observations lead to. */
  readonly followers: readonly AgentTeamMemberId[]
  /** Older observations than `items` exist. The follower set is always complete. */
  readonly hasMore: boolean
}

/** One bounded Workspace view item. */
export interface AgentTeamViewItem {
  readonly message: AgentTeamMessage
  /** Structured Member refs of this Message, from its originating send operation. */
  readonly mentions: readonly AgentTeamMemberId[]
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly taskNumber?: number
  /**
   * The people still on this item's Task: owners of its live Claims, in claim
   * order, deduped — the same rule, and the same words, the Inbox row already
   * uses for the same Task, resolved here because a feed entry draws handles
   * and has no Member view of its own. Empty on a taskless item, and on a done
   * or closed one, whose Claims are history that the state word already tells.
   */
  readonly claimOwners: readonly AgentTeamInboxActor[]
  readonly messageCount: number
  /** Instant of the latest fact on this Thread (message or activity), projected from its committing operation. */
  readonly lastActivityAt: string
}

/**
 * One in-flight Task Thread for the team_view「活跃 task thread」radar: work a
 * reader can see is already claimed and moving, so an unexpected Workspace edit
 * or a Task they were about to pick up resolves to "someone is on this" instead
 * of a mystery. Unlike the Human Inbox's 「最近活跃」 slice, admission is not
 * participation — every active Task Thread in the reader's authorized Channels
 * appears, whether or not they took part — and a Thread still holding unread is
 * not excluded, because this radar answers "who is on what" independently of
 * the reader's own unread queue.
 */
export interface AgentTeamActiveTaskThread {
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly channelRef: AgentTeamChannelRef
  /** The Task's ordinal inside its home Channel. */
  readonly taskNumber?: number
  /** Always `in_progress` or `in_review` — the two states a live Claim keeps a Task in. */
  readonly status: AgentTeamTask['status']
  /** The Thread's opening line, trimmed and capped at 120 characters — the same bound the Inbox row uses. */
  readonly subject: string
  /** Owners of the Task's live Claims, in claim order, deduped — the same rule the Inbox row and Channel feed use. */
  readonly members: readonly AgentTeamInboxActor[]
  /** Instant of the newest fact on this Thread. */
  readonly lastActivityAt: string
}

export interface AgentTeamViewRequest {
  readonly workspaceId: WorkspaceId
  readonly channelRef?: AgentTeamChannelRef
  readonly threadRef?: AgentTeamThreadRef
  readonly limit?: number
  readonly cursor?: number
  /** Read facts after the cursor (Agent default) or the latest facts before it (Client history). */
  readonly direction?: 'after' | 'before'
  /** Exclude Thread replies from a top-level-only projection. */
  readonly topLevelOnly?: boolean
  /** Include public Claim and Task activities in the bounded stream (default true). */
  readonly includeActivities?: boolean
  /**
   * Return the durable Task/Thread/Claim catalog of the request's whole scope —
   * the address-book projection `team_view` renders. Omitted, the catalog
   * fields describe this response's own fact page plus the Thread the request
   * names, so a small read never carries every Task, Thread and Claim the
   * Workspace ever had.
   */
  readonly includeCatalog?: boolean
}

/** Bounded public collaboration facts plus a continuation sequence. */
export interface AgentTeamView {
  readonly humanMemberId: AgentTeamMemberId
  /** Every Workspace the viewing Member participates in — the address book for the optional `workspace` selector; `default` marks the Workspace its Session roots in. */
  readonly workspaces: readonly AgentTeamWorkspaceParticipation[]
  readonly channels: readonly AgentTeamChannel[]
  readonly members: readonly AgentTeamChannelMembership[]
  /**
   * Catalog of the response's scope: every visible Task, its Thread, its display
   * ordinal, the live-Claim radar rows and the Claims themselves. With
   * `includeCatalog` this is the whole request scope; without it, only the Tasks
   * and Threads this fact page and the named Thread carry.
   */
  readonly tasks: readonly AgentTeamTask[]
  readonly threads: readonly AgentTeamThread[]
  readonly taskNumbers: readonly { readonly taskRef: AgentTeamTaskRef; readonly taskNumber: number }[]
  readonly items: readonly AgentTeamViewItem[]
  /**
   * The「活跃 task thread」radar: the in_progress / in_review Task Threads of the
   * response's scope, newest activity first. With `includeCatalog` that is every
   * such Task Thread in the reader's authorized Channels of this Workspace;
   * without it, only those the catalog above carries.
   * Independent of the reader's participation and unread state — its job is to
   * surface who is already on what, so re-entry and pre-claim/pre-commit checks
   * do not mistake in-flight work for a conflict.
   */
  readonly activeTaskThreads: readonly AgentTeamActiveTaskThread[]
  readonly claims: readonly AgentTeamClaim[]
  readonly activities: readonly AgentTeamActivity[]
  readonly cursor: number
  readonly hasMore: boolean
}

/** Read request for one issue's read model. */
export interface AgentTeamIssueViewRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  /** Newest comments to carry; integer 1–100, default 50 (validated like threadHistory's limit). */
  readonly commentLimit?: number
}

/**
 * The Human's read model for one issue: the seven regions in one snapshot.
 *
 * The contract carries no variant. The page face, the slice dialog and the
 * peek panel read this same value and render different subsets of it —
 * `commentLimit` is the only variant-sensitive input, and it is a read size.
 */
export interface AgentTeamIssueView {
  /** Identity only — the client renders `properties`, never these fields directly. */
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly taskNumber: number

  /** `task.title ?? boundedInboxPreview(anchor.body)`, resolved once in the Host. */
  readonly title: string
  /**
   * The description is a record, not a string. The durable record is declared
   * once (`AgentTeamTaskDescription`); the region's type extends it with the
   * description's own fence, so there is one shape and not two.
   */
  readonly description: AgentTeamIssueDescription

  readonly properties: AgentTeamIssueProperties
  readonly comments: AgentTeamIssueComments
  readonly activity: AgentTeamIssueActivity
  readonly decisions: readonly AgentTeamIssueDecision[]
  readonly executionLog: AgentTeamIssueExecutionLog
  /** Carried in the value, not rendered in this cut. */
  readonly docs: readonly AgentTeamDocSummary[]

  /**
   * The fence is `thread.revision`; there is no second copy of it on this
   * value. A description write fences on `description.revision` instead.
   */
}

/** One row of the issue view's decisions region: an ask card, a decision record, or both. */
export type AgentTeamIssueDecision =
  | { readonly kind: 'card'; readonly card: AgentTeamDecisionView }
  | { readonly kind: 'decision'; readonly record: AgentTeamDecisionRecord; readonly card?: AgentTeamDecisionView }

/**
 * The issue's description: the durable record plus the description's own fence.
 *
 * The fence is NOT `thread.revision`: a description write neither advances nor
 * is fenced by the Thread revision, so an Agent mid-reply is not made stale by
 * a Human's description edit.
 */
export interface AgentTeamIssueDescription extends AgentTeamTaskDescription {
  /** The description's own fence; every description write checks and bumps it. */
  readonly revision: number
}

/** The issue's board facts, resolved by the Host so the client never re-derives them. */
export interface AgentTeamIssueProperties {
  readonly status: AgentTeamTask['status']
  readonly resolution: AgentTeamTask['resolution']
  readonly priority: AgentTeamTaskPriority          // absent reads as 'none'
  readonly position: number                          // absent reads as 0
  readonly assignee?: AgentTeamMemberId
  readonly channelRef: AgentTeamChannelRef
  readonly channelName: string
  readonly taskNumber: number
  /** Owners of live Claims — board presentation only. NOT the planning gate. */
  readonly claimOwners: readonly AgentTeamMemberId[]
  /**
   * The Host's answer to the planning gate: `true` iff the Task is `todo` and
   * holds no claim with `state === 'active'`. The client reads the answer; it
   * never re-derives the rule.
   */
  readonly planningPhase: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * One comment thread's resolution: who closed it, and when. The Host derives it
 * from the ledger's own resolution operations, so the client reads it and never
 * invents it.
 */
export interface AgentTeamCommentResolution {
  readonly memberId: AgentTeamMemberId
  /** The instant of the operation that closed the thread. */
  readonly resolvedAt: string
}

/** The issue's comments: the newest page of the Thread's Messages, the anchor excluded. */
export interface AgentTeamIssueComments {
  /** The `message` arm of `AgentTeamThreadFact`. No second message shape. The anchor is never here. */
  readonly items: readonly AgentTeamIssueComment[]
  readonly hasMore: boolean
  /** The oldest sequence carried; `beforeSequence: cursor` returns strictly older facts. */
  readonly cursor: number
}

/** One comment of the issue: the `message` arm of a Thread fact, plus its thread's resolution. */
export type AgentTeamIssueComment = Extract<AgentTeamThreadFact, { kind: 'message' }> & {
  /**
   * Present on a root comment whose thread the Host closed. A reply never
   * carries one: a reply is not resolvable on its own, and a thread is closed
   * by its root comment.
   */
  readonly resolved?: AgentTeamCommentResolution | undefined
}

/**
 * One activity of the issue: the `activity` arm of a Thread fact.
 *
 * The ordering key rides with the fact instead of being dropped in the
 * projection, so the client can merge activity with comments on one key
 * without inventing an order. No second activity shape.
 */
export type AgentTeamIssueActivityFact = Extract<AgentTeamThreadFact, { kind: 'activity' }>

/**
 * The issue's activity: the newest public Thread activities, oldest first.
 *
 * Oldest first is the timeline's order, so the merge is a walk and not a sort
 * of two differently-ordered lists.
 */
export interface AgentTeamIssueActivity {
  readonly items: readonly AgentTeamIssueActivityFact[]
  readonly hasMore: boolean
}

/** The issue's execution log: a snapshot of the Thread's Session runs and failed Turns. */
export interface AgentTeamIssueExecutionLog {
  readonly sessions: readonly AgentTeamThreadSessionRuns[]
  readonly failures: readonly AgentTeamThreadTurnFailure[]
}

/** One Workspace a Member participates in, as exposed to the Member-facing view. */
export interface AgentTeamWorkspaceParticipation {
  readonly workspaceId: WorkspaceId
  /** Registry display title; absent when the Workspace is already gone from the registry (a dangling participation pending cleanup). */
  readonly title?: string | undefined
  readonly default: boolean
}

/** One projection slice a Client can wait on; events wake only matching waiters. */
export type AgentTeamChangeScope =
  | { readonly kind: 'workspace'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'channel'; readonly channelRef: AgentTeamChannelRef }
  | { readonly kind: 'thread'; readonly threadRef: AgentTeamThreadRef }
  /**
   * Presence-only lifecycle wake (Agent running/idle/failure) with no ledger
   * commit behind it: members/presence subscribers refresh their rows, while
   * workspace catalog and scope-less Inbox subscribers stay parked because no
   * durable projection changed.
   */
  | { readonly kind: 'presence'; readonly workspaceId: WorkspaceId }
  /**
   * Host activity wake (a running Turn's step/tool progress): its own epoch,
   * shaped like presence. It never wakes a projection waiter.
   */
  | { readonly kind: 'activity'; readonly workspaceId: WorkspaceId }

/** One running Member Turn, as the host folds it from session events. Never persisted. */
export interface AgentTeamMemberActivity {
  readonly memberId: AgentTeamMemberId
  /** Instance slot running this Turn (multi-instance contract v2); absent for the seat's main Session (slot 0). */
  readonly slot?: number
  /** '@name' */
  readonly handle: string
  /** Thread the current Turn was delivered for; absent when unknown. */
  readonly threadRef?: AgentTeamThreadRef
  /** ISO-8601 */
  readonly turnStartedAt: string
  /** Model steps started in the current Turn. */
  readonly stepCount: number
  /** Tool calls started in the current Turn. */
  readonly toolCount: number
  /** label <= 80 chars; never arguments, command text, output, env or credentials. */
  readonly current?: { readonly tool: string; readonly label: string }
  /** ISO-8601, time of the last event folded in. */
  readonly updatedAt: string
}

/** Running Member Turns in one Workspace; `threadRef` narrows to the Turns delivered for that Thread. */
export interface AgentTeamMemberActivityRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
}

/** `revision` is the process-local activity epoch; it never advances the projection. */
export interface AgentTeamMemberActivityResult {
  readonly revision: number
  readonly activities: readonly AgentTeamMemberActivity[]
}

/** Subscribe to lightweight invalidations; each connection starts with a current baseline. */
export interface AgentTeamChangesRequest {
  /** Omit to observe every shared projection change. */
  readonly scope?: AgentTeamChangeScope
}

/** Invalidation, not a history record: intermediate versions may be coalesced. */
export interface AgentTeamChangesResult {
  /** Presence uses a process-local epoch; other scopes use the shared projection's ledger position. */
  readonly version: number
}

/** Human-facing summary of the current Team projection. */
export interface AgentTeamStatus {
  readonly initialized: true
  readonly sequence: number
  readonly operationCount: number
  readonly channelCount: number
  readonly agentMemberCount: number
  readonly humanMemberId: AgentTeamMemberId
}

/** One seat's Session runs in one Thread (contract §4 threadSessions). */
export interface AgentTeamThreadSessionRuns {
  readonly memberId: AgentTeamMemberId
  readonly active: AgentTeamSessionRun | null
  readonly history: readonly AgentTeamSessionRun[]
}

/** One reply's per-reply stats: the recorded Turn that holds it, and whether it is the Member's last reply in that Turn. */
export interface AgentTeamThreadReplyStat {
  readonly messageRef: AgentTeamMessageRef
  readonly memberId: AgentTeamMemberId
  readonly turn: AgentTeamSessionTurnRecordedData
  readonly isLastOfTurn: boolean
}

/** One errored Turn of a Thread's seat, shown to the human; the ledger op's sequence orders it with Messages. */
export interface AgentTeamThreadTurnFailure {
  readonly sequence: number
  readonly occurredAt: string
  readonly threadRef: AgentTeamThreadRef
  readonly memberId: AgentTeamMemberId
  /** The Member's handle, or its memberId when the Member has no projection entry (removed or archived). */
  readonly handle: string
  readonly sessionId: AgentTeamMemberSessionId
  readonly turn: number
  /** The stored redacted reason: first line, at most 200 characters. */
  readonly reason: string
}

/**
 * Room-activity read request (contract §19.1): one Channel, or one Thread inside it. A Channel scope
 * is the request without `threadRef`; a Thread scope names it and uses the Channel only to prove it.
 */
export interface AgentTeamRoomActivityRequest {
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  /** Present for a Thread scope; absent for the whole Channel. */
  readonly threadRef?: AgentTeamThreadRef
  /** Opaque continuation token from a previous page's `nextCursor`; absent for the newest page. */
  readonly cursor?: string
  /** Event rows per page, 1–200; over-limit is clamped server-side, never rejected. */
  readonly limit?: number
  /**
   * ISO-8601 instant bounding the fold: Messages, Turns, failure notices and events older than it
   * are excluded, and only Sessions with activity at or after it are listed (a listed Session's own
   * totals still cover its whole life). Absent folds the whole scope.
   */
  readonly since?: string
}

/**
 * One room-activity event: one committed operation projected into a row (contract §19.1).
 * The summary is plain text bounded to 200 characters; a Message body is never returned whole.
 */
export interface AgentTeamRoomActivityEvent {
  readonly sequence: number
  readonly at: string
  readonly kind: string
  readonly actor: string
  readonly summary: string
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly messageRef?: AgentTeamMessageRef
}

/** One usage bucket of a room-activity scope. Every field is null while any contributing Turn left it unproven (contract §3.2). */
export interface AgentTeamRoomActivityTotals {
  readonly messages: number
  readonly turns: number
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly cacheRead: number | null
  readonly cacheWrite: number | null
  readonly toolCalls: number | null
  readonly runMs: number | null
  readonly failedTurns: number
  readonly unrecordedTurns: number
}

/** One Member's share of a room-activity scope, plus every Session it ran in the scope. */
export interface AgentTeamRoomActivityAgent {
  readonly memberId: AgentTeamMemberId
  readonly messages: number
  readonly turns: number
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly cacheRead: number | null
  readonly cacheWrite: number | null
  readonly toolCalls: number | null
  readonly runMs: number | null
  readonly failedTurns: number
  readonly sessionIds: readonly AgentTeamMemberSessionId[]
}

/** The room-activity read result (contract §19.1): one scope's totals, per-seat shares, its Session runs and its bounded event feed. */
export interface AgentTeamRoomActivityResult {
  readonly scope: 'channel' | 'thread'
  readonly totals: AgentTeamRoomActivityTotals
  readonly perAgent: readonly AgentTeamRoomActivityAgent[]
  readonly sessions: readonly AgentTeamSessionRun[]
  readonly events: readonly AgentTeamRoomActivityEvent[]
  readonly nextCursor?: string
}

/**
 * Workspace-wide activity read request: every Channel of one Workspace folded into
 * one aggregate. Read-only, like `roomActivity`; no Channel ref is needed, so the
 * read works even before any Channel exists.
 */
export interface AgentTeamWorkspaceActivityRequest {
  readonly workspaceId: WorkspaceId
  /** Opaque continuation token from a previous page's `nextCursor`; absent for the newest page. */
  readonly cursor?: string
  /** Event rows per page, 1–200; over-limit is clamped server-side, never rejected. */
  readonly limit?: number
}

/**
 * One per-day spend bucket of the workspace aggregate, in the Host's local day.
 * `tokensIn` is null while any contributing Session ran a Turn whose uncached
 * input split was unreported (the same sticky null the totals use, §3.2).
 */
export interface AgentTeamWorkspaceActivityDayAgent {
  readonly memberId: AgentTeamMemberId
  readonly tokensIn: number | null
  readonly tokensOut: number
  readonly runMs: number
}

/** One local day's spend: the team fold on the day, plus each Member's share of it. */
export interface AgentTeamWorkspaceActivityDay {
  /** Local calendar day, `YYYY-MM-DD` in the Host's timezone. Ascending order. */
  readonly day: string
  readonly tokensIn: number | null
  readonly tokensOut: number
  readonly runMs: number
  readonly perAgent: readonly AgentTeamWorkspaceActivityDayAgent[]
}

/**
 * The workspace-activity read result: the `roomActivity` fold over every Channel of
 * the Workspace at once — totals, per-seat shares, Session runs and the bounded
 * newest-first event feed — plus the per-day spend buckets the Overview page charts.
 */
export interface AgentTeamWorkspaceActivity {
  readonly totals: AgentTeamRoomActivityTotals
  readonly perAgent: readonly AgentTeamRoomActivityAgent[]
  readonly perDay: readonly AgentTeamWorkspaceActivityDay[]
  readonly sessions: readonly AgentTeamSessionRun[]
  readonly events: readonly AgentTeamRoomActivityEvent[]
  readonly nextCursor?: string
}

/** Member intent to start one Team Document in a Thread, with its outline. */
export interface AgentTeamCreateDocRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  /**
   * The Task the Doc is bound to, when it is a plan for one issue. The Doc
   * must live in that Task's Thread: a plan bound to an issue is read with it.
   */
  readonly taskRef?: AgentTeamTaskRef | undefined
  readonly title: string
  /** Section headings in order; each becomes an empty section to fill later. May be empty. */
  readonly outline: readonly string[]
}

/**
 * Intent to write one Doc section: replace `sectionId`, or append a new section
 * when it is absent. The Doc's author writes it; the Human may edit it too.
 */
export interface AgentTeamWriteDocSectionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  /** The Doc revision from the writer's latest read or write. */
  readonly baseDocRevision: number
  readonly sectionId?: string
  readonly heading: string
  readonly markdown: string
}

/** Comment intent on one Doc passage, or a reply to an earlier comment. */
export interface AgentTeamCommentDocRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly sectionId: string
  /** The selected passage; may be empty only for a reply. */
  readonly quote: string
  readonly body: string
  readonly parentCommentRef?: AgentTeamDocCommentRef
}

/** Member intent to ask the Human to review the Doc at its current revision. */
export interface AgentTeamSubmitDocRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly docRevision: number
  /** Optional one-paragraph note for the Human, added to the Thread notice. */
  readonly note?: string
}

/** Human verdict on the Doc at the revision the Human was looking at. */
export interface AgentTeamReviewDocRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly docRevision: number
  readonly verdict: AgentTeamDocVerdict
  /** Optional overall note, added to the Thread notice. */
  readonly note?: string
}

/** Close one comment thread by its root comment. */
export interface AgentTeamResolveDocCommentRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly commentRef: AgentTeamDocCommentRef
}

export interface AgentTeamDocRequest {
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
}

/** List the Docs of one Thread or one Channel, or resolve Doc refs cited in Message bodies. */
export interface AgentTeamDocsRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly channelRef?: AgentTeamChannelRef
  readonly docRefs?: readonly AgentTeamDocRef[]
}

/** Every version of one section, newest first. */
export interface AgentTeamDocSectionHistoryRequest {
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly sectionId: string
}

/** One written version of a section: the outline at creation, or a later write. */
export interface AgentTeamDocSectionVersion {
  readonly sequence: number
  readonly writer: AgentTeamMemberId
  readonly heading: string
  readonly markdown: string
  readonly occurredAt: string
}

export interface AgentTeamDocSectionHistory {
  readonly docRef: AgentTeamDocRef
  readonly sectionId: string
  readonly versions: readonly AgentTeamDocSectionVersion[]
}

/** One section as a reader sees it: its text, and who wrote that text last. */
export interface AgentTeamDocSectionView extends AgentTeamDocSection {
  readonly writer: AgentTeamMemberId
  /** Sequence of the write that produced this text. */
  readonly writtenAtSequence: number
}

/** One comment as a reader sees it. */
export interface AgentTeamDocCommentView extends AgentTeamDocComment {
  readonly occurredAt: string
  /** A Human comment no review verdict has delivered yet. */
  readonly pending: boolean
  /** Its thread is closed: set on the root comment and every reply under it. */
  readonly resolved: boolean
}

/** One review verdict the Human gave. */
export interface AgentTeamDocReview {
  readonly sequence: number
  readonly messageRef: AgentTeamMessageRef
  readonly verdict: AgentTeamDocVerdict
  readonly docRevision: number
  readonly commentRefs: readonly AgentTeamDocCommentRef[]
  readonly occurredAt: string
}

/** The whole current Doc. */
export interface AgentTeamDocView {
  readonly doc: AgentTeamDoc
  /** The ledger's Human Member id, so a reader tells the Human's comments from an Agent's. */
  readonly humanMemberId: AgentTeamMemberId
  readonly status: AgentTeamDocStatus
  /** Sequence of the latest creation or section write; the fence for the next write and for a submit or review. */
  readonly revision: number
  readonly sections: readonly AgentTeamDocSectionView[]
  readonly comments: readonly AgentTeamDocCommentView[]
  readonly reviews: readonly AgentTeamDocReview[]
  /** The revision the latest submit asked the Human to review. */
  readonly submittedRevision?: number
  readonly updatedAt: string
}

/** One Doc as a list row or card shows it. */
export interface AgentTeamDocSummary {
  readonly docRef: AgentTeamDocRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  /** The Task the Doc is bound to, when it is a plan for one issue; absent on a Doc written for the Thread alone. */
  readonly taskRef?: AgentTeamTaskRef | undefined
  readonly title: string
  readonly author: AgentTeamMemberId
  readonly status: AgentTeamDocStatus
  readonly revision: number
  readonly sectionCount: number
  readonly pendingCommentCount: number
  readonly updatedAt: string
}

export interface AgentTeamDocsResult {
  readonly docs: readonly AgentTeamDocSummary[]
}

/** A committed Doc creation: the Doc, its outline, and the revision the first section write is fenced by. */
export interface AgentTeamCreateDocResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly doc: AgentTeamDoc
  readonly sections: readonly AgentTeamDocSection[]
  readonly revision: number
}

export interface AgentTeamDocCommentResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly comment: AgentTeamDocComment
}

export interface AgentTeamResolveDocCommentResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly docRef: AgentTeamDocRef
  readonly commentRef: AgentTeamDocCommentRef
}

/** The Doc changed after the caller read it; nothing was committed. */
export interface AgentTeamStaleDocRevision {
  readonly kind: 'stale_doc_revision'
  readonly docRef: AgentTeamDocRef
  readonly expectedRevision: number
  readonly revision: number
}

export type AgentTeamWriteDocSectionResult =
  | {
    readonly kind: 'committed'
    readonly receipt: AgentTeamOperationReceipt
    readonly docRef: AgentTeamDocRef
    readonly section: AgentTeamDocSection
    /** The Doc revision this write produced; the fence for the next write. */
    readonly revision: number
  }
  | AgentTeamStaleDocRevision

/** A committed submit or review: the Thread notice and the Doc fact it carries. */
export type AgentTeamDocNoticeResult =
  | {
    readonly kind: 'committed'
    readonly receipt: AgentTeamOperationReceipt
    readonly message: AgentTeamMessage
    readonly thread: AgentTeamThread
    readonly notice: AgentTeamDocNotice
  }
  | AgentTeamStaleDocRevision

/** A Member asks one to six questions on one card in a Thread. */
export interface AgentTeamAskDecisionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly context?: string
  /**
   * The seat the card is addressed to. Absent addresses the Human, which is
   * every card recorded before targeted asks existed. A named target must be
   * a live Member of the Workspace and of the card's Channel.
   */
  readonly target?: AgentTeamMemberId
  readonly questions: readonly AgentTeamDecisionQuestion[]
}

/** The Human answers an open card: one answer per question, in question order. */
export interface AgentTeamAnswerDecisionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly decisionRef: AgentTeamDecisionRef
  readonly answers: readonly AgentTeamDecisionAnswer[]
}

/** The asking Member takes back an open card it no longer needs. */
export interface AgentTeamWithdrawDecisionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly decisionRef: AgentTeamDecisionRef
}

export interface AgentTeamDecisionRequest {
  readonly workspaceId: WorkspaceId
  readonly decisionRef: AgentTeamDecisionRef
}

/** The decision cards of one Thread, oldest first. */
export interface AgentTeamDecisionsRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
}

/** One decision card as readers see it: the questions, and the answer once there is one. */
export interface AgentTeamDecisionView {
  readonly decisionRef: AgentTeamDecisionRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly asker: AgentTeamMemberId
  /** The Thread reply that asked; the card renders in its place in the timeline. */
  readonly messageRef: AgentTeamMessageRef
  readonly context?: string
  /** The seat the card is addressed to; absent on a card that addresses the Human. */
  readonly target?: AgentTeamMemberId
  readonly questions: readonly AgentTeamDecisionQuestion[]
  readonly status: AgentTeamDecisionStatus
  readonly askedAt: string
  readonly answers?: readonly AgentTeamDecisionAnswer[]
  /** The member who answered or withdrew, and when. */
  readonly closedBy?: AgentTeamMemberId
  readonly closedAt?: string
  /**
   * The Task the card belongs to, when its Thread has one. Absent on a card
   * asked on a taskless Thread. It answers "which Task is this card on?" for
   * the thread-scoped read; the issue view's decision rows are task-scoped by
   * construction and do not need it.
   */
  readonly taskRef?: AgentTeamTaskRef
}

export interface AgentTeamDecisionsResult {
  readonly decisions: readonly AgentTeamDecisionView[]
}

/**
 * One recorded decision, as the issue view reads it: who decided, what was
 * decided, why, when, and the source it came from.
 *
 * A record is immutable once written: a changed mind is a new record, and the
 * record it supersedes stays listed.
 */
export interface AgentTeamDecisionRecord {
  readonly recordRef: AgentTeamDecisionRecordRef
  /** The Task the decision belongs to, once its Thread has one. */
  readonly taskRef?: AgentTeamTaskRef
  /** The Human (`member:human`) or the seat that decided. */
  readonly decidedBy: AgentTeamMemberId
  /** One line: what was decided. */
  readonly decided: string
  /** Why, in the decider's words. Empty when the decision carried none. */
  readonly rationale: string
  readonly decidedAt: string
  /** Where the decision came from: the ask card, or the plan. */
  readonly source: AgentTeamDecisionRecordSource
  /** The earlier plan record on this Task that this one supersedes. */
  readonly supersedes?: AgentTeamDecisionRecordRef
}

/** The decision records of one Task, oldest first. */
export interface AgentTeamDecisionRecordsRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
}

export interface AgentTeamDecisionRecordsResult {
  readonly records: readonly AgentTeamDecisionRecord[]
}

/** A committed ask, answer or withdrawal: the Thread notice and the decision fact it carries. */
export interface AgentTeamDecisionNoticeResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly thread: AgentTeamThread
  readonly notice: AgentTeamDecisionNotice
}
