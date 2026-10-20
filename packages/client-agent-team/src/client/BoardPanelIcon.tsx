/**
 * The Board entry's glyph in the sidebar's main list: three columns of a
 * kanban board, drawn in the shipped icon language (16px grid, 1px stroke,
 * `currentColor`) rather than borrowing a shipped glyph that means something
 * else. The sidebar owns the button, the label, and the selected state around
 * it.
 */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Board mark at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function BoardPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1}>
      <rect x="2" y="2.5" width="3.2" height="11" rx="1" stroke="currentColor" />
      <rect x="6.4" y="2.5" width="3.2" height="7.5" rx="1" stroke="currentColor" />
      <rect x="10.8" y="2.5" width="3.2" height="9.5" rx="1" stroke="currentColor" />
    </svg>
  )
}
