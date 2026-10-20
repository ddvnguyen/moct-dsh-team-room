/**
 * The Board panel's body: the Team seat showing the Board face.
 *
 * The Board is a whole-page destination: the kanban surface wants the whole
 * main column, not the narrow strip the sidebar's tab row offers. It is
 * therefore a *panel* — a row in the sidebar's main list, like Team Settings
 * and Context Insights — and this body is the page behind that row.
 *
 * The page itself is the Team seat's `board` face (`TeamConversation` renders
 * it when the navigation says so), so the Board keeps one owner: this panel
 * selects the face on mount, and every Board interaction — a card pick, a
 * column drag — rides the same navigation the Team conversation uses.
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamConversationProps } from './slots.ts'
import { TeamConversation } from './TeamConversation.tsx'

type BoardPanelProps = TeamConversationProps & {
  /** The raw navigation action: it sets the Board face without touching the panel selection. */
  readonly selectBoard: () => void
  readonly selectWorkspace: (workspaceId: WorkspaceId) => void
}

export function TeamBoardPanel(props: BoardPanelProps) {
  const { navigation, useWorkspaces, selectWorkspace, selectBoard, t } = props
  const workspaces = useWorkspaces(state => state.items)
  const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const held = snapshot.workspaceId
  // The Board reads the Workspace's whole catalog, so it needs a selected
  // Workspace. The held one wins; otherwise the browser adopts the first it
  // can see, the same adoption the tab's launcher did.
  const workspaceId = held !== undefined && workspaces.some(workspace => workspace.workspaceId === held)
    ? held
    : workspaces[0]?.workspaceId

  useEffect(() => {
    if (workspaceId === undefined) return
    if (held !== workspaceId) selectWorkspace(workspaceId)
    selectBoard()
  }, [held, selectBoard, selectWorkspace, workspaceId])

  return <TeamConversation {...props} t={t} />
}
