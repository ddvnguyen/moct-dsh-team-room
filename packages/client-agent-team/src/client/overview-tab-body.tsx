/**
 * The Overview tab's body inside the host's native tab strip (Board 7/10).
 *
 * The body is the workspace Overview page: the live agent strip, needs
 * attention, spend and the workspace event feed, over one Workspace at a time.
 * It keeps its own Workspace selector like the Agents tab does, so browsing
 * another Workspace's overview never moves the Channel view the Team tab
 * shows; it starts on the Workspace the Team navigation last selected. A row's
 * thread link and an agent card navigate through the same navigation actions
 * the other seats use, so the conversation opens in the main column and this
 * tab never mounts `TeamConversation` itself.
 *
 * The host calls a tab's `render` with its own render props inside the host's
 * React tree, so, as for the Team and Agents tabs, the Workspace list comes
 * from the host's `useWorkspaces` and the seat's remotes come from the client
 * entry.
 */

import { createElement, useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamSidebarProps } from './slots.ts'
import { useHumanIdentity } from './human-identity.ts'
import { TeamOverviewPage } from './TeamOverviewPage.tsx'
import { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
import type { NativeTabRenderProps } from './team-tab-body.tsx'
import css from './sidebar.module.css'

type OverviewTabProps = Pick<TeamSidebarProps,
  'navigation' | 'useWorkspaces' | 'humanIdentity' | 'loadWorkspaceActivity' | 'loadMembers' | 'loadMemberActivity' | 'loadDecisions' | 'loadInbox'
  | 'subscribeChanges' | 'selectThread' | 'openMemberSession' | 't'>

export function TeamOverviewTab({ navigation, useWorkspaces, humanIdentity, t, ...overview }: OverviewTabProps) {
  const workspaces = useWorkspaces(state => state.items)
  // The page names the Human in the feed from the one identity projection, the
  // same source the conversation seat reads.
  const identity = useHumanIdentity(humanIdentity)
  const [chosen, setChosen] = useState<WorkspaceId | undefined>(() => navigation.getSnapshot().workspaceId)
  const selectedId = chosen !== undefined && workspaces.some(workspace => workspace.workspaceId === chosen)
    ? chosen
    : workspaces[0]?.workspaceId
  return <section className={css.workspaceBrowser} aria-label={t('overview')} data-team-overview-tab>
    <TeamWorkspaceSelector workspaces={workspaces} selectedId={selectedId} current={false} onSelect={setChosen} t={t} />
    {selectedId !== undefined && <TeamOverviewPage key={selectedId} workspaceId={selectedId} {...overview}
      humanName={identity.name ?? t('human')}
      {...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl })}
      t={t} />}
  </section>
}

/** Build the Overview tab body as an element, with the seat built the way the Team tab's is. */
export function renderOverviewTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // As in the Team tab body: the host's own projections ride along, the seat goes last.
  return createElement(TeamOverviewTab, { ...props, ...seat } as unknown as Parameters<typeof TeamOverviewTab>[0])
}
