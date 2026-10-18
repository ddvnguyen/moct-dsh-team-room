// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'
import { STORAGE_KEY } from '../src/client/navigation.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

// The board's drag contract is driven through a controllable DndContext
// double, the way Multica's own board tests do: jsdom has no layout, so the
// real PointerSensor/collision stack cannot resolve a drop. The double records
// the handlers the page registered and renders children directly, so a spec
// fires onDragStart/onDragOver/onDragEnd with plain ids and the page's own
// mirror/settle logic runs for real.
interface DragEventLike {
  readonly active: { readonly id: string }
  readonly over: { readonly id: string } | null
}

type DragHandler = (event: DragEventLike) => void

let dndHandlers: {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragOver?: DragHandler
  onDragEnd?: DragHandler
  onDragCancel?: () => void
} = {}
let droppableOverId: string | null = null
vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: { children: unknown; onDragStart: (event: { active: { id: string } }) => void; onDragOver: DragHandler; onDragEnd: DragHandler; onDragCancel: () => void }) => {
    dndHandlers = {
      onDragStart: props.onDragStart,
      onDragOver: props.onDragOver,
      onDragEnd: props.onDragEnd,
      onDragCancel: props.onDragCancel,
    }
    return props.children
  },
  DragOverlay: (props: { children?: unknown }) => (props.children ?? null) as never,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: (args: { id: string }) => ({ setNodeRef: () => {}, isOver: droppableOverId === args.id }),
  pointerWithin: vi.fn(),
  closestCenter: vi.fn(),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: { children: unknown }) => props.children,
  verticalListSortingStrategy: {},
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

/** Three todo rows in one channel, plus one done row, with distinct positions. */
function boardSeed() {
  return [
    { taskRef: 'task:a', status: 'todo' as const, title: 'Alpha task', taskNumber: 11, position: 1 },
    { taskRef: 'task:b', status: 'todo' as const, title: 'Beta task', taskNumber: 12, position: 2, assignee: 'member:builder' },
    { taskRef: 'task:c', status: 'todo' as const, title: 'Gamma task', taskNumber: 13, position: 3 },
    { taskRef: 'task:d', status: 'done' as const, title: 'Done task', taskNumber: 14, position: 1 },
  ]
}

/** Opens the runtime straight onto the board face, the way a reload restores it. */
async function boardRuntime(options?: Parameters<typeof runtimeWithTeam>[0]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'team', workspaceId: 'w1', board: true }))
  return runtimeWithTeam({ initialChannels: true, ...options })
}

/** Fires the drag handlers in the order a real pointer drag produces them. */
function drag(activeId: string, overId: string | null): void {
  act(() => { dndHandlers.onDragStart?.({ active: { id: activeId } }) })
  act(() => { dndHandlers.onDragOver?.({ active: { id: activeId }, over: overId === null ? null : { id: overId } }) })
  act(() => { dndHandlers.onDragEnd?.({ active: { id: activeId }, over: overId === null ? null : { id: overId } }) })
}

type BoardView = Awaited<ReturnType<typeof runtimeWithTeam>>['view']

function columnOf(view: BoardView, status: string): HTMLElement {
  const columns = view.container.querySelectorAll<HTMLElement>('[data-testid="board-column"]')
  const column = Array.from(columns).find(entry => entry.getAttribute('data-status') === status)
  expect(column, `column ${status} rendered`).toBeDefined()
  return column!
}

