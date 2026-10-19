/**
 * The Teams page: the Team conversation in the main column.
 *
 * The Channels and the Agents are browsed in the sidebar's Teams tab, which
 * carries both sections under one Workspace picker. This page is the
 * conversation those picks open, so it carries no view of its own: the
 * segmented control that used to pick between the Channel view and the Agents
 * list is gone, because an Agent is a Team member and the two are one
 * destination, not two.
 */

import { createElement } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { TeamConversation } from './TeamConversation.tsx'

export function TeamsPage(props: TeamConversationProps) {
  return createElement(
    'div',
    {
      'data-team-page': 'teams',
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
    },
    createElement(TeamConversation, props),
  )
}
