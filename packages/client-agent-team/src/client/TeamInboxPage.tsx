import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamInboxItem, AgentTeamMemberId, AgentTeamThreadTurnFailure } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { EMPTY_INBOX_FILTERS, filterInboxItems, type InboxFilters } from './multica/inbox-filter.ts'
import { mintRequestId } from './requests.ts'
import { claimersLabel, formatAbsoluteTime, formatInboxTime, formatTaskStatus, taskStatusDot } from './team-formatters.ts'
import { namedAvatarOwners, type TeamAvatarHuman } from './TeamAvatarStack.tsx'
import { TeamDecisionCard } from './TeamDecisionCard.tsx'
import { TeamStateDot } from './TeamStateDot.tsx'
import { AgentAvatarStack } from './multica-ui/AgentAvatarStack.tsx'
import { PriorityIcon } from './multica-ui/PriorityIcon.tsx'
import { PRIORITY_LABEL_KEY, normalizePriority } from './multica/priority.ts'
import conversationCss from './conversation.module.css'
import { InboxFilterMenu } from './inbox/InboxFilterMenu.tsx'
import { InboxList, type InboxListEntry } from './inbox/InboxList.tsx'
import { InboxListItem } from './inbox/InboxListItem.tsx'
import { INBOX_REASON_KEYS, INBOX_SEVERITY_KEYS, groupFacetedRows, inboxDetailSubject, inboxDetailTitle } from './inbox/inbox-display.ts'
import { buildFacetedRows, buildInboxRow, inboxActorOptions, inboxChannelOptions, type FacetedRow } from './inbox/inbox-items.ts'
import look from './multica-look.module.css'
import inboxCss from './inbox/inbox.module.css'

interface TeamInboxRow {
  readonly workspaceId: WorkspaceId
  readonly workspaceTitle: string
  readonly item: AgentTeamInboxItem
}

/**
 * Queue order, one total order across Workspaces: the Host's own keys —
 * mentions first, then the ledger sequence, then the Thread ref. Each
 * Workspace slice already arrives in this order, and it is also the Host's
 * truncation policy, so the merge re-applies it instead of inventing a second
 * one: a row that survived the cut on mentions must not sink below a merely
 * newer row after the merge. `newestSequence` is a global ledger position, so
 * it stays comparable across Workspaces.
 */
function compareInboxRows(left: TeamInboxRow, right: TeamInboxRow): number {
  return right.item.directCount - left.item.directCount
    || right.item.newestSequence - left.item.newestSequence
    || left.item.thread.threadRef.localeCompare(right.item.thread.threadRef)
}

interface TeamInboxPageProps {
  readonly useWorkspaces: TeamConversationProps['useWorkspaces']
  readonly loadInbox: TeamConversationProps['loadInbox']
  /** The roster the detail pane names decision actors from. */
  readonly loadMembers: TeamConversationProps['loadMembers']
  /** One Thread's decision cards (#109): an open card makes its row action-required. */
  readonly loadDecisions: TeamConversationProps['loadDecisions']
  /** The Human's answer to one open card, committed through the same card. */
  readonly answerDecision: TeamConversationProps['answerDecision']
  /** Failed-Turn notices of one Thread; they lift a row into the attention band. */
  readonly threadTurnFailures: TeamConversationProps['threadTurnFailures']
  /** The durable Thread read: the mark-read path the rows already drain through. */
  readonly readThread: TeamConversationProps['readThread']
  /** The Human's own Thread Attention: archive is its unfollow. */
  readonly changeAttention: TeamConversationProps['changeAttention']
  /** Wake source while the page is open: one scope-less subscription, shared with the badge poll. */
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly selectWorkspace: TeamConversationProps['selectWorkspace']
  readonly selectThread: TeamConversationProps['selectThread']
  /** The global opener: the issue opens as a slice over the Inbox. */
  readonly openIssue: TeamConversationProps['openIssue']
  /** The Human's display name, from the Client's one identity projection. */
  readonly humanName: string
  readonly humanAvatarUrl?: string | undefined
  readonly t: TeamConversationProps['t']
}

