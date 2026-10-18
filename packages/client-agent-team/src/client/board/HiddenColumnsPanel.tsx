// Derived from multica-x packages/views/issues/components/hidden-columns-panel.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: five fixed statuses, no workflow note, no per-status
// pagination totals. The hidden set is a UI preference persisted by the page.

import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import css from './board.module.css'

/** The "Hidden columns" rail rendered after the last visible column. */
export function HiddenColumnsPanel({ hidden, onShow, t }: {
  readonly hidden: readonly TaskStatus[]
  readonly onShow: (status: TaskStatus) => void
  readonly t: TeamSidebarProps['t']
}) {
  return (
    <div className={css.hiddenColumns} data-testid="board-hidden-columns">
      <span className={css.hiddenColumnsTitle}>{t('boardHiddenColumns')}</span>
      {hidden.map(status => (
        <div key={status} className={css.hiddenRow}>
          <span className={css.hiddenRowLeft}>
            <StatusIcon status={status} size={14} />
            <span className={css.hiddenRowLabel}>{t(STATUS_LABEL_KEY[status])}</span>
          </span>
          <button type="button" className={css.hiddenShowButton} onClick={() => onShow(status)}>
            {t('boardShowColumn')}
          </button>
        </div>
      ))}
    </div>
  )
}
