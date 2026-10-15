import type { AgentTeamClientMemberStatus, AgentTeamSessionRun } from '@ddvnguyen/moct-dsh-team-room/types'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import css from './agent-detail.module.css'

/** One status per Session row: green active, gray not active, red error, yellow pending on an action. */
export type SessionState = 'active' | 'inactive' | 'error' | 'pending'

const LABEL_KEY = {
  active: 'agentDetailsStateActive',
  inactive: 'agentDetailsStateInactive',
  error: 'agentDetailsStateError',
  pending: 'agentDetailsStatePending',
} as const

/**
 * A row's state from the Team projection the Client already holds. A Session the
 * seat is running (its current Session or an instance slot's) is live: it is red
 * when that slot reports `error`, yellow while the seat's configuration is not yet
 * applied (an action is pending on it), green otherwise. Every other Session has
 * ended, so it is gray. Whether an ENDED Session's last Turn failed is not in the
 * run row, so it does not turn red.
 */
export function sessionState(
  run: Pick<AgentTeamSessionRun, 'sessionId'>,
  status: Pick<AgentTeamClientMemberStatus, 'instances' | 'presence' | 'capabilityState'>,
  current: string | null,
): SessionState {
  const slot = status.instances.find(instance => instance.sessionId === run.sessionId)
  const isCurrent = run.sessionId === current
  if (slot === undefined && !isCurrent) return 'inactive'
  const presence = slot?.presence ?? status.presence
  if (presence === 'error') return 'error'
  if (presence === 'unavailable') return 'inactive'
  if (status.capabilityState === 'pending') return 'pending'
  return 'active'
}

/** A single status dot. Colour is never the only signal: the tooltip and the accessible name say the state. */
export function SessionStateIcon({ state, t }: { readonly state: SessionState; readonly t: TeamSidebarProps['t'] }) {
  const label = t(LABEL_KEY[state])
  return (
    <Tooltip label={label}>
      <span className={css.stateIcon} role="img" aria-label={label} data-session-state={state}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor" /></svg>
      </span>
    </Tooltip>
  )
}
