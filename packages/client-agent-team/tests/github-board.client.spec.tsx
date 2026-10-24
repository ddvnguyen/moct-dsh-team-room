// @vitest-environment jsdom
//
// The GitHub board source: GitHub Issues are the cards, the project's Status
// options are the columns, and every write goes to GitHub before anything
// moves. The panel is the communication face — an issue's whole conversation
// plus the composer that posts one comment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentTeamGitHubBoard, AgentTeamGitHubIssue, AgentTeamGitHubIssueSummary } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamBoardPage } from '../src/client/board/TeamBoardPage.tsx'
import { TeamNavigation } from '../src/client/navigation.ts'

// jsdom has no layout, so dnd-kit's sensors cannot resolve a drop. The double
// records the board's handlers and renders the children directly; the spec
// fires a drag end with the same shape the real event carries.
interface DragEventLike {
  readonly active: { readonly id: string; readonly data?: { readonly current?: unknown } }
  readonly over: { readonly id: string } | null
}
let onDragEnd: ((event: DragEventLike) => void) | undefined
vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: { children: unknown; onDragEnd: (event: DragEventLike) => void }) => {
    onDragEnd = props.onDragEnd
    return props.children
  },
  DragOverlay: (props: { children?: unknown }) => (props.children ?? null) as never,
  PointerSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  KeyboardSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false, transform: null }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  closestCenter: vi.fn(),
  pointerWithin: vi.fn(),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: { children: unknown }) => props.children,
  verticalListSortingStrategy: {},
  sortableKeyboardCoordinates: () => undefined,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(cleanup)

const t = ((key: string) => key) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })

const COLUMNS = [
  { id: 'opt_todo', name: 'Todo', kind: 'project-status' as const, droppable: true },
  { id: 'opt_done', name: 'Done', kind: 'project-status' as const, droppable: true },
  { id: 'no-status', name: 'No status', kind: 'project-status' as const, droppable: false },
]

const issue = (number: number, columnId: string, extra: Partial<AgentTeamGitHubIssueSummary> = {}): AgentTeamGitHubIssueSummary => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  author: 'ada',
  assignees: ['lin'],
  labels: [{ name: 'bug', color: 'd73a4a' }],
  commentCount: 1,
  updatedAt: '2026-10-20T10:00:00Z',
  url: `https://github.test/octo/demo/issues/${number}`,
  columnId,
  ...extra,
})

const boardFixture = (issues: readonly AgentTeamGitHubIssueSummary[] = [issue(3, 'opt_todo'), issue(4, 'opt_done')]): AgentTeamGitHubBoard => ({
  repo: 'octo/demo',
  projectNumber: 7,
  columns: COLUMNS,
  issues,
  labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }],
  people: ['ada', 'lin', 'grace'],
  fetchedAt: '2026-10-24T00:00:00Z',
  truncated: false,
})

const detailFixture = (overrides: Partial<AgentTeamGitHubIssue> = {}): AgentTeamGitHubIssue => ({
  ...issue(3, 'opt_todo'),
  body: 'The whole description',
  comments: [{ id: '91', author: 'ada', body: 'First thought', createdAt: '2026-10-19T09:00:00Z', url: 'u1' }],
  truncatedComments: false,
  ...overrides,
})

interface MountOptions {
  readonly status?: { readonly configured: boolean; readonly repo?: string; readonly reason?: 'missing-repo' | 'missing-token' }
  readonly boards?: readonly AgentTeamGitHubBoard[]
  readonly details?: readonly AgentTeamGitHubIssue[]
  readonly updateRule?: (request: { readonly number: number; readonly status?: string, readonly labels?: readonly string[], readonly assignees?: readonly string[] }) => unknown
}

function mount(options: MountOptions = {}) {
  const boards = [...(options.boards ?? [boardFixture()])]
  const details = [...(options.details ?? [detailFixture()])]
  const loadGitHubStatus = vi.fn(async () => ok(options.status ?? { configured: true, repo: 'octo/demo', projectNumber: 7 }))
  const loadGitHubBoard = vi.fn(async () => ok(boards.length > 1 ? boards.shift()! : boards[0]!))
  const loadGitHubIssue = vi.fn(async () => ok(details.length > 1 ? details.shift()! : details[0]!))
  const createGitHubIssue = vi.fn(async () => ok(issue(9, 'opt_todo')))
  const updateGitHubIssue = vi.fn(async (request: { number: number; status?: string; labels?: readonly string[]; assignees?: readonly string[] }) => {
    if (options.updateRule !== undefined) return options.updateRule(request) as never
    return ok(issue(request.number, request.status ?? 'opt_todo')) as never
  })
  const commentGitHubIssue = vi.fn(async () => ok({ id: '101', author: 'ada', body: 'Ship it', createdAt: '2026-10-24T01:00:00Z', url: 'u' }))
  const navigation = new TeamNavigation()
  render(
    <TeamBoardPage
      workspaceId={'w1' as never}
      loadBoard={vi.fn(async () => ok({ channels: [], tasks: [], taskNumbers: [], threads: [], claims: [], decisions: [], docs: [] })) as never}
      loadMembers={vi.fn(async () => ok([])) as never}
      loadMemberActivity={vi.fn(async () => ok({ revision: 0, activities: [] })) as never}
      loadGitHubStatus={loadGitHubStatus as never}
      loadGitHubBoard={loadGitHubBoard as never}
      loadGitHubIssue={loadGitHubIssue as never}
      createGitHubIssue={createGitHubIssue as never}
      updateGitHubIssue={updateGitHubIssue as never}
      commentGitHubIssue={commentGitHubIssue as never}
      createTask={vi.fn() as never}
      updateTask={vi.fn() as never}
      changeTask={vi.fn() as never}
      subscribeChanges={(() => () => {}) as never}
      openIssue={vi.fn() as never}
      navigation={navigation as never}
      t={t}
    />,
  )
  return { loadGitHubStatus, loadGitHubBoard, loadGitHubIssue, createGitHubIssue, updateGitHubIssue, commentGitHubIssue }
}

