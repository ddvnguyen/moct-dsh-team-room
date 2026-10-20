/**
 * Human presentation preference for the Thread lane: how wide it opens beside
 * its Channel. Like `sidebar-sections.ts` it is UI taste kept in this browser
 * only, never a Team fact; a missing or unreadable value falls back to the
 * default, and a failed write is ignored.
 */

const STORAGE_KEY = 'dsh.agent-team.thread-lane-width'

/** Below this seat width the Thread takes the whole seat, as a page of its own. */
export const TWO_LANE_MIN_SEAT_WIDTH = 900
/** The narrowest Thread lane that still fits its header actions and composer. */
export const LANE_MIN_WIDTH = 360
/** The narrowest Channel lane left beside an open Thread. */
export const CHANNEL_MIN_WIDTH = 400
export const LANE_DEFAULT_WIDTH = 520
/** Keyboard resizing moves the split by this much per arrow press. */
export const LANE_KEY_STEP = 24

export function readLaneWidth(): number {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    const width = stored === null ? Number.NaN : Number(stored)
    return Number.isFinite(width) && width > 0 ? width : LANE_DEFAULT_WIDTH
  } catch {
    return LANE_DEFAULT_WIDTH
  }
}

export function persistLaneWidth(width: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(Math.round(width)))
  } catch {
    // A preference that cannot be stored lasts for this page only.
  }
}

/** The lane width the seat can give right now, keeping the Channel lane at its minimum. */
export function clampLaneWidth(width: number, seatWidth: number): number {
  const widest = Math.max(LANE_MIN_WIDTH, seatWidth - CHANNEL_MIN_WIDTH)
  return Math.round(Math.min(Math.max(width, LANE_MIN_WIDTH), widest))
}

export { STORAGE_KEY as LANE_WIDTH_STORAGE_KEY }
