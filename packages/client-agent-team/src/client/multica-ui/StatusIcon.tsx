// Derived from multica-x packages/views/issues/components/status-icon.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica resolves custom statuses, colors and icon
// overrides from a workspace catalog. The Team ledger derives exactly five
// statuses, so the glyph is chosen from the status alone and the tone comes
// from a CSS Module class on the scoped `--ml-*` layer.

import type { TaskStatus } from '../multica/types.ts'
import look from '../multica-look.module.css'
import css from './status-icon.module.css'

const CX = 7
const CY = 7
const OUTER_R = 6
const FILL_R = 3.5

/** Build a pie wedge from 12 o'clock, clockwise. */
function piePath(cx: number, cy: number, r: number, progress: number): string {
  const angle = 2 * Math.PI * progress
  const endX = cx + r * Math.sin(angle)
  const endY = cy - r * Math.cos(angle)
  const largeArc = progress > 0.5 ? 1 : 0
  return `M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${largeArc},1 ${endX},${endY} Z`
}

function ProgressCircle({ progress, children }: { readonly progress: number; readonly children?: React.ReactNode }) {
  return (
    <>
      <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3.14 0" strokeDashoffset={-0.7} />
      {progress === 1
        ? <circle cx={CX} cy={CY} r={OUTER_R} fill="currentColor" />
        : progress > 0 ? <path d={piePath(CX, CY, FILL_R, progress)} fill="currentColor" /> : null}
      {children}
    </>
  )
}

function TodoIcon() {
  return <ProgressCircle progress={0} />
}

function InProgressIcon() {
  return <ProgressCircle progress={0.5} />
}

function InReviewIcon() {
  return <ProgressCircle progress={0.75} />
}

function DoneIcon() {
  return (
    <ProgressCircle progress={1}>
      <path
        d="M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z"
        fill="white"
        stroke="none"
      />
    </ProgressCircle>
  )
}

/** Closed is a cross inside the empty ring, Multica's cancelled geometry. */
function ClosedIcon() {
  return (
    <ProgressCircle progress={0}>
      <path d="M5 5 L9 9 M9 5 L5 9" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </ProgressCircle>
  )
}

const RENDERERS: Readonly<Record<TaskStatus, () => React.ReactNode>> = {
  todo: TodoIcon,
  in_progress: InProgressIcon,
  in_review: InReviewIcon,
  done: DoneIcon,
  closed: ClosedIcon,
}

const TONE: Readonly<Record<TaskStatus, string>> = {
  todo: css.todo!,
  in_progress: css.inProgress!,
  in_review: css.inReview!,
  done: css.done!,
  closed: css.closed!,
}

/**
 * One status glyph: a dashed ring plus a pie fill for progress, a check for
 * done and a cross for closed. Decorative by default — the caller supplies the
 * accessible name through its own label, so the glyph never repeats it.
 */
export function StatusIcon({ status, size = 14, className, title }: {
  readonly status: TaskStatus
  readonly size?: number
  readonly className?: string
  readonly title?: string
}) {
  const Renderer = RENDERERS[status]
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      fill="none"
      className={[look.multicaLook, css.icon, TONE[status], className].filter(part => part !== undefined).join(' ')}
      data-status={status}
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <Renderer />
    </svg>
  )
}