/**
 * Below this seat width the Inbox renders the list alone and a row opens its
 * Thread full-screen, the way it always has; above it the page splits into the
 * list and the selected row's detail — Multica's own master–detail.
 */
const SPLIT_MIN_SEAT_WIDTH = 720

/**
 * How many 「最近活跃」 rows the merged page may show. The Host bounds each
 * Workspace's own slice; this is the single bound across every Workspace on
 * screen, so the tail stays the same size no matter how many are open — and
 * it stays a way back into work rather than a second queue.
 */
const RECENT_ROWS_LIMIT = 5

/**
 * The Human Inbox, restyled after Multica's: one Inbox call per visible
 * Workspace, the Host's two slices merged into one list — the unread queue
 * 「需要我」, grouped by the severity the derivation found (a pending decision,
 * a Task waiting on the Human's accept, a mention, a failed Turn, or plain
 * activity), and the 「最近活跃」 tail of Threads the reader took part in.
 *
 * Opening the page never acknowledges anything — only a durable Thread read
 * advances the watermark and consumes a mention marker. Rows and the badge
 * drop after the Thread is read through the same path the queue always
 * drained; archive is the reader's own unfollow.
 */
export function TeamInboxPage({ useWorkspaces, loadInbox, loadMembers, loadDecisions, answerDecision, threadTurnFailures, readThread, changeAttention, subscribeChanges, selectWorkspace, selectThread, openIssue, humanName, humanAvatarUrl, t }: TeamInboxPageProps) {
  const workspaces = useWorkspaces(state => state.items)
  const [rows, setRows] = useState<readonly TeamInboxRow[]>()
  const [recentRows, setRecentRows] = useState<readonly TeamInboxRow[]>([])
  // The Host names the Human's Member id on every Inbox row's payload; the
  // page keeps it so a row can draw that one actor from the Client's own
  // Human identity instead of the initials the stack gives every Agent.
  const [humanMemberId, setHumanMemberId] = useState<AgentTeamMemberId>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  // The Host caps the unread queue and reports whether it did; keeping that
  // verdict is what stops a full page from reading as the whole queue. A failed
  // read keeps the last verdict, matching the kept slices below it.
  const [truncated, setTruncated] = useState(false)
  // Only the first refresh owns the loading surface; later wakes refresh the
  // rendered rows in place instead of flashing them back to skeleton.
  const loadedRef = useRef(false)
  // Per-Workspace last successful slice: a Workspace whose read fails keeps
  // its rows — a failed read must not empty this action queue for that
  // Workspace (the sidebar badge holds the same keep-last-good policy) — and
  // the next success overwrites the kept slice.
  const keptSlicesRef = useRef(new Map<string, { readonly items: readonly AgentTeamInboxItem[]; readonly recent: readonly AgentTeamInboxItem[] }>())
  // The side reads the severity derivation joins in: per queue row, its open
  // decision card and its failed-Turn notices. Kept across refreshes so a
  // row's band does not flicker while its side reads are in flight.
  const [side, setSide] = useState<ReadonlyMap<string, { readonly decision: AgentTeamDecisionView | undefined; readonly failures: readonly AgentTeamThreadTurnFailure[] }>>()
  const sideSequence = useRef(0)
  const liveRef = useRef(true)
  useEffect(() => () => { liveRef.current = false }, [])
  // The roster the detail pane names decision actors from.
  const [members, setMembers] = useState<readonly { readonly member: { readonly memberId: AgentTeamMemberId; readonly handle: string } }[]>([])
  // The filter menu's state is the page's; the pure helpers do the matching.
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_INBOX_FILTERS)
  // The split view's selection: a key the filtered list resolves, plus the
  // wide-seat measure that decides whether a detail pane exists at all.
  const [selectedKey, setSelectedKey] = useState('')
  const [wide, setWide] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  // One owner per generation. A wake can land while an earlier read is still in
  // flight, so a refresh that finishes after a newer one must not write its
  // rows back over fresher ones.
  const refreshSequence = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++refreshSequence.current
    if (!loadedRef.current) setLoading(true)
    const results = await Promise.all(workspaces.map(async workspace => {
      const result = await loadInbox({ workspaceId: workspace.workspaceId, limit: 100 })
      if (result.ok) {
        return { ok: true as const, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, items: result.value.items, recent: result.value.recent, hasMore: result.value.hasMore, humanMemberId: result.value.humanMemberId }
      }
      const kept = keptSlicesRef.current.get(workspace.workspaceId)
      return { ok: false as const, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, items: kept?.items ?? [], recent: kept?.recent ?? [], message: result.error.message }
    }))
    // Superseded (a newer refresh, or the page is gone): the newer generation
    // owns the surface, and this read's rows are already stale.
    if (!liveRef.current || mine !== refreshSequence.current) return
    for (const result of results) {
      if (result.ok) keptSlicesRef.current.set(result.workspaceId, { items: result.items, recent: result.recent })
    }
    const failure = results.find(result => !result.ok)
    setHumanMemberId(results.find(result => result.ok)?.humanMemberId)
    const asRows = (items: readonly AgentTeamInboxItem[], workspaceId: WorkspaceId, workspaceTitle: string): TeamInboxRow[] =>
      items.map(item => ({ workspaceId, workspaceTitle, item }))
    setRows(results.flatMap(result => asRows(result.items, result.workspaceId, result.workspaceTitle)).sort(compareInboxRows))
    // The tail is one global bound rather than one per Workspace: the reader
    // was promised a way back into recent work, and every Workspace's slice is
    // already capped on its own, so the merged list is trimmed here.
    setRecentRows(results.flatMap(result => asRows(result.recent, result.workspaceId, result.workspaceTitle)).sort(compareInboxRows).slice(0, RECENT_ROWS_LIMIT))
    setError(failure?.ok === false ? failure.message : undefined)
    // Only a successful read carries a verdict: a kept slice must not clear the
    // footnote it was rendered with.
    if (results.some(result => result.ok)) setTruncated(results.some(result => result.ok && result.hasMore))
    loadedRef.current = true
    setLoading(false)
  }, [loadInbox, workspaces])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges(undefined, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    void refresh()
  }), [subscribeChanges, refresh])

  // The detail pane names actors from the roster; one read per visible
  // Workspace covers every row the page can hold.
  useEffect(() => {
    let live = true
    void Promise.all(workspaces.map(workspace => loadMembers({ workspaceId: workspace.workspaceId })))
      .then(results => {
        if (!live) return
        setMembers(results.flatMap(result => result.ok ? result.value : []))
      })
    return () => { live = false }
  }, [loadMembers, workspaces])

  // The severity derivation's side reads: every queue row reports whether its
  // Thread holds an open decision card (#109) and any failed Turns. Bounded by
  // the Host's own queue page; a later wake supersedes an earlier read's
  // writes, so a slow answer never overwrites fresher side data.
  //
  // A failed Turn only decides the band of a row that is neither a Task in
  // review nor a mention — the two bands above it. Those rows do not read
  // their Turn failures at all, which keeps the common queue (mentions) at
  // one side read per row instead of two. A row that is banded by its own
  // failures carries them, and the detail pane prints them.
  useEffect(() => {
    if (rows === undefined) return
    if (rows.length === 0) {
      setSide(new Map())
      return
    }
    const mine = ++sideSequence.current
    void Promise.all(rows.map(async row => {
      const threadRef = row.item.thread.threadRef
      const decided = row.item.task?.status === 'in_review' || row.item.directCount > 0
      const [decisionResult, failureResult] = await Promise.all([
        loadDecisions({ workspaceId: row.workspaceId, threadRef }),
        decided ? Promise.resolve({ ok: true as const, value: [] as readonly AgentTeamThreadTurnFailure[] }) : threadTurnFailures({ workspaceId: row.workspaceId, threadRef }),
      ])
      const decisions = decisionResult.ok ? decisionResult.value.decisions : []
      const failures = failureResult.ok ? failureResult.value : []
      const open = decisions.filter(decision => decision.status === 'open')
      return [`${row.workspaceId} ${threadRef}`, { decision: open.at(-1), failures }] as const
    })).then(entries => {
      if (liveRef.current && mine === sideSequence.current) setSide(new Map(entries))
    })
  }, [rows, loadDecisions, threadTurnFailures])

  // The split measure, taken like the Thread lane's: before paint, then on
  // every resize of the page's own element.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const measure = (): void => { setWide(root.getBoundingClientRect().width >= SPLIT_MIN_SEAT_WIDTH) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setWide(entry.contentRect.width >= SPLIT_MIN_SEAT_WIDTH)
    })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  // Side data joined in: queue rows carry their derived severity, tail rows
  // are read by definition. A row whose side reads have not landed yet derives
  // from what the projection already says — it moves groups when the answer
  // lands, which is exactly how a non-optimistic surface settles.
  const faceted = useMemo(() => {
    const sideData = side ?? new Map<string, { readonly decision: AgentTeamDecisionView | undefined; readonly failures: readonly AgentTeamThreadTurnFailure[] }>()
    const queue = (rows ?? []).map(row => buildInboxRow(
      row.workspaceId,
      row.workspaceTitle,
      row.item,
      sideData.get(`${row.workspaceId} ${row.item.thread.threadRef}`)?.decision,
      sideData.get(`${row.workspaceId} ${row.item.thread.threadRef}`)?.failures ?? [],
    ))
    const recent = recentRows.map(row => buildInboxRow(row.workspaceId, row.workspaceTitle, row.item, undefined, []))
    return buildFacetedRows(queue, recent)
  }, [rows, recentRows, side])

  const filtered = useMemo(() => applyFilters(faceted, filters), [faceted, filters])

  // Every row the page can show, severity-blind: the universe the filter
  // menu's channel and agent facets are built from, so picking one value never
  // removes the others from the menu that offers them.
  const universe = useMemo(() => faceted.map(entry => entry.row), [faceted])
  const channelOptions = useMemo(() => inboxChannelOptions(universe), [universe])
  const actorOptions = useMemo(() => inboxActorOptions(universe), [universe])

  const queueRows = useMemo(() => filtered.filter(entry => entry.row.item.unreadCount > 0), [filtered])
  const tailRows = useMemo(() => filtered.filter(entry => entry.row.item.unreadCount === 0), [filtered])
  const groups = useMemo(() => groupFacetedRows(filtered), [filtered])

  // The rows on screen may span more than one Workspace; only then does a row
  // spend its identity line on the (otherwise constant) Workspace name.
  const shownWorkspaces = new Set<string>()
  for (const entry of filtered) shownWorkspaces.add(entry.row.workspaceTitle)
  const showWorkspace = shownWorkspaces.size > 1

  // One identity for every row on the page: the Host tells the rows which
  // actor is the reader, the Client's identity projection says what that actor
  // looks like. Either half missing leaves the stack on its initials fallback.
  const human = humanMemberId === undefined
    ? undefined
    : { memberId: humanMemberId, name: humanName, ...(humanAvatarUrl === undefined ? {} : { avatarUrl: humanAvatarUrl }) } satisfies TeamAvatarHuman

  const memberName = useCallback((memberId: AgentTeamMemberId): string => {
    if (memberId === humanMemberId) return humanName
    return members.find(entry => entry.member.memberId === memberId)?.member.handle ?? memberId
  }, [members, humanMemberId, humanName])

  // Open the row's Thread where it lives: its own Workspace first, then the
  // Thread and its Channel — never the Inbox. The persisted location is the
  // Thread's, so a reload lands back on the work, not on the queue.
  const openThread = useCallback((row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }): void => {
    selectWorkspace(row.workspaceId)
    selectThread(row.item.thread.threadRef, row.item.channelRef, row.item.task?.taskRef, row.item.taskNumber)
  }, [selectWorkspace, selectThread])

  // Open the row's issue: the same seam the board and the Agent page use, so
  // the issue opens as a slice over the Inbox. The row's Workspace rides the
  // seam instead of a Workspace selection: selecting one would leave the
  // Inbox — the very face the slice is over — and the issue slot is
  // orthogonal to the face flags. A row without a Task has no issue to open,
  // so it falls back to the Thread.
  const openIssueOf = useCallback((row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }, focusOpener?: () => void): void => {
    const taskRef = row.item.task?.taskRef
    if (taskRef === undefined) {
      openThread(row)
      return
    }
    openIssue(taskRef, { workspaceId: row.workspaceId, focusOpener })
  }, [openThread, openIssue])

  // Row activation: on a wide seat a plain click selects the row into the
  // detail pane and a modifier click opens the Thread (Multica's own grammar);
  // on a narrow one the click is the Thread — full-screen detail, the shape
  // the page had before the split.
  const activate = useCallback((row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }, event?: MouseEvent<HTMLButtonElement>): void => {
    const key = `${row.workspaceId} ${row.item.thread.threadRef}`
    if (wide && event !== undefined && !event.metaKey && !event.ctrlKey) {
      setSelectedKey(current => current === key ? '' : key)
      return
    }
    const target = event?.currentTarget
    openIssueOf(row, target === undefined ? undefined : () => { target.focus({ preventScroll: true }) })
  }, [wide, openIssueOf])

  // The keyboard walk moves the selection and nothing else: the arrow keys
  // never open a Thread. On a wide seat the selection is the detail pane's
  // subject; on a narrow one it is the row the reader has walked onto, and
  // the row's own button still opens the Thread.
  const select = useCallback((row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }): void => {
    setSelectedKey(`${row.workspaceId} ${row.item.thread.threadRef}`)
  }, [])

  // Mark read through the durable read the queue already drains through. Not
  // optimistic: the row leaves the queue when the projection says so, and the
  // refresh after a committed read is what moves it.
  const [actionError, setActionError] = useState<string>()
  const markRead = useCallback(async (row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }): Promise<void> => {
    const result = await readThread({ requestId: mintRequestId(), workspaceId: row.workspaceId, threadRef: row.item.thread.threadRef })
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    await refresh()
  }, [readThread, refresh])

  // Archive is the reader's own unfollow: the Thread leaves the Inbox for
  // good, which is the Host's projection settling, not a hidden second store.
  const archive = useCallback(async (row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }): Promise<void> => {
    const result = await changeAttention({ requestId: mintRequestId(), workspaceId: row.workspaceId, threadRef: row.item.thread.threadRef, action: 'unfollow' })
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    setSelectedKey(current => current === `${row.workspaceId} ${row.item.thread.threadRef}` ? '' : current)
    await refresh()
  }, [changeAttention, refresh])

  const answer = useCallback(async (row: { readonly workspaceId: WorkspaceId; readonly item: AgentTeamInboxItem }, decision: AgentTeamDecisionView, answers: readonly AgentTeamDecisionAnswer[]): Promise<string | undefined> => {
    const result = await answerDecision({ requestId: mintRequestId(), workspaceId: row.workspaceId, decisionRef: decision.decisionRef, answers })
    if (!result.ok) return result.error.message
    // The card's answer is committed; re-read the Thread's cards so the row's
    // severity settles from the answer, not from hope.
    const sideResult = await loadDecisions({ workspaceId: row.workspaceId, threadRef: row.item.thread.threadRef })
    if (sideResult.ok) {
      const open = sideResult.value.decisions.filter(entry => entry.status === 'open')
      setSide(current => {
        const next = new Map(current ?? [])
        next.set(`${row.workspaceId} ${row.item.thread.threadRef}`, { decision: open.at(-1), failures: current?.get(`${row.workspaceId} ${row.item.thread.threadRef}`)?.failures ?? [] })
        return next
      })
    }
    return undefined
  }, [answerDecision, loadDecisions])

  // The selected row, resolved against what the list currently shows. A row a
  // filter hides or an unfollow removed is no longer selectable: the pane
  // clears instead of showing work the reader cannot see in the list.
  const selected = filtered.find(entry => entry.facet.id === selectedKey)
  useEffect(() => {
    if (selectedKey !== '' && selected === undefined) setSelectedKey('')
  }, [selectedKey, selected])

  const listEntries = useMemo<readonly InboxListEntry[]>(() => groups.flatMap(group => [
    { kind: 'heading' as const, key: `group:${group.severity}`, severity: group.severity, label: t(INBOX_SEVERITY_KEYS[group.severity]), count: group.rows.length },
    ...group.rows.map(entry => ({ kind: 'row' as const, key: entry.facet.id, row: entry.row, facet: entry.facet })),
  ]), [groups, t])

  // The page rides the shared conversation seat: the same header band, 880px
  // reading column, responsive gutters, and scrollbar gutter as Channel and
  // Thread, so switching surfaces does not shift the content column.
  const totalUnread = rows?.reduce((sum, row) => sum + row.item.unreadCount, 0) ?? 0
  const totalMentions = rows?.reduce((sum, row) => sum + row.item.directCount, 0) ?? 0
  const hasFilters = filters.severities.length > 0 || filters.channels.length > 0 || filters.actors.length > 0 || filters.unreadOnly
  const listPanel = <div className={inboxCss.listPanel}>
    {loading && rows === undefined && error === undefined && <div className={conversationCss.emptySurface}><p className={conversationCss.loadingState}><span className={conversationCss.loadingMark} aria-hidden="true" />{t('loadingInbox')}</p></div>}
    {!loading && rows === undefined && error !== undefined && <div className={conversationCss.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button></div>}
    {rows !== undefined && (filtered.length === 0
      ? <div className={conversationCss.emptySurface}>
          <div className={conversationCss.emptyState}>
            <strong>{hasFilters ? t('inboxFilterEmpty') : t('inboxEmptyTitle')}</strong>
            <span>{hasFilters ? t('inboxFilterEmptyHint') : t('inboxEmptyHint')}</span>
          </div>
        </div>
      : <>
          {queueRows.length > 0 && <section className={inboxCss.section}>
            <h2 className={inboxCss.sectionTitle}>{t('inboxSectionNeedsMe')}<span className={inboxCss.sectionCount}>{queueRows.length}</span></h2>
            <InboxList entries={listEntries} selectedKey={selectedKey} showWorkspace={showWorkspace} human={human} t={t} onActivate={activate} onSelect={select} />
            {/* A capped queue says so where the list ends: the rows above are
                the newest unread Threads, never a claim to be all of them. */}
            {truncated && <p className={inboxCss.queueMore} role="status">{t('inboxQueueMore')}</p>}
          </section>}
          {tailRows.length > 0 && <section className={inboxCss.section}>
            <h2 className={inboxCss.sectionTitle}>{t('inboxSectionRecent')}<span className={inboxCss.sectionCount}>{tailRows.length}</span></h2>
            <div className={inboxCss.list} data-inbox-tail>
              {tailRows.map(entry => <InboxListItem
                key={entry.facet.id}
                row={entry.row}
                facet={entry.facet}
                selected={entry.facet.id === selectedKey}
                showWorkspace={showWorkspace}
                human={human}
                t={t}
                onActivate={event => { activate(entry.row, event) }}
              />)}
            </div>
          </section>}
        </>)}
    {rows !== undefined && error !== undefined && <p className={conversationCss.error} role="alert">{error}</p>}
    {actionError !== undefined && <p className={conversationCss.error} role="alert">{actionError}</p>}
  </div>

  // The detail pane: the selected row's task detail in Multica's issue shape —
  // subject, standing, the reason it is here, the failed Turns it carries, the
  // decision card to answer, and the actions the row's reader has. Board 5/10
  // replaces this pane's body with the full Task detail page; the pane itself
  // is the seam it drops into.
  const detailContent = selected === undefined
    ? <div className={inboxCss.detailEmpty}><p>{t('inboxDetailEmpty')}</p></div>
    : <DetailPane
        key={selected.facet.id}
        entry={selected}
        human={human}
        memberName={memberName}
        onOpen={() => { openThread(selected.row) }}
        onRead={() => { void markRead(selected.row) }}
        onArchive={() => { void archive(selected.row) }}
        onAnswer={answers => answer(selected.row, selected.row.decision!, answers)}
        t={t}
      />

  return <main className={conversationCss.surface} data-team-inbox ref={rootRef}>
    <div className={conversationCss.surfaceHeader}>
      <header className={conversationCss.headerRow}>
        <div className={conversationCss.headerCopy}>
          <h1>{t('inboxTitle')}</h1>
          {rows !== undefined && rows.length > 0 && <p className={inboxCss.headerMeta}>
            <span>{t('inboxHeaderThreads', { count: rows.length })}</span>
            {/* The one number the page is about leads the line; mentions join it
                only when the queue actually holds one. */}
            <span className={inboxCss.headerUnread}>{t('inboxHeaderUnread', { count: totalUnread })}</span>
            {totalMentions > 0 && <span>{t('inboxHeaderMentions', { count: totalMentions })}</span>}
          </p>}
        </div>
        {/* The filter menu belongs to every row the page shows, the tail
            included: a reader who filters the tail must be able to clear the
            filter again from the same page. */}
        {rows !== undefined && filtered.length > 0 && <InboxFilterMenu
          rows={faceted}
          filters={filters}
          onToggle={change => { setFilters(current => change(current)) }}
          onClear={() => { setFilters(EMPTY_INBOX_FILTERS) }}
          channels={channelOptions}
          actors={actorOptions}
          t={t}
        />}
      </header>
    </div>
    {wide
      ? <div className={`${look.multicaLook} ${inboxCss.split}`}>
          {listPanel}
          <div className={inboxCss.detailPanel}>{detailContent}</div>
        </div>
      : <div className={conversationCss.timeline}>
          <div className={conversationCss.timelineContent}>{listPanel}</div>
        </div>}
  </main>
}

