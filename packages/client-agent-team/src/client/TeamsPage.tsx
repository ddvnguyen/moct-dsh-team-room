/**
 * The Teams page: the Channel view and the Agents list under one destination.
 *
 * Agents used to be a separate tab beside Team even though an Agent is a Team
 * member. The codex sidebar has no tab strip for plugin tabs, so the merge has
 * to happen inside the page the Teams row opens: a small segmented control
 * switches between the Channel view and the Agents list, and the Agents list
 * keeps its own Workspace selector so browsing another Workspace never moves
 * the Channel view.
 */

import { createElement, useState } from 'react'
import type { TeamConversationProps, TeamSidebarProps } from './slots.ts'
import { TeamConversation } from './TeamConversation.tsx'
import { TeamAgentsTab } from './agents-tab-body.tsx'

type TeamsPageProps = TeamConversationProps & Pick<TeamSidebarProps,
  | 'addMember' | 'updateMember' | 'recoverMember' | 'archiveMember'
  | 'joinWorkspace' | 'leaveWorkspace' | 'loadModels' | 'openAgentDetail'>

type TeamsView = 'channels' | 'agents'

export function TeamsPage(props: TeamsPageProps) {
  const [view, setView] = useState<TeamsView>('channels')
  const { t } = props

  const tab = (id: TeamsView, label: string) => createElement(
    'button',
    {
      type: 'button',
      role: 'tab',
      'aria-selected': view === id,
      'data-team-view': id,
      onClick: () => { setView(id) },
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
      'data-team-page': 'teams',
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
    },
    createElement(
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
    ),
    createElement(
      'div',
      { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' } },
      view === 'channels'
        ? createElement(TeamConversation, props)
        : createElement(TeamAgentsTab, props as never),
    ),
  )
}
