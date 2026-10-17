// Derived from multica-x packages/views/issues/components/progress-ring.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the complete tone is a CSS Module class on `--ml-*`
// instead of a Tailwind text color.

import look from '../multica-look.module.css'
import css from './progress-ring.module.css'

/**
 * Tiny circular progress ring. Renders an open ring when in progress and a
 * full ring once `done` reaches `total`. Decorative: the caller states the
 * numbers in text when they matter.
 */
export function ProgressRing({ done, total, size = 12, className }: {
  readonly done: number
  readonly total: number
  readonly size?: number
  readonly className?: string
}) {
  const stroke = 1.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.min(done / total, 1) : 0
  const offset = circumference * (1 - ratio)
  const complete = total > 0 && done >= total
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={[look.multicaLook, css.ring, complete ? css.complete : undefined, className].filter(part => part !== undefined).join(' ')}
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
