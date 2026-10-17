// Derived from multica-x packages/views/issues/utils/drag-utils.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Board drag helpers. Multica's version also carries project/property grouping;
// the Team board groups by Task status only, so those branches are dropped.

import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'
import { STATUS_RANK } from './status.ts'
import type { BoardTaskLike, TaskStatus } from './types.ts'

export type DragMoveTargetUpdates = {
  readonly status?: TaskStatus
  readonly assignee?: string | null
  readonly position?: number
}

export type DragMoveUpdates = DragMoveTargetUpdates & {
  readonly beforeId: string | null
  readonly afterId: string | null
}

/** Column ids are `status:<status>`; cards are Task refs. */
export function statusGroupId(status: TaskStatus): string {
  return `status:${status}`
}

/**
 * Prefer a pointer-inside hit on a card, fall back to the nearest column.
 * Without the filter, a pointer over a card would resolve to the column and
 * the card could never be dropped between two neighbours.
 */
export function makeKanbanCollision(columnIds: ReadonlySet<string>): CollisionDetection {
  return (args) => {
    const pointer = pointerWithin(args)
    if (pointer.length > 0) {
      const cards = pointer.filter(candidate => !columnIds.has(candidate.id as string))
      return cards.length > 0 ? cards : pointer
    }
    return closestCenter(args)
  }
}

/** Bucket Task refs into columns, in the given column order. */
export function buildColumns(
  tasks: readonly BoardTaskLike[],
  columnIds: readonly string[],
): Record<string, string[]> {
  const columns: Record<string, string[]> = {}
  for (const id of columnIds) columns[id] = []
  for (const task of tasks) {
    const column = columns[statusGroupId(task.status)]
    if (column !== undefined) column.push(task.taskRef)
  }
  return columns
}

function positionOf(task: BoardTaskLike | undefined): number {
  return task?.position ?? 0
}

/**
 * Fractional position for the dragged card at its new index. The caller
 * persists the number; no reindex pass is needed while neighbours are dense.
 */
export function computePosition(
  ids: readonly string[],
  activeId: string,
  taskMap: ReadonlyMap<string, BoardTaskLike>,
): number {
  const index = ids.indexOf(activeId)
  if (index === -1) return 0
  if (ids.length === 1) return positionOf(taskMap.get(activeId))
  if (index === 0) return positionOf(taskMap.get(ids[1]!)) - 1
  if (index === ids.length - 1) return positionOf(taskMap.get(ids[index - 1]!)) + 1
  return (positionOf(taskMap.get(ids[index - 1]!)) + positionOf(taskMap.get(ids[index + 1]!))) / 2
}

export function getMoveAnchors(
  ids: readonly string[],
  activeId: string,
): Pick<DragMoveUpdates, 'beforeId' | 'afterId'> {
  const index = ids.indexOf(activeId)
  return {
    beforeId: index > 0 ? ids[index - 1]! : null,
    afterId: index >= 0 && index < ids.length - 1 ? ids[index + 1]! : null,
  }
}

/** Insert `id` where `position ASC` puts it, matching the Host's read order. */
export function insertIdByPosition(
  ids: readonly string[],
  id: string,
  position: number,
  taskMap: ReadonlyMap<string, BoardTaskLike>,
): string[] {
  const index = ids.findIndex((existing) => {
    const existingPosition = taskMap.get(existing)?.position
    return existingPosition !== undefined && existingPosition > position
  })
  if (index === -1) return [...ids, id]
  return [...ids.slice(0, index), id, ...ids.slice(index)]
}

export function findColumn(
  columns: Record<string, string[]>,
  id: string,
  columnIds: ReadonlySet<string>,
): string | null {
  if (columnIds.has(id)) return id
  for (const [columnId, ids] of Object.entries(columns)) {
    if (ids.includes(id)) return columnId
  }
  return null
}

export function statusOfColumnId(columnId: string): TaskStatus | null {
  if (!columnId.startsWith('status:')) return null
  const status = columnId.slice('status:'.length)
  return status in STATUS_RANK ? status as TaskStatus : null
}

/** Reordering inside a column never emits a status write. */
export function getMoveUpdates(
  columnId: string,
  position: number,
  task?: Pick<BoardTaskLike, 'status'>,
): DragMoveTargetUpdates {
  const status = statusOfColumnId(columnId)
  if (status === null) return { position }
  if (task !== undefined && task.status === status) return { position }
  return { status, position }
}
