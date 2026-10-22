import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamArchiveChannelRequest,
  AgentTeamArchiveChannelResult,
  AgentTeamArchiveMemberRequest,
  AgentTeamArchiveMemberResult,
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamClearMemberContextRequest,
  AgentTeamClearMemberContextResult,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamCreateTaskRequest,
  AgentTeamCreateTaskResult,
  AgentTeamInbox,
  AgentTeamInboxRequest,
  AgentTeamIssueView,
  AgentTeamIssueViewRequest,
  AgentTeamJoinWorkspaceRequest,
  AgentTeamJoinWorkspaceResult,
  AgentTeamLeaveWorkspaceRequest,
  AgentTeamLeaveWorkspaceResult,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamGetAttachmentRequest,
  AgentTeamGetAttachmentResult,
  AgentTeamPutAttachmentRequest,
  AgentTeamPutAttachmentResult,
  AgentTeamMemberResult,
  AgentTeamAddMemberResult,
  AgentTeamRecoverMemberRequest,
  AgentTeamRecoverMemberResult,
  AgentTeamMemberActivityRequest,
  AgentTeamMemberActivityResult,
  AgentTeamUpdateTaskRequest,
  AgentTeamUpdateTaskResult,
  AgentTeamWorkspaceActivityRequest,
  AgentTeamWorkspaceActivity,
  AgentTeamMembersRequest,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamReplyRequest,
  AgentTeamResolveTaskRefsRequest,
  AgentTeamResolveTaskRefsResult,
  AgentTeamMemoryListRequest,
  AgentTeamMemoryListResult,
  AgentTeamResolveThreadRefsRequest,
  AgentTeamResolveMessageRefsRequest,
  AgentTeamResolveMessageRefsResult,
  AgentTeamCommentDocRequest,
  AgentTeamDocCommentResult,
  AgentTeamDocNoticeResult,
  AgentTeamDocRequest,
  AgentTeamDocsRequest,
  AgentTeamDocsResult,
  AgentTeamDocView,
  AgentTeamReviewDocRequest,
  AgentTeamAnswerDecisionRequest,
  AgentTeamDecisionNoticeResult,
  AgentTeamDecisionsRequest,
  AgentTeamDecisionsResult,
  AgentTeamResolveDocCommentRequest,
  AgentTeamResolveDocCommentResult,
  AgentTeamDocSectionHistory,
  AgentTeamDocSectionHistoryRequest,
  AgentTeamWriteDocSectionRequest,
  AgentTeamWriteDocSectionResult,
  AgentTeamResolveThreadRefsResult,
  AgentTeamReplyResult,
  AgentTeamConfirmationRequired,
  AgentTeamThreadHistory,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadObservations,
  AgentTeamThreadObservationsRequest,
  AgentTeamThreadAttentionRequest,
  AgentTeamThreadAttentionResult,
  AgentTeamThreadReadRequest,
  AgentTeamThreadReadResult,
  AgentTeamThreadReplyStat,
  AgentTeamThreadRef,
  AgentTeamThreadTurnFailure,
  AgentTeamThreadSessionRuns,
  AgentTeamPromoteThreadRequest,
  AgentTeamPromoteThreadResult,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamSessionRun,
  AgentTeamUpdateChannelRequest,
  AgentTeamUpdateChannelResult,
  AgentTeamUpdateMemberRequest,
  AgentTeamView,
  AgentTeamViewRequest,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'
import type { TeamChangeListener, TeamChangeScope } from './team-changes.ts'
import type { TeamDraftStore } from './drafts.ts'
import type { TeamHumanIdentitySource } from './human-identity.ts'
import type { TeamTriggerCatalogItem, TeamTriggerCatalogScope } from './trigger-catalog.ts'

export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

/** Subscribe to one projection scope's invalidation stream; disposal aborts the shared poll. */
export type SubscribeTeamChanges = (scope: TeamChangeScope, listener: TeamChangeListener) => () => void

/** One adapter-owned selectable reasoning effort of one model route. */
export interface TeamModelEffortOption {
  readonly id: string
  readonly name: string
}

/** One selectable model row inside one provider group of the Host catalog. */
export interface TeamModelOption {
  readonly id: string
  readonly name: string
  /** Selectable reasoning levels when the adapter exposes them. */
  readonly reasoning?: {
    readonly efforts: readonly TeamModelEffortOption[]
  }
}

/** Provider-grouped slice of the Host model catalog the editors render. */
export interface TeamModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly TeamModelOption[]
}

/** Host-scoped catalog load result; per-provider listing failures ride `failures`. */
export interface TeamModelCatalog {
  readonly groups: readonly TeamModelProviderGroup[]
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}

