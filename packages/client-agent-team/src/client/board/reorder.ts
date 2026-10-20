// Position writes for a same-column drop.

import { computePosition } from '../multica/drag-utils.ts'
import type { BoardTaskLike } from '../multica/types.ts'

export interface PositionWrite {
  readonly taskRef: string
  readonly position: number
}

const positionOf = (task: Pick<BoardTaskLike, 'position'> | undefined): number => task?.position ?? 0

/**
 * The writes that make `ids` (the column in its new order) the persisted
 * order after `activeId` moved. One write places the card between its
 * neighbours when they are apart; when they tie (Tasks created before the Host
 * spaced positions all read 0) there is no number between them, so the column
 * is renumbered 1..n and only the cards whose number changes are written.
 */
export function planPositionWrites(
  ids: readonly string[],
  activeId: string,
  tasks: ReadonlyMap<string, Pick<BoardTaskLike, 'position'>>,
): readonly PositionWrite[] {
  const index = ids.indexOf(activeId)
  if (index === -1) return []
  const candidate = computePosition(ids, activeId, tasks)
  const previous = index > 0 ? positionOf(tasks.get(ids[index - 1]!)) : undefined
  const next = index < ids.length - 1 ? positionOf(tasks.get(ids[index + 1]!)) : undefined
  const fits = (previous === undefined || candidate > previous) && (next === undefined || candidate < next)
  if (fits) return candidate === positionOf(tasks.get(activeId)) ? [] : [{ taskRef: activeId, position: candidate }]
  return ids.flatMap((taskRef, order) => {
    const position = order + 1
    return position === positionOf(tasks.get(taskRef)) ? [] : [{ taskRef, position }]
  })
}
