// Derived from multica-x packages/views/agents/components/agent-avatar-stack.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica resolves each id through workspace hooks. Here
// the caller passes the roster slice it already holds, so the stack stays a
// pure projection of props and renders identically in tests.

import type { AvatarSize } from './avatar-size.ts'
import { AVATAR_SIZE_PX } from './avatar-size.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { ActorAvatar } from './ActorAvatar.tsx'
import css from './agent-avatar-stack.module.css'

/** The roster facts one stack head needs. */
export interface AvatarStackMember {
  readonly memberId: string
  readonly handle: string
  readonly avatarUrl?: string | null | undefined
}

/**
 * Overlapping avatar group. The component does not dedupe — callers pass a
 * unique list — and drops the tail into a `+N` chip past `max` heads.
 */
export function AgentAvatarStack({ members, size = 'sm', max = 3, t }: {
  readonly members: readonly AvatarStackMember[]
  readonly size?: AvatarSize
  readonly max?: number
  readonly t: TeamSidebarProps['t']
}) {
  if (members.length === 0) return null
  const visible = members.slice(0, max)
  const overflow = members.length - visible.length
  const px = AVATAR_SIZE_PX[size]
  // 30% overlap reads as "stacked" without obscuring the next head's glyph.
  const overlap = Math.round(px * 0.3)
  return (
    <span className={`${look.multicaLook} ${css.stack}`} data-size={size}>
      {visible.map((member, index) => (
        <span key={member.memberId} className={css.head} style={{ marginLeft: index === 0 ? 0 : -overlap }}>
          <ActorAvatar name={member.handle} avatarUrl={member.avatarUrl} kind="agent" size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={css.overflow}
          style={{ marginLeft: -overlap, width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.45)) }}
          aria-label={t('avatarStackOverflow', { count: String(overflow) })}
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}
