// Derived from multica-x packages/views/issues/components/board-column.tsx @ cbd75011884bd0ee75e9de57d86fbb05c150c421. Copyright Index Labs. Multica License.
//
// Rendering adapted: the Team board groups by Task status only, so the strip
// carries the three facts the expanded column's header carries — the status
// glyph, the name and the count — and no project/property arms. It registers
// no droppable, so a collapsed column is a label, never a drop target.

import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import css from './board.module.css'

/** Width of one collapsed column: Multica's `BOARD_COLLAPSED_WIDTH`. */
export const BOARD_COLLAPSED_WIDTH = 44

export interface CollapsedBoardColumnProps {
  readonly status: TaskStatus
  /** The same number the expanded column shows. */
  readonly count: number
  readonly onExpand: () => void
  readonly t: TeamSidebarProps['t']
}

/**
 * A collapsed column: a slim vertical strip that keeps the column's icon, name
 * and count visible, and expands the column on click.
 */
export function CollapsedBoardColumn({ status, count, onExpand, t }: CollapsedBoardColumnProps) {
  return (
    <button
      type="button"
      className={css.collapsedColumn}
      style={{ width: BOARD_COLLAPSED_WIDTH }}
      data-status={status}
      data-testid="board-collapsed-column"
      aria-label={`${t('boardExpandList')} ${t(STATUS_LABEL_KEY[status])}`}
      onClick={onExpand}
    >
      <StatusIcon status={status} size={12} />
      <span className={css.collapsedColumnName}>{t(STATUS_LABEL_KEY[status])}</span>
      <span className={css.collapsedColumnCount}>{count}</span>
    </button>
  )
}
