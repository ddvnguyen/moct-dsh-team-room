/**
 * @deprecated The legacy Thread view (D10, 2026-10-22). The issue surface
 * (`./issue/`) is what every entry point opens now; this page is a **peer
 * surface**, not a component the issue view borrows from. It is frozen —
 * fixes only, no new region, no new write, no new op kind — and it stays
 * reachable from the Channel face and from the issue header's
 * "Open the legacy thread view" control. See `docs/frontend-design/board.md`.
 *
 * One store, two views: both surfaces read the same Thread facts from the
 * Host, so a comment posted in one must appear in the other. A disagreement
 * is a bug in the issue view, never a second comment store.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamChannelRef,
  AgentTeamConfirmationToken,
  AgentTeamDecisionAnswer,
  AgentTeamDecisionRef,
  AgentTeamDecisionView,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamRequestId,
  AgentTeamTaskPatchRequest,
  AgentTeamTaskRef,
  AgentTeamThreadFact,
  AgentTeamThreadReadFact,
  AgentTeamThreadRef,
  AgentTeamThreadTurnFailure,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, DisclosureRow, IconChecklistOutlineRegular, IconChevronLeftOutlineRegular, IconCloseOutlineRegular, IconPanelLeftOutlineRegular, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import type { TeamDraftKey, TeamDraftStore } from './drafts.ts'
import { useThreadAttention } from './team-attention.ts'
import { TeamMemberRow } from './TeamMemberRow.tsx'
import { TeamComposer } from './TeamComposer.tsx'
import { diagnosticText, TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamMessage } from './TeamMessage.tsx'
import { namedAvatarOwners, TeamAvatarStack, type TeamAvatarHuman } from './TeamAvatarStack.tsx'
import { TeamRunDivider } from './TeamRunDivider.tsx'
import { replyStatsView, type ReplyStatsView } from './reply-stats.ts'
import { firstSentence, formatActivity, formatClaimState, formatRiskClass, formatTaskStatus, formatTaskTitle, mentionNameOf, mentionNamesOf, mentionedMemberIds, taskStatusDot, type MentionHandle } from './team-formatters.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { mintRequestId, uploadComposerFiles } from './requests.ts'
import { daySeparatorLabel, isRunGap, timelineDayKey } from './team-separators.ts'
import { useTimelineScroll } from './timeline-scroll.ts'
import { TeamActivityLine } from './TeamActivityLine.tsx'
import { TeamThreadDocs } from './TeamThreadDocs.tsx'
import { TeamDecisionCard } from './TeamDecisionCard.tsx'
import { ExecutionLog } from './thread/ExecutionLog.tsx'
import { AssigneePicker } from './multica-ui/AssigneePicker.tsx'
import { PriorityPicker } from './multica-ui/PriorityPicker.tsx'
import { StatusPicker } from './multica-ui/StatusPicker.tsx'
import { AgentAvatarStack } from './multica-ui/AgentAvatarStack.tsx'
import { makeTimeAgo } from './multica/time-ago.ts'
import { normalizePriority } from './multica/priority.ts'
import look from './multica-look.module.css'
import detailCss from './thread-detail.module.css'
import { hostTaskRefLookup } from './refs.ts'
import { hostThreadRefLookup, jumpToThread } from './refs.ts'
import { cachedResolvedMessageRef, hostMessageRefLookup, resolveUnknownMessageRefs, useResolvedMessageRefVersion } from './refs.ts'
import { rosterChannelName, rosterMember } from './refs.ts'
import css from './conversation.module.css'
import channelCss from './channel.module.css'
import threadCss from './thread.module.css'

interface TeamThreadPageProps {
  readonly workspaceId: WorkspaceId
  /** The Human's own display name and avatar, from the shared identity projection. */
  readonly humanName: string
  readonly humanAvatarUrl?: string | undefined
  readonly channelRef?: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber?: number
  readonly backToWorkspace: TeamConversationProps['backToWorkspace']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly readThread: TeamConversationProps['readThread']
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  readonly threadObservations: TeamConversationProps['threadObservations']
  readonly threadReplyStats: TeamConversationProps['threadReplyStats']
  readonly threadTurnFailures: TeamConversationProps['threadTurnFailures']
  readonly loadThreadSessions: TeamConversationProps['loadThreadSessions']
  readonly updateTask: TeamConversationProps['updateTask']
  readonly stopSession: TeamConversationProps['stopSession']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly loadMemberActivity: TeamConversationProps['loadMemberActivity']
  readonly drafts: TeamDraftStore
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  readonly getAttachment: TeamConversationProps['getAttachment']
  readonly reply: TeamConversationProps['reply']
  readonly changeTask: TeamConversationProps['changeTask']
  /** The Human's own Thread Attention op: follow/unfollow this Thread as the reading Human. */
  readonly changeAttention: TeamConversationProps['changeAttention']
  readonly promoteThread: TeamConversationProps['promoteThread']
  readonly putAttachment: TeamConversationProps['putAttachment']
  readonly selectChannel: TeamConversationProps['selectChannel']
  readonly selectThread: TeamConversationProps['selectThread']
  /** The global opener: a cited Task opens as an issue slice over the Thread. */
  readonly openIssue: TeamConversationProps['openIssue']
  readonly resolveTaskRefs: TeamConversationProps['resolveTaskRefs']
  readonly resolveThreadRefs: TeamConversationProps['resolveThreadRefs']
  readonly resolveMessageRefs: TeamConversationProps['resolveMessageRefs']
  readonly loadDocs: TeamConversationProps['loadDocs']
  readonly reviewDoc: TeamConversationProps['reviewDoc']
  readonly loadDecisions: TeamConversationProps['loadDecisions']
  readonly answerDecision: TeamConversationProps['answerDecision']
  readonly selectDoc: TeamConversationProps['selectDoc']
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  /** Whether the shell's left column is closed; the header offers the open control while it is. */
  readonly sidebarCollapsed: boolean
  /** Reopen the shell's left column through the shell's own action. */
  readonly openSidebar: () => void
  /** Open beside its Channel rather than alone: the back crumb closes the lane, and the page is a region, not the seat's main landmark. */
  readonly inLane?: boolean
  readonly t: TeamConversationProps['t']
}

type ReadProjection = Awaited<ReturnType<TeamThreadPageProps['readThread']>> extends infer Result
  ? Result extends { ok: true; value: infer Value } ? Value : never
  : never

type ThreadFactKey = string

function factKey(fact: AgentTeamThreadFact): ThreadFactKey {
  return fact.kind === 'message' ? `message:${fact.message.messageRef}` : `activity:${fact.activity.activityRef}`
}

function messageFact(message: ReadProjection['anchor'], mentions: readonly AgentTeamMemberId[] = []): AgentTeamThreadFact {
  return { kind: 'message', sequence: message.sequence, message, mentions, occurredAt: message.occurredAt }
}

/**
 * A fact owns its mention array, so the rendered name list is cached against
 * that array. Every roster refresh replaces the handles map with a fresh Map of
 * identical content, so the cache compares the resolved names rather than the
 * map identity: identity stays stable while the names are unchanged, which is
 * what keeps a memoized row from re-rendering on every refresh.
 */
const mentionNamesCache = new WeakMap<readonly AgentTeamMemberId[], readonly MentionHandle[]>()

function stableMentionNames(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>, humanName: string): readonly MentionHandle[] {
  const names = mentionNamesOf(mentions, handles, humanName)
  const cached = mentionNamesCache.get(mentions)
  if (cached !== undefined && cached.length === names.length && cached.every((name, index) => mentionNameOf(name) === mentionNameOf(names[index]!))) return cached
  mentionNamesCache.set(mentions, names)
  return names
}

function mergeFacts(...groups: readonly (readonly AgentTeamThreadFact[])[]): readonly AgentTeamThreadFact[] {
  const byKey = new Map<ThreadFactKey, AgentTeamThreadFact>()
  for (const group of groups) for (const fact of group) byKey.set(factKey(fact), fact)
  return [...byKey.values()].sort((left, right) => left.sequence - right.sequence)
}

function minSequence(facts: readonly AgentTeamThreadFact[]): number | undefined {
  return facts.reduce<number | undefined>((minimum, fact) => minimum === undefined ? fact.sequence : Math.min(minimum, fact.sequence), undefined)
}

function readMeta(facts: readonly AgentTeamThreadReadFact[]): ReadonlyMap<ThreadFactKey, AgentTeamThreadReadFact> {
  return new Map(facts.map(fact => [factKey(fact.fact), fact]))
}

