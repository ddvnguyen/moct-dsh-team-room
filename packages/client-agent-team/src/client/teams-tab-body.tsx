/**
 * The Teams tab's body: the Channel view and the Agents list in one tab,
 * switched by the shared view switch.
 *
 * Agents used to have their own tab beside Team. The two were split for layout
 * reasons, not because they are different destinations — an Agent is a Team
 * member — so this module puts them back together under one Teams tab while
 * keeping both bodies unchanged. Each body still owns its own Workspace
 * selector and its own subscriptions; nothing is copied or reimplemented here.
 *
 * Only the selected body is mounted. Rendering both at once would put two
 * Workspace selectors on one page and subscribe the Agents panel even while
 * the reader is looking at Channels.
 */

import { createElement, useState } from 'react'
import type { TeamSidebarProps } from './slots.ts'
import type { NativeTabRenderProps } from './team-tab-body.tsx'
import { renderTeamTabBody } from './team-tab-body.tsx'
import { renderAgentsTabBody } from './agents-tab-body.tsx'
import { TeamsViewSwitch } from './TeamsViewSwitch.tsx'

/**
 * The strip calls a tab's `render` raw inside its own tree, so the merged share
 * is passed as element props: the component below owns only the view switch,
 * never the bodies' data.
 */
type TeamsTabProps = TeamSidebarProps & NativeTabRenderProps

export function TeamsTab(props: TeamsTabProps): ReturnType<typeof createElement> {
  const [view, setView] = useState<'channels' | 'agents'>('channels')
  const { t } = props

  return createElement(
    'div',
    {
      'data-team-tab': 'teams',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
      },
    },
    createElement(TeamsViewSwitch, { view, onSelect: setView, t }),
    view === 'channels'
      ? createElement(
        'div',
        { 'data-team-section': 'channels', style: { minHeight: 0, flex: '1 1 auto', display: 'flex' } },
        renderTeamTabBody(props, props),
      )
      : createElement(
        'div',
        { 'data-team-section': 'agents', style: { minHeight: 0, flex: '1 1 auto', display: 'flex' } },
        renderAgentsTabBody(props, props),
      ),
  )
}

export function renderTeamsTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // The share the Channel view is built from. `channelsOnly` says the browser
  // shows the Channel list without the Agents group beside it: the Agents list
  // is its own view of this tab, so the browser must not draw a second one.
  const share = { ...props, ...seat, channelsOnly: true } as unknown as TeamsTabProps
  return createElement(TeamsTab, share)
}
