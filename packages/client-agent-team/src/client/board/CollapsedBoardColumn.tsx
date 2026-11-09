// Derived from multica-x packages/views/issues/components/board-column.tsx @ cbd75011884bd0ee75e9de57d86fbb05c150c421. Copyright Index Labs. Multica License.
//
// Rendering adapted: the strip carries the three facts the expanded column's
// header carries — the glyph, the name and the count. It registers no
// droppable, so a collapsed column is a label, never a drop target. M-51: it
// reads a column model, so a custom list folds and expands like a built-in.

import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import { columnLabel, type BoardColumnModel } from './board-columns.ts'
import css from './board.module.css'

/** Width of one collapsed column: Multica's `BOARD_COLLAPSED_WIDTH`. */
export const BOARD_COLLAPSED_WIDTH = 44

export interface CollapsedBoardColumnProps {
  readonly column: BoardColumnModel
  /** The same number the expanded column shows. */
  readonly count: number
  readonly onExpand: () => void
  readonly t: TeamSidebarProps['t']
}

/**
 * A collapsed column: a slim vertical strip that keeps the column's icon, name
 * and count visible, and expands the column on click.
 */
export function CollapsedBoardColumn({ column, count, onExpand, t }: CollapsedBoardColumnProps) {
  const name = columnLabel(column, t)
  return (
    <button
      type="button"
      className={css.collapsedColumn}
      style={{ width: BOARD_COLLAPSED_WIDTH }}
      data-status={column.key}
      data-column-key={column.key}
      data-testid="board-collapsed-column"
      aria-label={`${t('boardExpandList')} ${name}`}
      onClick={onExpand}
    >
      {column.builtin ? <StatusIcon status={column.key as TaskStatus} size={12} /> : <CustomListGlyph />}
      <span className={css.collapsedColumnName}>{name}</span>
      <span className={css.collapsedColumnCount}>{count}</span>
    </button>
  )
}

/** A custom list's glyph in the strip: the same plain ring the header draws. */
function CustomListGlyph() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} aria-hidden="true">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
