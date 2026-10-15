import { useEffect, useState } from 'react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamSidebarProps } from './slots.ts'
import type { TeamNavigation } from './navigation.ts'
import { TeamAgentDetail } from './TeamAgentDetail.tsx'
import css from './agent-detail.module.css'

/**
 * A14 Agent detail as the host's own conversation tabs.
 *
 * The Agent detail is the Agent's Session shown in the native conversation seat;
 * Sessions, Config and Memory are `conversation.view` entries beside the host's
 * Chat and Trajectory (and whatever other plugins register). The host's tab list
 * is global, so the entries exist only while a Member Session is the open main
 * session and are disposed otherwise: an ordinary conversation never shows them.
 */
export const AGENT_VIEW_IDS = { sessions: 'agent-sessions', config: 'agent-config', memory: 'agent-memory' } as const
/** Below the host Chat view's order (0), so the strip reads Sessions | Config | Memory | Chat | Trajectory. */
export const AGENT_VIEW_ORDER = { sessions: -30, config: -20, memory: -10 } as const

interface AgentRef { readonly workspaceId: WorkspaceId; readonly memberId: string }

/** Which Agent a Member Session belongs to, noted when the Client opens it from an Agent surface. */
const agentOfSession = new Map<string, AgentRef>()
/** Sessions just opened from a Session row: they land on Chat even if last left on one of these tabs. */
const chatLanding = new Set<string>()

export function noteAgentSession(sessionId: string, agent: AgentRef): void { agentOfSession.set(sessionId, agent) }
export function agentOfSessionFor(sessionId: string): AgentRef | undefined { return agentOfSession.get(sessionId) }
export function markChatLanding(sessionId: string): void { chatLanding.add(sessionId) }
export function resetAgentSessions(): void { agentOfSession.clear(); chatLanding.clear() }

type ViewRemotes = Pick<TeamSidebarProps, 'loadMembers' | 'loadMemberSessions' | 'resolveThreadRefs' | 'loadMemory' | 'loadChannels' | 'openMemberSession'>

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly workspaceId: WorkspaceId; readonly status: AgentTeamClientMemberStatus }

/** Find the Agent behind a Member Session: the noted one, else the roster Member that holds the session. */
async function resolveAgent(remotes: ViewRemotes, navigation: TeamNavigation, sessionId: string): Promise<Loaded> {
  const noted = agentOfSession.get(sessionId)
  const workspaceId = noted?.workspaceId ?? navigation.getSnapshot().workspaceId
  if (workspaceId === undefined) return { state: 'missing' }
  const result = await remotes.loadMembers({ workspaceId })
  if (!result.ok) return { state: 'failed', message: result.error.message }
  const status = result.value.find(item => noted === undefined
    ? item.member.sessionId === sessionId || item.instances.some(instance => instance.sessionId === sessionId)
    : item.member.memberId === noted.memberId)
  return status === undefined ? { state: 'missing' } : { state: 'ready', workspaceId, status }
}

/** The body of one Agent tab, mounted by the host inside the conversation's view area. */
export function AgentViewBody({ tab, sessionId, remotes, navigation, openView, t }: {
  readonly tab: 'sessions' | 'overview' | 'memory'
  readonly sessionId: string
  readonly remotes: ViewRemotes
  readonly navigation: TeamNavigation
  readonly openView?: (view: string, focus: string) => void
  readonly t: TeamSidebarProps['t']
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  // A Session row press lands on Chat: when the opened session remembered one of
  // these tabs, the tab sends the conversation to Chat through the host's own
  // `openView`, on its own session.
  useEffect(() => {
    if (chatLanding.delete(sessionId)) openView?.('chat', '')
  }, [sessionId])
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const next = await resolveAgent(remotes, navigation, sessionId)
        if (live) setLoaded(next)
      } catch (cause) {
        if (live) setLoaded({ state: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })()
    return () => { live = false }
  }, [remotes.loadMembers, sessionId])
  if (loaded.state === 'ready') {
    const { workspaceId, status } = loaded
    const open: TeamSidebarProps['openMemberSession'] = (target, reportFailure) => {
      noteAgentSession(target, { workspaceId, memberId: status.member.memberId })
      markChatLanding(target)
      remotes.openMemberSession(target, reportFailure)
    }
    return <TeamAgentDetail only={tab} workspaceId={workspaceId} status={status} loadMemberSessions={remotes.loadMemberSessions} resolveThreadRefs={remotes.resolveThreadRefs} loadMemory={remotes.loadMemory} loadChannels={remotes.loadChannels} openMemberSession={open} t={t} />
  }
  return <div className={css.viewBody} data-team-agent-detail-body={tab}>
    {loaded.state === 'loading' && <p className={css.muted}>{t('agentDetailsLoading')}</p>}
    {loaded.state === 'missing' && <p className={css.muted}>{t('agentDetailsNotAgent')}</p>}
    {loaded.state === 'failed' && <p className={css.partial} role="alert">{t('agentDetailsLoadFailed', { message: loaded.message })}</p>}
  </div>
}
