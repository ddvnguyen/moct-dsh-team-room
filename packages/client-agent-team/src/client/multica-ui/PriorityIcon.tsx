// Derived from multica-x packages/views/issues/components/priority-icon.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the tone is a CSS Module class instead of a Tailwind
// class pair, and `inheritColor` simply drops the tone class so the glyph
// takes the surrounding text color (used inside priority chips).

import type { TaskPriority } from '../multica/types.ts'
import { PRIORITY_BARS } from '../multica/priority.ts'
import look from '../multica-look.module.css'
import css from './priority-icon.module.css'

const BAR_HEIGHTS = [6, 9, 12] as const

/**
 * Priority glyphs, two families on purpose:
 * - low / medium / high share one three-bar frame (1 / 2 / 3 bars filled,
 *   the rest faint) so severity reads as a fill level at a glance;
 * - urgent breaks out of the scale entirely — a filled badge with an
 *   exclamation mark — because it is an interrupt, not "even higher";
 * - none stays a quiet dash.
 */
export function PriorityIcon({ priority, size = 14, className, inheritColor = false, title }: {
  readonly priority: TaskPriority
  readonly size?: number
  readonly className?: string
  readonly inheritColor?: boolean
  readonly title?: string
}) {
  const classes = [look.multicaLook, css.icon, inheritColor ? undefined : css[priority], className]
    .filter(part => part !== undefined).join(' ')
  const label = title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title }

  if (priority === 'none') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={classes} data-priority={priority} {...label}>
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
    )
  }

  if (priority === 'urgent') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" className={classes} data-priority={priority} {...label}>
        <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" />
        <line x1="8" y1="5" x2="8" y2="8.6" stroke="var(--ml-surface, #fff)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.95" fill="var(--ml-surface, #fff)" />
      </svg>
    )
  }

  const filled = Math.min(PRIORITY_BARS[priority], 3)
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" className={classes} data-priority={priority} {...label}>
      {BAR_HEIGHTS.map((height, index) => (
        <rect key={index} x={2 + index * 4.25} y={14 - height} width="3.5" height={height} rx="1" opacity={index < filled ? 1 : 0.35} />
      ))}
    </svg>
  )
}
