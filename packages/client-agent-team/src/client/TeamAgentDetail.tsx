import { useEffect, useMemo, useState } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamMemberActivity,
  AgentTeamSessionRun,
  AgentTeamTaskRef,
  AgentTeamThreadTurnFailure,
  AgentTeamView,
  TeamMemoryRecord,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconCopyOutlineRegular, Modal, SegmentedTabs, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { presenceLabel } from './TeamPresenceDot.tsx'
import { formatTokens, UNKNOWN } from './reply-stats.ts'
import { formatAbsoluteTime } from './team-formatters.ts'
import { loadAgentMemory, type AgentMemoryLoad } from './agent-memory.ts'
import { cachedResolvedThreadRef, hostThreadRefLookup, useResolvedThreadRefVersion } from './refs.ts'
import { SessionStateIcon, sessionState } from './session-state.tsx'
import { AgentConfigEditor } from './TeamMemberEditor.tsx'
import { ROLE_LABEL_KEY } from './TeamMemberRow.tsx'
import { ActorAvatar } from './multica-ui/ActorAvatar.tsx'
import { AgentPresenceDot } from './multica-ui/AgentPresenceDot.tsx'
import { deriveAgentPresence } from './multica/derive-presence.ts'
import {
  cacheHitLabel,
  currentTaskOf,
  formatRunTime,
  groupTasksByStatus,
  isMemberBusy,
  memberTaskRows,
  stopTargets,
  tokensOrUnknown,
} from './agents/agent-page-model.ts'
import { AgentRunsTab } from './agents/agent-runs-tab.tsx'
import { AgentTasksTab } from './agents/agent-tasks-tab.tsx'
import createCss from './create.module.css'
import css from './agent-detail.module.css'

export { cacheHitLabel, formatRunTime, tokensOrUnknown }

/** Session ids are long; the list shows the head and copies the whole id. */
const ID_TAIL = 8

/** The full Session id, monospace; when the row is too narrow the head gives way (middle ellipsis) and the full id is the tooltip. */
function SessionIdLabel({ sessionId }: { readonly sessionId: string }) {
  const split = Math.max(0, sessionId.length - ID_TAIL)
  return <code title={sessionId} data-session-id-label><span className={css.idHead}>{sessionId.slice(0, split)}</span><span className={css.idTail}>{sessionId.slice(split)}</span></code>
}

/** A slot's presence under the seat's identity. The seat's diagnostic describes slot 0 — the seat's own Session — so only that row keeps it. */
function slotPresence(status: AgentTeamClientMemberStatus, slot: number, presence: AgentTeamClientMemberStatus['presence']): AgentTeamClientMemberStatus {
  if (slot === 0) return { ...status, presence }
  const { diagnostic: _seatDiagnostic, ...rest } = status
  return { ...rest, presence }
}

/** A slot with no Session that is neither working nor failed is simply idle: it says so once instead of reading as an outage. */
const idleSlot = (instance: { readonly sessionId?: unknown; readonly presence: AgentTeamClientMemberStatus['presence'] }): boolean =>
  instance.sessionId === undefined && instance.presence !== 'working' && instance.presence !== 'error'

type DetailTab = 'sessions' | 'overview' | 'memory' | 'runs' | 'tasks'

/**
 * Where a Session run happened, as one line: the first Thread's Channel and
 * gist, plus `+N` for the others. A Thread the Host no longer resolves keeps
 * the count only, never a guess.
 */
export function runPlace(
  run: Pick<AgentTeamSessionRun, 'threadRefs'>,
  channelNames: ReadonlyMap<string, string>,
  resolve: (threadRef: AgentTeamSessionRun['threadRefs'][number]) => { readonly channelRef: string; readonly title: string } | undefined,
): { readonly text: string; readonly more: number } | undefined {
  const [first, ...rest] = run.threadRefs
  if (first === undefined) return undefined
  const hit = resolve(first)
  if (hit === undefined) return { text: '', more: run.threadRefs.length }
  const channel = channelNames.get(hit.channelRef)
  const text = [channel === undefined ? undefined : `# ${channel}`, hit.title === '' ? undefined : hit.title].filter(part => part !== undefined).join(' › ')
  return { text, more: rest.length }
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly current: string | null; readonly runs: readonly AgentTeamSessionRun[] }

