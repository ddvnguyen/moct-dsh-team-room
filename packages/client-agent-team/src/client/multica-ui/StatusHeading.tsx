// Derived from multica-x packages/views/issues/components/status-heading.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: a built-in column's label comes from `locales.ts`; a
// custom list passes its own stored name and draws a neutral ring instead of a
// derived status glyph. The count is plain text next to the name.

import type { TaskStatus } from '../multica/types.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { StatusIcon } from './StatusIcon.tsx'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import css from './status-heading.module.css'

/** One board column header: the glyph (built-ins only), the name and the card count. */
export function StatusHeading({ status, label, count, t }: {
  readonly status?: TaskStatus | undefined
  /** A custom list's stored name; absent draws the localized label of `status`. */
  readonly label?: string | undefined
  readonly count: number
  readonly t: TeamSidebarProps['t']
}) {
  const text = label ?? (status === undefined ? '' : t(STATUS_LABEL_KEY[status]))
  return (
    <div className={`${look.multicaLook} ${css.heading}`} data-status={status}>
      <span className={css.label}>
        {status === undefined ? <CustomListGlyph /> : <StatusIcon status={status} size={12} />}
        {text}
      </span>
      <span className={css.count}>{count}</span>
    </div>
  )
}

/** A custom list's glyph: a plain ring, the same weight as the status glyphs. */
function CustomListGlyph() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12} aria-hidden="true" className={css.customGlyph}>
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
