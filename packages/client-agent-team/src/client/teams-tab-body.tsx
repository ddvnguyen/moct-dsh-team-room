/**
 * The Teams tab's body: the Channel view and the Agents list in one tab.
 *
 * Agents used to have their own tab beside Team. The two were split for layout
 * reasons, not because they are different destinations — an Agent is a Team
 * member — so this module puts them back together under one Teams tab while
 * keeping both bodies unchanged. Each body still owns its own Workspace
 * selector and its own subscriptions; nothing is copied or reimplemented here.
 */

import { createElement } from 'react'
import type { TeamSidebarProps } from './slots.ts'
import type { NativeTabRenderProps } from './team-tab-body.tsx'
import { renderTeamTabBody } from './team-tab-body.tsx'
import { renderAgentsTabBody } from './agents-tab-body.tsx'

export function renderTeamsTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  return createElement(
    'div',
    {
      'data-team-tab': 'teams',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
      },
    },
    createElement(
      'div',
      { 'data-team-section': 'channels', style: { minHeight: 0, flex: '1 1 auto' } },
      renderTeamTabBody(seat, props),
    ),
    createElement(
      'div',
      { 'data-team-section': 'agents', style: { flex: '0 0 auto' } },
      renderAgentsTabBody(seat, props),
    ),
  )
}