export type TeamSidebarProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<'team'>
  & TeamNavigationActions
  & {
    navigation: TeamNavigationSource
    /** The Human's own identity: the display name and avatar every seat that names or draws them reads. */
    humanIdentity: TeamHumanIdentitySource
    loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
    /** Human direct-only Inbox slice; the badge sums each visible Workspace's total. */
    loadInbox: (request: AgentTeamInboxRequest) => Promise<RemoteResult<AgentTeamInbox>>
    /** The workspace-wide activity aggregate the Overview tab renders (Board 7/10); read-only, uncached. */
    loadWorkspaceActivity: (request: AgentTeamWorkspaceActivityRequest) => Promise<RemoteResult<AgentTeamWorkspaceActivity>>
    /** The decision cards of one Thread; the Overview needs-attention slice reads them through the shared remotes. */
    loadDecisions: (request: AgentTeamDecisionsRequest) => Promise<RemoteResult<AgentTeamDecisionsResult>>
    /** Fired after every committed durable Thread read; the badge refreshes without waiting for a changes wake. */
    subscribeReads: (listener: () => void) => () => void
    subscribeChanges: SubscribeTeamChanges
    addMember: (request: AgentTeamAddMemberRequest) => Promise<RemoteResult<AgentTeamAddMemberResult>>
    loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
    createChannel: (request: AgentTeamCreateChannelRequest) => Promise<RemoteResult<AgentTeamCreateChannelResult>>
    updateChannel: (request: AgentTeamUpdateChannelRequest) => Promise<RemoteResult<AgentTeamUpdateChannelResult>>
    archiveChannel: (request: AgentTeamArchiveChannelRequest) => Promise<RemoteResult<AgentTeamArchiveChannelResult>>
    updateMember: (request: AgentTeamUpdateMemberRequest) => Promise<RemoteResult<AgentTeamMemberResult>>
    recoverMember: (request: AgentTeamRecoverMemberRequest) => Promise<RemoteResult<AgentTeamRecoverMemberResult>>
    /**
     * Host clear-context remote kept as a hidden migration escape hatch.
     * The visible row action is retired: Members manage their own context
     * through the context_rollover tool (see docs/architecture/README.md).
     */
    clearMemberContext: (request: AgentTeamClearMemberContextRequest) => Promise<RemoteResult<AgentTeamClearMemberContextResult>>
    archiveMember: (request: AgentTeamArchiveMemberRequest) => Promise<RemoteResult<AgentTeamArchiveMemberResult>>
    joinWorkspace: (request: AgentTeamJoinWorkspaceRequest) => Promise<RemoteResult<AgentTeamJoinWorkspaceResult>>
    leaveWorkspace: (request: AgentTeamLeaveWorkspaceRequest) => Promise<RemoteResult<AgentTeamLeaveWorkspaceResult>>
    joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
    /** Session-independent Host model catalog (`llm.models`); needs no live Member. */
    loadModels: () => Promise<RemoteResult<TeamModelCatalog>>
    /** A14: the Member's Session runs, newest first, plus the seat's current Session. */
    loadMemberSessions: (request: { readonly workspaceId: AgentTeamViewRequest['workspaceId']; readonly memberId: AgentTeamClientMemberStatus['member']['memberId'] }) => Promise<RemoteResult<{ readonly current: AgentTeamClientMemberStatus['member']['sessionId'] | null; readonly runs: readonly AgentTeamSessionRun[] }>>
    /** The board's catalog read: the Agent page's current Task and Tasks tab. */
    loadBoard: (request: { readonly workspaceId: AgentTeamViewRequest['workspaceId'] }) => Promise<RemoteResult<AgentTeamView>>
    /** Running Turns of the Workspace; the Agent page narrows it to one Member for the live tool label. */
    loadMemberActivity: (request: AgentTeamMemberActivityRequest) => Promise<RemoteResult<AgentTeamMemberActivityResult>>
    /** Errored Turns of one Thread: the Agent page's run failure reasons. */
    threadTurnFailures: (request: { readonly workspaceId: AgentTeamThreadObservationsRequest['workspaceId']; readonly threadRef: AgentTeamThreadRef }) => Promise<RemoteResult<readonly AgentTeamThreadTurnFailure[]>>
    /** Cancel one Member Session's running Turn through the dsh Session controller (`session.cancel`); the Team Host is untouched. */
    stopSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => Promise<RemoteResult<{ readonly accepted: true }>>
    /** Names the Threads a Session run touched, for the Agent detail's Session rows. */
    resolveThreadRefs: (request: AgentTeamResolveThreadRefsRequest) => Promise<RemoteResult<AgentTeamResolveThreadRefsResult>>
    /** Team memory read for Agent detail's Memory tab (the Human memory list; the Host adds the actor). */
    loadMemory: (request: AgentTeamMemoryListRequest) => Promise<RemoteResult<AgentTeamMemoryListResult>>
    /** Embed the Member's Session conversation in the Team conversation seat. */
    openMemberSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId'], reportFailure?: (message: string) => void) => void
    /** A14: open the Agent's current Session natively; the Agent's detail tabs ride the conversation. */
    openAgentDetail: (workspaceId: AgentTeamViewRequest['workspaceId'], memberId: AgentTeamClientMemberStatus['member']['memberId'], sessionId: AgentTeamClientMemberStatus['member']['sessionId'], reportFailure?: (message: string) => void) => void
    selectedChannelRef?: AgentTeamChannelRef
  }

