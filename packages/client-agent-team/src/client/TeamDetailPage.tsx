/**
 * The Team Detail page: the main-column seat of the side menu's Team Detail row.
 *
 * One page holds the team surfaces that used to sit apart: the workspace
 * Overview ("what is going on now and today"), the Agents roster, the Team
 * memory and the team's own settings. A sub-nav switches between them, the way
 * Multica's own detail pages switch their sections, and the Workspace scope
 * above the nav is the one scope every section reads.
 *
 * The page keeps its own Workspace state rather than following the Team
 * navigation: the Team tab may be unmounted while this page holds the column,
 * and browsing another Workspace's Agents here must not move the Channel view
 * the tab shows. The scope starts on the Workspace the Team navigation last
 * selected, so the page opens where the reader just was.
 *
 * The Human's own profile and the judge stay on the host's Settings → Team
 * section; the Settings section here is the team's own configuration and says
 * where the rest lives.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamSidebarProps } from './slots.ts'
import type { TeamWorkspaceChoice } from './TeamWorkspaceSelector.tsx'
import { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
import { useHumanIdentity } from './human-identity.ts'
import { TeamOverviewPage } from './TeamOverviewPage.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamMemoryPanel, type TeamMemoryRemotes } from './TeamMemoryPanel.tsx'
import type { TeamKey } from './locales.ts'
import css from './team-detail.module.css'

/** The host's Workspace list as the page reads it: a snapshot plus a change subscription. */
export interface TeamWorkspaceListSource {
  readonly getSnapshot: () => { readonly items: readonly TeamWorkspaceChoice[] }
  readonly subscribe: (listener: () => void) => () => void
}

/** The four sections the page's sub-nav switches between. */
export type TeamDetailSection = 'overview' | 'agents' | 'memory' | 'settings'

/** The nav's sections, in reading order, with the label each one carries. */
const SECTIONS: readonly { readonly id: TeamDetailSection; readonly labelKey: TeamKey }[] = [
  { id: 'overview', labelKey: 'overview' },
  { id: 'agents', labelKey: 'agents' },
  { id: 'memory', labelKey: 'memorySection' },
  { id: 'settings', labelKey: 'teamDetailSectionSettings' },
]

export type TeamDetailPageProps = Pick<TeamSidebarProps,
  'loadMembers' | 'subscribeChanges' | 'addMember' | 'updateMember' | 'recoverMember' | 'archiveMember'
  | 'joinWorkspace' | 'leaveWorkspace' | 'loadModels' | 'openMemberSession' | 'openAgentDetail'
  // The roster row's live facts, as in the Agents tab.
  | 'loadMemberActivity' | 'loadBoard' | 'loadMemberSessions'
  // The Overview page's reads, the same ones the removed Overview tab carried.
  | 'loadWorkspaceActivity' | 'loadMemberActivity' | 'loadDecisions' | 'loadInbox' | 'selectThread'
  | 'humanIdentity' | 't'> & {
  readonly workspaceList: TeamWorkspaceListSource
  /** The Workspace the Team navigation last selected; read once, when the page mounts. */
  readonly initialWorkspaceId: () => WorkspaceId | undefined
  /** The Host's Human memory methods; each request names only the Workspace. */
  readonly memory: TeamMemoryRemotes
}

export function TeamDetailPage({ workspaceList, initialWorkspaceId, memory, t, ...team }: TeamDetailPageProps) {
  const subscribe = useCallback((listener: () => void) => workspaceList.subscribe(listener), [workspaceList])
  const getWorkspaces = useCallback(() => workspaceList.getSnapshot().items, [workspaceList])
  const workspaces = useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces)
  const [chosen, setChosen] = useState<WorkspaceId | undefined>(initialWorkspaceId)
  const selectedId = chosen !== undefined && workspaces.some(workspace => workspace.workspaceId === chosen)
    ? chosen
    : workspaces[0]?.workspaceId
  // The Overview names the Human in its feed, from the one identity projection
  // the conversation seat reads.
  const identity = useHumanIdentity(team.humanIdentity)
  const [section, setSection] = useState<TeamDetailSection>('overview')

  return <section className={`${css.section} ${css.page}`} aria-label={t('teamDetail')} data-team-detail-page>
    <header className={css.header}>
      <h2 className={css.heading}>{t('teamDetail')}</h2>
      <p className={css.intro}>{t('teamDetailPageIntro')}</p>
    </header>
    <TeamWorkspaceSelector workspaces={workspaces} selectedId={selectedId} current={false} onSelect={setChosen} t={t} />
    <div className={css.nav} role="tablist" aria-label={t('teamDetailSections')}>
      {SECTIONS.map(entry => <button
        key={entry.id}
        type="button"
        role="tab"
        id={`team-detail-tab-${entry.id}`}
        aria-selected={section === entry.id}
        aria-controls={`team-detail-panel-${entry.id}`}
        tabIndex={section === entry.id ? 0 : -1}
        className={css.navTab}
        onClick={() => setSection(entry.id)}>{t(entry.labelKey)}</button>)}
    </div>
    <div
      className={css.body}
      role="tabpanel"
      id={`team-detail-panel-${section}`}
      aria-labelledby={`team-detail-tab-${section}`}
      data-team-detail-section={section}>
      {section === 'overview' && selectedId !== undefined && <TeamOverviewPage
        key={selectedId}
        workspaceId={selectedId}
        loadWorkspaceActivity={team.loadWorkspaceActivity}
        loadMembers={team.loadMembers}
        loadMemberActivity={team.loadMemberActivity}
        loadDecisions={team.loadDecisions}
        loadInbox={team.loadInbox}
        subscribeChanges={team.subscribeChanges}
        selectThread={team.selectThread}
        openMemberSession={team.openMemberSession}
        humanName={identity.name ?? t('human')}
        {...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl })}
        t={t} />}
      {section === 'agents' && selectedId !== undefined && <TeamAgentsPanel
        key={selectedId}
        workspaceId={selectedId}
        loadMembers={team.loadMembers}
        subscribeChanges={team.subscribeChanges}
        addMember={team.addMember}
        updateMember={team.updateMember}
        recoverMember={team.recoverMember}
        archiveMember={team.archiveMember}
        joinWorkspace={team.joinWorkspace}
        leaveWorkspace={team.leaveWorkspace}
        loadModels={team.loadModels}
        loadMemberActivity={team.loadMemberActivity}
        loadBoard={team.loadBoard}
        loadMemberSessions={team.loadMemberSessions}
        openMemberSession={team.openMemberSession}
        openAgentDetail={team.openAgentDetail}
        onCreatingChange={() => {}}
        t={t} />}
      {section === 'memory' && selectedId !== undefined && <TeamMemoryPanel
        key={`memory:${selectedId}`}
        workspaceId={selectedId}
        memory={memory}
        loadMembers={team.loadMembers}
        t={t} />}
      {section === 'settings' && <div className={css.settings}>
        <p className={css.settingsIntro}>{t('teamDetailSettingsIntro')}</p>
        <p className={css.about}>{t('aboutMulticaAttribution')}</p>
      </div>}
    </div>
  </section>
}
