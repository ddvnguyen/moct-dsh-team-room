// Derived from multica-x packages/views/issues/components/issue-agent-activity-indicator.tsx and
// packages/views/agents/components/agent-activity-hover-content.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica derives the badge from a workspace task snapshot
// and resolves agents through query hooks. Here the `memberActivity` snapshot
// arrives as props, the roster slice supplies names, and the hover card is the
// dsh `HoverCard` primitive instead of a Radix one.

import { TextShimmer, HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivitySource } from '../multica/types.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { AgentAvatarStack, type AvatarStackMember } from './AgentAvatarStack.tsx'
import { ActorAvatar } from './ActorAvatar.tsx'
import css from './agent-activity-indicator.module.css'

export interface AgentActivityIndicatorProps {
  /** Running Turns in the Workspace, narrowed by the caller. */
  readonly activities: readonly ActivitySource[]
  /** Roster facts for the heads; activities for unknown members are still counted. */
  readonly members: readonly AvatarStackMember[]
  /** Opens the per-Turn card on dwell; off on dense triage surfaces. */
  readonly hoverCard?: boolean
  readonly t: TeamSidebarProps['t']
}

/**
 * "Is an Agent working right now" badge. Running Turns render an avatar stack
 * plus a shimmering label; the current tool and step count ride beside it so
 * the badge answers "on what?" without a click. With no running Turn it
 * renders nothing — no placeholder chrome on a quiet board.
 */
export function AgentActivityIndicator({ activities, members, hoverCard = true, t }: AgentActivityIndicatorProps) {
  if (activities.length === 0) return null
  const byId = new Map(members.map(member => [member.memberId, member]))
  const heads: AvatarStackMember[] = []
  const seen = new Set<string>()
  for (const activity of activities) {
    if (seen.has(activity.memberId)) continue
    seen.add(activity.memberId)
    const member = byId.get(activity.memberId)
    heads.push(member ?? { memberId: activity.memberId, handle: activity.handle })
  }
  // The most recently started Turn speaks for the badge; more than one is said out loud.
  const current = activities.reduce((latest, activity) => activity.turnStartedAt > latest.turnStartedAt ? activity : latest)
  const label = t('activityWorkingShort')

  const badge = (
    <span className={css.badge}>
      <AgentAvatarStack members={heads} size="xs" max={3} t={t} />
      <TextShimmer active className={css.label}>{label}</TextShimmer>
      {current.current !== undefined && <span className={css.tool}>{current.current.label}</span>}
      <span className={css.step}>{t('activityStepCount', { count: String(current.stepCount) })}</span>
      {activities.length > 1 && <span className={css.step}>{t('activityHoverHeader', { count: String(activities.length) })}</span>}
    </span>
  )

  if (!hoverCard) {
    return <span className={`${look.multicaLook} ${css.root}`} role="group" aria-label={label}>{badge}</span>
  }

  return (
    <span className={`${look.multicaLook} ${css.root}`}>
      <HoverCard
        inline
        openDelayMs={900}
        anchor={<span className={css.anchor} tabIndex={0} role="group" aria-label={label}>{badge}</span>}
        content={(
          <div className={`${look.multicaLook} ${css.card}`}>
            <p className={css.cardTitle}>{t('activityHoverHeader', { count: String(activities.length) })}</p>
            <ul className={css.rows}>
              {activities.map(activity => {
                const member = byId.get(activity.memberId)
                return (
                  <li key={`${activity.memberId}:${activity.slot ?? 0}:${activity.turnStartedAt}`} className={css.row}>
                    <ActorAvatar name={member?.handle ?? activity.handle} avatarUrl={member?.avatarUrl} kind="agent" size="sm" />
                    <span className={css.rowHandle}>{member?.handle ?? activity.handle}</span>
                    <span className={css.rowTool}>{activity.current?.label ?? t('activityThinking')}</span>
                    <span className={css.rowMeta}>{t('activityStepCount', { count: String(activity.stepCount) })}</span>
                    <span className={css.rowMeta}>{t('activityToolCount', { count: String(activity.toolCount) })}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      />
    </span>
  )
}
