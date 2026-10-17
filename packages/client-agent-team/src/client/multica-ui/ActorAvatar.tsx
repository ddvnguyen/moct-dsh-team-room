// Derived from multica-x packages/views/common/actor-avatar.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad and packages/ui/components/common/actor-avatar.tsx. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's wrapper resolves the actor through workspace
// hooks, hover cards and profile navigation. Here the avatar is pure
// presentation — name, optional image URL and kind come from props — because
// the Team Client never reaches into `ctx` from a component and the roster
// already holds the facts.

import type { CSSProperties } from 'react'
import { AVATAR_SIZE_PX, DEFAULT_AVATAR_SIZE, type AvatarSize } from './avatar-size.ts'
import look from '../multica-look.module.css'
import css from './actor-avatar.module.css'

export interface ActorAvatarProps {
  readonly name: string
  /** Resolved image URL; absent falls back to initials (human) or a bot glyph (agent). */
  readonly avatarUrl?: string | null | undefined
  readonly kind: 'agent' | 'human'
  readonly size?: AvatarSize
  readonly className?: string
}

/** First grapheme of the handle, uppercased — Multica's initials fallback. */
function initialsOf(name: string): string {
  return name.replace(/^@/, '').trim().slice(0, 1).toUpperCase()
}

function BotGlyph({ px }: { readonly px: number }) {
  return (
    <svg viewBox="0 0 16 16" width={px * 0.55} height={px * 0.55} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5.5" width="10" height="7.5" rx="2.5" />
      <path d="M8 5.5V3.2M6.2 8.7h.01M9.8 8.7h.01M6.5 11h3" />
    </svg>
  )
}

/**
 * One actor as a circle: image, else a bot glyph for an Agent, else the
 * handle's initial. Every actor renders as a circle — the shape is a hard
 * invariant, not a per-call choice.
 */
export function ActorAvatar({ name, avatarUrl, kind, size = DEFAULT_AVATAR_SIZE, className }: ActorAvatarProps) {
  const px = AVATAR_SIZE_PX[size]
  const style: CSSProperties = { width: px, height: px, fontSize: px * 0.45 }
  return (
    <span
      className={[look.multicaLook, css.avatar, className].filter(part => part !== undefined).join(' ')}
      style={style}
      role="img"
      aria-label={name}
      data-kind={kind}
    >
      {avatarUrl != null && avatarUrl !== ''
        ? <img className={css.image} src={avatarUrl} alt={name} />
        : kind === 'agent' ? <BotGlyph px={px} /> : <span aria-hidden="true">{initialsOf(name)}</span>}
    </span>
  )
}
