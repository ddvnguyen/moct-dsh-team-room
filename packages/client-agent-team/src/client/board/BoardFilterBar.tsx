// Derived from multica-x packages/views/issues/components/filter-chips-bar.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: four predicates only — channel, assignee (including
// Unassigned), priority and text — driven by the ported `multica/filter.ts`
// model. Multica's saved views, status filter and property chips are not
// ported: the Team board's columns are the statuses.

import type { TeamSidebarProps } from '../slots.ts'
import type { TaskPriority } from '../multica/types.ts'
import { PRIORITY_LABEL_KEY } from '../multica/priority.ts'
import { UNASSIGNED, taskFilterCount, type TaskFilters } from '../multica/filter.ts'
import { PickerItem, PickerMenu } from '../multica-ui/PickerMenu.tsx'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import css from './board.module.css'

export interface BoardFilterBarProps {
  readonly filters: TaskFilters
  readonly onFiltersChange: (filters: TaskFilters) => void
  readonly channels: readonly { readonly channelRef: string; readonly name: string }[]
  readonly members: readonly AssigneeOption[]
  readonly t: TeamSidebarProps['t']
}

/** The board's filter bar: one popover per predicate plus a text box. */
export function BoardFilterBar({ filters, onFiltersChange, channels, members, t }: BoardFilterBarProps) {
  const count = taskFilterCount(filters)
  const toggle = <T,>(list: readonly T[], value: T): readonly T[] =>
    list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]

  // A chip names its facet and what is selected; its clear button names the facet it clears.
  const chipLabel = (facet: string, values: readonly string[], onClear: () => void) => (
    <span className={css.filterChip}>
      {`${facet}: ${values.join(', ')}`}
      <button type="button" className={css.filterChipClear} aria-label={`${t('boardFilterClear')} ${facet}`} onClick={onClear}>×</button>
    </span>
  )
  const channelNames = filters.channelRefs.map(ref => channels.find(channel => channel.channelRef === ref)?.name ?? ref)
  const assigneeNames = filters.assignees.map(id => id === UNASSIGNED ? t('assigneeUnassigned') : members.find(member => member.memberId === id)?.handle ?? id)
  const priorityNames = filters.priorities.map(priority => t(PRIORITY_LABEL_KEY[priority]))

  return (
    <div className={css.toolbarFilters} data-testid="board-filter-bar">
      <PickerMenu
        triggerLabel={t('boardFilterChannel')}
        icon={undefined}
        label={t('boardFilterChannel')}
      >
        {() => (
          <>
            {channels.map(channel => (
              <PickerItem
                key={channel.channelRef}
                selected={filters.channelRefs.includes(channel.channelRef)}
                onSelect={() => {
                  onFiltersChange({ ...filters, channelRefs: toggle(filters.channelRefs, channel.channelRef) })
                }}
              >
                <span className={css.hiddenRowLabel}>{channel.name}</span>
              </PickerItem>
            ))}
          </>
        )}
      </PickerMenu>
      <PickerMenu
        triggerLabel={t('boardFilterAssignee')}
        icon={undefined}
        label={t('boardFilterAssignee')}
      >
        {() => (
          <>
            <PickerItem
              selected={filters.assignees.includes(UNASSIGNED)}
              onSelect={() => {
                onFiltersChange({ ...filters, assignees: toggle(filters.assignees, UNASSIGNED) })
              }}
            >
              <span className={css.hiddenRowLabel}>{t('assigneeUnassigned')}</span>
            </PickerItem>
            {members.map(member => (
              <PickerItem
                key={member.memberId}
                selected={filters.assignees.includes(member.memberId)}
                onSelect={() => {
                  onFiltersChange({ ...filters, assignees: toggle(filters.assignees, member.memberId) })
                }}
              >
                <span className={css.hiddenRowLabel}>{member.handle}</span>
              </PickerItem>
            ))}
          </>
        )}
      </PickerMenu>
      <PickerMenu
        triggerLabel={t('boardFilterPriority')}
        icon={undefined}
        label={t('boardFilterPriority')}
      >
        {() => (
          <>
            {(['urgent', 'high', 'medium', 'low', 'none'] as const).map(priority => (
              <PickerItem
                key={priority}
                selected={filters.priorities.includes(priority)}
                onSelect={() => {
                  onFiltersChange({ ...filters, priorities: toggle(filters.priorities, priority as TaskPriority) })
                }}
              >
                <span className={css.hiddenRowLabel}>{t(PRIORITY_LABEL_KEY[priority])}</span>
              </PickerItem>
            ))}
          </>
        )}
      </PickerMenu>
      {count > 0 && <span className={css.filterBadge} role="status" aria-label={t('boardFilterActive', { count: String(count) })} data-testid="board-filter-count">{count}</span>}
      {filters.channelRefs.length > 0 && chipLabel(t('boardFilterChannel'), channelNames, () => onFiltersChange({ ...filters, channelRefs: [] }))}
      {filters.assignees.length > 0 && chipLabel(t('boardFilterAssignee'), assigneeNames, () => onFiltersChange({ ...filters, assignees: [] }))}
      {filters.priorities.length > 0 && chipLabel(t('boardFilterPriority'), priorityNames, () => onFiltersChange({ ...filters, priorities: [] }))}
      <input
        type="search"
        className={css.filterSearch}
        placeholder={t('boardFilterText')}
        aria-label={t('boardFilterText')}
        value={filters.text ?? ''}
        onChange={event => { onFiltersChange({ ...filters, text: event.target.value }) }}
      />
    </div>
  )
}
