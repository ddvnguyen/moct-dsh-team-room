// Derived from multica-x packages/views/issues/components/hidden-columns-panel.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: no workflow note, no per-status pagination totals. The
// hidden set is a UI preference persisted by the page, keyed by column key —
// the same key a built-in status has, so a preference stored before custom
// lists existed still hides what it always hid. M-51: the rail lists column
// models, so a hidden custom list can be brought back.

import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import { columnLabel, type BoardColumnModel } from './board-columns.ts'
import css from './board.module.css'

/** The "Hidden columns" rail rendered after the last visible column. */
export function HiddenColumnsPanel({ columns, onShow, t }: {
  readonly columns: readonly BoardColumnModel[]
  readonly onShow: (column: BoardColumnModel) => void
  readonly t: TeamSidebarProps['t']
}) {
  return (
    <div className={css.hiddenColumns} data-testid="board-hidden-columns">
      <span className={css.hiddenColumnsTitle}>{t('boardHiddenColumns')}</span>
      {columns.map(column => {
        const name = columnLabel(column, t)
        return (
          <div key={column.key} className={css.hiddenRow}>
            <span className={css.hiddenRowLeft}>
              {column.builtin ? <StatusIcon status={column.key as TaskStatus} size={14} /> : <CustomListGlyph />}
              <span className={css.hiddenRowLabel}>{name}</span>
            </span>
            <button type="button" className={css.hiddenShowButton} aria-label={`${t('boardShowColumn')} ${name}`} onClick={() => onShow(column)}>
              {t('boardShowColumn')}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** A custom list's glyph in the rail: the same plain ring the column draws. */
function CustomListGlyph() {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
