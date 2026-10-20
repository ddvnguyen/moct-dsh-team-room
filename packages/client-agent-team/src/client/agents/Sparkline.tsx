// Derived from multica-x packages/views/agents/components/sparkline.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica binds Tailwind colour variables and a class name
// from the caller; the Team Room reads its own `--ml-*` tone tokens through a
// CSS Module. Geometry, scaling and the stacked semantics are unchanged.

import type { TokenBucket } from './agent-page-model.ts'
import css from './agent-sparkline.module.css'

interface SparklineProps {
  /**
   * Buckets in display order (oldest → newest). One column per bucket; the
   * column's height is that day's total and its red share is the failed
   * portion, so throughput and failure rate live on one shape.
   */
  readonly buckets: readonly TokenBucket[]
  readonly width: number
  readonly height: number
  readonly label: string
  readonly className?: string
}

const COLUMN_GAP = 1

/**
 * Stacked bar sparkline — completed bottom, failed top. Column height is the
 * day's tokens scaled to the busiest day in this window, so a quiet Agent
 * still reads as its own shape instead of flattening against a noisy one.
 * Zero days keep the baseline only, never a missing cell.
 */
export function Sparkline({ buckets, width, height, label, className }: SparklineProps) {
  const n = buckets.length
  const classes = className === undefined ? css.sparkline : `${css.sparkline} ${className}`
  if (n === 0) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={classes} role="img" aria-label={label} />

  const colWidth = Math.max(1, Math.floor((width - COLUMN_GAP * (n - 1)) / n))
  const usedWidth = colWidth * n + COLUMN_GAP * (n - 1)
  const offsetX = Math.floor((width - usedWidth) / 2)

  let maxTotal = 0
  for (const bucket of buckets) if (bucket.total > maxTotal) maxTotal = bucket.total
  const denominator = Math.max(1, maxTotal)

  // Reserve 1px so columns sit on a floor rather than floating.
  const baselineY = height - 1
  const usableH = height - 1

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={classes} role="img" aria-label={label}>
      <rect x={0} y={baselineY} width={width} height={1} className={css.baseline} />
      {buckets.map((bucket, i) => {
        if (bucket.total === 0) return null
        const x = offsetX + i * (colWidth + COLUMN_GAP)
        const totalH = Math.max(1, Math.round((usableH * bucket.total) / denominator))
        // 1px floor so a single failed token is still visible, clamped by the column.
        const failedH = bucket.failed > 0
          ? Math.min(totalH, Math.max(1, Math.round((usableH * bucket.failed) / denominator)))
          : 0
        const completedH = bucket.completed > 0
          ? Math.min(totalH - failedH, Math.max(1, Math.round((usableH * bucket.completed) / denominator)))
          : 0
        const neutralH = totalH - failedH - completedH
        const colTop = baselineY - totalH
        return (
          <g key={bucket.day} data-day={bucket.day}>
            {completedH > 0 && <rect x={x} y={colTop + failedH + neutralH} width={colWidth} height={completedH} className={css.completed} />}
            {neutralH > 0 && <rect x={x} y={colTop + failedH} width={colWidth} height={neutralH} className={css.neutral} />}
            {failedH > 0 && <rect x={x} y={colTop} width={colWidth} height={failedH} className={css.failed} />}
          </g>
        )
      })}
    </svg>
  )
}
