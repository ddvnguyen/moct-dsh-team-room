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
  MouseSensor: class {},
  TouchSensor: class {},
  KeyboardSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: (args: { id: string }) => ({ setNodeRef: () => {}, isOver: droppableOverId === args.id }),
  pointerWithin: vi.fn(),
  closestCenter: vi.fn(),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: { children: unknown }) => props.children,
  verticalListSortingStrategy: {},
  sortableKeyboardCoordinates: () => undefined,
  useSortable: () => ({ attributes: { role: 'button', tabIndex: 0, 'aria-roledescription': 'sortable', 'aria-pressed': false }, listeners: {}, setNodeRef: () => {}, transform: null, transition: null, isDragging: false }),
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

function menuRow(_view: BoardView, label: string): HTMLButtonElement {
  // Picker lists are portaled to the body, outside the render container.
  const row = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
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
    const board = await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(board.textContent).toContain('Beta task'))
    fireEvent.click(within(board).getByRole('button', { name: '负责人' }))
    fireEvent.click(menuRow(b.view, '未分配'))
    // The board's own cards: the roster in the sidebar column may name the
    // same task as a Member's current work, and that is not the board's list.
    await waitFor(() => expect(board.textContent).not.toContain('Beta task'))
    expect(board.textContent).toContain('Alpha task')
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
    fireEvent.click(within(b.view.getByTestId('board-hidden-columns')).getByRole('button', { name: /^显示列/ }))
    await waitFor(() => expect(b.view.container.querySelectorAll('[data-testid="board-column"]')).toHaveLength(5))
    expect(statuses()).toContain('done')
    await b.runtime.dispose()
  })

  it('moves a card when an Agent claims its Task elsewhere, with no local write', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(columnOf(b.view, 'todo').textContent).toContain('Alpha task'))
    // The claim commits to Channel and Thread scopes only; the board must still hear it.
    act(() => { b.claimBoardTask('task:a', 'in_progress') })
    await waitFor(() => expect(columnOf(b.view, 'in_progress').textContent).toContain('Alpha task'))
    expect(columnOf(b.view, 'todo').textContent).not.toContain('Alpha task')
    expect(b.changeTask).not.toHaveBeenCalled()
    expect(b.updateTask).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('explains a stale write and keeps the card where it was', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    b.failNextBoardWrite('stale_revision')
    drag('task:a', 'status:done')
    await waitFor(() => expect(b.view.getByTestId('board-notice').textContent).toContain('刚在别处被更改'))
    expect(b.view.getByTestId('board-notice').textContent).not.toContain('unknown')
    await waitFor(() => expect(columnOf(b.view, 'todo').textContent).toContain('Alpha task'))
    expect(columnOf(b.view, 'done').textContent).not.toContain('Alpha task')
    await b.runtime.dispose()
  })

  it('tells the Human to read the Thread first when the write needs it', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    b.failNextBoardWrite('unread_required')
    drag('task:a', 'status:done')
    await waitFor(() => expect(b.view.getByTestId('board-notice').textContent).toContain('还没读的消息'))
    await waitFor(() => expect(columnOf(b.view, 'todo').textContent).toContain('Alpha task'))
    await b.runtime.dispose()
  })

  it('does not lock the origin column while a card is dragged over its own column', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    act(() => { dndHandlers.onDragStart?.({ active: { id: 'task:a' } }) })
    droppableOverId = 'status:todo'
    act(() => { dndHandlers.onDragOver?.({ active: { id: 'task:a' }, over: { id: 'status:todo' } }) })
    expect(b.view.queryByTestId('board-drop-hint')).toBeNull()
    droppableOverId = null
    act(() => { dndHandlers.onDragCancel?.() })
    await b.runtime.dispose()
  })

  it('renumbers a column whose neighbours tie, writing only the cards whose position changes', async () => {
    const tied = [
      { taskRef: 'task:a', status: 'todo' as const, title: 'Alpha task', taskNumber: 11 },
      { taskRef: 'task:b', status: 'todo' as const, title: 'Beta task', taskNumber: 12 },
      { taskRef: 'task:c', status: 'todo' as const, title: 'Gamma task', taskNumber: 13 },
    ]
    const b = await boardRuntime({ seedBoardTasks: tied })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    // Alpha lands after Beta; all three read position 0, so there is no number between them.
    drag('task:a', 'task:b')
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledTimes(3))
    expect(b.updateTask.mock.calls.map(call => [call[0].taskRef, call[0].patch.position])).toEqual([['task:b', 1], ['task:a', 2], ['task:c', 3]])
    await waitFor(() => {
      const titles = [...columnOf(b.view, 'todo').querySelectorAll('[data-testid="board-card"]')].map(card => card.getAttribute('data-task-ref'))
      expect(titles).toEqual(['task:b', 'task:a', 'task:c'])
    })
    await b.runtime.dispose()
  })

  it('persists the new order after a reorder', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    drag('task:a', 'task:b')
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      const refs = [...columnOf(b.view, 'todo').querySelectorAll('[data-testid="board-card"]')].map(card => card.getAttribute('data-task-ref'))
      expect(refs).toEqual(['task:b', 'task:a', 'task:c'])
    })
    await b.runtime.dispose()
  })

  it('keeps a card picker from opening the Task, and writes the chosen field', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    const card = [...b.view.container.querySelectorAll<HTMLElement>('[data-testid="board-card"]')].find(entry => entry.getAttribute('data-task-ref') === 'task:a')!
    fireEvent.click(within(card).getByRole('button', { name: /^修改优先级/ }))
    const item = (await b.view.findAllByRole('menuitem')).find(entry => entry.textContent?.includes('紧急'))!
    fireEvent.click(item)
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledTimes(1))
    expect(b.updateTask.mock.calls[0]![0]).toMatchObject({ taskRef: 'task:a', patch: { priority: 'urgent' } })
    // The board is still the open face: no Thread was selected.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ board: true })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').threadRef).toBeUndefined()
    await b.runtime.dispose()
  })

  it('opens the Task from its title, which is the card\'s only control besides its pickers', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    const card = [...b.view.container.querySelectorAll<HTMLElement>('[data-testid="board-card"]')].find(entry => entry.getAttribute('data-task-ref') === 'task:a')!
    // One tab stop on the sortable wrapper, a named group, and no button inside another.
    const slot = card.parentElement!
    expect(slot.getAttribute('role')).toBe('group')
    expect(slot.getAttribute('aria-label')).toBe('#11 Alpha task')
    expect(slot.getAttribute('tabindex')).toBe('0')
    expect(card.hasAttribute('tabindex')).toBe(false)
    expect(card.getAttribute('role')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Alpha task' }))
    // The card opens the issue as a slice over the board: the board stays
    // behind the dialog, and Maximize turns it into the page. The slot is
    // the navigation's own — the slice is an overlay, not a place, so it is
    // not written to the persisted snapshot.
    const navigation = b.runtime.ctx.get('teamNavigation')
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:a'))
    expect(navigation?.getSnapshot().issueVariant).toBe('slice')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').issueRef).toBeUndefined()
    await b.runtime.dispose()
  })

  it('walks between the issues with the keyboard while the slice is open', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    const navigation = b.runtime.ctx.get('teamNavigation')
    const cardOf = (taskRef: string): HTMLElement =>
      [...b.view.container.querySelectorAll<HTMLElement>('[data-testid="board-card"]')].find(entry => entry.getAttribute('data-task-ref') === taskRef)!

    // The card opens the slice over the board; the walk belongs to the board.
    fireEvent.click(within(cardOf('task:a')).getByRole('button', { name: 'Alpha task' }))
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:a'))

    // J steps to the next issue of the column, K steps back.
    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:b'))
    fireEvent.keyDown(document, { key: 'k' })
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:a'))

    // L moves to the next column, H back to this one.
    fireEvent.keyDown(document, { key: 'l' })
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:d'))
    fireEvent.keyDown(document, { key: 'h' })
    await waitFor(() => expect(navigation?.getSnapshot().issueRef).toBe('task:a'))
    await b.runtime.dispose()
  })

  it('closes the create dialog on Escape without creating anything', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    fireEvent.click(b.view.getByTestId('board-new-task'))
    await b.view.findByTestId('board-create-dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(b.view.queryByTestId('board-create-dialog')).toBeNull())
    expect(b.createTask).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('retries a failed create under the same request id and a new payload under a new one', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    b.createTask.mockImplementationOnce(async () => ({ ok: false as const, error: { message: 'seat is busy' } }) as never)
    fireEvent.click(b.view.getByTestId('board-new-task'))
    const dialog = await b.view.findByTestId('board-create-dialog')
    fireEvent.change(dialog.querySelector('input')!, { target: { value: 'Retry me' } })
    fireEvent.click(b.view.getByTestId('board-create-submit'))
    await waitFor(() => expect(document.body.textContent).toContain('seat is busy'))
    fireEvent.click(b.view.getByTestId('board-create-submit'))
    await waitFor(() => expect(b.createTask).toHaveBeenCalledTimes(2))
    expect(b.createTask.mock.calls[1]![0].requestId).toBe(b.createTask.mock.calls[0]![0].requestId)
    await b.runtime.dispose()
  })

  it('names each chip and hidden-column button by what it acts on', async () => {
    const b = await boardRuntime({ seedBoardTasks: boardSeed() })
    await b.view.findByTestId('team-board-page')
    await waitFor(() => expect(b.view.container.textContent).toContain('Alpha task'))
    fireEvent.click(b.view.getByRole('button', { name: '负责人' }))
    fireEvent.click(menuRow(b.view, '未分配'))
    expect(b.view.getByRole('button', { name: '清除 负责人' })).toBeTruthy()
    expect(b.view.getByTestId('board-filter-count').getAttribute('aria-label')).toBe('已启用 1 个筛选')
    const done = columnOf(b.view, 'done')
    fireEvent.click(within(done).getByRole('button', { name: '列选项' }))
    fireEvent.click(await b.view.findByText('隐藏列'))
    expect(await b.view.findByRole('button', { name: /^显示列 / })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('opens the board from the sidebar\'s Board row, the entry point readers use', async () => {
    const b = await runtimeWithTeam({ nativeTabs: true, workspaceId: 'w1', initialChannels: true, seedBoardTasks: boardSeed() })
    // The Board is a panel: a row in the sidebar's main list, and the panel's
    // seat shows the Board face in the main column.
    const row = await waitFor(() => {
      const found = b.runtime.slots.entriesOfSlot('sidebar.panellist')
        .map(entry => (entry.options as { id?: string }).id)
      expect(found).toContain('agent-team-board')
      return found
    })
    expect(row).toContain('agent-team-board')
    // The strip keeps no Board tab: the Board is a destination, not a list.
    expect(b.view.container.querySelector('[data-native-tab="board"]')).toBeNull()
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
