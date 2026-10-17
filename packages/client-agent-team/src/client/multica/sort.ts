// Derived from multica-x packages/views/issues/utils/sort.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Manual position is the board's own order and always ascends; every other
// field honours the requested direction.

import { PRIORITY_RANK } from './priority.ts'
import { STATUS_RANK } from './status.ts'
import type { BoardTaskLike, TaskPriority, TaskStatus } from './types.ts'

export type SortField = 'position' | 'priority' | 'status' | 'createdAt' | 'updatedAt' | 'title'
export type SortDirection = 'asc' | 'desc'

function rankPriority(priority: TaskPriority | undefined): number {
  return PRIORITY_RANK[priority ?? 'none'] ?? 99
}

function rankStatus(status: TaskStatus): number {
  return STATUS_RANK[status] ?? 99
}

function compareOptionalDate(
  a: string | undefined,
  b: string | undefined,
  direction: SortDirection,
): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  const dir = direction === 'desc' ? -1 : 1
  return dir * (new Date(a).getTime() - new Date(b).getTime())
}

export function sortTasks<T extends BoardTaskLike>(
  tasks: readonly T[],
  field: SortField,
  direction: SortDirection,
): T[] {
  const dir = direction === 'desc' ? -1 : 1
  return [...tasks].sort((a, b) => {
    switch (field) {
      case 'priority':
        return dir * (rankPriority(a.priority) - rankPriority(b.priority))
      case 'status':
        return dir * (rankStatus(a.status) - rankStatus(b.status))
      case 'createdAt':
        return compareOptionalDate(a.createdAt, b.createdAt, direction)
      case 'updatedAt':
        return compareOptionalDate(a.updatedAt, b.updatedAt, direction)
      case 'title':
        return dir * (a.title ?? '').localeCompare(b.title ?? '')
      case 'position':
      default:
        return (a.position ?? 0) - (b.position ?? 0)
    }
  })
}
