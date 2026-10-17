// Derived from multica-x packages/views/issues/components/status-heading.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the label comes from `locales.ts` instead of a workspace
// status catalog hook, and the count is plain text next to it.

import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { StatusIcon } from './StatusIcon.tsx'
import css from './status-heading.module.css'

/** One board column header: status glyph, localized label and card count. */
export function StatusHeading({ status, count, t }: {
  readonly status: TaskStatus
  readonly count: number
  readonly t: TeamSidebarProps['t']
}) {
  return (
    <div className={`${look.multicaLook} ${css.heading}`} data-status={status}>
      <span className={css.label}>
        <StatusIcon status={status} size={12} />
        {t(STATUS_LABEL_KEY[status])}
      </span>
      <span className={css.count}>{count}</span>
    </div>
  )
}
