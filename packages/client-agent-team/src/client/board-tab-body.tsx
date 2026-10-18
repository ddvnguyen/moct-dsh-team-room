/**
 * The Board tab's body inside the host's native tab strip.
 *
 * The full board lives in the Team `main` seat (the navigation's `board`
 * face), because the kanban surface wants the whole column. The tab body is
 * the tab strip's own slice: one action that opens the board on the Workspace
 * the Team navigation already holds (or the first one while none is picked).
 * The strip renders inside the host's narrow sidebar, where five 280px columns
 * would only ever scroll, and the workspace switcher stays on the Team and
 * Agents tabs so the strip never shows three copies of it.
 *
 * The host calls a tab's `render` with its own render props inside the host's
 * React tree, so, as for the Agents tab, the Workspace list comes from the
 * host's `useWorkspaces` and the seat's actions come from the client entry.
 */

import { createElement } from 'react'
import type { TeamSidebarProps } from './slots.ts'
import type { NativeTabRenderProps } from './team-tab-body.tsx'
import css from './sidebar.module.css'
import boardCss from './board/board.module.css'

type BoardTabProps = Pick<TeamSidebarProps, 'navigation' | 'useWorkspaces' | 'selectWorkspace' | 'selectBoard' | 't'>

export function TeamBoardTab({ navigation, useWorkspaces, selectWorkspace, selectBoard, t }: BoardTabProps) {
  const workspaces = useWorkspaces(state => state.items)
  const held = navigation.getSnapshot().workspaceId
  const workspaceId = held !== undefined && workspaces.some(workspace => workspace.workspaceId === held)
    ? held
    : workspaces[0]?.workspaceId
  return <section className={css.workspaceBrowser} aria-label={t('boardTab')} data-team-board-tab>
    <button
      type="button"
      className={boardCss.newTaskButton}
      data-testid="board-tab-open"
      {...(workspaceId === undefined ? { disabled: true } : {})}
      onClick={() => {
        if (workspaceId === undefined) return
        selectWorkspace(workspaceId)
        selectBoard()
      }}
    >
      {t('boardOpen')}
    </button>
  </section>
}

/** Build the Board tab body as an element, with the seat built the way the Team tab's is. */
export function renderBoardTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // As in the Team tab body: the host's own projections ride along, the seat goes last.
  return createElement(TeamBoardTab, { ...props, ...seat } as unknown as Parameters<typeof TeamBoardTab>[0])
}
