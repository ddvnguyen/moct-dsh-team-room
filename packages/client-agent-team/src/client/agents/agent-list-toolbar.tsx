// Derived from multica-x packages/views/agents/components/agent-list-toolbar.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's toolbar opens a multi-dimension filter popover
// (availability / access / runtime / owner / model) over a server-filtered
// list. The Team Room roster is small and fully local, so the three dimensions
// the Agents tab actually needs — free text, role and presence — are always
// visible: a search field plus two filter menus, with the visible/total count
// on the right. No popover state to lose, and every control is a real button
// so the filter is keyboard- and screen-reader-operable.
//
// The two filters are the ported `PickerMenu` shell the Board filter bar and
// the Inbox filter menu already use, not native `<select>` elements: a select
// in the narrow rail clipped its own label mid-glyph (Chromium does not
// ellipsize a select) and, with `appearance: none`, carried no dropdown
// affordance at all. The menu's trigger keeps a chevron and a label that
// truncates, so the control reads as a filter and never overprints the count
// standing next to it.

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberRole } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { AgentAvailability } from '../multica/types.ts'
import { AVAILABILITY_LABEL_KEY, AVAILABILITY_ORDER } from '../multica/presence.ts'
import { PickerItem, PickerMenu } from '../multica-ui/index.ts'
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
  // The trigger shows the chosen value, and the "All" wording when the
  // dimension is not narrowing the list. The accessible name states the
  // dimension too, so the two neighbouring triggers are never both just a
  // value.
  const roleLabel = filters.role === 'all' ? t('agentFilterAllRoles') : t(ROLE_LABEL_KEY[filters.role])
  const presenceLabel = filters.presence === 'all' ? t('agentFilterAllPresence') : t(AVAILABILITY_LABEL_KEY[filters.presence])
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
      {/* The filters and the reset share one row that may shrink; the count
          is the last item in flow, so it can never be painted over a
          control — the row wraps instead of colliding. */}
      <div className={css.filters} data-agent-list-filters>
        <span className={css.filter} data-agent-list-filter="role">
          <PickerMenu
            label={roleLabel}
            triggerLabel={t('agentFilterRole')}
            valueLabel={roleLabel}
          >
            {close => <>
              <PickerItem selected={filters.role === 'all'} onSelect={() => { onChange({ ...filters, role: 'all' }); close() }}>
                <span className={css.filterRow}>{t('agentFilterAllRoles')}</span>
              </PickerItem>
              {ROLES.map(role => (
                <PickerItem key={role} selected={filters.role === role} onSelect={() => { onChange({ ...filters, role }); close() }}>
                  <span className={css.filterRow}>{t(ROLE_LABEL_KEY[role])}</span>
                </PickerItem>
              ))}
            </>}
          </PickerMenu>
        </span>
        <span className={css.filter} data-agent-list-filter="presence">
          <PickerMenu
            label={presenceLabel}
            triggerLabel={t('agentFilterPresence')}
            valueLabel={presenceLabel}
          >
            {close => <>
              <PickerItem selected={filters.presence === 'all'} onSelect={() => { onChange({ ...filters, presence: 'all' }); close() }}>
                <span className={css.filterRow}>{t('agentFilterAllPresence')}</span>
              </PickerItem>
              {AVAILABILITY_ORDER.map(availability => (
                <PickerItem key={availability} selected={filters.presence === availability} onSelect={() => { onChange({ ...filters, presence: availability }); close() }}>
                  <span className={css.filterRow}>{t(AVAILABILITY_LABEL_KEY[availability])}</span>
                </PickerItem>
              ))}
            </>}
          </PickerMenu>
        </span>
        {/* One reset for the whole toolbar, and only while a dimension
            narrows the list: with nothing filtered there is nothing to
            reset. */}
        {countActiveFilters(filters) > 0 && (
          <button type="button" className={css.clearButton} aria-label={t('agentFilterClear')} title={t('agentFilterClear')} data-agent-list-clear onClick={() => { onChange(EMPTY_AGENT_FILTERS) }}>
            ×
          </button>
        )}
      </div>
      <span className={css.count} data-agent-list-count>{t('agentListCount', { visible: String(visible), total: String(total) })}</span>
    </div>
  )
}
