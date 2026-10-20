// Derived from multica-x packages/views/agents/components/agent-list-toolbar.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's toolbar opens a multi-dimension filter popover
// (availability / access / runtime / owner / model) over a server-filtered
// list. The Team Room roster is small and fully local, so the three dimensions
// the Agents tab actually needs — free text, role and presence — are always
// visible: a search field plus two pill selects, with the visible/total count
// on the right. No popover state to lose, and every control is a real form
// control so the filter is keyboard- and screen-reader-operable.

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberRole } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { AgentAvailability } from '../multica/types.ts'
import { AVAILABILITY_LABEL_KEY, AVAILABILITY_ORDER } from '../multica/presence.ts'
import { ROLE_LABEL_KEY } from '../TeamMemberRow.tsx'
import css from './agent-list.module.css'

const ROLES = Object.keys(ROLE_LABEL_KEY) as readonly AgentTeamMemberRole[]

export type RoleFilter = AgentTeamMemberRole | 'all'
export type PresenceFilter = AgentAvailability | 'all'

export interface AgentListFilters {
  readonly query: string
  readonly role: RoleFilter
  readonly presence: PresenceFilter
}

export const EMPTY_AGENT_FILTERS: AgentListFilters = { query: '', role: 'all', presence: 'all' }

/** How many dimensions narrow the list; the toolbar shows it as a quiet count. */
export function countActiveFilters(filters: AgentListFilters): number {
  return (filters.query.trim() === '' ? 0 : 1) + (filters.role === 'all' ? 0 : 1) + (filters.presence === 'all' ? 0 : 1)
}

export function AgentListToolbar({ filters, onChange, visible, total, t }: {
  readonly filters: AgentListFilters
  readonly onChange: (next: AgentListFilters) => void
  readonly visible: number
  readonly total: number
  readonly t: TeamSidebarProps['t']
}) {
  return (
    <div className={css.toolbar} data-agent-list-toolbar>
      <Input
        className={css.search!}
        type="search"
        value={filters.query}
        placeholder={t('agentSearchPlaceholder')}
        aria-label={t('agentSearchPlaceholder')}
        onChange={event => { onChange({ ...filters, query: event.target.value }) }}
      />
      <label className={css.field}>
        <span className={css.srOnly}>{t('agentFilterRole')}</span>
        <select
          className={css.select}
          value={filters.role}
          aria-label={t('agentFilterRole')}
          onChange={event => { onChange({ ...filters, role: event.target.value as RoleFilter }) }}
        >
          <option value="all">{t('agentFilterAllRoles')}</option>
          {ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL_KEY[role])}</option>)}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.srOnly}>{t('agentFilterPresence')}</span>
        <select
          className={css.select}
          value={filters.presence}
          aria-label={t('agentFilterPresence')}
          onChange={event => { onChange({ ...filters, presence: event.target.value as PresenceFilter }) }}
        >
          <option value="all">{t('agentFilterAllPresence')}</option>
          {AVAILABILITY_ORDER.map(availability => <option key={availability} value={availability}>{t(AVAILABILITY_LABEL_KEY[availability])}</option>)}
        </select>
      </label>
      <span className={css.count} data-agent-list-count>{t('agentListCount', { visible: String(visible), total: String(total) })}</span>
    </div>
  )
}