export type TeamConversationProps = PropsRuntime<'main'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  /** Keyed composer draft cache; one store per Client context. */
  drafts: TeamDraftStore
  /**
   * Lazy read-only catalogs. Host commands come from the retained main
   * Session; skills are scoped to the caller's selected Member session.
   */
  loadTriggerCatalog: (scope: TeamTriggerCatalogScope, signal: AbortSignal) => Promise<readonly TeamTriggerCatalogItem[]>
  /** The Human's own identity: the display name and avatar every seat that names or draws them reads. */
  humanIdentity: TeamHumanIdentitySource
  loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
  readThread: (request: AgentTeamThreadReadRequest) => Promise<RemoteResult<AgentTeamThreadReadResult>>
  loadThreadHistory: (request: AgentTeamThreadHistoryRequest) => Promise<RemoteResult<AgentTeamThreadHistory>>
  subscribeChanges: SubscribeTeamChanges
  putAttachment: (request: AgentTeamPutAttachmentRequest) => Promise<RemoteResult<AgentTeamPutAttachmentResult>>
  getAttachment: (request: AgentTeamGetAttachmentRequest) => Promise<RemoteResult<AgentTeamGetAttachmentResult>>
  sendMessage: (request: AgentTeamSendMessageRequest) => Promise<RemoteResult<AgentTeamSendMessageResult>>
  joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
  removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
  /** Archive a Channel from the Channel page's overflow menu (D1b). */
  archiveChannel: (request: AgentTeamArchiveChannelRequest) => Promise<RemoteResult<AgentTeamArchiveChannelResult>>
  reply: (request: AgentTeamReplyRequest) => Promise<RemoteResult<AgentTeamReplyResult | AgentTeamConfirmationRequired>>
  changeTask: (request: AgentTeamTaskRequest) => Promise<RemoteResult<AgentTeamTaskResult>>
  /** Human's own Thread Attention: follow/unfollow of this Thread as the reading Human. */
  changeAttention: (request: AgentTeamThreadAttentionRequest) => Promise<RemoteResult<AgentTeamThreadAttentionResult>>
  promoteThread: (request: AgentTeamPromoteThreadRequest) => Promise<RemoteResult<AgentTeamPromoteThreadResult>>
  resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>
  resolveThreadRefs: (request: AgentTeamResolveThreadRefsRequest) => Promise<RemoteResult<AgentTeamResolveThreadRefsResult>>
  /** Quote context (author + excerpt) for the Messages replies cite; unknown refs are omitted. */
  resolveMessageRefs: (request: AgentTeamResolveMessageRefsRequest) => Promise<RemoteResult<AgentTeamResolveMessageRefsResult>>
  /** Team Document rows of one Thread or one Channel; both pages show them as cards. */
  loadDocs: (request: AgentTeamDocsRequest) => Promise<RemoteResult<AgentTeamDocsResult>>
  /** One whole Team Document for its page. */
  loadDoc: (request: AgentTeamDocRequest) => Promise<RemoteResult<AgentTeamDocView>>
  /** The Human's comment on a selected passage; it stays pending until a verdict. */
  commentDoc: (request: AgentTeamCommentDocRequest) => Promise<RemoteResult<AgentTeamDocCommentResult>>
  /** The Human's Approve, Review or Cancel verdict, fenced by the Doc revision on screen. */
  reviewDoc: (request: AgentTeamReviewDocRequest) => Promise<RemoteResult<AgentTeamDocNoticeResult>>
  /** The Human's edit of one section, or a restore of an earlier version, fenced by the Doc revision on screen. */
  writeDocSection: (request: AgentTeamWriteDocSectionRequest) => Promise<RemoteResult<AgentTeamWriteDocSectionResult>>
  /** Close one comment thread; a pending Human comment in it is withdrawn. */
  resolveDocComment: (request: AgentTeamResolveDocCommentRequest) => Promise<RemoteResult<AgentTeamResolveDocCommentResult>>
  /** Every version of one section, newest first. */
  loadDocSectionHistory: (request: AgentTeamDocSectionHistoryRequest) => Promise<RemoteResult<AgentTeamDocSectionHistory>>
  /** The decision cards of one Thread; each renders in place of the reply that asked it. */
  loadDecisions: (request: AgentTeamDecisionsRequest) => Promise<RemoteResult<AgentTeamDecisionsResult>>
  /** The Human's answer to one open card; the reply it posts wakes the asker. */
  answerDecision: (request: AgentTeamAnswerDecisionRequest) => Promise<RemoteResult<AgentTeamDecisionNoticeResult>>
  loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
  /** The board's catalog read: one whole-Workspace `view` per query key. */
  loadBoard: (request: { readonly workspaceId: AgentTeamViewRequest['workspaceId'] }) => Promise<RemoteResult<AgentTeamView>>
  /**
   * The issue view: one read per issue, shared by every presentation of it.
   * The Thread scope is known only once the board card that opens the issue
   * has been read; passing it narrows the query's covered scopes.
   */
  loadIssueView: (request: AgentTeamIssueViewRequest, threadRef?: AgentTeamThreadRef) => Promise<RemoteResult<AgentTeamIssueView>>
  /** Board create: one unassigned Task with its opening Message. */
  createTask: (request: AgentTeamCreateTaskRequest) => Promise<RemoteResult<AgentTeamCreateTaskResult>>
  /** Board field write: title/priority/assignee/position, fenced by the Thread revision. */
  updateTask: (request: AgentTeamUpdateTaskRequest) => Promise<RemoteResult<AgentTeamUpdateTaskResult>>
  /** Running Turns (A13 v2) for the activity line above the composer; in-memory on the Host, never persisted. */
  loadMemberActivity: (request: AgentTeamMemberActivityRequest) => Promise<RemoteResult<AgentTeamMemberActivityResult>>
  /** The workspace-wide activity aggregate the Overview page renders (Board 7/10); read-only, uncached. */
  loadWorkspaceActivity: (request: AgentTeamWorkspaceActivityRequest) => Promise<RemoteResult<AgentTeamWorkspaceActivity>>
  /** Human direct-only Inbox slice; the Inbox page merges one call per visible Workspace. */
  loadInbox: (request: AgentTeamInboxRequest) => Promise<RemoteResult<AgentTeamInbox>>
  /** Human-only Thread Attention observations; the Thread composer ranks the returned followers first. */
  threadObservations: (request: AgentTeamThreadObservationsRequest) => Promise<RemoteResult<AgentTeamThreadObservations>>
  /** Per-reply usage of one Thread's agent replies; the page keys the rows by message ref. */
  threadReplyStats: (request: { readonly workspaceId: AgentTeamThreadObservationsRequest['workspaceId']; readonly threadRef: AgentTeamThreadRef }) => Promise<RemoteResult<readonly AgentTeamThreadReplyStat[]>>
  /** Errored-Turn notices of the Thread, every notice kept; the page merges them into the timeline by ledger sequence. */
  threadTurnFailures: (request: { readonly workspaceId: AgentTeamThreadObservationsRequest['workspaceId']; readonly threadRef: AgentTeamThreadRef }) => Promise<RemoteResult<readonly AgentTeamThreadTurnFailure[]>>
  /** Per-seat Session runs that touched one Thread: each seat's active run plus its history (contract §4); the execution log reads it. */
  loadThreadSessions: (request: { readonly workspaceId: AgentTeamThreadObservationsRequest['workspaceId']; readonly threadRef: AgentTeamThreadRef }) => Promise<RemoteResult<readonly AgentTeamThreadSessionRuns[]>>
  /** Cancel one Member Session's running Turn through the dsh Session controller (`session.cancel`); the Team Host is untouched. */
  stopSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => Promise<RemoteResult<{ readonly accepted: true }>>
  /** Agent-card session jump, shared by every slot; message member chips reuse it. */
  openMemberSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId'], reportFailure?: (message: string) => void) => void
  /**
   * L1 (issue 57): whether the shell's left column is closed, read reactively.
   * The frame publishes it on its element and hands the main seat no owner
   * props, so the whole Channel/Thread surface reads it through this hook.
   */
  useSidebarCollapsed: () => boolean
  /** Reopen the shell's left column through the shell's own action. */
  openSidebar: () => void
}

export type TeamSettingsProps = PropsRuntime<'sidebar.settings'> & PropsLocale<'team'> & TeamNavigationActions & {
  loadMemberGroups: () => Promise<readonly TeamMemberGroup[]>
}

export interface TeamMemberGroup {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly members: readonly AgentTeamClientMemberStatus[]
}
