// Derived from multica-x packages/views/issues/utils/filter.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// The Team board's filter bar needs channel, assignee (including Unassigned),
// priority and text. Multica's project/label/property predicates are not
// ported because the Team model has no equivalents.

import type { BoardTaskLike, TaskPriority, TaskStatus } from './types.ts'

/** Sentinel for "no assignee" in the assignee filter. */
export const UNASSIGNED = '__unassigned__'

export interface TaskFilters {
  readonly channelRefs: readonly string[]
  /** Member ids plus `UNASSIGNED`. Empty = every assignee. */
  readonly assignees: readonly string[]
  readonly priorities: readonly TaskPriority[]
  readonly statuses: readonly TaskStatus[]
  /** Case-insensitive substring over the title. */
  readonly text?: string
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  channelRefs: [],
  assignees: [],
  priorities: [],
  statuses: [],
  text: '',
}

export function isEmptyTaskFilters(filters: TaskFilters): boolean {
  return filters.channelRefs.length === 0
    && filters.assignees.length === 0
    && filters.priorities.length === 0
    && filters.statuses.length === 0
    && (filters.text ?? '').trim() === ''
}

export function filterTasks<T extends BoardTaskLike>(tasks: readonly T[], filters: TaskFilters): T[] {
  if (isEmptyTaskFilters(filters)) return [...tasks]
  const channels = new Set(filters.channelRefs)
  const assignees = new Set(filters.assignees)
  const priorities = new Set(filters.priorities)
  const statuses = new Set(filters.statuses)
  const text = (filters.text ?? '').trim().toLowerCase()
  return tasks.filter((task) => {
    if (channels.size > 0 && !channels.has(task.channelRef)) return false
    if (statuses.size > 0 && !statuses.has(task.status)) return false
    if (priorities.size > 0 && !priorities.has(task.priority ?? 'none')) return false
    if (assignees.size > 0) {
      const key = task.assignee ?? UNASSIGNED
      if (!assignees.has(key)) return false
    }
    if (text !== '' && !(task.title ?? '').toLowerCase().includes(text)) return false
    return true
  })
}

/** Number of active predicates, for the filter button's badge. */
export function taskFilterCount(filters: TaskFilters): number {
  return filters.channelRefs.length
    + filters.assignees.length
    + filters.priorities.length
    + filters.statuses.length
    + ((filters.text ?? '').trim() === '' ? 0 : 1)
}
