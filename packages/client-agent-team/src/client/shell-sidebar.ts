/**
 * The shell column's collapse state, observed the only way a main-slot occupant
 * can observe it. The frame (ui-layout's AppFrame) publishes
 * `data-sidebar-collapsed` on its own element — present while the left column is
 * closed, absent while it is open — and hands the `main` seat no owner props at
 * all, so a central panel receives no collapse flag and cannot reach the layout
 * store the frame owns. Reading the published attribute is the contract-clean
 * route: it is derived from that same store (`sidebar === 0`, or the narrow
 * auto-collapse override), so it can never disagree with the column, and it
 * changes exactly when the column does.
 *
 * The shell already owns a reopen control — ui-sidebar's toggle on the collapsed
 * rail, and the window-chrome seat on macOS where the column hides entirely. Both
 * live in the column; a reader whose attention is on the central panel has to
 * leave it to get back. The Channel and Thread headers carry their own control
 * while the column is closed, so the panel is never a dead end. The click goes
 * through the shell's own action (`ctx.layout.toggleSidebar()`), never a local
 * copy of the column's state.
 */
import { useSyncExternalStore } from 'react'

/** Attribute the AppFrame publishes on its own element while the column is closed. */
const COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed'

/**
 * The frame element carrying the published state, or null before the shell
 * mounts one. A subtree-wide attribute filter matches the frame itself, which
 * is the only element that writes it.
 * @returns the frame element, or null.
 */
function frameElement(): Element | null {
  return document.querySelector(`[${COLLAPSED_ATTRIBUTE}]`)
}

/**
 * Whether the shell's left column is closed right now.
 * @returns true while the frame publishes the collapsed attribute.
 */
export function shellSidebarCollapsed(): boolean {
  const frame = frameElement()
  return frame !== null && frame.getAttribute(COLLAPSED_ATTRIBUTE) !== 'false'
}

/**
 * Subscribe to the column's collapse state. Attribute writes are the only
 * signal the frame emits, so this watches the document for them and forwards
 * just the changes that move the published value.
 * @param listener - called whenever the collapse state changes.
 * @returns the unsubscribe function.
 */
export function subscribeShellSidebar(listener: () => void): () => void {
  let previous = shellSidebarCollapsed()
  const observer = new MutationObserver(() => {
    const next = shellSidebarCollapsed()
    if (next === previous) return
    previous = next
    listener()
  })
  observer.observe(document, { attributes: true, attributeFilter: [COLLAPSED_ATTRIBUTE], subtree: true })
  return () => { observer.disconnect() }
}

/**
 * Reactive read of the shell column's collapse state.
 * @returns true while the left column is closed.
 */
export function useShellSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribeShellSidebar, shellSidebarCollapsed, () => false)
}