function menuRow(view: BoardView, label: string): HTMLButtonElement {
  const row = [...view.container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
    .find(entry => entry.textContent?.includes(label))
  expect(row, `menu row ${label}`).toBeDefined()
  return row!
}

describe('Team board page', () => {
  it('renders the columns with the seeded tasks by status and the empty state without any', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    expect(b.view.container.textContent).toContain('Beta task')
    expect(columnOf(b.view, 'todo').textContent).toContain('#11')
    expect(columnOf(b.view, 'done').textContent).toContain('Done task')
    expect(columnOf(b.view, 'in_progress').textContent).toContain('暂无任务')
    await b.runtime.dispose()
  })

  it('shows the board empty state when the workspace has no tasks', async () => {
    const b = await boardRuntime()
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('还没有任务'))
    await b.runtime.dispose()
  })

  it('creates an unassigned task with the chosen channel through createTask', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    fireEvent.click(b.view.getByTestId('board-new-task'))
    const dialog = await b.view.findByTestId('board-create-dialog')
    // The assignee field starts on 未分配: creating never assigns.
    expect(dialog.textContent).toContain('未分配')
    fireEvent.change(dialog.querySelector('input')!, { target: { value: 'Board fresh task' } })
    fireEvent.click(b.view.getByTestId('board-create-submit'))
    await waitFor(() => expect(b.createTask).toHaveBeenCalledTimes(1))
    expect(b.createTask.mock.calls[0]![0]).toMatchObject({
      workspaceId: 'w1',
      channelRef: 'channel:engineering',
      title: 'Board fresh task',
      assignee: null,
    })
    // The catalog refetch carries the new row into the todo column.
    await waitFor(() => expect(b.view.container.textContent).toContain('Board fresh task'))
    await b.runtime.dispose()
  })

  it('drops a card on Done and calls changeTask with accept; the card moves only after the refetch', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    drag('task:a', 'status:done')
    await b.view.findByTestId('board-debug-state')
    expect(b.changeTask).toHaveBeenCalledTimes(1)
    expect(b.changeTask.mock.calls[0]![0]).toMatchObject({ taskRef: 'task:a', action: 'accept', baseRevision: 2 })
    // The double moved the row; the reload puts the card in the done column.
    await waitFor(() => expect(columnOf(b.view, 'done').textContent).toContain('Alpha task'))
    expect(columnOf(b.view, 'todo').textContent).not.toContain('Alpha task')
    await b.runtime.dispose()
  })

  it('rejects a drop on In progress with the agents-claim hint and no Remote call', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    drag('task:a', 'status:in_progress')
    await waitFor(() => expect(b.view.container.textContent).toContain('进行中与待评审由 Agent 认领设定'))
    expect(b.changeTask).not.toHaveBeenCalled()
    expect(b.updateTask).not.toHaveBeenCalled()
    // The card snapped back: the mirror resync puts it back in todo.
    await waitFor(() => expect(columnOf(b.view, 'todo').textContent).toContain('Alpha task'))
    await b.runtime.dispose()
  })

  it('reorders within a column and calls updateTask with a position between the neighbours', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    // Alpha (1) onto Beta (2), Gamma (3) behind: the midpoint of 2 and 3.
    drag('task:a', 'task:b')
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledTimes(1))
    expect(b.updateTask.mock.calls[0]![0]).toMatchObject({ taskRef: 'task:a', patch: { position: 2.5 } })
    await b.runtime.dispose()
  })

  it('filters by the assignee Unassigned and hides the assigned card', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Beta task'))
    fireEvent.click(b.view.getByRole('button', { name: '负责人' }))
    fireEvent.click(menuRow(b.view, '未分配'))
    await waitFor(() => expect(b.view.container.textContent).not.toContain('Beta task'))
    expect(b.view.container.textContent).toContain('Alpha task')
    await b.runtime.dispose()
  })

  it('shows the live activity badge on the card whose thread is running a Turn', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    expect(b.view.container.textContent).not.toContain('工作中')
    // The workspace activity wake drives the reload; the badge lands on the
    // card whose thread the Turn runs against.
    b.publishActivity({ memberId: 'member:builder', handle: 'builder', threadRef: 'thread:a' })
    await waitFor(() => expect(b.view.container.textContent).toContain('工作中'))
    const cards = b.view.container.querySelectorAll<HTMLElement>('[data-testid="board-card"]')
    const badged = Array.from(cards).find(card => card.textContent?.includes('工作中'))
    expect(badged?.getAttribute('data-task-ref')).toBe('task:a')
    await b.runtime.dispose()
  })

  it('snaps back and shows the Remote error when a field write fails', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    b.updateTask.mockImplementationOnce(async () => ({ ok: false as const, error: { message: 'seat is busy' } }))
    drag('task:a', 'task:b')
    await waitFor(() => expect(b.view.container.textContent).toContain('seat is busy'))
    expect(b.updateTask).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('hides a column from the menu and shows it again from the hidden rail', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    const done = columnOf(b.view, 'done')
    fireEvent.click(within(done).getByRole('button', { name: '列选项' }))
    fireEvent.click(await b.view.findByText('隐藏列'))
    await waitFor(() => expect(b.view.container.querySelectorAll('[data-testid="board-column"]')).toHaveLength(4))
    // The column left the board and its preference persisted.
    const statuses = () => [...b.view.container.querySelectorAll('[data-testid="board-column"]')].map(entry => entry.getAttribute('data-status'))
    expect(statuses()).not.toContain('done')
    expect(JSON.parse(localStorage.getItem('dsh.agent-team.board.hiddenColumns') ?? '[]')).toEqual(['done'])
    // The hidden rail names the column and offers it back.
    fireEvent.click(within(b.view.getByTestId('board-hidden-columns')).getByRole('button', { name: '显示列' }))
    await waitFor(() => expect(b.view.container.querySelectorAll('[data-testid="board-column"]')).toHaveLength(5))
    expect(statuses()).toContain('done')
    await b.runtime.dispose()
  })

  it('locks a live-status column with a drop hint while a card hovers it', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    act(() => { dndHandlers.onDragStart?.({ active: { id: 'task:a' } }) })
    droppableOverId = 'status:in_progress'
    act(() => { dndHandlers.onDragOver?.({ active: { id: 'task:a' }, over: { id: 'status:in_progress' } }) })
    const hint = await b.view.findByTestId('board-drop-hint')
    expect(hint.textContent).toContain('进行中与待评审由 Agent 认领设定')
    droppableOverId = null
    act(() => { dndHandlers.onDragCancel?.() })
    await b.runtime.dispose()
  })
})
