/**
 * Human presentation preference for the issue panel: how wide the slice opens
 * from the right edge. Like `lane-width.ts` it is UI taste kept in this browser
 * only, never a Team fact; a missing or unreadable value falls back to the
 * default, and a failed write is ignored.
 */

const STORAGE_KEY = 'dsh.agent-team.issue-panel-width'

/** The narrowest panel that still fits the issue's property column. */
export const PANEL_MIN_WIDTH = 360
/** The width the panel opens at until the reader drags it somewhere else. */
export const PANEL_DEFAULT_WIDTH = 520
/** Keyboard resizing moves the panel's edge by this much per arrow press. */
export const PANEL_KEY_STEP = 24
/** The viewport keeps this much room beside the panel, so the face behind stays visible. */
export const PANEL_VIEWPORT_MARGIN = 64

export function readPanelWidth(): number {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    const width = stored === null ? Number.NaN : Number(stored)
    return Number.isFinite(width) && width > 0 ? width : PANEL_DEFAULT_WIDTH
  } catch {
    return PANEL_DEFAULT_WIDTH
  }
}

export function persistPanelWidth(width: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(Math.round(width)))
  } catch {
    // A preference that cannot be stored lasts for this page only.
  }
}

/** The width the viewport can give the panel right now, never below the minimum. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const widest = Math.max(PANEL_MIN_WIDTH, viewportWidth - PANEL_VIEWPORT_MARGIN)
  return Math.round(Math.min(Math.max(width, PANEL_MIN_WIDTH), widest))
}

export { STORAGE_KEY as PANEL_WIDTH_STORAGE_KEY }
