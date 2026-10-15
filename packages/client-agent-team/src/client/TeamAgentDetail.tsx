import { useEffect, useMemo, useState } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamSessionRun, TeamMemoryRecord } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconCopyOutlineRegular, SegmentedTabs, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { presenceLabel } from './TeamPresenceDot.tsx'
import { formatTokens, UNKNOWN } from './reply-stats.ts'
import { formatAbsoluteTime } from './team-formatters.ts'
import { loadAgentMemory, type AgentMemoryLoad } from './agent-memory.ts'
import { cachedResolvedThreadRef, hostThreadRefLookup, useResolvedThreadRefVersion } from './refs.ts'
import { SessionStateIcon, sessionState } from './session-state.tsx'
import createCss from './create.module.css'
import css from './agent-detail.module.css'

/** Session ids are long; the list shows the head and copies the whole id. */
export const shortSessionId = (sessionId: string): string => sessionId.slice(0, 8)

/** Run wall time: `42s`, `3m 5s`, `2h 14m`. */
export function formatRunTime(runMs: number): string {
  const seconds = Math.max(0, Math.round(runMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Cache hit share of the input side: cache read / (uncached input + cache read). Unknown input or an empty denominator is an em dash. */
export function cacheHitLabel(run: Pick<AgentTeamSessionRun, 'tokensIn' | 'cacheReadTokens'>): string {
  if (run.cacheReadTokens === null) return UNKNOWN
  const total = run.tokensIn + run.cacheReadTokens
  return total === 0 ? UNKNOWN : `${String(Math.round((run.cacheReadTokens / total) * 100))}%`
}

/** A null bucket is unknown, never 0. */
export const tokensOrUnknown = (count: number | null): string => count === null ? UNKNOWN : formatTokens(count)

/** A slot's presence under the seat's identity. The seat's diagnostic describes slot 0 — the seat's own Session — so only that row keeps it. */
function slotPresence(status: AgentTeamClientMemberStatus, slot: number, presence: AgentTeamClientMemberStatus['presence']): AgentTeamClientMemberStatus {
  if (slot === 0) return { ...status, presence }
  const { diagnostic: _seatDiagnostic, ...rest } = status
  return { ...rest, presence }
}

/** A slot with no Session that is neither working nor failed is simply idle: it says so once instead of reading as an outage. */
const idleSlot = (instance: { readonly sessionId?: unknown; readonly presence: AgentTeamClientMemberStatus['presence'] }): boolean =>
  instance.sessionId === undefined && instance.presence !== 'working' && instance.presence !== 'error'

type DetailTab = 'sessions' | 'overview' | 'memory'

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

/**
 * A14 Agent detail: the seat's header and its Session history, newest first,
 * from the Host's folded SessionRun rows. Clicking a Session opens it natively
 * through the same path as the row click; an id the Client cannot open is
 * reported in the dialog, not swallowed.
 */
export function TeamAgentDetail({ workspaceId, status, loadMemberSessions, resolveThreadRefs, loadMemory, loadChannels, openMemberSession, openThread, currentSessionId, openView, onClose, only, t }: {
  readonly workspaceId: WorkspaceId
  readonly status: AgentTeamClientMemberStatus
  readonly loadMemberSessions: TeamSidebarProps['loadMemberSessions']
  readonly resolveThreadRefs: TeamSidebarProps['resolveThreadRefs']
  readonly loadMemory: TeamSidebarProps['loadMemory']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  /** Opens a Thread in the Team conversation (the row's Thread link). */
  readonly openThread?: (threadRef: AgentTeamSessionRun['threadRefs'][number]) => void
  /** The Member Session now open in the main view: pressing its own row cannot remount, so it selects Chat directly. */
  readonly currentSessionId?: string
  /** The host's own view selector on the open session's conversation. */
  readonly openView?: (view: string, focus: string) => void
  /** Called after a Session opened natively; the detail's tabs live in the open conversation, so nothing closes. */
  readonly onClose?: () => void
  /** Render one tab's body only (the host's conversation tab strip owns the tabs). */
  readonly only?: DetailTab
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
  const name = status.member.handle.replace(/^@/, '')

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const result = await loadMemberSessions({ workspaceId, memberId: status.member.memberId })
        if (!live) return
        if (result.ok) setLoaded({ state: 'ready', current: result.value.current, runs: result.value.runs })
        else setLoaded({ state: 'failed', message: result.error.message })
      } catch (cause) {
        if (live) setLoaded({ state: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })()
    return () => { live = false }
  }, [loadMemberSessions, workspaceId, status.member.memberId])

  // Each run names the Channel and Thread it served: resolve the Threads once
  // for the whole list and the Channel names beside them. A failed lookup only
  // leaves the place line at its Thread count.
  const threadRefsKey = loaded.state === 'ready' ? loaded.runs.flatMap(run => run.threadRefs).join(',') : ''
  useEffect(() => {
    if (loaded.state !== 'ready' || threadRefsKey === '') return
    let live = true
    void (async () => {
      try {
        await hostThreadRefLookup(resolveThreadRefs, workspaceId)([...new Set(loaded.runs.flatMap(run => run.threadRefs))])
        const view = await loadChannels({ workspaceId })
        if (live && view.ok) setChannelNames(new Map(view.value.channels.map(channel => [channel.channelRef, channel.name])))
      } catch { /* the place line stays at its count */ }
    })()
    return () => { live = false }
  }, [threadRefsKey, resolveThreadRefs, loadChannels, workspaceId])
  useResolvedThreadRefVersion()
  const placeOf = useMemo(() => (run: AgentTeamSessionRun) => runPlace(run, channelNames, ref => cachedResolvedThreadRef(ref)), [channelNames])

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
    loadAgentMemory(loadMemory, workspaceId, status.member.memberId)
      .then(result => { if (live) setMemory(result) })
      .catch((cause: unknown) => { if (live) setMemory({ ok: false, code: 'ERROR', message: cause instanceof Error ? cause.message : String(cause) }) })
    return () => { live = false }
  }, [memoryRequested, loadMemory, workspaceId, status.member.memberId])

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

  return (
    <div className={only === undefined ? undefined : css.viewBody} data-team-agent-detail-body={only ?? 'all'}>
      {(only === undefined || only === 'sessions') && <div className={css.header} data-team-agent-detail>
        <span className={css.handle}>@{name}</span>
        <span>{presenceLabel(status, t)}</span>
        <span className={css.muted}>{latestModel === null ? UNKNOWN : `${latestModel.provider}/${latestModel.model}`}</span>
      </div>}
      {only === undefined && <SegmentedTabs
        label={t('agentDetailsTabs')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sessions', label: t('agentDetailsTabSessions'), id: 'agent-detail-tab-sessions', panelId: 'agent-detail-panel-sessions' },
          { value: 'overview', label: t('agentDetailsTabOverview'), id: 'agent-detail-tab-overview', panelId: 'agent-detail-panel-overview' },
          { value: 'memory', label: t('agentDetailsTabMemory'), id: 'agent-detail-tab-memory', panelId: 'agent-detail-panel-memory' },
        ]}
      />}
      {tab === 'overview' && (
        <div role="tabpanel" id="agent-detail-panel-overview" aria-labelledby="agent-detail-tab-overview" data-team-agent-overview>
          <dl className={css.facts}>
            <dt>{t('agentDetailsFactDescription')}</dt><dd>{status.member.description === '' ? UNKNOWN : status.member.description}</dd>
            <dt>{t('agentDetailsFactState')}</dt><dd>{status.member.state} · {presenceLabel(status, t)}</dd>
            <dt>{t('agentDetailsFactModel')}</dt><dd>{status.member.model === undefined ? (latestModel === null ? UNKNOWN : `${latestModel.provider}/${latestModel.model}`) : `${status.member.model.provider}/${status.member.model.model}`}</dd>
            <dt>{t('agentDetailsFactPreset')}</dt><dd>{status.member.presetId}</dd>
            <dt>{t('agentDetailsFactInstances')}</dt><dd>{String(instances.length)}</dd>
            <dt>{t('agentDetailsFactWorkspaces')}</dt><dd>{String(status.workspaceIds.length)}</dd>
          </dl>
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
                  : <button type="button" className={css.open} aria-label={t('agentDetailsOpen', { id: instance.sessionId })} onClick={() => { openSlot(instance.sessionId!) }}><code>{shortSessionId(instance.sessionId)}</code></button>}
                <span className={css.muted}>{t('agentDetailsThreads', { count: String(instance.threadRefs.length) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {alert !== undefined && <p className={createCss.error} role="alert">{alert}</p>}
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
            return (
              <li key={run.sessionId} className={css.run} data-session-id={run.sessionId} data-active={state !== 'inactive' || undefined}>
                <div className={css.runHead}>
                  <SessionStateIcon state={state} t={t} />
                  <button type="button" className={css.open} aria-label={t('agentDetailsOpen', { id: run.sessionId })} onClick={() => { open(run) }}>
                    <code>{shortSessionId(run.sessionId)}</code>
                  </button>
                  <Tooltip label={t('copySessionId')}>
                    <button type="button" className={css.copy} aria-label={t('copySessionId')} onClick={() => { void copy(run.sessionId) }}><IconCopyOutlineRegular size={14} /></button>
                  </Tooltip>
                  {partial && <span className={css.partial} title={t('agentDetailsPartialTitle', { count: String(run.unknownInputTurns) })}>{t('agentDetailsPartial')}</span>}
                  <span className={css.muted}>{run.model === null ? UNKNOWN : run.model.model}</span>
                </div>
                <div className={css.muted} data-run-place>
                  {formatAbsoluteTime(run.startedAt)} → {formatAbsoluteTime(run.endedAt)}
                  {' · '}
                  {firstThread === undefined
                    ? <span data-run-no-thread>{t('agentDetailsNoThread')}</span>
                    : <ThreadLink threadRef={firstThread} text={place === undefined || place.text === '' ? t('agentDetailsThreads', { count: String(run.threadRefs.length) }) : place.text} openThread={openThread} />}
                  {otherThreads.length > 0 && (
                    <details className={css.more} data-run-more-threads>
                      <summary aria-label={t('agentDetailsMoreThreads', { count: String(otherThreads.length) })}>+{otherThreads.length}</summary>
                      <ul className={css.moreList}>
                        {otherThreads.map(ref => <li key={ref}><ThreadLink threadRef={ref} text={cachedResolvedThreadRef(ref)?.title || ref.slice(0, 15)} openThread={openThread} /></li>)}
                      </ul>
                    </details>
                  )}
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
    </div>
  )
}

/** One Thread of a run as a link that opens it; without a way to open it, plain text. */
function ThreadLink({ threadRef, text, openThread }: { readonly threadRef: AgentTeamSessionRun['threadRefs'][number]; readonly text: string; readonly openThread: ((threadRef: AgentTeamSessionRun['threadRefs'][number]) => void) | undefined }) {
  if (openThread === undefined) return <span>{text}</span>
  return <button type="button" className={css.threadLink} data-run-thread={threadRef} onClick={() => { openThread(threadRef) }}>{text}</button>
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
