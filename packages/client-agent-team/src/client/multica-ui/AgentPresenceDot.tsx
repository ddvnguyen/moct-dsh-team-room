// Derived from multica-x packages/views/agents/components/agent-presence-indicator.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the detail object arrives as a prop (no query hooks), a
// Skeleton is replaced by a neutral dot while loading, and the two dimensions
// render through `presence.ts` tone keys instead of Tailwind class strings.

import type { AgentPresenceDetail } from '../multica/types.ts'
import type { PresenceTone } from '../multica/presence.ts'
import { AVAILABILITY_LABEL_KEY, availabilityTone, WORKLOAD_LABEL_KEY, workloadTone } from '../multica/presence.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import css from './agent-presence-dot.module.css'

const DOT_TONE: Readonly<Record<PresenceTone, string>> = {
  success: css.dotSuccess!,
  warning: css.dotWarning!,
  muted: css.dotMuted!,
  brand: css.dotBrand!,
}

const TEXT_TONE: Readonly<Record<PresenceTone, string>> = {
  success: css.textSuccess!,
  warning: css.textWarning!,
  muted: css.textMuted!,
  brand: css.textBrand!,
}

/**
 * Availability dot, optionally with the workload chip. The dot's colour reads
 * only from availability: a reachable Agent whose last Turn failed stays
 * green, and workload carries no historical state.
 *
 * `compact` collapses to the dot alone for dense rows.
 */
export function AgentPresenceDot({ detail, compact = false, t }: {
  readonly detail: AgentPresenceDetail | null | undefined
  readonly compact?: boolean
  readonly t: TeamSidebarProps['t']
}) {
  if (detail === null || detail === undefined) {
    return <span className={`${look.multicaLook} ${css.loading}`} data-loading="true" aria-hidden="true" />
  }
  const availability = availabilityTone[detail.availability]
  const workload = workloadTone[detail.workload]
  const availabilityLabel = t(AVAILABILITY_LABEL_KEY[detail.availability])
  const workloadLabel = t(WORKLOAD_LABEL_KEY[detail.workload])
  if (compact) {
    return (
      <span className={`${look.multicaLook} ${css.compact}`} title={`${availabilityLabel} · ${workloadLabel}`}>
        <span className={`${css.dot} ${DOT_TONE[availability]}`} />
        <span className={css.srOnly}>{availabilityLabel}</span>
      </span>
    )
  }
  return (
    <span className={`${look.multicaLook} ${css.presence}`} data-availability={detail.availability} data-workload={detail.workload}>
      <span className={css.availability}>
        <span className={`${css.dot} ${DOT_TONE[availability]}`} />
        <span className={TEXT_TONE[availability]}>{availabilityLabel}</span>
      </span>
      {detail.availability !== 'archived' && (
        <span className={css.workload}>
          <span className={css.separator} aria-hidden="true">·</span>
          <span className={TEXT_TONE[workload]}>{workloadLabel}</span>
          {detail.workload === 'working' && (
            <span className={css.count}>{detail.runningCount} / {detail.capacity}</span>
          )}
          {detail.workload === 'queued' && <span className={css.count}>{detail.queuedCount}</span>}
        </span>
      )}
    </span>
  )
}
