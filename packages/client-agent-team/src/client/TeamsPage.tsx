/**
 * The Teams page: the Channel view and the Agents list under one destination.
 *
 * Agents used to be a separate tab beside Team even though an Agent is a Team
 * member. The codex sidebar has no tab strip for plugin tabs, so the merge has
 * to happen inside the page the Teams row opens: the view switch below picks
 * between the Channel view and the Agents list, and the Agents list keeps its
 * own Workspace selector so browsing another Workspace never moves the Channel
 * view.
 */

import { createElement, useState } from 'react'
import type { TeamConversationProps, TeamSidebarProps } from './slots.ts'
import { TeamConversation } from './TeamConversation.tsx'
import { TeamAgentsTab } from './agents-tab-body.tsx'
import { TeamsViewSwitch } from './TeamsViewSwitch.tsx'

type TeamsPageProps = TeamConversationProps & Pick<TeamSidebarProps,
  'addMember' | 'updateMember' | 'recoverMember' | 'archiveMember'
  | 'joinWorkspace' | 'leaveWorkspace' | 'loadModels' | 'openAgentDetail'>

export function TeamsPage(props: TeamsPageProps) {
  const [view, setView] = useState<'channels' | 'agents'>('channels')
  const { t } = props

  return createElement(
    'div',
    {
      'data-team-page': 'teams',
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
    },
    createElement(TeamsViewSwitch, { view, onSelect: setView, t }),
    createElement(
      'div',
      { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' } },
      view === 'channels'
        ? createElement(TeamConversation, props)
        : createElement(TeamAgentsTab, props as never),
    ),
  )
}
