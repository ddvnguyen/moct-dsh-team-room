/**
 * The Teams view switch: the Channel view and the Agents list under one
 * destination, chosen by a segmented control.
 *
 * Agents used to be a separate tab beside Team even though an Agent is a Team
 * member. The two surfaces that carry the merged destination — the Team panel
 * the sidebar row opens, and the body of the Team tab in a host's own tab
 * strip — each render this control, so the switch looks and behaves the same
 * in both and the two surfaces cannot drift apart.
 *
 * Only the selected view is mounted by the caller. Mounting both would put two
 * Workspace selectors on one page and would subscribe the Agents panel while
 * the reader is looking at Channels.
 */

import { createElement } from 'react'
import type { TeamSidebarProps } from './slots.ts'

/** The two views one Teams destination carries. */
export type TeamsView = 'channels' | 'agents'

export interface TeamsViewSwitchProps {
  readonly view: TeamsView
  readonly onSelect: (view: TeamsView) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamsViewSwitch({ view, onSelect, t }: TeamsViewSwitchProps) {
  const tab = (id: TeamsView, label: string) => createElement(
    'button',
    {
      type: 'button',
      role: 'tab',
      'aria-selected': view === id,
      'data-team-view': id,
      onClick: () => { onSelect(id) },
      style: {
        appearance: 'none',
        border: 0,
        borderRadius: '6px',
        background: view === id ? 'rgba(128, 128, 128, 0.22)' : 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        cursor: 'pointer',
        padding: '4px 14px',
        opacity: view === id ? 1 : 0.65,
        fontWeight: view === id ? 600 : 400,
      },
    },
    label,
  )

  return createElement(
    'div',
    {
      role: 'tablist',
      'aria-label': t('teams'),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        alignSelf: 'flex-start',
        margin: '10px 12px',
        padding: '3px',
        flex: '0 0 auto',
        borderRadius: '8px',
        background: 'rgba(128, 128, 128, 0.10)',
        border: '1px solid rgba(128, 128, 128, 0.20)',
      },
    },
    tab('channels', t('channels')),
    tab('agents', t('agents')),
  )
}
