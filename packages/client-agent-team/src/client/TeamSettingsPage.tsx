/**
 * The Team Settings page: the main-column seat of the rail's Team Settings row.
 *
 * It is the home of the Agents config only while the Agents tab is not in the
 * strip; the tab holds the list once it is (the Agents config used to sit in a
 * collapsed group inside the Team tab). The page keeps its own Workspace selector rather
 * than following the Team navigation: the Team tab may be unmounted while this
 * page holds the column, and browsing another Workspace's Agents here must not
 * move the Channel view the tab shows. The selector starts on the Workspace the
 * Team navigation last selected, so the page opens where the reader just was.
 *
 * Below the Agents sits the Team memory section (`TeamMemoryPanel`) for the
 * same Workspace: records, the task picture, the rule feed, usage and settings.
 *
 * The Human's own profile and the judge stay on the host's Settings page (the
 * `team-settings` section); the intro says where.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamSidebarProps } from './slots.ts'
import type { TeamWorkspaceChoice } from './TeamWorkspaceSelector.tsx'
import { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
import type { AgentsTabState } from './agents-tab-state.ts'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamMemoryPanel, type TeamMemoryRemotes } from './TeamMemoryPanel.tsx'
import css from './team-settings.module.css'

/** The host's Workspace list as the page reads it: a snapshot plus a change subscription. */
export interface TeamWorkspaceListSource {
  readonly getSnapshot: () => { readonly items: readonly TeamWorkspaceChoice[] }
  readonly subscribe: (listener: () => void) => () => void
}

export type TeamSettingsPageProps = Pick<TeamSidebarProps,
  'loadMembers' | 'subscribeChanges' | 'addMember' | 'updateMember' | 'recoverMember' | 'archiveMember'
  | 'joinWorkspace' | 'leaveWorkspace' | 'loadModels' | 'openMemberSession' | 'openAgentDetail' | 't'> & {
  readonly workspaceList: TeamWorkspaceListSource
  /** The Workspace the Team navigation last selected; read once, when the page mounts. */
  readonly initialWorkspaceId: () => WorkspaceId | undefined
  /** The Host's Human memory methods; each request names only the Workspace. */
  readonly memory: TeamMemoryRemotes
  /** Whether the Agents tab is in the strip; the Agents list lives there once it is, and here until then. */
  readonly agentsTab: AgentsTabState
}

export function TeamSettingsPage({ workspaceList, initialWorkspaceId, memory, agentsTab, t, ...agents }: TeamSettingsPageProps) {
  const subscribe = useCallback((listener: () => void) => workspaceList.subscribe(listener), [workspaceList])
  const getWorkspaces = useCallback(() => workspaceList.getSnapshot().items, [workspaceList])
  const workspaces = useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces)
  const agentsInTab = useSyncExternalStore(agentsTab.subscribe, agentsTab.getSnapshot, agentsTab.getSnapshot)
  const [chosen, setChosen] = useState<WorkspaceId | undefined>(initialWorkspaceId)
  const selectedId = chosen !== undefined && workspaces.some(workspace => workspace.workspaceId === chosen)
    ? chosen
    : workspaces[0]?.workspaceId

  return <section className={`${css.section} ${css.page}`} aria-label={t('teamSettingsGroup')} data-team-settings-page>
    <h2 className={css.heading}>{t('teamSettingsGroup')}</h2>
    <p className={css.intro}>{t('teamSettingsPageIntro')}</p>
    <p className={css.about}>{t('aboutMulticaAttribution')}</p>
    <TeamWorkspaceSelector workspaces={workspaces} selectedId={selectedId} current={false} onSelect={setChosen} t={t} />
    {!agentsInTab && selectedId !== undefined && <TeamAgentsPanel key={selectedId} workspaceId={selectedId} {...agents} onCreatingChange={() => {}} t={t} />}
    {selectedId !== undefined && <TeamMemoryPanel key={`memory:${selectedId}`} workspaceId={selectedId} memory={memory} loadMembers={agents.loadMembers} t={t} />}
  </section>
}
