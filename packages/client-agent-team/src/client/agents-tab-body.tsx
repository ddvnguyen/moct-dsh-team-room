/**
 * The Agents tab's body inside the host's native tab strip.
 *
 * The Agents list moved out of the Team Settings page into this tab. The body
 * keeps its own Workspace selector, like the settings page did, so browsing
 * another Workspace's Agents never moves the Channel view the Team tab shows;
 * it starts on the Workspace the Team navigation last selected. A row opens the
 * Agent's detail (the same `TeamAgentDetail` the row menu opened).
 *
 * The host calls a tab's `render` with its own render props inside the host's
 * React tree, so, as for the Team tab, the Workspace list comes from the host's
 * `useWorkspaces` and the seat's remotes come from the client entry.
 */

import { createElement, useState, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamSidebarProps } from './slots.ts'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
import type { NativeTabRenderProps } from './team-tab-body.tsx'
import css from './sidebar.module.css'

type AgentsTabProps = Pick<TeamSidebarProps,
  'navigation' | 'useWorkspaces' | 'loadMembers' | 'subscribeChanges' | 'addMember' | 'updateMember' | 'recoverMember'
  | 'archiveMember' | 'joinWorkspace' | 'leaveWorkspace' | 'loadModels' | 'loadMemberSessions' | 'resolveThreadRefs' | 'loadChannels' | 'openMemberSession' | 't'>

export function TeamAgentsTab({ navigation, useWorkspaces, t, ...agents }: AgentsTabProps) {
  const workspaces = useWorkspaces(state => state.items)
  // The row of the open Member Session carries the current marker.
  const memberSessionId = useSyncExternalStore(navigation.subscribe, () => navigation.getSnapshot().memberSessionId)
  const [chosen, setChosen] = useState<WorkspaceId | undefined>(() => navigation.getSnapshot().workspaceId)
  const selectedId = chosen !== undefined && workspaces.some(workspace => workspace.workspaceId === chosen)
    ? chosen
    : workspaces[0]?.workspaceId
  return <section className={css.workspaceBrowser} aria-label={t('agents')} data-team-agents-tab>
    <TeamWorkspaceSelector workspaces={workspaces} selectedId={selectedId} current={false} onSelect={setChosen} t={t} />
    {selectedId !== undefined && <TeamAgentsPanel key={selectedId} workspaceId={selectedId} {...agents} {...(memberSessionId === undefined ? {} : { memberSessionId })} onCreatingChange={() => {}} t={t} />}
  </section>
}

/** Build the Agents tab body as an element, with the seat built the way the Team tab's is. */
export function renderAgentsTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // As in the Team tab body: the host's own projections ride along, the seat goes last.
  return createElement(TeamAgentsTab, { ...props, ...seat } as unknown as Parameters<typeof TeamAgentsTab>[0])
}