/** Switches the board onto its GitHub source and waits for the first read. */
async function openGitHubSource(): Promise<void> {
  fireEvent.click(await screen.findByTestId('board-source-github'))
}

const columnText = (id: string): string =>
  document.querySelector<HTMLElement>(`[data-github-column="${id}"]`)?.textContent ?? ''

describe('the GitHub board source', () => {
  it('keeps the task board until the reader switches, then draws the project columns', async () => {
    const m = mount()
    await waitFor(() => expect(m.loadGitHubStatus).toHaveBeenCalled())
    expect(document.querySelector('[data-github-board]')).toBeNull()
    await openGitHubSource()
    await waitFor(() => expect(document.querySelector('[data-github-board]')).not.toBeNull())
    expect(columnText('opt_todo')).toContain('Todo')
    expect(columnText('opt_todo')).toContain('Issue 3')
    expect(columnText('opt_done')).toContain('Issue 4')
    expect(columnText('no-status')).toContain('No status')
    expect(m.loadGitHubBoard).toHaveBeenCalledWith({ workspaceId: 'w1' })
  })

  it('answers an unbound deployment with setup, not an empty board', async () => {
    const m = mount({ status: { configured: false, repo: 'octo/demo', reason: 'missing-token' } })
    await openGitHubSource()
    await waitFor(() => expect(document.querySelector('[data-github-setup]')).not.toBeNull())
    const text = document.querySelector('[data-github-setup]')?.textContent ?? ''
    expect(text).toContain('DSH_AGENT_TEAM_GITHUB_REPO')
    expect(text).toContain('DSH_AGENT_TEAM_GITHUB_TOKEN')
    expect(text).toContain('githubSetupMissingToken')
    expect(m.loadGitHubBoard).not.toHaveBeenCalled()
  })

  it('opens an issue over the board and posts the comment to GitHub', async () => {
    const moved = detailFixture({
      commentCount: 2,
      comments: [
        { id: '91', author: 'ada', body: 'First thought', createdAt: '2026-10-19T09:00:00Z', url: 'u1' },
        { id: '101', author: 'ada', body: 'Ship it', createdAt: '2026-10-24T01:00:00Z', url: 'u' },
      ],
    })
    const m = mount({ details: [detailFixture(), moved] })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-issue-panel="3"]')).not.toBeNull())
    expect(document.querySelector('[data-github-issue-body]')?.textContent).toBe('The whole description')
    expect(document.querySelector('[data-github-comment="91"]')?.textContent).toContain('First thought')
    const input = document.querySelector<HTMLTextAreaElement>('[data-github-issue-panel="3"] textarea')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { value: 'Ship it' } })
    fireEvent.click(screen.getByText('githubCommentSubmit'))
    await waitFor(() => expect(m.commentGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, body: 'Ship it' }))
    // The panel re-reads after the write: the comment on screen is GitHub's,
    // not the draft the reader typed.
    await waitFor(() => expect(document.querySelector('[data-github-comment="101"]')).not.toBeNull())
    expect(m.loadGitHubIssue).toHaveBeenCalledTimes(2)
  })

  it('writes a drop as a project status and moves the card only after the re-read', async () => {
    const movedBoard = boardFixture([issue(3, 'opt_done'), issue(4, 'opt_done')])
    const m = mount({ boards: [boardFixture(), movedBoard] })
    await openGitHubSource()
    await waitFor(() => expect(document.querySelector('[data-github-card="3"]')).not.toBeNull())
    expect(columnText('opt_todo')).toContain('Issue 3')
    const dragged = issue(3, 'opt_todo')
    act(() => {
      onDragEnd?.({ active: { id: 'issue:3', data: { current: { issue: dragged } } }, over: { id: 'opt_done' } })
    })
    await waitFor(() => expect(m.updateGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, status: 'opt_done' }))
    await waitFor(() => expect(columnText('opt_done')).toContain('Issue 3'))
    expect(columnText('opt_todo')).not.toContain('Issue 3')
  })

  it('adds a label on GitHub and paints it only when the re-read brings it back', async () => {
    const after = detailFixture({ labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }] })
    const m = mount({ details: [detailFixture(), after] })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-add-label]')).not.toBeNull())
    expect(document.querySelector('[data-label="enhancement"]')).toBeNull()
    fireEvent.change(document.querySelector<HTMLSelectElement>('[data-github-add-label]')!, { target: { value: 'enhancement' } })
    // The whole new set is sent: GitHub replaces an issue's labels wholesale.
    await waitFor(() => expect(m.updateGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, labels: ['bug', 'enhancement'] }))
    await waitFor(() => expect(document.querySelector('[data-label="enhancement"]')).not.toBeNull())
    expect(m.loadGitHubIssue).toHaveBeenCalledTimes(2)
    // Both labels are attached now, so the picker has nothing left to offer.
    expect(document.querySelector('[data-github-add-label]')).toBeNull()
  })

  it('removes a label with the rest of the set', async () => {
    const attached = detailFixture({ labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }] })
    const m = mount({ details: [attached, detailFixture()] })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-remove-label="enhancement"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-github-remove-label="enhancement"]')!)
    await waitFor(() => expect(m.updateGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, labels: ['bug'] }))
    await waitFor(() => expect(document.querySelector('[data-label="enhancement"]')).toBeNull())
    expect(document.querySelector('[data-label="bug"]')).not.toBeNull()
  })

  it('assigns someone by adding them to the people GitHub already holds', async () => {
    const after = detailFixture({ assignees: ['lin', 'grace'] })
    const m = mount({ details: [detailFixture(), after] })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-add-assignee]')).not.toBeNull())
    fireEvent.change(document.querySelector<HTMLSelectElement>('[data-github-add-assignee]')!, { target: { value: 'grace' } })
    await waitFor(() => expect(m.updateGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, assignees: ['lin', 'grace'] }))
    await waitFor(() => expect(document.querySelector('[data-assignee="grace"]')).not.toBeNull())
  })

  it('unassigns the last person and sends an empty set', async () => {
    const m = mount({ details: [detailFixture(), detailFixture({ assignees: [] })] })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-remove-assignee="lin"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-github-remove-assignee="lin"]')!)
    await waitFor(() => expect(m.updateGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 3, assignees: [] }))
    await waitFor(() => expect(document.querySelector('[data-assignee="lin"]')).toBeNull())
  })

  it('shows a refused label write and leaves the issue as GitHub holds it', async () => {
    const m = mount({
      updateRule: () => ({ ok: false, error: { message: 'Resource not accessible by personal access token' } }),
    })
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(document.querySelector('[data-github-remove-label="bug"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-github-remove-label="bug"]')!)
    await waitFor(() => expect(document.querySelector('[data-github-issue-panel="3"] [role="alert"]')?.textContent)
      .toContain('Resource not accessible by personal access token'))
    // Nothing was re-read: GitHub refused the write, so its truth is unchanged.
    expect(m.loadGitHubIssue).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-label="bug"]')).not.toBeNull()
  })

  it('names the open issue in the URL and drops it when the panel closes', async () => {
    mount()
    await openGitHubSource()
    fireEvent.click(await screen.findByText('Issue 3'))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('ghIssue')).toBe('3'))
    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('ghIssue')).toBeNull())
    expect(document.querySelector('[data-github-issue-panel]')).toBeNull()
  })

  it('opens the GitHub face and the issue a cold link names, with no switch first', async () => {
    // The link is shareable: a browser that last read the Task board still
    // lands on GitHub's store, because that is where the issue lives.
    localStorage.setItem('dsh.agent-team.board.source', 'tasks')
    window.history.replaceState(null, '', '/?ghIssue=4')
    const m = mount({ details: [detailFixture({ number: 4, title: 'Issue 4', columnId: 'opt_done' })] })
    await waitFor(() => expect(document.querySelector('[data-github-issue-panel="4"]')).not.toBeNull())
    expect(m.loadGitHubIssue).toHaveBeenCalledWith({ workspaceId: 'w1', number: 4 })
    expect(document.querySelector('[data-github-board]')).not.toBeNull()
    expect(document.querySelector('[data-github-issue-title]')?.textContent).toBe('Issue 4')
    // Closing a link-opened panel puts the keyboard on that issue's card: no
    // opener click happened, so the card stands in for it.
    fireEvent.click(screen.getByText('close'))
    await waitFor(() => expect(document.activeElement?.getAttribute('data-github-card')).toBe('4'))
  })

  it('refuses a drop on the "No status" bucket without calling GitHub', async () => {
    const m = mount()
    await openGitHubSource()
    await waitFor(() => expect(document.querySelector('[data-github-card="3"]')).not.toBeNull())
    act(() => {
      onDragEnd?.({ active: { id: 'issue:3', data: { current: { issue: issue(3, 'opt_todo') } } }, over: { id: 'no-status' } })
    })
    await waitFor(() => expect(document.querySelector('[data-github-notice]')?.textContent).toBe('githubBucketColumn'))
    expect(m.updateGitHubIssue).not.toHaveBeenCalled()
  })
})
