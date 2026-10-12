import { useEffect, useState } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamSessionRun } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconCopyOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { presenceLabel } from './TeamPresenceDot.tsx'
import { formatTokens, UNKNOWN } from './reply-stats.ts'
import { formatAbsoluteTime } from './team-formatters.ts'
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

/** A null bucket is unknown, never 0. */
export const tokensOrUnknown = (count: number | null): string => count === null ? UNKNOWN : formatTokens(count)

/** A slot's presence under the seat's identity; the seat's diagnostic belongs to slot 0 only, so it is dropped. */
function slotPresence(status: AgentTeamClientMemberStatus, presence: AgentTeamClientMemberStatus['presence']): AgentTeamClientMemberStatus {
  const { diagnostic: _seatDiagnostic, ...rest } = status
  return { ...rest, presence }
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
export function TeamAgentDetail({ workspaceId, status, loadMemberSessions, openMemberSession, onClose, t }: {
  readonly workspaceId: WorkspaceId
  readonly status: AgentTeamClientMemberStatus
  readonly loadMemberSessions: TeamSidebarProps['loadMemberSessions']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [alert, setAlert] = useState<string>()
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

  const copy = async (sessionId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sessionId)
    } catch {
      setAlert(t('copySessionIdFailed'))
    }
  }

  const open = (run: AgentTeamSessionRun): void => {
    let failed = false
    openMemberSession(run.sessionId, message => {
      failed = true
      setAlert(t('openAgentSessionFailed', { name, message }))
    })
    if (!failed) onClose()
  }

  const instances = status.instances
  const openSlot = (sessionId: AgentTeamSessionRun['sessionId']): void => {
    let failed = false
    openMemberSession(sessionId, message => {
      failed = true
      setAlert(t('openAgentSessionFailed', { name, message }))
    })
    if (!failed) onClose()
  }

  const latestModel = loaded.state === 'ready' ? loaded.runs.find(run => run.model !== null)?.model ?? null : null

  return (
    <Modal
      open
      onClose={onClose}
      title={t('agentDetailsTitle', { name })}
      closeLabel={t('close')}
      contentClassName={createCss.dialogContent!}
      footer={<Button variant="outline" onClick={onClose}>{t('close')}</Button>}
    >
      <div className={css.header} data-team-agent-detail>
        <span className={css.handle}>@{name}</span>
        <span>{presenceLabel(status, t)}</span>
        <span className={css.muted}>{latestModel === null ? UNKNOWN : `${latestModel.provider}/${latestModel.model}`}</span>
      </div>
      {instances.length > 1 && (
        <section className={css.slots} data-team-agent-slots aria-label={t('agentDetailsSlots')}>
          <h3 className={css.slotsTitle}>{t('agentDetailsSlots')}</h3>
          <ul className={css.list}>
            {instances.map(instance => (
              <li key={instance.slot} className={css.slot} data-slot={instance.slot} data-presence={instance.presence}>
                <span>{t(instance.slot === 0 ? 'agentDetailsSlotMain' : 'agentDetailsSlot', { slot: String(instance.slot) })}</span>
                <span>{presenceLabel(slotPresence(status, instance.presence), t)}</span>
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
            const active = run.sessionId === loaded.current
            const partial = run.unknownInputTurns > 0
            return (
              <li key={run.sessionId} className={css.run} data-session-id={run.sessionId} data-active={active || undefined}>
                <div className={css.runHead}>
                  <button type="button" className={css.open} aria-label={t('agentDetailsOpen', { id: run.sessionId })} onClick={() => { open(run) }}>
                    <code>{shortSessionId(run.sessionId)}</code>
                  </button>
                  <Tooltip label={t('copySessionId')}>
                    <button type="button" className={css.copy} aria-label={t('copySessionId')} onClick={() => { void copy(run.sessionId) }}><IconCopyOutlineRegular size={14} /></button>
                  </Tooltip>
                  {active && <span className={css.active}>{t('agentDetailsActive')}</span>}
                  {partial && <span className={css.partial} title={t('agentDetailsPartialTitle', { count: String(run.unknownInputTurns) })}>{t('agentDetailsPartial')}</span>}
                  <span className={css.muted}>{run.model === null ? UNKNOWN : run.model.model}</span>
                </div>
                <div className={css.muted}>{formatAbsoluteTime(run.startedAt)} → {formatAbsoluteTime(run.endedAt)} · {t('agentDetailsThreads', { count: String(run.threadRefs.length) })}</div>
                <div className={css.stats}>{t('agentDetailsStats', {
                  turns: String(run.turns),
                  input: partial ? `${formatTokens(run.tokensIn)}+` : formatTokens(run.tokensIn),
                  output: formatTokens(run.tokensOut),
                  cacheRead: tokensOrUnknown(run.cacheReadTokens),
                  cacheWrite: tokensOrUnknown(run.cacheWriteTokens),
                  tools: String(run.toolCalls),
                  runtime: formatRunTime(run.runMs),
                })}</div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
