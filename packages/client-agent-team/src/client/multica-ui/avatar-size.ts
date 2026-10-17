// Derived from multica-x packages/ui/lib/avatar-size.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Semantic avatar tiers, so a chip, a list row and a page header render the
// same person at one consistent size instead of three ad-hoc pixels.

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

/** Pixel diameter for each semantic avatar size. */
export const AVATAR_SIZE_PX: Readonly<Record<AvatarSize, number>> = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 40,
  '2xl': 56,
}

export const DEFAULT_AVATAR_SIZE: AvatarSize = 'sm'