interface DetailPaneProps {
  readonly entry: FacetedRow
  readonly human: TeamAvatarHuman | undefined
  readonly memberName: (memberId: AgentTeamMemberId) => string
  readonly onOpen: () => void
  readonly onRead: () => void
  readonly onArchive: () => void
  readonly onAnswer: (answers: readonly AgentTeamDecisionAnswer[]) => Promise<string | undefined>
  readonly t: TeamConversationProps['t']
}

/**
 * The right pane of the split: the row's task detail. The subject leads, the
 * reason and the instant close the meta line, the Task's own properties follow
 * in the issue shape the Thread page uses (status, priority, assignee, the
 * people on the Task), the gist is the body, and the actions are the three the
 * row's reader has — open the Thread, mark it read, archive it. An open
 * decision card renders the #109 card in place, so the reader answers without
 * leaving the Inbox.
 */
function DetailPane({ entry, human, memberName, onOpen, onRead, onArchive, onAnswer, t }: DetailPaneProps) {
  const { row } = entry
  const { item } = row
  const unread = item.unreadCount > 0
  const owners = item.claimOwners
  const namedOwners = namedAvatarOwners(owners, human)
  const owns = owners.some(owner => owner.memberId === human?.memberId)
  const task = item.task
  const priority = normalizePriority(task?.priority)
  const assignee = task?.assignee === undefined || task.assignee === null
    ? undefined
    : { memberId: task.assignee, handle: memberName(task.assignee) }
  return <article className={inboxCss.detail} data-inbox-detail>
    <h2 className={inboxCss.detailTitle}>{inboxDetailTitle(item, number => t('taskLabel', { number }))}</h2>
    <p className={inboxCss.detailMeta}>
      <span>{t(INBOX_REASON_KEYS[row.reason])}</span>
      <time dateTime={item.newestOccurredAt} title={formatAbsoluteTime(item.newestOccurredAt)}>{formatInboxTime(item.newestOccurredAt, t)}</time>
      <span>#{item.channelName ?? item.channelRef}</span>
    </p>
    {task !== undefined && <section className={inboxCss.detailProps} aria-label={t('propertiesLabel')}>
      <div className={inboxCss.detailProp}>
        <span className={inboxCss.detailPropLabel}>{t('propStatus')}</span>
        <span className={inboxCss.detailPropValue} data-team-task-state={task.status}>
          <TeamStateDot size={8} state={taskStatusDot(task.status)} />
          {formatTaskStatus(task.status, t)}
        </span>
      </div>
      <div className={inboxCss.detailProp}>
        <span className={inboxCss.detailPropLabel}>{t('propPriority')}</span>
        <span className={inboxCss.detailPropValue}>
          <PriorityIcon priority={priority} title={t(PRIORITY_LABEL_KEY[priority])} />
          {t(PRIORITY_LABEL_KEY[priority])}
        </span>
      </div>
      {assignee !== undefined && <div className={inboxCss.detailProp}>
        <span className={inboxCss.detailPropLabel}>{t('propAssignee')}</span>
        <span className={inboxCss.detailPropValue}>
          <AgentAvatarStack members={[assignee]} size="xs" max={1} t={t} />
          {assignee.handle}
        </span>
      </div>}
      {owners.length > 0 && <div className={inboxCss.detailProp}>
        <span className={inboxCss.detailPropLabel}>{t('claims')}</span>
        <span className={inboxCss.detailPropValue}>{claimersLabel(namedOwners, t)}</span>
      </div>}
    </section>}
    {item.previewText !== undefined && item.previewText.trim() !== inboxDetailSubject(item) && <p className={inboxCss.detailBody}>{item.previewText}</p>}
    {row.failures.length > 0 && <ul className={inboxCss.detailFailures}>
      {row.failures.map(failure => <li key={failure.sequence}>{t('inboxFailureLine', { name: `@${failure.handle}`, reason: failure.reason })}</li>)}
    </ul>}
    {row.decision !== undefined && <div className={inboxCss.detailDecision}>
      <TeamDecisionCard decision={row.decision} nameOf={memberName} answer={onAnswer} t={t} />
    </div>}
    <div className={inboxCss.detailActions}>
      <Button size="sm" variant="outline" onClick={onOpen}>{t('inboxOpenThread')}</Button>
      {unread && <Button size="sm" variant="outline" onClick={onRead}>{t('inboxMarkRead')}</Button>}
      {/* Archive is the reader's own unfollow, so it is offered where an
          unfollow can land: the row carries an attention fact, and the reader
          holds no Claim on the Task (the Host refuses an unfollow then). */}
      {item.attention !== undefined && !owns && <Button size="sm" variant="outline" onClick={onArchive}>{t('inboxArchive')}</Button>}
    </div>
  </article>
}

/**
 * The facet filter, applied with the ported pure helper — one authority for the
 * matching, the same one the filter menu counts with.
 *
 * The severity facet describes the queue: the bands are what waits of the
 * reader, and a read row has no band to fall into. The other facets (channel,
 * agent, unread) name work rather than urgency, so they narrow the tail too —
 * it stays the way back into recent work that the reader can still trim.
 */
function applyFilters(rows: readonly FacetedRow[], filters: InboxFilters): readonly FacetedRow[] {
  const queue = rows.filter(entry => !entry.facet.read)
  const tail = rows.filter(entry => entry.facet.read)
  const kept = new Set([
    ...filterInboxItems(queue.map(entry => entry.facet), filters).map(facet => facet.id),
    ...filterInboxItems(tail.map(entry => entry.facet), { ...filters, severities: [] }).map(facet => facet.id),
  ])
  return rows.filter(entry => kept.has(entry.facet.id))
}
