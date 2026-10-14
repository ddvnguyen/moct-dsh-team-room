import type { TeamMemoryRecord } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from './slots.ts'

/** The backend's page bound is 1..20; five pages is the most one Agent view reads (100 rows). */
export const AGENT_MEMORY_PAGE = 20
export const AGENT_MEMORY_MAX_PAGES = 5

export type AgentMemoryLoad =
  | {
    readonly ok: true
    /** The Agent's own `expert` home records, newest page first as the backend orders them. */
    readonly own: readonly TeamMemoryRecord[]
    /** The read stopped at the page cap with a cursor still open: say so, never truncate silently. */
    readonly ownMore: boolean
    /** Team rules and conventions: one page, read-only. */
    readonly team: readonly TeamMemoryRecord[]
    readonly teamMore: boolean
  }
  | { readonly ok: false; readonly code: string; readonly message: string }

/**
 * Reads what the Team memory holds for one Agent through the Human memory
 * list, no new op: the `expert` home keyed by the Member id (the list filters
 * by home kind only, so the ref is matched here) and the Team's rules and
 * conventions. Requests name only the Workspace; the Host adds the actor.
 */
export async function loadAgentMemory(
  list: TeamSidebarProps['loadMemory'],
  workspaceId: Parameters<TeamSidebarProps['loadMemory']>[0]['workspaceId'],
  memberId: string,
): Promise<AgentMemoryLoad> {
  const own: TeamMemoryRecord[] = []
  let cursor: string | undefined
  let ownMore = false
  for (let page = 1; page <= AGENT_MEMORY_MAX_PAGES; page += 1) {
    const result = await list({ workspaceId, homes: ['expert'], status: 'active', limit: AGENT_MEMORY_PAGE, ...(cursor === undefined ? {} : { cursor }) })
    if (!result.ok) return { ok: false, code: result.code, message: result.message }
    own.push(...result.value.results.filter(record => record.home.kind === 'expert' && record.home.ref === memberId))
    if (result.value.nextCursor === null) break
    if (page === AGENT_MEMORY_MAX_PAGES) ownMore = true
    cursor = result.value.nextCursor
  }
  const team = await list({ workspaceId, homes: ['team'], types: ['rule', 'convention'], status: 'active', limit: AGENT_MEMORY_PAGE })
  if (!team.ok) return { ok: false, code: team.code, message: team.message }
  return { ok: true, own, ownMore, team: team.value.results, teamMore: team.value.nextCursor !== null }
}