/** @deprecated The legacy Thread view (D10). The issue surface is current; this page is frozen and stays reachable. */
export function TeamThreadPage(props: TeamThreadPageProps) {
  const {
    workspaceId, humanName, humanAvatarUrl, channelRef, taskRef, threadRef, taskNumber, backToWorkspace, selectChannel, selectThread, openIssue, resolveTaskRefs, resolveThreadRefs, resolveMessageRefs, openMemberSession, putAttachment,
    loadChannels, readThread, loadThreadHistory, threadObservations, threadReplyStats, threadTurnFailures, loadThreadSessions, updateTask, stopSession,
    changeAttention, loadDocs, reviewDoc, loadDecisions, answerDecision, selectDoc,
    subscribeChanges, loadMembers, loadMemberActivity, drafts, loadTriggerCatalog, getAttachment, reply, changeTask, promoteThread, sidebarCollapsed, openSidebar, inLane = false, t,
  } = props
  const threadRequest = { threadRef, ...(taskRef === undefined ? {} : { taskRef }) }
  const [projection, setProjection] = useState<ReadProjection>()
  const [docsVersion, setDocsVersion] = useState(0)
  // Decision cards asked in this Thread, keyed by the reply that asked each.
  // The Thread wake that bumps docsVersion re-reads them too.
  const [decisions, setDecisions] = useState<ReadonlyMap<AgentTeamMessageRef, AgentTeamDecisionView>>(() => new Map())
  const [decisionsReload, setDecisionsReload] = useState(0)
  const decisionsSequence = useRef(0)
  const [channelView, setChannelView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  // Current Thread followers; the composer ranks them first because a mention
  // to a follower delivers directly instead of entering the invite detour.
  const [followerIds, setFollowerIds] = useState<ReadonlySet<AgentTeamMemberId>>(() => new Set())
  const [currentFacts, setCurrentFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [olderFacts, setOlderFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [readFacts, setReadFacts] = useState<readonly AgentTeamThreadReadFact[]>([])
  const [historyCursor, setHistoryCursor] = useState<number>()
  const [historyHasMore, setHistoryHasMore] = useState(false)
  // A bounded read acknowledges at most 20 unread facts; larger backlogs need
  // continuation reads. Reads also never self-wake a change scope, so a
  // backlog beyond a handful of batches would otherwise linger forever. The
  // cap stops a pathological feed (facts arriving faster than they are read)
  // from looping without bound; the error surface keeps the remainder visible.
  const MAX_AUTO_READ_ROUNDS = 50
  const [autoReadExhausted, setAutoReadExhausted] = useState(false)
  const [newFactsCount, setNewFactsCount] = useState(0)
  // The reply draft lives in the keyed draft cache: view switches unmount
  // this page, and a refresh must not cost the half-written message either.
  // The composer owns the subscription — this page only reads a snapshot when
  // it sends, so typing never re-renders the timeline.
  const draftKey: TeamDraftKey = `thread:${threadRef}`
  // Early acceptance: the Human may accept while Claims are still open; the
  // confirm dialog lists exactly what will be completed with the Task.
  const [confirmingAccept, setConfirmingAccept] = useState(false)
  // L1 (issue 57, item 3): the Thread's member surface. Existing ops cap what it
  // can offer — the Host's changeAttention is the Human's PERSONAL op, so it
  // toggles only the reading Human's follow. The dialog therefore lists members
  // and followers read-only, offers the Human's own follow/unfollow, and invites a
  // Channel member by seeding an @mention into the composer draft.
  const [managingThreadMembers, setManagingThreadMembers] = useState(false)
  const [inviteNote, setInviteNote] = useState<string>()
  // Multica issue layout: the inline title editor and the properties sheet.
  // The editor saves on Enter and on blur, the way the issue page's own title
  // does; Escape discards the draft.
  const [editingTitle, setEditingTitle] = useState(false)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)
  const titleBusyRef = useRef(false)
  const [titleError, setTitleError] = useState<string>()
  // The properties sidebar collapses into a sheet under the lane width; the
  // sheet rides the same dsh Modal every dialog on the page uses.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [patchPending, setPatchPending] = useState(false)

  useEffect(() => {
    if (confirmingAccept && projection?.task?.resolution === 'accepted') setConfirmingAccept(false)
  }, [confirmingAccept, projection?.task?.resolution])
  const [replyRequestId, setReplyRequestId] = useState<AgentTeamRequestId>()
  // The Message the next send answers; it rides the reply as replyToMessageRef.
  const [replyTarget, setReplyTarget] = useState<AgentTeamMessageRef>()
  const [flashedMessage, setFlashedMessage] = useState<AgentTeamMessageRef>()
  const [confirmation, setConfirmation] = useState<AgentTeamConfirmationToken>()
  const [statusMessage, setStatusMessage] = useState<string>()
  const [pending, setPending] = useState(false)
  // Label source for the promote/accept buttons only: a reply send also raises
  // the shared `pending` gate, and must not retitle those buttons.
  const [mutating, setMutating] = useState<'promote' | 'accept' | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)
  const currentFactsRef = useRef<readonly AgentTeamThreadFact[]>([])
  const sequenceRef = useRef(0)
  const readRequestIdRef = useRef<AgentTeamRequestId>(mintRequestId())
  const projectionRef = useRef<ReadProjection>()
  const mutationRequests = useRef(new Map<string, AgentTeamRequestId>())
  const threadLastFact = currentFacts[currentFacts.length - 1]
  const timeline = useTimelineScroll(`${currentFacts.length}:${olderFacts.length}:${threadLastFact === undefined ? '' : factKey(threadLastFact)}`)

  const updateProjection = (next: ReadProjection): void => {
    projectionRef.current = next
    setProjection(next)
    setReadFacts(next.facts)
    const anchor = messageFact(next.anchor, next.anchorMentions)
    const batch = [anchor, ...next.facts.map(fact => fact.fact)]
    setCurrentFacts(current => {
      const merged = mergeFacts(current, batch)
      currentFactsRef.current = merged
      return merged
    })
  }

  // Continue a bounded read while unread facts remain. Each round must mint a
  // fresh requestId: the Host replays a repeated id from its idempotency
  // cache, which would return the same batch forever. The loop terminates on
  // a zero remainder, a failed read (the existing error surface offers
  // retry), a superseding sequence, or the round cap.
  const drainUnread = async (): Promise<void> => {
    for (let round = 1; round <= MAX_AUTO_READ_ROUNDS; round += 1) {
      const snapshot = projectionRef.current
      if (snapshot === undefined || snapshot.remainingUnreadCount <= 0) return
      const beforeSequence = sequenceRef.current
      if (!await readCurrent(true)) return
      // A newer read or remount owns the tail now; it drains the remainder.
      if (!mountedRef.current || sequenceRef.current !== beforeSequence + 1) return
      // A stalled remainder (Host fault) must not spin the loop.
      if (projectionRef.current?.remainingUnreadCount === snapshot.remainingUnreadCount) return
    }
    setAutoReadExhausted(true)
  }

  const readCurrent = async (newRequest = false): Promise<boolean> => {
    if (!mountedRef.current) return false
    if (newRequest) readRequestIdRef.current = mintRequestId()
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    try {
      const result = await readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest })
      if (!mountedRef.current || sequence !== sequenceRef.current) return false
      if (!result.ok) { setError(result.error.message); return false }
      updateProjection(result.value)
      setError(undefined)
      return true
    } catch (cause) {
      if (mountedRef.current && sequence === sequenceRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) setLoading(false)
    }
  }

  /** One roster + view read. Answers false once the page is gone. */
  const applySupplemental = async (): Promise<boolean> => {
    try {
      const [loadedMembers, loadedView] = await Promise.all([
        loadMembers({ workspaceId }),
        loadChannels({ workspaceId, ...(channelRef === undefined ? {} : { channelRef }), threadRef, includeActivities: false, limit: 1 }),
      ])
      if (!mountedRef.current) return false
      if (loadedMembers.ok) setMembers(loadedMembers.value)
      if (loadedView.ok) setChannelView(loadedView.value)
      const failure = [loadedMembers, loadedView].find(result => !result.ok)
      if (failure !== undefined && !failure.ok) setError(failure.error.message)
      return true
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return mountedRef.current
    }
  }

  const supplementalRef = useRef<Promise<void>>()
  const supplementalPendingRef = useRef(false)
  const refreshSupplemental = (): Promise<void> => {
    supplementalPendingRef.current = true
    if (supplementalRef.current !== undefined) return supplementalRef.current
    const round = (async () => {
      // Collect synchronous scope notifications before issuing the shared read.
      await Promise.resolve()
      while (mountedRef.current && supplementalPendingRef.current) {
        supplementalPendingRef.current = false
        if (!await applySupplemental()) return
      }
    })().finally(() => {
      if (supplementalRef.current === round) supplementalRef.current = undefined
    })
    supplementalRef.current = round
    return round
  }

  // Presence and roster live in the workspace projection; they never need
  // the channel view that the supplemental fetch performs.
  const refreshMembers = async (): Promise<void> => {
    if (!mountedRef.current) return
    try {
      const loaded = await loadMembers({ workspaceId })
      if (!mountedRef.current) return
      if (loaded.ok) setMembers(loaded.value); else setError(loaded.error.message)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const refreshPassiveFacts = async (): Promise<void> => {
    try {
      const result = await loadThreadHistory({ workspaceId, ...threadRequest, limit: 100 })
      if (!mountedRef.current || !result.ok) return
      const incoming = result.value.facts
      const shown = currentFactsRef.current
      if (shown.length === 0) return
      const known = new Set(shown.map(fact => factKey(fact)))
      // Facts older than everything already rendered are backfill of the
      // wider history window this fetch uses, not new updates; counting
      // them would re-flag already-read messages after every change wake.
      const newestShown = shown.reduce((maximum, fact) => Math.max(maximum, fact.sequence), 0)
      const additions = incoming.filter(fact => !known.has(factKey(fact)) && fact.sequence > newestShown)
      setCurrentFacts(current => {
        const merged = mergeFacts(current, incoming)
        currentFactsRef.current = merged
        return merged
      })
      setProjection(current => {
        // React state can lag the ref here: a read landing between this wake's
        // dispatch and its render means the queued `current` is already stale,
        // and spreading it would resurrect a pre-read projection (and stall a
        // running unread drain on a phantom unchanged remainder). The ref is
        // written synchronously at every write site, so it is the freshest base.
        const base = projectionRef.current ?? current
        const next = base === undefined ? current : { ...base, ...(result.value.task === undefined ? {} : { task: result.value.task }), thread: result.value.thread, claims: result.value.claims }
        if (next !== undefined) projectionRef.current = next
        return next
      })
      if (additions.length === 0) return
      // Every arrival while the Thread is open is acknowledged durably: the
      // timeline renders it either way, and the Human has no manual read
      // action anymore. The count only feeds the pure jump hint for a reader
      // away from the tail; a bottom-pinned reader already sees the arrivals.
      if (!timeline.isPinned()) setNewFactsCount(current => current + additions.length)
      // The acknowledgment outcome does not change what is on screen: a
      // failed read surfaces through the error surface, not through the count.
      await readCurrent(true)
    } catch {
      // A passive refresh is an invalidation convenience; the next explicit action rereads Host state.
    }
  }

  // Follower ranking is an enhancement, not a page fact: a failed observation
  // read leaves the roster order in place instead of surfacing an error.
  const refreshFollowers = async (): Promise<void> => {
    try {
      const result = await threadObservations({ workspaceId, ...threadRequest })
      if (!mountedRef.current || !result.ok) return
      setFollowerIds(new Set(result.value.followers))
    } catch {
      // The next thread-scope wake retries; ranking falls back to roster order.
    }
  }

  // L1 (issue 57, item 3): the Human's own follow of this Thread. The Host binds
  // the actor, so the request names no memberId — this can only ever be the
  // reading Human's own follow, never another seat's.
  const attention = useThreadAttention({ changeAttention }, () => {
    setInviteNote(undefined)
    void refreshFollowers()
  })
  /** Seed an @mention into the live draft; sending it is the invitation. */
  const inviteMember = (handle: string): void => {
    const { draft } = drafts.getSnapshot(draftKey)
    const inserted = `@${handle.replace(/^@/, '')} `
    const nextDraft = draft === '' || draft.endsWith(' ') ? `${draft}${inserted}` : `${draft} ${inserted}`
    drafts.writeDraft(draftKey, nextDraft)
    setInviteNote(t('inviteInserted', { name: handle.replace(/^@/, '') }))
  }

  // Reply stats are keyed by message ref, so each agent row finds its own line.
  // A failed read leaves the rows without their line rather than surfacing an error.
  const [replyStats, setReplyStats] = useState<ReadonlyMap<string, ReplyStatsView>>(() => new Map())
  const refreshReplyStats = async (): Promise<void> => {
    try {
      const result = await threadReplyStats({ workspaceId, threadRef })
      if (!mountedRef.current || !result.ok) return
      const views = new Map<string, ReplyStatsView>()
      for (const stat of result.value) {
        const view = replyStatsView(stat)
        if (view !== undefined) views.set(stat.messageRef, view)
      }
      setReplyStats(views)
    } catch {
      // The next thread-scope wake retries; the rows stay without their line until then.
    }
  }

  // Failure notices keep every notice a boot re-issues (no de-duplication); the timeline merges them by ledger sequence.
  const [turnFailures, setTurnFailures] = useState<readonly AgentTeamThreadTurnFailure[]>([])
  const refreshTurnFailures = async (): Promise<void> => {
    try {
      const result = await threadTurnFailures({ workspaceId, threadRef })
      if (!mountedRef.current || !result.ok) return
      setTurnFailures(result.value)
    } catch {
      // The next thread-scope wake retries; the notices stay as they were until then.
    }
  }

  useEffect(() => {
    mountedRef.current = true
    // The previous mount's supplemental round must not answer for this one.
    supplementalRef.current = undefined
    supplementalPendingRef.current = false
    projectionRef.current = undefined
    setProjection(undefined)
    setChannelView(undefined)
    setMembers([])
    setFollowerIds(new Set())
    setReplyStats(new Map())
    setCurrentFacts([])
    currentFactsRef.current = []
    setOlderFacts([])
    setReadFacts([])
    setHistoryCursor(undefined)
    setHistoryHasMore(false)
    setAutoReadExhausted(false)
    setNewFactsCount(0)
    setError(undefined)
    setStatusMessage(undefined)
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    void (async () => {
      // One parallel round covers the whole first paint. The durable read no
      // longer wakes any change scope; only the subscription baseline can
      // request a catch-up while this first paint is loading.
      const [read, history, observations] = await Promise.all([
        readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest }),
        loadThreadHistory({ workspaceId, ...threadRequest, limit: 20 }).catch(() => undefined),
        threadObservations({ workspaceId, ...threadRequest }).catch(() => undefined),
      ])
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      if (!read.ok) {
        setError(read.error.message)
        setLoading(false)
        return
      }
      updateProjection(read.value)
      // The Thread opens at the latest fact; the unread boundary stays
      // rendered as information, but reading is automatic from here on.
      timeline.scrollToBottom()
      if (history !== undefined && history.ok) {
        setCurrentFacts(current => {
          const merged = mergeFacts(current, history.value.facts)
          currentFactsRef.current = merged
          return merged
        })
        setHistoryCursor(history.value.cursor)
        setHistoryHasMore(history.value.hasMore)
      } else {
        // A history read that rejected or was refused must not take the only way
        // back to older facts with it: the affordance stands, and pressing it
        // pages from the oldest fact on screen under its own error surface.
        setHistoryHasMore(true)
      }
      if (observations !== undefined && observations.ok) setFollowerIds(new Set(observations.value.followers))
      setError(undefined)
      setLoading(false)
      await drainUnread()
    })()
    void refreshSupplemental()
    void refreshReplyStats()
    void refreshTurnFailures()
    const disposers = [
      subscribeChanges({ kind: 'thread', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshPassiveFacts()
        // Every Team Document write wakes its Thread's scope; the Doc cards re-read on it.
        setDocsVersion(version => version + 1)
        // Attention changes wake this scope too; keep the mention ranking current.
        void refreshFollowers()
        // A new reply or a finished Turn changes the usage lines.
        void refreshReplyStats()
        // A failed Turn adds its notice; the same wake covers it.
        void refreshTurnFailures()
      }),
      subscribeChanges({ kind: 'workspace', workspaceId }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshSupplemental()
      }),
      // Presence transitions commit nothing: only the member rows move, so
      // the roster refreshes alone — the supplemental fetch's channel view
      // stays reserved for workspace membership changes that can move it.
      subscribeChanges({ kind: 'presence', workspaceId }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshMembers()
      }),
    ]
    return () => {
      mountedRef.current = false
      sequenceRef.current += 1
      for (const dispose of disposers) dispose()
    }
  }, [workspaceId, taskRef, threadRef])

  // Returning to the bottom is the reader's answer to the jump hint: the
  // arrivals are on screen, their durable read already happened (or will be
  // retried by the next change wake), and the hint has nothing left to say.
  useEffect(() => {
    if (newFactsCount > 0 && timeline.isPinned()) setNewFactsCount(0)
  }, [newFactsCount, currentFacts, olderFacts, timeline])

  // The hint answers "where is the tail?"; the moment the reader is back
  // within the follow margin — by the jump click or their own scroll — it
  // must go away even when no render follows that position change.
  const handleTimelineScroll = (): void => {
    timeline.onScroll()
    if (timeline.isPinned()) setNewFactsCount(0)
  }

  const loadOlder = async (): Promise<void> => {
    if (historyHasMore === false && historyCursor === undefined) return
    const beforeSequence = historyCursor ?? minSequence(currentFactsRef.current)
    if (beforeSequence === undefined) return
    setLoading(true)
    try {
      const result = await loadThreadHistory({ workspaceId, ...threadRequest, beforeSequence, limit: 20 })
      if (!mountedRef.current) return
      if (!result.ok) { setError(result.error.message); return }
      setOlderFacts(current => mergeFacts(current, result.value.facts))
      setHistoryCursor(result.value.cursor)
      setHistoryHasMore(result.value.hasMore)
      setError(undefined)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const activeProjection = projection
  const task = activeProjection?.task
  const thread = activeProjection?.thread
  const resolvedTaskNumber = taskNumber ?? channelView?.taskNumbers.find(entry => entry.taskRef === task?.taskRef)?.taskNumber
  const taskTitle = activeProjection === undefined ? undefined : formatTaskTitle(activeProjection.anchor.body)
  const taskClaims = activeProjection?.claims ?? []
  const effectiveChannelRef = task?.channelRef ?? channelRef
  const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef])
  const currentFactsWithAnchor = mergeFacts(activeProjection === undefined ? [] : [messageFact(activeProjection.anchor, activeProjection.anchorMentions)], currentFacts)
  // This Thread's participants: every actor holding a Message in the loaded
  // window, in first-appearance order, plus every Member the loaded facts name.
  // A mention is a seat the Thread already reaches, so a freshly woken Member a
  // message @-names is selectable in the composer before it ever posts. A Thread
  // is where those actors belong, so their roster is the Channel's member set
  // only as a fallback — a Channel with no joined Member once leaked its whole
  // Workspace here.
  const threadParticipantIds = useMemo(() => {
    const seen = new Set<AgentTeamMemberId>()
    const ids: AgentTeamMemberId[] = []
    const add = (id: AgentTeamMemberId): void => {
      if (seen.has(id)) return
      seen.add(id)
      ids.push(id)
    }
    for (const fact of currentFactsWithAnchor) {
      if (fact.kind !== 'message') continue
      add(fact.message.sender)
      for (const mentioned of fact.mentions) add(mentioned)
    }
    return ids
  }, [currentFactsWithAnchor])
  // The seat's own roster, then the Thread's participants on top of it: the
  // writing Human is a participant without holding a Message of their own, and
  // a participant the Host has not projected yet still belongs to the Thread.
  // The Task's claimers are Thread participants too: a seat that claimed this
  // Task works it, so the composer must be able to name it.
  const threadRosterIds = useMemo(() => {
    if (threadParticipantIds.length === 0 && taskClaims.length === 0) return undefined
    const ids = new Set<AgentTeamMemberId>(threadParticipantIds)
    if (channelView?.humanMemberId !== undefined) ids.add(channelView.humanMemberId)
    for (const claim of taskClaims) ids.add(claim.owner)
    return ids
  }, [threadParticipantIds, taskClaims, channelView?.humanMemberId])
  // The same guard the Channel page applies (TeamChannelPage.tsx:220): an
  // archived or inactive seat is not a selectable member anywhere.
  const selectable = (status: { readonly member: { readonly state: string } }): boolean => status.member.state !== 'inactive' && status.member.state !== 'archived'
  const channelMembers = useMemo(() => {
    if (threadRosterIds !== undefined) return members.filter(status => threadRosterIds.has(status.member.memberId) && selectable(status))
    // No Thread facts yet: fall back to the Channel's own members, the
    // selectable ones only, so an empty membership yields an empty roster
    // instead of every Workspace seat.
    if (channelMemberIds.size === 0) return []
    return members.filter(status => channelMemberIds.has(status.member.memberId) && selectable(status))
  }, [members, threadRosterIds, channelMemberIds])
  const mentionHandlesMap = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')])), [members])
  const metadata = useMemo(() => readMeta(readFacts), [readFacts])
  const unreadIndex = useMemo(() => {
    const all = mergeFacts(
      ...(activeProjection === undefined ? [] : [[messageFact(activeProjection.anchor, activeProjection.anchorMentions)]]),
      readFacts.map(fact => fact.fact),
      currentFacts,
    )
    return all.findIndex(fact => metadata.get(factKey(fact))?.unread === true)
  }, [activeProjection?.anchor, readFacts, currentFacts, metadata])

  const memberName = (memberId: AgentTeamMemberId): string => {
    if (memberId === channelView?.humanMemberId) return humanName
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? t('memberUnknown') : `@${status.member.handle}`
  }

  const messageSender = (fact: AgentTeamThreadFact): AgentTeamMemberId | undefined =>
    fact.kind === 'message' ? fact.message.sender : undefined

  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([])

  // Branded-ref navigation for message bodies: channel refs hop to the
  // Channel; thread and task refs cited here resolve through the Host and
  // jump to their home Channel. Unresolvable refs never become links (see
  // TeamMessage), so this path only fires for refs the Host already confirmed.
  // Identity-stable: a fresh closure per render would defeat TeamMessage's memo.
  const openRef = useCallback((ref: string): void => {
    if (ref.startsWith('channel:') && ref !== channelRef) {
      selectChannel(ref as AgentTeamChannelRef)
      return
    }
    if (ref.startsWith('thread:') && ref !== threadRef) {
      // Another Thread cited here: resolve its home Channel and jump.
      jumpToThread(resolveThreadRefs, workspaceId, ref as AgentTeamThreadRef, selectThread)
      return
    }
    if (ref.startsWith('task:') && ref !== taskRef) {
      // Another Task cited here: open it as an issue slice over this Thread,
      // the same seam the board and the Inbox use. The Thread's own Workspace
      // is the one the issue is read in.
      openIssue(ref as AgentTeamTaskRef, { workspaceId })
    }
  }, [channelRef, threadRef, taskRef, workspaceId, selectChannel, selectThread, resolveTaskRefs, resolveThreadRefs])

  const lookupTaskRefs = useMemo(() => hostTaskRefLookup(resolveTaskRefs, workspaceId), [resolveTaskRefs, workspaceId])
  const lookupThreadRefs = useMemo(() => hostThreadRefLookup(resolveThreadRefs, workspaceId), [resolveThreadRefs, workspaceId])
  // Reply parents resolve through the Host: a quote must fill in even when the
  // Message it answers sits far outside the facts this page has loaded.
  const lookupMessageRefs = useMemo(() => hostMessageRefLookup(resolveMessageRefs, workspaceId), [resolveMessageRefs, workspaceId])
  const messageRefVersion = useResolvedMessageRefVersion()
  useEffect(() => {
    // Every rendered reply's parent (for its quote) and the composer's target
    // (for its banner): the target is usually not itself a reply.
    const refs = [...olderFacts, ...currentFacts].flatMap(fact => fact.kind === 'message' && fact.message.replyToMessageRef !== undefined ? [fact.message.replyToMessageRef] : [])
    if (replyTarget !== undefined && !refs.includes(replyTarget)) refs.push(replyTarget)
    if (refs.length > 0) void resolveUnknownMessageRefs(refs, lookupMessageRefs)
  }, [olderFacts, currentFacts, replyTarget, lookupMessageRefs, messageRefVersion])
  useEffect(() => {
    if (flashedMessage === undefined) return
    const timer = setTimeout(() => { setFlashedMessage(undefined) }, 1200)
    return () => { clearTimeout(timer) }
  }, [flashedMessage])
  // One stable callback per action for every row: TeamMessage is memoized, so a
  // fresh closure per row would re-render the whole timeline on any page render.
  // A new target is a different request: the parent is part of the Host's
  // retry identity, so a pending request id or confirmation must not carry over.
  const changeReplyTarget = useCallback((messageRef: AgentTeamMessageRef | undefined): void => {
    setReplyTarget(messageRef)
    setReplyRequestId(undefined)
    setConfirmation(undefined)
    setStatusMessage(undefined)
  }, [])
  const handleReply = useCallback((messageRef: AgentTeamMessageRef): void => { changeReplyTarget(messageRef) }, [changeReplyTarget])
  /** Take the reader to the Message a reply answers, when it is on screen. */
  const handleOpenReplyTo = useCallback((messageRef: AgentTeamMessageRef): void => {
    const node = document.querySelector(`[data-message-ref="${messageRef}"]`)
    if (node === null) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashedMessage(messageRef)
  }, [])
  // Roster chips resolve synchronously from loaded data: channel names from
  // the Channel view, member facts from the member list. Anything outside the
  // loaded window stays plain text — the same rule unresolvable Task/Thread
  // refs follow. The lookups key on roster content, not array identity: every
  // refresh hands over fresh arrays, and the memoized rows must survive
  // change bursts that leave the roster itself untouched.
  const rosterKey = useMemo(() => [
    (channelView?.channels ?? []).map(channel => `${channel.channelRef}=${channel.name}=${channel.state}`).join(','),
    members.map(status => `${status.member.memberId}=${status.member.handle}=${status.member.sessionId}=${status.availability}`).join(','),
    channelView?.humanMemberId ?? '',
  ].join(';'), [channelView, members])
  const channelNameOf = useMemo(() => {
    const channels = channelView?.channels ?? []
    return (ref: AgentTeamChannelRef): string | undefined => rosterChannelName(channels, ref)
  }, [rosterKey])
  const memberOf = useMemo(() => {
    const humanMemberId = channelView?.humanMemberId
    return (ref: AgentTeamMemberId) => rosterMember(members, humanMemberId, humanName, ref)
  }, [rosterKey, humanName])

  // The quote line names the parent's author and excerpt from the Host's
  // resolution; until it lands (or if it never does) the ref itself still
  // travels, so the line can always say where it goes.
  const replyContexts = useMemo(() => {
    const contexts = new Map<AgentTeamMessageRef, { readonly senderName: string; readonly excerpt: string; readonly messageRef: AgentTeamMessageRef }>()
    for (const fact of [...olderFacts, ...currentFacts]) {
      if (fact.kind !== 'message' || fact.message.replyToMessageRef === undefined) continue
      const parent = cachedResolvedMessageRef(fact.message.replyToMessageRef)
      contexts.set(fact.message.messageRef, parent === undefined
        ? { senderName: t('memberUnknown'), excerpt: '', messageRef: fact.message.replyToMessageRef }
        : { senderName: memberName(parent.sender), excerpt: parent.excerpt, messageRef: parent.messageRef })
    }
    return contexts
  }, [olderFacts, currentFacts, messageRefVersion, rosterKey, humanName, t])

  useEffect(() => {
    let live = true
    const mine = ++decisionsSequence.current
    void loadDecisions({ workspaceId, threadRef }).then(result => {
      if (live && mine === decisionsSequence.current && result.ok) setDecisions(new Map(result.value.decisions.map(decision => [decision.messageRef, decision])))
    })
    return () => { live = false }
  }, [workspaceId, threadRef, docsVersion, decisionsReload])

  const answerCard = useCallback(async (decisionRef: AgentTeamDecisionRef, answers: readonly AgentTeamDecisionAnswer[]): Promise<string | undefined> => {
    const result = await answerDecision({ requestId: mintRequestId(), workspaceId, decisionRef, answers })
    setDecisionsReload(count => count + 1)
    return result.ok ? undefined : result.error.message
  }, [answerDecision, workspaceId])

  const renderFact = (fact: AgentTeamThreadFact, grouped = false) => {
    if (fact.kind === 'message') {
      const sender = memberName(fact.message.sender)
      const senderStatus = members.find(candidate => candidate.member.memberId === fact.message.sender)
      const human = fact.message.sender === channelView?.humanMemberId
      // An ask's body spells the card out for readers without it; here its first line heads the card itself.
      const decision = decisions.get(fact.message.messageRef)
      return <TeamMessage
        key={factKey(fact)}
        senderName={sender}
        memberId={fact.message.sender}
        human={human}
        {...(human && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {})}
        body={decision === undefined ? fact.message.body : fact.message.body.split('\n', 1)[0]!}
        attachments={fact.message.attachments}
        {...(human ? {} : { replyStats: replyStats.get(fact.message.messageRef) })}
        loadAttachment={getAttachment}
        t={t}
        occurredAt={fact.message.occurredAt}
        mentionNames={stableMentionNames(fact.mentions, mentionHandlesMap, humanName)}
        onOpenRef={openRef}
        onResolveTaskRefs={lookupTaskRefs}
        onResolveThreadRefs={lookupThreadRefs}
        channelNameOf={channelNameOf}
        memberOf={memberOf}
        onOpenMemberSession={openMemberSession}
        grouped={grouped}
        {...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description })}
        messageRef={fact.message.messageRef}
        onReply={handleReply}
        {...(replyContexts.has(fact.message.messageRef) ? { replyTo: replyContexts.get(fact.message.messageRef)!, onOpenReplyTo: handleOpenReplyTo } : {})}
        replyTarget={replyTarget === fact.message.messageRef}
        replyFlash={flashedMessage === fact.message.messageRef}
      >
        {decision !== undefined && <TeamDecisionCard key={decision.status} decision={decision} nameOf={memberName} t={t}
          answer={answers => answerCard(decision.decisionRef, answers)} />}
      </TeamMessage>
    }
    return <p className={threadCss.activityRow} key={factKey(fact)}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{formatActivity(fact.activity, { t, actorName: memberName, claims: taskClaims })}</span></p>
  }

  /** One run = one same-sender reply turn; activities, the unread boundary, and day changes break runs. */
  const renderFactBlocks = (facts: readonly AgentTeamThreadFact[], boundaryIndex: number | undefined, failures: readonly AgentTeamThreadTurnFailure[] = []): ReactNode[] => {
    const nodes: ReactNode[] = []
    let run: AgentTeamThreadFact[] = []
    let lastDay: string | undefined
    let nextFailure = 0
    const flushRun = () => {
      if (run.length > 0) {
        nodes.push(
          <div className={css.messageRun} key={`run-${factKey(run[0]!)}`}>
            {run.map((entry, entryIndex) => {
              const previous = entryIndex > 0 ? run[entryIndex - 1] : undefined
              const turnGap = entry.kind === 'message' && isRunGap(previous?.kind === 'message' ? previous.message.occurredAt : undefined, entry.message.occurredAt)
              return <Fragment key={factKey(entry)}>
                {turnGap && <TeamRunDivider occurredAt={entry.message.occurredAt} />}
                {renderFact(entry, entryIndex > 0)}
              </Fragment>
            })}
          </div>,
        )
      }
      run = []
    }
    // A notice sits between the facts whose ledger sequence brackets it; it breaks a run like an activity does.
    const emitFailuresBefore = (sequence: number | undefined): void => {
      while (nextFailure < failures.length && (sequence === undefined || failures[nextFailure]!.sequence < sequence)) {
        const failure = failures[nextFailure++]!
        flushRun()
        nodes.push(<p className={threadCss.activityRow} key={`failure-${failure.sequence}`}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{t('turnFailure', { handle: failure.handle, turn: failure.turn, reason: failure.reason })}</span></p>)
      }
    }
    facts.forEach((fact, index) => {
      emitFailuresBefore(fact.sequence)
      const occurredAt = fact.kind === 'message' ? fact.message.occurredAt : undefined
      if (occurredAt !== undefined) {
        const day = timelineDayKey(occurredAt)
        if (lastDay !== undefined && day !== lastDay) {
          flushRun()
          nodes.push(<p className={threadCss.daySeparator} key={`day-${index}`}><span>{daySeparatorLabel(occurredAt)}</span></p>)
        }
        lastDay = day
      }
      const sender = messageSender(fact)
      if (sender !== undefined && run.length > 0 && sender === messageSender(run[run.length - 1]!)) {
        run.push(fact)
        return
      }
      flushRun()
      if (boundaryIndex === index) nodes.push(<p key={`boundary-${index}`} className={threadCss.unreadBoundary} role="separator"><span>{t('unreadBoundary')}</span></p>)
      if (sender !== undefined) run.push(fact)
      else nodes.push(<Fragment key={factKey(fact)}>{renderFact(fact)}</Fragment>)
    })
    emitFailuresBefore(undefined)
    flushRun()
    return nodes
  }

  const refreshAfterFence = async (): Promise<void> => {
    timeline.scrollToBottom()
    await readCurrent(true)
    await refreshSupplemental()
    await drainUnread()
  }

  const convertToTask = async (): Promise<void> => {
    if (pending || thread === undefined || task !== undefined) return
    setPending(true)
    setMutating('promote')
    setError(undefined)
    const key = 'promote'
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await promoteThread({ requestId, workspaceId, threadRef, baseRevision: thread.revision })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setProjection(current => current === undefined ? current
          : { ...current, task: committed.task, thread: committed.thread })
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'activity', sequence: committed.activity.sequence, activity: committed.activity, occurredAt: committed.receipt.occurredAt }])
          currentFactsRef.current = merged
          return merged
        })
        await readCurrent(true)
        await refreshSupplemental()
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
      } else {
        setError(t('staleRevision'))
        mutationRequests.current.delete(key)
        await refreshPassiveFacts()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  const mutateTask = async (action: 'accept' | 'close' | 'reopen'): Promise<void> => {
    if (pending || task === undefined || thread === undefined) return
    setPending(true)
    if (action === 'accept') setMutating('accept')
    setError(undefined)
    const key = `task:${action}`
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await changeTask({ requestId, workspaceId, taskRef: task.taskRef, action, baseRevision: thread.revision })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setProjection(current => current === undefined ? current : { ...current, task: committed.task, thread: committed.thread, claims: committed.claims })
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'activity', sequence: committed.activity.sequence, activity: committed.activity, occurredAt: committed.receipt.occurredAt }])
          currentFactsRef.current = merged
          return merged
        })
        await readCurrent(true)
        await refreshSupplemental()
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
      } else {
        setError(t('staleRevision'))
        mutationRequests.current.delete(key)
        await refreshPassiveFacts()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  // Editing the draft invalidates one-shot send state: a confirmation token,
  // the retained requestId, and the status line. Every setter returns the same
  // state when there is nothing to clear, so a keystroke does not re-render the
  // timeline now that the composer owns the draft.
  const clearSendState = useCallback((): void => {
    setConfirmation(current => current === undefined ? current : undefined)
    setReplyRequestId(current => current === undefined ? current : undefined)
    setStatusMessage(current => current === undefined ? current : undefined)
  }, [])

  const sendReply = async (): Promise<void> => {
    // Read the draft at send time: this page no longer subscribes to it, so a
    // captured render value would be stale after the composer's own edits.
    const { draft, recipients } = drafts.getSnapshot(draftKey)
    if (pending || thread === undefined || draft.trim() === '') return
    const id = replyRequestId ?? mintRequestId()
    setReplyRequestId(id)
    setPending(true)
    setError(undefined)
    try {
      // Upload chosen files first; any failure aborts the reply with the
      // existing error surface and keeps the chips for a retry.
      const upload = await uploadComposerFiles(putAttachment, workspaceId, pendingFiles)
      if (!upload.ok) {
        setError(upload.error)
        return
      }
      const attachmentIds = upload.attachmentIds
      const result = await reply({ requestId: id, workspaceId, threadRef, ...(task === undefined ? {} : { taskRef: task.taskRef }), ...(replyTarget === undefined ? {} : { replyToMessageRef: replyTarget }), body: draft.trim(), baseRevision: thread.revision, recipients: [...recipients].sort(), ...(attachmentIds.length === 0 ? {} : { attachments: attachmentIds }), ...(confirmation === undefined ? {} : { confirmationToken: confirmation }) })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value.kind === 'committed') {
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        // The optimistic row chips what the Host is about to report: a
        // hand-typed `@Handle` delivers exactly like a picked recipient, and the
        // committed facts replace this row as soon as they arrive.
        const optimisticMentions = [...new Set([...recipients, ...mentionedMemberIds(draft, channelMembers)])].sort()
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'message', sequence: committed.message.sequence, message: committed.message, mentions: optimisticMentions, occurredAt: committed.receipt.occurredAt }])
          currentFactsRef.current = merged
          return merged
        })
        setProjection(current => current === undefined ? current : { ...current, ...(committed.task === undefined ? {} : { task: committed.task }), thread: committed.thread })
        drafts.clear(draftKey)
        setPendingFiles([])
        setReplyTarget(undefined)
        setReplyRequestId(undefined)
        setConfirmation(undefined)
        setStatusMessage(undefined)
        await refreshSupplemental()
      } else if (result.value.kind === 'confirmation_required') {
        setConfirmation(result.value.confirmationToken)
        setStatusMessage(t('mentionConfirmation'))
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
        await refreshAfterFence()
      } else if (result.value.kind === 'stale_revision') {
        setError(t('staleRevision'))
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
        await refreshPassiveFacts()
      } else {
        setError(t('memberNotFollowing', { ids: result.value.memberIds.map(memberId => `@${members.find(candidate => candidate.member.memberId === memberId)?.member.handle ?? memberId}`).join(', ') }))
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setPending(false) }
  }

  /** The Human's board-field patch (title, priority, assignee), fenced by the Thread revision; status is not writable here. Returns the failure message, if any. */
  const patchTask = async (patch: AgentTeamTaskPatchRequest): Promise<string | undefined> => {
    if (patchPending || task === undefined || thread === undefined) return undefined
    setPatchPending(true)
    setError(undefined)
    const key = 'task:patch'
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await updateTask({ requestId, workspaceId, taskRef: task.taskRef, baseRevision: thread.revision, patch })
      if (!result.ok) { setError(result.error.message); return result.error.message }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setProjection(current => current === undefined ? current : { ...current, task: committed.task, thread: committed.thread })
        return undefined
      }
      if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
        return t('unreadRequired', { count: result.value.unreadCount })
      }
      setError(t('staleRevision'))
      mutationRequests.current.delete(key)
      await refreshPassiveFacts()
      return t('staleRevision')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      return message
    } finally {
      setPatchPending(false)
    }
  }

  // Notices older than the first current fact belong to the history block when there is one; otherwise they lead the current block.
  const firstCurrentSequence = currentFacts[0]?.sequence ?? Number.POSITIVE_INFINITY
  const historyFailures = olderFacts.length > 0 ? turnFailures.filter(failure => failure.sequence < firstCurrentSequence) : []
  const currentFailures = olderFacts.length > 0 ? turnFailures.filter(failure => failure.sequence >= firstCurrentSequence) : turnFailures
  const unreadBoundary = unreadIndex >= 0 ? unreadIndex : undefined
  // One row per erroring Member holding a live Claim. The row shows the
  // diagnostic's structured class — the localizable axis — beside the first
  // sentence of the Host's own reason; the full English text moves to the
  // row's title.
  const risks = taskClaims.filter(claim => claim.state === 'active').flatMap(claim => {
    const status = members.find(candidate => candidate.member.memberId === claim.owner)
    if (status?.presence !== 'error') return []
    const risk = formatRiskClass(status, t)
    const detail = diagnosticText(status)
    return [{
      claim, status, ...risk,
      reason: detail === '' ? t('statusError') : firstSentence(detail),
      full: detail === '' ? t('statusError') : detail,
    }]
  })
  // Threads are always entered through a Channel page, so a Channel origin
  // returns to its timeline; a Thread restored without one returns further.
  const backLabel = inLane ? t('closeThreadLane') : channelRef === undefined ? t('backToWorkspace') : t('backToChannel')
  // Slim header participants: every actor holding a Message in the loaded
  // window, in first-appearance order, drawn as the shared identity stack.
  // The stack caps itself at three plus `+N`; the label names them all.
  const participantIds = (() => {
    const seen = new Set<AgentTeamMemberId>()
    const ids: AgentTeamMemberId[] = []
    for (const fact of currentFactsWithAnchor) {
      if (fact.kind !== 'message' || seen.has(fact.message.sender)) continue
      seen.add(fact.message.sender)
      ids.push(fact.message.sender)
    }
    return ids
  })()
  const threadHuman: TeamAvatarHuman | undefined = channelView?.humanMemberId === undefined
    ? undefined
    : { memberId: channelView.humanMemberId, name: humanName, ...(humanAvatarUrl === undefined ? {} : { avatarUrl: humanAvatarUrl }) }
  const participantOwners = namedAvatarOwners(participantIds.map(memberId => ({ memberId, name: memberName(memberId) })), threadHuman)
  const channelName = channelView?.channels.find(entry => entry.channelRef === effectiveChannelRef)?.name
  // The crumb keeps the old h1 content verbatim (Task number, never the
  // free-text title): the number is what every entry row cross-references.
  // A titled Task carries its title in the tooltip, the way the Channel row
  // carries its description.
  const crumbTitle = task === undefined ? t('threadLabel') : t('taskLabel', { number: resolvedTaskNumber ?? '…' })
  const crumbText = t('threadCrumbLabel', { channel: channelName ?? '…', title: crumbTitle })
  const crumbHint = taskTitle === undefined || taskTitle === '' ? crumbText : `${crumbText} — ${taskTitle}`

  // --- Multica issue layout: title, property rows, execution log ------------
  // The board title leads; Tasks created before the board fell back to the
  // opening Message's first line, and the editor writes the board field.
  const currentTitle = task?.title ?? taskTitle ?? ''
  const startTitleEdit = (): void => {
    setTitleDraft(currentTitle)
    setTitleError(undefined)
    setEditingTitle(true)
  }
  const cancelTitleEdit = (): void => {
    setEditingTitle(false)
    setTitleDraft('')
    setTitleError(undefined)
  }
  const saveTitleEdit = (): void => {
    // Enter and blur both save; the busy ref keeps the second call (the blur
    // that the Enter path itself causes) from re-submitting the patch.
    if (titleBusyRef.current || titleSaving) return
    const next = titleDraft.trim()
    if (next === '' || next === currentTitle) { cancelTitleEdit(); return }
    titleBusyRef.current = true
    void (async () => {
      setTitleSaving(true)
      const failure = await patchTask({ title: next })
      titleBusyRef.current = false
      setTitleSaving(false)
      if (failure === undefined) cancelTitleEdit(); else setTitleError(failure)
    })()
  }
  // The sidebar's relative times: created is the opening Message's instant,
  // last activity the newest fact's.
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  const createdAt = activeProjection?.anchor.occurredAt
  const lastActivityAt = currentFactsWithAnchor.length > 0
    ? currentFactsWithAnchor.reduce((latest, fact) => fact.sequence > latest.sequence ? fact : latest, currentFactsWithAnchor[0]!).occurredAt
    : createdAt
  // The assignee picker offers every selectable seat; the Human included, the
  // way the board card's picker does.
  const assigneeOptions = useMemo(() => members.filter(status => selectable(status)).map(status => ({
    memberId: status.member.memberId,
    handle: status.member.handle,
    ...(status.member.memberId === channelView?.humanMemberId && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {}),
  })), [members, channelView?.humanMemberId, humanAvatarUrl])
  // The Human picker option needs a name even before its avatar lands.
  const followerStack = useMemo(() => [...followerIds].flatMap(memberId => {
    if (memberId === channelView?.humanMemberId) return [{ memberId, handle: humanName, ...(humanAvatarUrl === undefined ? {} : { avatarUrl: humanAvatarUrl }) }]
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? [] : [{ memberId, handle: status.member.handle }]
  }), [followerIds, members, channelView?.humanMemberId, humanName, humanAvatarUrl])
  // The status picker writes through the ledger transitions: done accepts the
  // Task, closed closes it, todo reopens. The picker disables in_progress and
  // in_review itself — Claims set those, never the Human.
  const statusChange = (status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed'): void => {
    const action = status === 'done' ? 'accept' : status === 'closed' ? 'close' : 'reopen'
    void mutateTask(action)
  }
  const sidebarBody = <>
    {task !== undefined && <section className={detailCss.propSection} aria-label={t('propertiesLabel')}>
      <div className={detailCss.propRow}>
        <span className={detailCss.propLabel}>{t('propStatus')}</span>
        <span className={detailCss.propControl}><StatusPicker status={task.status} onChange={statusChange} t={t} /></span>
      </div>
      <div className={detailCss.propRow}>
        <span className={detailCss.propLabel}>{t('propPriority')}</span>
        <span className={detailCss.propControl}><PriorityPicker priority={normalizePriority(task.priority)} onChange={priority => { void patchTask({ priority }) }} t={t} /></span>
      </div>
      <div className={detailCss.propRow}>
        <span className={detailCss.propLabel}>{t('propAssignee')}</span>
        <span className={detailCss.propControl}><AssigneePicker assignee={task.assignee} members={assigneeOptions} onChange={memberId => { void patchTask({ assignee: memberId as AgentTeamMemberId | null }) }} t={t} /></span>
      </div>
    </section>}
    {task !== undefined && <section className={detailCss.propSection} aria-label={t('claims')}>
      <DisclosureRow
        expandOnRowClick
        expandable
        open={claimsOpen}
        onToggle={() => { setClaimsOpen(current => !current) }}
        icon={<IconChecklistOutlineRegular size={14} />}
        title={`${t('claims')} · ${taskClaims.length}`}
      >
        <div className={detailCss.claimList}>
          {taskClaims.length === 0 && <p className={detailCss.emptyNotes}>{t('noClaims')}</p>}
          {taskClaims.map(claim => {
            const ownerStatus = members.find(status => status.member.memberId === claim.owner)
            return <article className={detailCss.claimRow} key={claim.claimRef} data-claim-state={claim.state}>
              {ownerStatus === undefined ? <span className={detailCss.claimSpacer} /> : <TeamPresenceDot status={ownerStatus} t={t} />}
              <span className={detailCss.claimBody}>
                <strong className={detailCss.claimOwner} title={memberName(claim.owner)}>{memberName(claim.owner)}</strong>
                <span className={detailCss.claimDirection}>{claim.direction}</span>
              </span>
              <small className={detailCss.claimState}>{formatClaimState(claim.state, t)}</small>
            </article>
          })}
        </div>
      </DisclosureRow>
    </section>}
    <section className={detailCss.propSection} aria-label={t('propFollowers')}>
      <div className={detailCss.propHeading}>{t('propFollowers')}</div>
      {followerStack.length === 0
        ? <p className={detailCss.emptyNotes}>{t('noFollowers')}</p>
        : <span className={detailCss.followerStack}><AgentAvatarStack members={followerStack} size="xs" max={5} t={t} /><span className={detailCss.followerCount}>{t('threadFollowersCount', { count: followerStack.length })}</span></span>}
    </section>
    <section className={detailCss.propSection} aria-label={t('propTimes')}>
      <div className={detailCss.propRow}>
        <span className={detailCss.propLabel}>{t('propCreated')}</span>
        <span className={`${detailCss.propControl} ${detailCss.propTime}`}>{createdAt === undefined ? '—' : timeAgo(createdAt)}</span>
      </div>
      <div className={detailCss.propRow}>
        <span className={detailCss.propLabel}>{t('propLastActivity')}</span>
        <span className={`${detailCss.propControl} ${detailCss.propTime}`}>{lastActivityAt === undefined ? '—' : timeAgo(lastActivityAt)}</span>
      </div>
    </section>
    <section className={detailCss.logSection} aria-label={t('executionLog')}>
      <div className={detailCss.propHeading}>{t('executionLog')}</div>
      <ExecutionLog
        workspaceId={workspaceId}
        threadRef={threadRef}
        loadThreadSessions={loadThreadSessions}
        loadMemberActivity={loadMemberActivity}
        threadTurnFailures={threadTurnFailures}
        openMemberSession={openMemberSession}
        stopSession={stopSession}
        subscribeChanges={subscribeChanges}
        members={members}
        t={t}
      />
    </section>
  </>

  // The dialog's rows: the roster plus the writing Human, who is a participant
  // without holding a Message of their own. The Human is matched by id, never
  // assumed to be in the roster: a Workspace projection that serves no Human
  // seat still gets the follow row.
  const humanStatus = channelView?.humanMemberId === undefined
    ? undefined
    : members.find(status => status.member.memberId === channelView.humanMemberId)
  const threadMemberRows: readonly AgentTeamClientMemberStatus[] = humanStatus === undefined
    || channelMembers.some(status => status.member.memberId === humanStatus.member.memberId)
    ? channelMembers
    : [...channelMembers, humanStatus]
  // One element type in both faces, so crossing the two-lane width never remounts the Thread.
  return <div role={inLane ? 'region' : 'main'} aria-label={inLane ? crumbText : undefined} className={css.surface} data-team-thread={threadRef}>
    <div className={css.surfaceHeader}>
      <header className={channelCss.slimHeader} data-team-slim-header="thread">
        <h1 className={channelCss.slimHidden}>{crumbTitle}</h1>
        {/* The shell reopen control leads the row rather than trailing it: the far
            right belongs to the Task actions, and a collapsed column must not push
            them off the edge. It shows only while the column is closed. */}
        {sidebarCollapsed && <Button size="sm" variant="outline" icon={<IconPanelLeftOutlineRegular size={16} />} aria-label={t('openSidebar')} onClick={openSidebar} />}
        <button type="button" className={channelCss.slimCrumb} aria-label={backLabel} title={crumbHint} onClick={backToWorkspace}>
          {inLane ? <IconCloseOutlineRegular size={14} /> : <IconChevronLeftOutlineRegular size={14} />}
          <span className={channelCss.slimCrumbText}>{crumbText}</span>
        </button>
        {participantOwners.length > 0 && <span className={channelCss.slimParticipants}>
          <TeamAvatarStack owners={participantOwners} label={t('participantsLabel', { names: participantIds.map(memberId => memberName(memberId)).join(', ') })} human={threadHuman} />
        </span>}
        {task !== undefined && <Pill><TeamStateDot size={8} state={taskStatusDot(task.status)} />{formatTaskStatus(task.status, t)}</Pill>}
        {/* L1 (issue 57, item 3): the Thread member surface rides the row's own action
            group — the same place the Channel header opens its members. It is a Thread
            action, not a Task transition, so it leads the group and the Task transitions
            follow it; the group keeps the row's last-child slot either way. */}
        {thread !== undefined && <span className={channelCss.slimActions}>
          {/* The properties sheet opener serves the sub-lane widths where the
              sidebar column is hidden; CSS collapses it on the wide page. */}
          <Button size="sm" variant="outline" className={detailCss.propertiesToggle} onClick={() => { setPropertiesOpen(true) }}>{t('propertiesLabel')}</Button>
          <Button size="sm" variant="outline" onClick={() => { setManagingThreadMembers(true) }}>{t('threadMembers')}</Button>
          {task === undefined
            ? <Button size="sm" variant="primary" disabled={pending} onClick={() => { void convertToTask() }}>{mutating === 'promote' ? t('promotingTask') : t('promoteToTask')}</Button>
            : task.resolution !== 'closed' && (() => {
              const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? []
              const earlyAccept = task.resolution === 'open' && task.status === 'in_progress' && activeClaims.length > 0
              // todo Tasks accept directly: the work finished outside the
              // ledger, so there is nothing to confirm and no Claims to list.
              const acceptButton = !(task.status === 'in_review' || task.status === 'todo' || earlyAccept) || task.resolution !== 'open' ? null
                : <Button size="sm" variant="primary" disabled={pending}
                  onClick={() => { if (earlyAccept) { setConfirmingAccept(true) } else { void mutateTask('accept') } }}>{t('acceptTask')}</Button>
              const transition = task.resolution === 'open'
                ? <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</Button>
                : <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>
              return <>{acceptButton}{transition}</>
            })()}
        </span>}
      </header>
      {task !== undefined && <div className={detailCss.issueHead}>
        <span className={detailCss.issueNumber} aria-hidden="true">#{resolvedTaskNumber ?? '…'}</span>
        {editingTitle
          ? <span className={detailCss.titleEditor}>
              <input
                autoFocus
                className={detailCss.titleInput}
                aria-label={t('editTitle')}
                value={titleDraft}
                disabled={titleSaving || patchPending}
                onChange={event => { setTitleDraft(event.currentTarget.value) }}
                onBlur={saveTitleEdit}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); saveTitleEdit() }
                  if (event.key === 'Escape') { event.preventDefault(); cancelTitleEdit() }
                }}
              />
              {titleError !== undefined && <span className={detailCss.titleError} role="alert">{titleError}</span>}
            </span>
          : <button type="button" className={detailCss.issueTitle} aria-label={t('editTitle')} title={currentTitle === '' ? undefined : currentTitle} onClick={startTitleEdit}>
              {currentTitle === '' ? <span className={detailCss.titlePlaceholder}>{t('titlePlaceholder')}</span> : currentTitle}
            </button>}
      </div>}
      <TeamThreadDocs workspaceId={workspaceId} home={{ threadRef }} loadDocs={loadDocs} reviewDoc={reviewDoc} changeVersion={docsVersion} t={t}
        openDoc={summary => { selectDoc(summary.docRef, threadRef, summary.channelRef) }} />
      {risks.length > 0 && <section className={threadCss.riskSection} aria-label={t('runtimeRisk')}>
        <h2>{t('runtimeRisk')}</h2>
        {risks.map(({ claim, status, label, sentenceKey, reason, full }) => <p className={threadCss.riskRow} key={claim.claimRef}>
          <TeamPresenceDot status={status} t={t} />
          <span title={full}><strong className={threadCss.riskClass}>{label}</strong> · {t(sentenceKey, { member: status.member.handle })} — {reason}</span>
        </p>)}
      </section>}
      {thread !== undefined && <Modal
        open={managingThreadMembers}
        onClose={() => { if (!attention.pending) setManagingThreadMembers(false) }}
        title={t('threadMembers')}
        closeLabel={t('close')}
        contentClassName={threadCss.modalBody!}
        description={t('threadMembersNotice')}
      >
        <div className={threadCss.memberList}>
          {threadMemberRows.map(status => {
            const following = followerIds.has(status.member.memberId)
            const isHuman = channelView?.humanMemberId === status.member.memberId
            // Invitation by mention: the composer draft gains @handle, and
            // sending it notifies the seat through the existing mention path.
            return <TeamMemberRow
              key={status.member.memberId}
              status={status}
              action={isHuman
                ? {
                  label: attention.pending ? t('attentionUpdating') : following ? t('unfollowThread') : t('followThread'),
                  disabled: attention.pending,
                  onSelect: () => { void attention.change({ workspaceId, threadRef, action: following ? 'unfollow' : 'follow' }) },
                }
                : {
                  label: t('inviteToThread'),
                  onSelect: () => { inviteMember(status.member.handle) },
                }}
              t={t}
            />
          })}
        </div>
        <p className={threadCss.memberFoot}>
          <span>{t('threadMembersCount', { count: channelMembers.length })}</span>
          <span>{t('threadFollowersCount', { count: followerIds.size })}</span>
        </p>
        {inviteNote !== undefined && <p className={threadCss.inviteNote} role="status">{inviteNote}</p>}
        {attention.error !== undefined && <p className={threadCss.inviteNote} role="alert">{attention.error}</p>}
      </Modal>}
      {task !== undefined && thread !== undefined && (() => {
        // Recomputed here so the confirm list never shows stale rows.
        const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? []
        return <Modal
          open={confirmingAccept}
          onClose={() => { if (!pending) setConfirmingAccept(false) }}
          title={t('acceptEarlyTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <Button variant="outline" disabled={pending} onClick={() => { setConfirmingAccept(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={pending} onClick={() => { void mutateTask('accept') }}>{mutating === 'accept' ? t('acceptingTask') : t('acceptTask')}</Button>
          </>}
        >
          <p className={css.confirmBody}>{t('acceptEarlyBody', { count: activeClaims.length })}</p>
          <ul className={css.confirmList}>
            {activeClaims.map(claim => (
              <li key={claim.claimRef}>{memberName(claim.owner)} · {claim.direction}</li>
            ))}
          </ul>
        </Modal>
      })()}
    </div>

    <div className={detailCss.bodyRow}>
      <section ref={timeline.ref} onScroll={handleTimelineScroll} className={css.timeline} aria-label={t('timelineLabel')}>
        <div className={css.timelineContent}>
          {loading && projection === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingThread')}</p></div>}
          {projection === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void readCurrent() }}>{t('retry')}</Button></div>}
          {olderFacts.length > 0 && <section className={threadCss.historySection} aria-label={t('olderHistory')}><h2>{t('olderHistory')}</h2>{renderFactBlocks(olderFacts, undefined, historyFailures)}</section>}
          {historyHasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
          {currentFactsWithAnchor.length > 0 && <section className={threadCss.publicSection}>
            {renderFactBlocks(currentFactsWithAnchor, unreadBoundary, currentFailures)}
          </section>}
          {autoReadExhausted && <div className={css.timelineAction} role="alert">
            <span>{t('autoReadIncomplete')}</span>
            <Button size="sm" onClick={() => { setAutoReadExhausted(false); void drainUnread() }} disabled={loading}>{t('retry')}</Button>
          </div>}
          {newFactsCount > 0 && <div className={threadCss.newUpdates} role="status">
            <button type="button" className={threadCss.newUpdatesJump} onClick={() => { setNewFactsCount(0); timeline.scrollToBottom() }}>{t('newUpdatesJump', { count: newFactsCount })}</button>
          </div>}
        </div>
      </section>
      {/* The Multica issue layout's property column. A Thread rendered inside
          the two-lane view keeps the lane it had: the sidebar belongs to the
          full-page Task view, and the sheet opener serves the narrow widths. */}
      {!inLane && <aside className={detailCss.side} data-team-thread-side>
        {sidebarBody}
      </aside>}
    </div>
    {thread !== undefined && <Modal
      open={propertiesOpen}
      onClose={() => { setPropertiesOpen(false) }}
      title={t('propertiesLabel')}
      closeLabel={t('close')}
      contentClassName={threadCss.modalBody!}
    >
      {sidebarBody}
    </Modal>}

    {projection !== undefined && thread !== undefined ? (
      task?.resolution === 'closed'
        ? <div className={threadCss.closedBar} data-team-closed>
            {error !== undefined && <p className={css.error} role="alert">{error}</p>}
            <div className={threadCss.closedNotice}>
              <span>{t('taskClosedNotice')}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>
            </div>
          </div>
        : <TeamComposer
      key={draftKey}
      members={channelMembers}
      followerMemberIds={followerIds}
      drafts={drafts}
      loadTriggerCatalog={loadTriggerCatalog}
      draftKey={draftKey}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onEdit={clearSendState}
      onSubmit={() => { void sendReply() }}
      placeholder={t('replyPlaceholder')}
      pendingFiles={pendingFiles}
      onFilesChange={setPendingFiles}
      {...(replyTarget === undefined ? {} : {
        replyTo: (() => {
          const target = cachedResolvedMessageRef(replyTarget)
          return target === undefined
            ? { senderName: t('memberUnknown'), excerpt: '' }
            : { memberId: target.sender, senderName: memberName(target.sender), excerpt: target.excerpt }
        })(),
        onCancelReply: () => { changeReplyTarget(undefined) },
      })}
      {...(channelView?.humanMemberId === undefined ? {} : { humanMemberId: channelView.humanMemberId })}
      activity={<TeamActivityLine workspaceId={workspaceId} threadRef={threadRef} members={channelMembers} loadMemberActivity={loadMemberActivity} subscribeChanges={subscribeChanges} t={t} />}
      t={t}
    />
    ) : <div />}
  </div>
}