type BoardState =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly view: AgentTeamView }

/**
 * A14 Agent detail: the seat's header, its Session history, its runs and the
 * Tasks it owns. The header carries the two actions the page exists for —
 * Chat opens the Agent's own Session, Stop cancels every Session it is
 * running right now — and both stay reachable from every tab.
 */
export function TeamAgentDetail({ workspaceId, status, loadMemberSessions, resolveThreadRefs, loadMemory, loadChannels, openMemberSession, openThread, openIssue, currentSessionId, openView, onClose, only, updateMember, loadModels, onCommitted, loadBoard, loadMemberActivity, subscribeChanges, threadTurnFailures, stopSession, t }: {
  readonly workspaceId: WorkspaceId
  readonly status: AgentTeamClientMemberStatus
  readonly loadMemberSessions: TeamSidebarProps['loadMemberSessions']
  readonly resolveThreadRefs: TeamSidebarProps['resolveThreadRefs']
  readonly loadMemory: TeamSidebarProps['loadMemory']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  /** Opens a Thread in the Team conversation (the row's Thread link). */
  readonly openThread?: (threadRef: AgentTeamSessionRun['threadRefs'][number]) => void
  /** The global opener: the issue opens as a slice over the Agent page. */
  readonly openIssue?: (taskRef: AgentTeamTaskRef) => void
  /** The Member Session now open in the main view: pressing its own row cannot remount, so it selects Chat directly. */
  readonly currentSessionId?: string
  /** The host's own view selector on the open session's conversation. */
  readonly openView?: (view: string, focus: string) => void
  /** Called after a Session opened natively; the detail's tabs live in the open conversation, so nothing closes. */
  readonly onClose?: () => void
  /** Render one tab's body only (the host's conversation tab strip owns the tabs). */
  readonly only?: DetailTab
  /** With both, the Config tab edits the model and Instances through the Agent editor's own save. */
  readonly updateMember?: TeamSidebarProps['updateMember']
  readonly loadModels?: TeamSidebarProps['loadModels']
  /** Re-reads the Member after a committed edit. */
  readonly onCommitted?: () => Promise<void> | void
  /** The board's catalog: the Tasks tab, and the Task the Agent is on right now. */
  readonly loadBoard?: TeamSidebarProps['loadBoard']
  /** Live running-Turn snapshot: the header's current tool and the presence workload. */
  readonly loadMemberActivity?: TeamSidebarProps['loadMemberActivity']
  /** Wakes the activity read while a Turn runs, so the tool label follows the Agent. */
  readonly subscribeChanges?: TeamSidebarProps['subscribeChanges']
  /** Errored Turns of a Thread: the Runs tab's failure reasons. */
  readonly threadTurnFailures?: TeamSidebarProps['threadTurnFailures']
  /** Cancels one Session's running Turn through the dsh Session controller. */
  readonly stopSession?: TeamSidebarProps['stopSession']
  readonly t: TeamSidebarProps['t']
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [alert, setAlert] = useState<string>()
  const [tabState, setTab] = useState<DetailTab>('sessions')
  const tab = only ?? tabState
  /** Sessions the Client refused to open (retired or not in its catalog): the row says so instead of staying silent. */
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
  const [memory, setMemory] = useState<AgentMemoryLoad | 'loading'>('loading')
  const [channelNames, setChannelNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [board, setBoard] = useState<BoardState>({ state: 'loading' })
  const [activities, setActivities] = useState<readonly AgentTeamMemberActivity[]>([])
  const [failures, setFailures] = useState<readonly AgentTeamThreadTurnFailure[]>([])
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const name = status.member.handle.replace(/^@/, '')
  const memberId = status.member.memberId
  const presence = deriveAgentPresence({ status, activities })
  const activity = activities.find(item => item.current !== undefined) ?? activities[0]
  const currentTask = board.state === 'ready' ? currentTaskOf(board.view, memberId, activity) : undefined

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const result = await loadMemberSessions({ workspaceId, memberId })
        if (!live) return
        if (result.ok) setLoaded({ state: 'ready', current: result.value.current, runs: result.value.runs })
        else setLoaded({ state: 'failed', message: result.error.message })
      } catch (cause) {
        if (live) setLoaded({ state: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })()
    return () => { live = false }
  }, [loadMemberSessions, workspaceId, memberId])

  // The board's catalog answers two questions at once: the Task the Agent is
  // on right now (header) and every Task it owns (Tasks tab). It is read once
  // per Member mount; the catalog is already cached by the read layer.
  useEffect(() => {
    if (loadBoard === undefined) return
    let live = true
    void (async () => {
      try {
        const result = await loadBoard({ workspaceId })
        if (!live) return
        if (result.ok) setBoard({ state: 'ready', view: result.value })
        else setBoard({ state: 'failed', message: result.error.message })
      } catch (cause) {
        if (live) setBoard({ state: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })()
    return () => { live = false }
  }, [loadBoard, workspaceId])

  // Live activity: the read layer's activity/presence scopes wake on every
  // step, so the header's tool label follows the Agent without a poll.
  useEffect(() => {
    if (loadMemberActivity === undefined) return
    let live = true
    const read = async (): Promise<void> => {
      try {
        const result = await loadMemberActivity({ workspaceId })
        if (live && result.ok) setActivities(result.value.activities.filter(activity => activity.memberId === memberId))
      } catch { /* the header keeps its last snapshot */ }
    }
    void read()
    if (subscribeChanges === undefined) return () => { live = false }
    const offPresence = subscribeChanges({ kind: 'presence', workspaceId }, update => { if (update.type !== 'failed') void read() })
    const offActivity = subscribeChanges({ kind: 'activity', workspaceId }, update => { if (update.type !== 'failed') void read() })
    return () => { live = false; offPresence(); offActivity() }
  }, [loadMemberActivity, subscribeChanges, workspaceId, memberId])

  // Each run names the Channel and Thread it served, and the Task the Agent
  // is on names its Thread: resolve them once for the whole page, so the
  // place lines and the header's Task link both open their Thread. A failed
  // lookup only leaves the place line at its Thread count.
  const resolveRefs = useMemo(() => {
    const refs = loaded.state === 'ready' ? loaded.runs.flatMap(run => run.threadRefs) : []
    if (currentTask !== undefined) refs.push(currentTask.threadRef)
    return [...new Set(refs)]
  }, [loaded, currentTask])
  const threadRefsKey = resolveRefs.join(',')
  useEffect(() => {
    if (threadRefsKey === '') return
    let live = true
    void (async () => {
      try {
        await hostThreadRefLookup(resolveThreadRefs, workspaceId)(resolveRefs)
        const view = await loadChannels({ workspaceId })
        if (live && view.ok) setChannelNames(new Map(view.value.channels.map(channel => [channel.channelRef, channel.name])))
      } catch { /* the place line stays at its count */ }
    })()
    return () => { live = false }
  }, [threadRefsKey, resolveThreadRefs, loadChannels, workspaceId])
  useResolvedThreadRefVersion()
  const placeOf = useMemo(() => (run: AgentTeamSessionRun) => runPlace(run, channelNames, ref => cachedResolvedThreadRef(ref)), [channelNames])

  // Failure reasons come per Thread, and a run may touch several: read each
  // distinct Thread once, then match by Session id. A failed read leaves the
  // row without a failure chip rather than failing the whole tab.
  useEffect(() => {
    if (loaded.state !== 'ready' || threadTurnFailures === undefined) return
    const refs = [...new Set(loaded.runs.flatMap(run => run.threadRefs))].slice(0, 24)
    if (refs.length === 0) return
    let live = true
    void (async () => {
      const results = await Promise.all(refs.map(async threadRef => {
        try {
          const result = await threadTurnFailures({ workspaceId, threadRef })
          return result.ok ? result.value : []
        } catch { return [] }
      }))
      if (live) setFailures(results.flat())
    })()
    return () => { live = false }
  }, [threadRefsKey, loaded.state, threadTurnFailures, workspaceId])

  // The Memory tab reads on first open only; a failure is shown, never swallowed.
  const [memoryRequested, setMemoryRequested] = useState(false)
  useEffect(() => {
    if (tab !== 'memory') return
    setMemoryRequested(true)
  }, [tab])
  useEffect(() => {
    if (!memoryRequested) return
    let live = true
    setMemory('loading')
    loadAgentMemory(loadMemory, workspaceId, memberId)
      .then(result => { if (live) setMemory(result) })
      .catch((cause: unknown) => { if (live) setMemory({ ok: false, code: 'ERROR', message: cause instanceof Error ? cause.message : String(cause) }) })
    return () => { live = false }
  }, [memoryRequested, loadMemory, workspaceId, memberId])

  const copy = async (sessionId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sessionId)
    } catch {
      setAlert(t('copySessionIdFailed'))
    }
  }

  const open = (run: AgentTeamSessionRun): void => {
    // The already-open session never remounts, so no tab-mount marker fires: select its Chat here.
    if (run.sessionId === currentSessionId && openView !== undefined) {
      openView('chat', '')
      onClose?.()
      return
    }
    let failed = false
    openMemberSession(run.sessionId, message => {
      failed = true
      setUnavailable(current => new Set(current).add(run.sessionId))
      setAlert(t('openAgentSessionFailed', { name, message }))
    })
    if (!failed) onClose?.()
  }

  const instances = status.instances
  const openSlot = (sessionId: AgentTeamSessionRun['sessionId']): void => {
    let failed = false
    openMemberSession(sessionId, message => {
      failed = true
      setAlert(t('openAgentSessionFailed', { name, message }))
    })
    if (!failed) onClose?.()
  }

  const latestModel = loaded.state === 'ready' ? loaded.runs.find(run => run.model !== null)?.model ?? null : null
  const modelLabel = status.member.model === undefined
    ? (latestModel === null ? UNKNOWN : `${latestModel.provider}/${latestModel.model}`)
    : `${status.member.model.provider}/${status.member.model.model}`
  const taskRows = board.state === 'ready' ? memberTaskRows(board.view, memberId) : []
  const busy = isMemberBusy(status, activities)
  const targets = stopTargets(status)
  const roleLabelKey = status.member.role === undefined ? undefined : (ROLE_LABEL_KEY as Readonly<Partial<Record<string, (typeof ROLE_LABEL_KEY)[keyof typeof ROLE_LABEL_KEY]>>>)[status.member.role]

  const chat = (): void => {
    // In the native detail the Agent's Session is already the open conversation;
    // Chat is the host's own view switch. Elsewhere it opens the Session.
    if (openView !== undefined) {
      openView('chat', '')
      return
    }
    openMemberSession(status.member.sessionId, message => { setAlert(t('openAgentSessionFailed', { name, message })) })
  }

  const stop = async (): Promise<void> => {
    if (stopSession === undefined || stopping) return
    setStopping(true)
    setAlert(undefined)
    const refused: string[] = []
    for (const target of targets) {
      try {
        const result = await stopSession(target.sessionId)
        if (!result.ok) refused.push(result.error.message)
      } catch (cause) {
        refused.push(cause instanceof Error ? cause.message : String(cause))
      }
    }
    setStopping(false)
    setConfirmStop(false)
    if (refused.length > 0) setAlert(t('agentStopFailed', { message: refused[0] ?? '' }))
  }

  const openTask = (threadRef: string): void => {
    if (openThread !== undefined) openThread(threadRef as AgentTeamSessionRun['threadRefs'][number])
  }

  // The issue opens as a slice over the Agent page: the same seam the board
  // and the Inbox use, so "open the issue" means one thing everywhere.
  const openIssueOf = (taskRef: AgentTeamTaskRef): void => {
    openIssue?.(taskRef)
  }

  return (
    <div className={only === undefined ? undefined : css.viewBody} data-team-agent-detail-body={only ?? 'all'}>
      <header className={css.detailHeader} data-team-agent-detail>
        <span className={css.detailAvatar}>
          <ActorAvatar name={name} kind="agent" size="xl" />
          <span className={css.detailPresence}><AgentPresenceDot detail={presence} compact t={t} /></span>
        </span>
        <div className={css.detailIdentity}>
          <span className={css.detailName}>
            <strong>@{name}</strong>
            {roleLabelKey !== undefined && <span className={css.detailRole} data-member-role={status.member.role}>{t(roleLabelKey)}</span>}
          </span>
          <span className={css.detailFacts}>
            <span className={css.detailPresenceWord} title={presenceLabel(status, t)}>{presenceLabel(status, t)}</span>
            <span className={css.detailDot} aria-hidden="true">·</span>
            <span data-agent-model>{modelLabel}</span>
            <span className={css.detailDot} aria-hidden="true">·</span>
            {currentTask === undefined
              ? <span className={css.muted} data-agent-current-task>{t('agentRowIdle')}</span>
              : <button type="button" className={css.detailTask} data-agent-current-task onClick={() => { openIssueOf(currentTask.taskRef) }}>
                <span className={css.taskNumber}>#{currentTask.taskNumber}</span>
                <span className={css.taskTitle}>{currentTask.title}</span>
              </button>}
            {activity?.current !== undefined && (
              <span className={css.detailTool} data-agent-current-tool title={activity.current.label}>{activity.current.label}</span>
            )}
          </span>
        </div>
        <div className={css.detailActions}>
          <Button variant="outline" size="sm" onClick={chat} data-agent-chat>{t('agentChat')}</Button>
          <Tooltip label={busy ? t('agentStopHint') : t('agentStopIdle')}>
            <span>
              <Button variant="primary" size="sm" disabled={!busy || stopSession === undefined} onClick={() => { setConfirmStop(true) }} data-agent-stop>{t('agentStop')}</Button>
            </span>
          </Tooltip>
        </div>
      </header>
      {only === undefined && <SegmentedTabs
        label={t('agentDetailsTabs')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sessions', label: t('agentDetailsTabSessions'), id: 'agent-detail-tab-sessions', panelId: 'agent-detail-panel-sessions' },
          { value: 'runs', label: t('agentDetailsTabRuns'), id: 'agent-detail-tab-runs', panelId: 'agent-detail-panel-runs' },
          { value: 'tasks', label: t('agentDetailsTabTasks'), id: 'agent-detail-tab-tasks', panelId: 'agent-detail-panel-tasks' },
          { value: 'overview', label: t('agentDetailsTabOverview'), id: 'agent-detail-tab-overview', panelId: 'agent-detail-panel-overview' },
          { value: 'memory', label: t('agentDetailsTabMemory'), id: 'agent-detail-tab-memory', panelId: 'agent-detail-panel-memory' },
        ]}
      />}
      {alert !== undefined && <p className={createCss.error} role="alert">{alert}</p>}
      {tab === 'runs' && (
        <div role="tabpanel" id="agent-detail-panel-runs" aria-labelledby="agent-detail-tab-runs" data-team-agent-runs-panel>
          <AgentRunsTab
            state={loaded.state === 'ready' ? 'ready' : loaded.state}
            {...(loaded.state === 'failed' ? { message: loaded.message } : {})}
            runs={loaded.state === 'ready' ? loaded.runs : []}
            current={loaded.state === 'ready' ? loaded.current : null}
            failures={failures}
            placeOf={placeOf}
            onOpen={open}
            t={t}
          />
        </div>
      )}
      {tab === 'tasks' && (
        <div role="tabpanel" id="agent-detail-panel-tasks" aria-labelledby="agent-detail-tab-tasks" data-team-agent-tasks-panel>
          <AgentTasksTab
            state={board.state}
            {...(board.state === 'failed' ? { message: board.message } : {})}
            groups={groupTasksByStatus(taskRows)}
            members={[{ memberId, handle: status.member.handle }]}
            activities={activities}
            onOpen={row => { openIssueOf(row.taskRef) }}
            t={t}
          />
        </div>
      )}
      {tab === 'overview' && (
        <div role="tabpanel" id="agent-detail-panel-overview" aria-labelledby="agent-detail-tab-overview" data-team-agent-overview>
          <dl className={css.facts}>
            <dt>{t('agentDetailsFactDescription')}</dt><dd>{status.member.description === '' ? UNKNOWN : status.member.description}</dd>
            <dt>{t('agentDetailsFactState')}</dt><dd>{status.member.state} · {presenceLabel(status, t)}</dd>
            <dt>{t('agentDetailsFactModel')}</dt><dd>{modelLabel}</dd>
            <dt>{t('agentDetailsFactPreset')}</dt><dd>{status.member.presetId}</dd>
            <dt>{t('agentDetailsFactInstances')}</dt><dd>{String(instances.length)}</dd>
            <dt>{t('agentDetailsFactWorkspaces')}</dt><dd>{String(status.workspaceIds.length)}</dd>
            <dt>{t('agentDetailsFactCurrentTask')}</dt><dd>{currentTask === undefined ? t('agentRowIdle') : `#${currentTask.taskNumber} ${currentTask.title}`}</dd>
            <dt>{t('agentDetailsFactCurrentTool')}</dt><dd>{activity?.current?.label ?? UNKNOWN}</dd>
          </dl>
          {updateMember !== undefined && loadModels !== undefined && (
            <section className={css.configEdit} data-team-agent-config aria-label={t('agentConfigEdit')}>
              <h3 className={css.sectionTitle}>{t('agentConfigEdit')}</h3>
              <AgentConfigEditor key={`${status.member.memberId}:${status.member.instances ?? ''}:${status.member.model?.provider ?? ''}/${status.member.model?.model ?? ''}/${status.member.model?.reasoningEffort ?? ''}`} status={status} updateMember={updateMember} loadModels={loadModels} onCommitted={onCommitted ?? (() => {})} t={t} />
            </section>
          )}
        </div>
      )}
      {tab === 'memory' && (
        <div role="tabpanel" id="agent-detail-panel-memory" aria-labelledby="agent-detail-tab-memory" data-team-agent-memory>
          {memory === 'loading' && <p className={css.muted}>{t('agentMemoryLoading')}</p>}
          {memory !== 'loading' && !memory.ok && <p className={css.partial} role="alert">{t('agentMemoryFailed', { message: memory.message })}</p>}
          {memory !== 'loading' && memory.ok && (
            <>
              <h3 className={css.sectionTitle}>{t('agentMemoryOwn')}</h3>
              {memory.own.length === 0 && <p className={css.muted}>{t('agentMemoryOwnEmpty')}</p>}
              <MemoryList records={memory.own} />
              {memory.ownMore && <p className={css.muted} data-memory-more>{t('agentMemoryMore')}</p>}
              <h3 className={css.sectionTitle}>{t('agentMemoryTeam')}</h3>
              {memory.team.length === 0 && <p className={css.muted}>{t('agentMemoryTeamEmpty')}</p>}
              <MemoryList records={memory.team} />
              {memory.teamMore && <p className={css.muted} data-memory-more>{t('agentMemoryMore')}</p>}
            </>
          )}
        </div>
      )}
      {tab === 'sessions' && (
        <div role="tabpanel" id="agent-detail-panel-sessions" aria-labelledby="agent-detail-tab-sessions" data-team-agent-sessions>
      {instances.length > 1 && (
        <section className={css.slots} data-team-agent-slots aria-label={t('agentDetailsSlots')}>
          <h3 className={css.slotsTitle}>{t('agentDetailsSlots')}</h3>
          <ul className={css.list}>
            {instances.map(instance => (
              <li key={instance.slot} className={css.slot} data-slot={instance.slot} data-presence={instance.presence}>
                <span>{t(instance.slot === 0 ? 'agentDetailsSlotMain' : 'agentDetailsSlot', { slot: String(instance.slot) })}</span>
                {!idleSlot(instance) && <span>{presenceLabel(slotPresence(status, instance.slot, instance.presence), t)}</span>}
                {instance.sessionId === undefined
                  ? <span className={css.muted}>{t('agentDetailsSlotIdle')}</span>
                  : <button type="button" className={css.open} aria-label={t('agentDetailsOpen', { id: instance.sessionId })} onClick={() => { openSlot(instance.sessionId!) }}><SessionIdLabel sessionId={instance.sessionId} /></button>}
                <span className={css.muted}>{t('agentDetailsThreads', { count: String(instance.threadRefs.length) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {loaded.state === 'loading' && <p className={css.muted}>{t('agentDetailsLoading')}</p>}
      {loaded.state === 'failed' && <p className={createCss.error} role="alert">{t('agentDetailsLoadFailed', { message: loaded.message })}</p>}
      {loaded.state === 'ready' && loaded.runs.length === 0 && <p className={css.muted}>{t('agentDetailsEmpty')}</p>}
      {loaded.state === 'ready' && loaded.runs.length > 0 && (
        <ul className={css.list}>
          {loaded.runs.map(run => {
            const partial = run.unknownInputTurns > 0
            const state = sessionState(run, status, loaded.current)
            const place = placeOf(run)
            const [firstThread, ...otherThreads] = run.threadRefs
            const otherTitles = otherThreads.map(ref => cachedResolvedThreadRef(ref)?.title || ref.slice(0, 15)).join('\n')
            return (
              <li key={run.sessionId} className={css.run} data-session-id={run.sessionId} data-active={state !== 'inactive' || undefined}>
                <div className={css.runHead}>
                  <SessionStateIcon state={state} t={t} />
                  <button type="button" className={css.open} aria-label={t('agentDetailsOpen', { id: run.sessionId })} onClick={() => { open(run) }}>
                    <SessionIdLabel sessionId={run.sessionId} />
                  </button>
                  <Tooltip label={t('copySessionId')}>
                    <button type="button" className={css.copy} aria-label={t('copySessionId')} onClick={() => { void copy(run.sessionId) }}><IconCopyOutlineRegular size={14} /></button>
                  </Tooltip>
                </div>
                <div className={css.muted} data-run-place>
                  {partial && <span className={css.partial} title={t('agentDetailsPartialTitle', { count: String(run.unknownInputTurns) })}>{t('agentDetailsPartial')}</span>}
                  {partial && ' '}
                  {run.model === null ? UNKNOWN : run.model.model}
                  {' · '}
                  {formatAbsoluteTime(run.startedAt)}
                  {' · '}
                  {firstThread === undefined
                    ? <span data-run-no-thread>{t('agentDetailsNoThread')}</span>
                    : <ThreadLink threadRef={firstThread} text={place === undefined || place.text === '' ? t('agentDetailsThreads', { count: String(run.threadRefs.length) }) : place.text} title={otherTitles === '' ? undefined : t('agentDetailsOtherThreads', { titles: otherTitles })} openThread={openThread} />}
                </div>
                {unavailable.has(run.sessionId) && <div className={css.partial} data-run-unavailable>{t('agentDetailsNotAvailable')}</div>}
                <dl className={css.stats} data-run-stats>
                  <div><dt>{t('agentDetailsStatIn')}</dt><dd>{partial ? `${formatTokens(run.tokensIn)}+` : formatTokens(run.tokensIn)}</dd></div>
                  <div><dt>{t('agentDetailsStatOut')}</dt><dd>{formatTokens(run.tokensOut)}</dd></div>
                  <div><dt>{t('agentDetailsStatCache')}</dt><dd>{cacheHitLabel(run)}</dd></div>
                  <div><dt>{t('agentDetailsStatTime')}</dt><dd>{formatRunTime(run.runMs)}</dd></div>
                  <div><dt>{t('agentDetailsStatTools')}</dt><dd>{String(run.toolCalls)}</dd></div>
                  <div><dt>{t('agentDetailsStatTurns')}</dt><dd>{String(run.turns)}</dd></div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
        </div>
      )}
      {confirmStop && (
        <Modal
          open
          onClose={() => { if (!stopping) setConfirmStop(false) }}
          title={t('agentStopTitle', { name })}
          closeLabel={t('close')}
          contentClassName={createCss.dialogContent!}
          footer={<>
            <Button variant="outline" disabled={stopping} onClick={() => { setConfirmStop(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={stopping} onClick={() => { void stop() }}>{stopping ? t('agentStopping') : t('agentStopConfirm')}</Button>
          </>}
        >
          <p>{t('agentStopNotice', { count: String(targets.length) })}</p>
        </Modal>
      )}
    </div>
  )
}

/** One Thread of a run as a link that opens it; without a way to open it, plain text. */
function ThreadLink({ threadRef, text, title, openThread }: { readonly threadRef: AgentTeamSessionRun['threadRefs'][number]; readonly text: string; readonly title?: string | undefined; readonly openThread: ((threadRef: AgentTeamSessionRun['threadRefs'][number]) => void) | undefined }) {
  if (openThread === undefined) return <span>{text}</span>
  return <button type="button" className={css.threadLink} data-run-thread={threadRef} title={title} onClick={() => { openThread(threadRef) }}>{text}</button>
}

function MemoryList({ records }: { readonly records: readonly TeamMemoryRecord[] }) {
  if (records.length === 0) return null
  return (
    <ul className={css.list}>
      {records.map(record => (
        <li key={record.id} className={css.run} data-memory-id={record.id}>
          <div className={css.runHead}><code>{record.type}</code> <strong>{record.title ?? record.id}</strong>{record.pinned ? ' 📌' : ''}</div>
          {record.body !== null && record.body !== '' && <div className={css.muted}>{record.body}</div>}
        </li>
      ))}
    </ul>
  )
}
