// Derived from multica-x packages/views/issues/components/board-view.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: no projects, workflows, saved views or pagination. The
// columns come from the Workspace's status catalog (the five built-ins plus
// the lists the Human added), so a new list is a column on the next read — no
// reload, no release. The house rule replaces Multica's optimistic mutations:
// a drop never moves data locally — the Remote commits, the change wake
// refetches, and only then does the card move; a rejected drop snaps the
// preview back with an inline hint.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  AgentTeamBoardStatus,
  AgentTeamChannelRef,
  AgentTeamMemberId,
  AgentTeamTaskPriority,
  AgentTeamTaskRef,
  AgentTeamRequestId,
  AgentTeamClientMemberStatus,
  AgentTeamCreateTaskRequest,
  AgentTeamCreateTaskResult,
  AgentTeamCreateStatusRequest,
  AgentTeamUpdateStatusRequest,
  AgentTeamArchiveStatusRequest,
  AgentTeamStatusResult,
  AgentTeamMemberActivityResult,
  AgentTeamUpdateTaskRequest,
  AgentTeamUpdateTaskResult,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamConversationProps, TeamSidebarProps } from '../slots.ts'
import type { ActivitySource } from '../multica/types.ts'
import { filterTasks, isEmptyTaskFilters, type TaskFilters } from '../multica/filter.ts'
import { sortTasks } from '../multica/sort.ts'
import { findColumn, makeKanbanCollision } from '../multica/drag-utils.ts'
import { mintRequestId } from '../requests.ts'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { planPositionWrites } from './reorder.ts'
import { BoardCardContent } from './BoardCard.tsx'
import { BoardColumn, BOARD_COL_WIDTH } from './BoardColumn.tsx'
import { CollapsedBoardColumn } from './CollapsedBoardColumn.tsx'
import { readCollapsedColumns, toggleCollapsedColumn, writeCollapsedColumns } from './collapsed-columns.ts'
import { BoardFilterBar } from './BoardFilterBar.tsx'
import { useDragSettle } from './use-drag-settle.ts'
import { useBoardDragPan } from './use-board-drag-pan.ts'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { HiddenColumnsPanel } from './HiddenColumnsPanel.tsx'
import { StatusEditorDialog, type StatusDraft } from './StatusEditorDialog.tsx'
import {
  boardColumns,
  buildBoardMirror,
  columnIdOf,
  columnLabel,
  columnDrop,
  type BoardColumnModel,
} from './board-columns.ts'
import type { BoardCardTask } from './board-types.ts'
import look from '../multica-look.module.css'
import css from './board.module.css'

const HIDDEN_KEY = 'dsh.agent-team.board.hiddenColumns'

/**
 * The hidden set is keyed by column key, not by display label: a built-in
 * key is the status it always was, so a preference stored before custom lists
 * existed still hides exactly what it hid, and a renamed list stays hidden.
 */
function readHiddenColumns(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch (error) {
    // A corrupt or blocked preference falls back to "nothing hidden"; it never blocks the board.
    void error
    return []
  }
}

function writeHiddenColumns(hidden: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden))
  } catch (error) {
    // Private mode or a full quota: the preference stays in memory for this visit.
    void error
  }
}

export interface TeamBoardPageProps {
  readonly workspaceId: WorkspaceId
  readonly loadBoard: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<AgentTeamView>>
  readonly loadMembers: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
  readonly loadMemberActivity: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<AgentTeamMemberActivityResult>>
  readonly createTask: (request: AgentTeamCreateTaskRequest) => Promise<RemoteResult<AgentTeamCreateTaskResult>>
  readonly updateTask: (request: AgentTeamUpdateTaskRequest) => Promise<RemoteResult<AgentTeamUpdateTaskResult>>
  /** The catalog writes: one editor, three Host operations. */
  readonly createStatus: (request: AgentTeamCreateStatusRequest) => Promise<RemoteResult<AgentTeamStatusResult>>
  readonly updateStatus: (request: AgentTeamUpdateStatusRequest) => Promise<RemoteResult<AgentTeamStatusResult>>
  readonly archiveStatus: (request: AgentTeamArchiveStatusRequest) => Promise<RemoteResult<AgentTeamStatusResult>>
  readonly changeTask: TeamConversationProps['changeTask']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  /** The global opener: the issue opens as a slice over the board. */
  readonly openIssue: TeamConversationProps['openIssue']
  /**
   * The order the panel's walk takes (M-69): the board publishes its columns
   * here, and holds no keys of its own.
   */
  readonly peekOrder: TeamConversationProps['peekOrder']
  /**
   * The navigation slot: the board reads the open issue's Task from it, to
   * scroll the card the reader is on into view.
   */
  readonly navigation: TeamConversationProps['navigation']
  readonly t: TeamSidebarProps['t']
}

type Notice = { readonly text: string; readonly tone: 'error' | 'info' }

/** One write's answer: the Remote either failed, or answered with a business outcome beside `committed`. */
type WriteResult = RemoteResult<{ readonly kind: string }>

function failureText(error: unknown, t: TeamSidebarProps['t']): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return t('boardWriteFailed')
}

/** The explanation for a write that did not commit; stale and unread results are normal `ok` answers. */
function outcomeText(result: WriteResult, t: TeamSidebarProps['t']): string {
  if (!result.ok) return failureText(result.error, t)
  if (result.value.kind === 'stale_revision') return t('boardStale')
  if (result.value.kind === 'unread_required') return t('boardUnreadRequired')
  return t('boardWriteFailed')
}

const isCommitted = (result: WriteResult): boolean => result.ok && result.value.kind === 'committed'

/** Ids that survive a retry of the same intent, so a lost response never double-commits. */
function useRequestIds() {
  const ids = useRef(new Map<string, AgentTeamRequestId>())
  return useMemo(() => ({
    forIntent(key: string): AgentTeamRequestId {
      let id = ids.current.get(key)
      if (id === undefined) {
        id = mintRequestId()
        ids.current.set(key, id)
      }
      return id
    },
    settle(key: string): void { ids.current.delete(key) },
  }), [])
}

/** Which list the editor is open on: none, a new list, or one existing custom list. */
type ListEditor = { readonly mode: 'add' } | { readonly mode: 'rename'; readonly column: BoardColumnModel }

export function TeamBoardPage({ workspaceId, loadBoard, loadMembers, loadMemberActivity, createTask, updateTask,
  createStatus, updateStatus, archiveStatus, changeTask, subscribeChanges, openIssue, peekOrder, navigation, t }: TeamBoardPageProps) {
  const [rows, setRows] = useState<readonly BoardCardTask[]>()
  const [statuses, setStatuses] = useState<readonly AgentTeamBoardStatus[]>([])
  const [channels, setChannels] = useState<readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string }[]>([])
  const [members, setMembers] = useState<readonly AssigneeOption[]>([])
  const [activities, setActivities] = useState<readonly ActivitySource[]>([])
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [filters, setFilters] = useState<TaskFilters>({ channelRefs: [], assignees: [], priorities: [], statuses: [], text: '' })
  const [hidden, setHidden] = useState<string[]>(readHiddenColumns)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedColumns(workspaceId, new Set()))
  const [createOpen, setCreateOpen] = useState(false)
  const [editor, setEditor] = useState<ListEditor>()
  const [activeTask, setActiveTask] = useState<BoardCardTask | null>(null)
  // The board's own root: the card the reader was on is found in it, and the
  // focus goes back to it when the issue closes.
  const pageRef = useRef<HTMLDivElement>(null)
  const [settlingRefs, setSettlingRefs] = useState<ReadonlySet<string>>(new Set())
  const requestIds = useRequestIds()

  // --- Data loads ---
  // Reads can overtake each other; only the newest one may write state.
  const boardSerial = useRef(0)
  const activitySerial = useRef(0)
  const reloadBoard = useCallback(async () => {
    const serial = boardSerial.current += 1
    const [viewResult, memberResult] = await Promise.all([
      loadBoard({ workspaceId }),
      loadMembers({ workspaceId }),
    ])
    if (serial !== boardSerial.current) return
    if (!viewResult.ok) {
      setLoadError(failureText(viewResult.error, t))
      return
    }
    const view = viewResult.value
    setChannels(view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })))
    setStatuses(view.statuses ?? [])
    setRows(deriveRows(view))
    if (memberResult.ok) {
      setMembers(memberResult.value.map(member => ({ memberId: member.member.memberId, handle: member.member.handle })))
      setLoadError(undefined)
    } else {
      // The cards still render; only assignee names are missing until the next read.
      setLoadError(failureText(memberResult.error, t))
    }
  }, [loadBoard, loadMembers, t, workspaceId])

  const reloadActivity = useCallback(async () => {
    const serial = activitySerial.current += 1
    const result = await loadMemberActivity({ workspaceId })
    if (serial === activitySerial.current && result.ok) setActivities(result.value.activities)
  }, [loadMemberActivity, workspaceId])

  const reloadRef = useRef(reloadBoard)
  reloadRef.current = reloadBoard
  const reloadActivityRef = useRef(reloadActivity)
  reloadActivityRef.current = reloadActivity

  useEffect(() => {
    void reloadRef.current()
    void reloadActivityRef.current()
    // Claims, resolutions and field writes commit to Channel and Thread scopes
    // only, so the Task stream is the scope-less one (as the Inbox's is);
    // activity wakes move the live badges. A catalog edit commits a Workspace
    // fact and reaches this same scope-less stream, so a new list draws without
    // a reload.
    const stopTasks = subscribeChanges(undefined, update => {
      if (update.type === 'failed') setLoadError(update.message)
      else void reloadRef.current()
    })
    const stopActivity = subscribeChanges({ kind: 'activity', workspaceId }, update => {
      if (update.type === 'changed') void reloadActivityRef.current()
    })
    return () => { stopTasks(); stopActivity() }
  }, [subscribeChanges, workspaceId])

  // --- Derivation ---
  const columns = useMemo(() => boardColumns(statuses), [statuses])
  const visibleColumns = useMemo(() => columns.filter(column => !hidden.includes(column.key)), [columns, hidden])
  const columnIds = useMemo(() => visibleColumns.map(column => column.id), [visibleColumns])
  const columnIdSet = useMemo(() => new Set(columnIds), [columnIds])
  const hiddenColumns = useMemo(() => columns.filter(column => hidden.includes(column.key)), [columns, hidden])
  const filtered = useMemo(() => {
    const base = rows ?? []
    const sorted = sortTasks(base, 'position', 'asc')
    return filterTasks(sorted, filters)
  }, [rows, filters])
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  const columnIdsRef = useRef(columnIds)
  columnIdsRef.current = columnIds
  const columnsRef = useRef(visibleColumns)
  columnsRef.current = visibleColumns

  const {
    columns: mirror,
    setColumns,
    columnsRef: mirrorRef,
    isDraggingRef,
    isSettlingRef,
    recentlyMovedRef,
    settleVersion,
    beginSettle,
  } = useDragSettle(() => buildBoardMirror(rows ?? [], visibleColumns))

  // Between drags the mirror follows the loaded rows; during a drag or a
  // settle it is frozen by the locks.
  useEffect(() => {
    if (!isDraggingRef.current && !isSettlingRef.current) {
      setColumns(buildBoardMirror(filtered, visibleColumns))
    }
  }, [filtered, visibleColumns, settleVersion, setColumns, isDraggingRef, isSettlingRef])

  const resyncColumns = useCallback(() => {
    setColumns(buildBoardMirror(filteredRef.current, columnsRef.current))
  }, [setColumns])

  const taskMap = useMemo(() => new Map<string, BoardCardTask>(filtered.map(task => [task.taskRef as string, task])), [filtered])
  const taskMapRef = useRef(taskMap)
  if (!isDraggingRef.current && !isSettlingRef.current) {
    taskMapRef.current = taskMap
  }

  const collisionDetection = useMemo(() => makeKanbanCollision(columnIdSet), [columnIdSet])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const pan = useBoardDragPan<HTMLDivElement>()

  // A collapsed column and a hidden one both resolve to no column: a drop over
  // either moves nothing and writes nothing.
  const columnOf = useCallback((columnId: string): BoardColumnModel | null => {
    const column = columnsRef.current.find(candidate => candidate.id === columnId)
    if (column === undefined || collapsed.has(columnId)) return null
    return column
  }, [collapsed])

  // --- Screen-reader announcements (dnd-kit's defaults are English only) ---
  const announcements = useMemo<Announcements>(() => {
    const titleOf = (id: string): string => {
      const task = taskMapRef.current.get(id)
      return task === undefined ? id : task.title ?? `#${task.taskNumber}`
    }
    const columnName = (overId: string): string => {
      const columnId = findColumn(mirrorRef.current, overId, columnIdSet)
      const column = columnId === null ? undefined : columnsRef.current.find(candidate => candidate.id === columnId)
      return column === undefined ? '' : columnLabel(column, t)
    }
    return {
      onDragStart: ({ active }) => t('boardAnnounceStart', { title: titleOf(active.id as string) }),
      onDragOver: ({ active, over }) => over === null ? undefined : t('boardAnnounceOver', { title: titleOf(active.id as string), column: columnName(over.id as string) }),
      onDragEnd: ({ active, over }) => over === null ? t('boardAnnounceCancel', { title: titleOf(active.id as string) }) : t('boardAnnounceDrop', { title: titleOf(active.id as string), column: columnName(over.id as string) }),
      onDragCancel: ({ active }) => t('boardAnnounceCancel', { title: titleOf(active.id as string) }),
    }
  }, [columnIdSet, mirrorRef, t])

  // --- Drag handlers ---
  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true
    setActiveTask(taskMapRef.current.get(event.active.id as string) ?? null)
  }, [isDraggingRef])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over || recentlyMovedRef.current) return
    const activeId = active.id as string
    const overId = over.id as string
    setColumns(prev => {
      const activeCol = findColumn(prev, activeId, columnIdSet)
      const overCol = findColumn(prev, overId, columnIdSet)
      if (!activeCol || !overCol || activeCol === overCol) return prev
      // A collapsed column is a label, not a target: the preview never crosses into it.
      if (columnOf(overCol) === null) return prev
      recentlyMovedRef.current = true
      const oldIds = (prev[activeCol] ?? []).filter(id => id !== activeId)
      const newIds = [...(prev[overCol] ?? [])]
      const overIndex = newIds.indexOf(overId)
      newIds.splice(overIndex >= 0 ? overIndex : newIds.length, 0, activeId)
      return { ...prev, [activeCol]: oldIds, [overCol]: newIds }
    })
  }, [columnIdSet, columnOf, recentlyMovedRef, setColumns])

  /** Marks one card settling until the write's answer is in. */
  const beginCardSettle = useCallback((taskRef: string) => {
    setSettlingRefs(prev => new Set(prev).add(taskRef))
    const release = beginSettle()
    return () => {
      setSettlingRefs(prev => {
        const next = new Set(prev)
        next.delete(taskRef)
        return next
      })
      release()
    }
  }, [beginSettle])

  /**
   * Records one write's answer. A commit clears the notice and settles the
   * request id; anything else explains itself, and a stale or unread answer
   * also refetches so the retry carries the current revision.
   */
  const conclude = useCallback((result: WriteResult, key: string): boolean => {
    if (isCommitted(result)) {
      requestIds.settle(key)
      setNotice(undefined)
      return true
    }
    setNotice({ text: outcomeText(result, t), tone: 'error' })
    if (result.ok) void reloadRef.current()
    return false
  }, [requestIds, t])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    isDraggingRef.current = false
    setActiveTask(null)

    if (!over) {
      resyncColumns()
      return
    }
    const activeId = active.id as string
    const overId = over.id as string
    const cols = mirrorRef.current
    const activeCol = findColumn(cols, activeId, columnIdSet)
    const overCol = findColumn(cols, overId, columnIdSet)
    if (!activeCol || !overCol) {
      resyncColumns()
      return
    }
    const task = taskMapRef.current.get(activeId)
    if (task === undefined) {
      resyncColumns()
      return
    }

    // A collapsed or hidden column is a label, not a target: the drop writes nothing.
    const target = columnOf(overCol)
    if (target === null) {
      resyncColumns()
      return
    }

    // The origin is the Task's own column, not the mirror column: onDragOver
    // has already moved the card across the mirror, so a cross-column drop
    // would otherwise read as a same-column reorder.
    const originColumnId = columnIdOf(task, columnsRef.current)

    // Same-column reorder: persist a position between the neighbours.
    if (originColumnId === target.id) {
      const ids = cols[activeCol] ?? []
      const oldIndex = ids.indexOf(activeId)
      const newIndex = ids.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        resyncColumns()
        return
      }
      const reordered = [...ids]
      reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, activeId)
      setColumns({ ...cols, [activeCol]: reordered })
      const writes = planPositionWrites(reordered, activeId, taskMapRef.current)
      if (writes.length === 0) {
        resyncColumns()
        return
      }
      const release = beginCardSettle(activeId)
      void (async () => {
        let committed = true
        for (const write of writes) {
          const row = taskMapRef.current.get(write.taskRef)
          if (row === undefined) continue
          const key = `position:${row.taskRef}:${write.position}:${row.threadRevision}`
          const result = await updateTask({
            requestId: requestIds.forIntent(key),
            workspaceId,
            taskRef: row.taskRef,
            baseRevision: row.threadRevision,
            patch: { position: write.position },
          })
          if (!conclude(result, key)) {
            committed = false
            break
          }
        }
        // One refetch for the whole renumbering; a failure snaps the mirror back.
        if (committed) void reloadRef.current()
        else resyncColumns()
        release()
      })()
      return
    }

    // Cross-column drop. A built-in column keeps its rules (done/closed/todo,
    // and todo only from a terminal status); a custom column is placement.
    // A refused drop answers with a hint and a snap-back — the preview is
    // discarded, no Remote is called.
    const drop = columnDrop(task, target, columnsRef.current)
    if (drop.kind === 'reorder') {
      // The mirror moved the card inside one column after the origin was read.
      resyncColumns()
      return
    }
    if (drop.kind === 'locked') {
      resyncColumns()
      setNotice({ text: t('boardDropLocked'), tone: 'info' })
      return
    }

    // The card moves only after the Remote result plus the change event: the
    // settle lock holds the preview, the reload re-derives the columns, and
    // the settle release resyncs the mirror. On a refusal the resync snaps the
    // card back and the notice explains why.
    const release = beginCardSettle(activeId)
    if (drop.kind === 'place') {
      const key = `place:${task.taskRef}:${drop.statusKey ?? 'none'}:${task.threadRevision}`
      void (async () => {
        const result = await updateTask({
          requestId: requestIds.forIntent(key),
          workspaceId,
          taskRef: task.taskRef,
          baseRevision: task.threadRevision,
          patch: { statusKey: drop.statusKey },
        })
        if (conclude(result, key)) void reloadRef.current()
        else resyncColumns()
        release()
      })()
      return
    }
    const action = drop.kind
    const key = `status:${task.taskRef}:${action}:${task.threadRevision}`
    void (async () => {
      const result = await changeTask({
        requestId: requestIds.forIntent(key),
        workspaceId,
        taskRef: task.taskRef,
        action,
        baseRevision: task.threadRevision,
      })
      if (conclude(result, key)) void reloadRef.current()
      else resyncColumns()
      release()
    })()
  }, [beginCardSettle, changeTask, columnIdSet, columnOf, conclude, isDraggingRef, mirrorRef, requestIds, resyncColumns, setColumns, t, updateTask, workspaceId])

  const handleDragCancel = useCallback(() => {
    isDraggingRef.current = false
    setActiveTask(null)
    resyncColumns()
  }, [isDraggingRef, resyncColumns])

  // --- Card actions ---
  const handleCardUpdate = useCallback((taskRef: string, update: { readonly priority?: AgentTeamTaskPriority; readonly assignee?: string | null }) => {
    const task = taskMapRef.current.get(taskRef)
    if (task === undefined) return
    const patch = {
      ...(update.priority === undefined ? {} : { priority: update.priority }),
      ...(update.assignee === undefined ? {} : { assignee: update.assignee as AgentTeamMemberId | null }),
    }
    const key = `field:${task.taskRef}:${JSON.stringify(patch)}:${task.threadRevision}`
    const release = beginCardSettle(taskRef)
    void (async () => {
      const result = await updateTask({
        requestId: requestIds.forIntent(key),
        workspaceId,
        taskRef: task.taskRef,
        baseRevision: task.threadRevision,
        patch,
      })
      if (conclude(result, key)) void reloadRef.current()
      release()
    })()
  }, [beginCardSettle, conclude, requestIds, updateTask, workspaceId])

  // The card the focus goes back to when the issue closes. The card is
  // found by its Task, not by a captured node: the board re-draws its cards
  // whenever the catalog moves, and a captured node would be stale by the
  // time the reader closes the issue.
  const focusCardOf = useCallback((taskRef: AgentTeamTaskRef): (() => void) => () => {
    const root = pageRef.current
    if (root === null) return
    const card = [...root.querySelectorAll<HTMLElement>('[data-task-ref]')]
      .find(entry => entry.getAttribute('data-task-ref') === taskRef)
    const title = card?.querySelector<HTMLElement>('[data-board-card-title]')
    title?.focus({ preventScroll: true })
  }, [])

  const handleCardClick = useCallback((task: BoardCardTask) => {
    // The card opens the issue as a slice over the board (D1, re-scoped on
    // 2026-10-21): the board stays visible behind the dialog, and Maximize
    // turns it into the page. Escape returns the focus to the card the
    // reader came from.
    openIssue(task.taskRef, { workspaceId, focusOpener: focusCardOf(task.taskRef) })
  }, [focusCardOf, openIssue, workspaceId])

  const handleCreate = useCallback(async (request: { readonly channelRef: AgentTeamChannelRef; readonly title: string; readonly body: string; readonly priority?: AgentTeamTaskPriority; readonly assignee?: AgentTeamMemberId | null }) => {
    const payload = {
      channelRef: request.channelRef,
      title: request.title,
      body: request.body,
      ...(request.priority === undefined ? {} : { priority: request.priority }),
      assignee: request.assignee ?? null,
    }
    const key = `create:${JSON.stringify(payload)}`
    const result = await createTask({ requestId: requestIds.forIntent(key), workspaceId, ...payload })
    if (result.ok) {
      requestIds.settle(key)
      setCreateOpen(false)
      setNotice(undefined)
      void reloadRef.current()
      return
    }
    throw new Error(failureText(result.error, t))
  }, [createTask, requestIds, t, workspaceId])

  const hideColumn = useCallback((column: BoardColumnModel) => {
    setHidden(prev => {
      const next = prev.includes(column.key) ? prev : [...prev, column.key]
      writeHiddenColumns(next)
      return next
    })
  }, [])

  const showColumn = useCallback((column: BoardColumnModel) => {
    setHidden(prev => {
      const next = prev.filter(entry => entry !== column.key)
      writeHiddenColumns(next)
      return next
    })
  }, [])

  const openCreate = useCallback(() => { setCreateOpen(true) }, [])
  const openRename = useCallback((column: BoardColumnModel) => { setEditor({ mode: 'rename', column }) }, [])
  const openAddList = useCallback(() => { setEditor({ mode: 'add' }) }, [])

  /** One editor, two directions: `+ Add list` and a column's Rename both land here. */
  const handleListSave = useCallback(async (draft: StatusDraft) => {
    const current = editor
    if (current === undefined) return
    const key = `list:${current.mode}:${current.mode === 'rename' ? current.column.key : ''}:${draft.label}:${draft.category}`
    const result = current.mode === 'add'
      ? await createStatus({ requestId: requestIds.forIntent(key), workspaceId, label: draft.label, category: draft.category })
      : await updateStatus({ requestId: requestIds.forIntent(key), workspaceId, key: current.column.key, label: draft.label, category: draft.category })
    if (!result.ok) throw new Error(failureText(result.error, t))
    requestIds.settle(key)
    setEditor(undefined)
    setNotice(undefined)
    void reloadRef.current()
  }, [createStatus, editor, requestIds, t, updateStatus, workspaceId])

  /**
   * Archive is refused by the Host while the list still holds cards, with the
   * count in the message: the notice says it, and no card is moved behind the
   * Human's back.
   */
  const handleArchive = useCallback(async (column: BoardColumnModel) => {
    const key = `archive:${column.key}`
    const result = await archiveStatus({ requestId: requestIds.forIntent(key), workspaceId, key: column.key })
    if (!result.ok) {
      setNotice({ text: failureText(result.error, t), tone: 'error' })
      void reloadRef.current()
      return
    }
    requestIds.settle(key)
    setNotice(undefined)
    void reloadRef.current()
  }, [archiveStatus, requestIds, reloadRef, t, workspaceId])

  const toggleCollapse = useCallback((columnId: string) => {
    setCollapsed(prev => {
      const next = toggleCollapsedColumn(prev, columnId)
      writeCollapsedColumns(workspaceId, next)
      return next
    })
  }, [workspaceId])

  // The preference is per Workspace and the board stays mounted when the reader
  // switches Workspace, so the set is re-read when the id changes — and when
  // the catalog first arrives, because a collapsed custom list's id is not
  // known before the read.
  const catalogIds = columns.map(column => column.id).join('|')
  const collapsedWorkspace = useRef(workspaceId)
  useEffect(() => {
    const workspaceChanged = collapsedWorkspace.current !== workspaceId
    collapsedWorkspace.current = workspaceId
    if (!workspaceChanged && catalogIds === '') return
    setCollapsed(readCollapsedColumns(workspaceId, new Set(catalogIds === '' ? [] : catalogIds.split('|'))))
  }, [workspaceId, catalogIds])

  // The columns' tasks and live badges, derived once per render of the mirror.
  // `visibleTaskMap` is the frozen map while a drag or settle holds the mirror, the live one otherwise.
  const visibleTaskMap = taskMapRef.current
  const columnTasks = useMemo(() => new Map(visibleColumns.map(column => {
    const ids = mirror[column.id] ?? []
    return [column.id, ids.flatMap(id => {
      const task = visibleTaskMap.get(id)
      return task === undefined ? [] : [task]
    })] as const
  })), [mirror, visibleColumns, visibleTaskMap])
  const columnActivities = useMemo(() => new Map(visibleColumns.map(column => {
    const threads = new Set((columnTasks.get(column.id) ?? []).map(task => task.threadRef as string))
    return [column.id, activities.filter(activity => activity.threadRef !== undefined && threads.has(activity.threadRef))] as const
  })), [activities, columnTasks, visibleColumns])

  // The open issue's Task: the slice the reader is in, if any. The board
  // scrolls the card into view; the walk between the issues is the panel's
  // (M-69), over the order published just below.
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const openTaskRef = navigationState.issueVariant === 'slice' ? navigationState.issueRef : undefined

  // The columns as they stand, with the Tasks in each: the walk moves
  // between the issues of a column, and between the columns. A collapsed
  // column shows no cards, so the walk never opens an issue into it.
  const walkableColumns = useMemo(() => visibleColumns
    .filter(column => !collapsed.has(column.id))
    .map(column => ({
      columnId: column.id,
      taskRefs: (columnTasks.get(column.id) ?? []).map(task => task.taskRef),
    })), [visibleColumns, collapsed, columnTasks])

  // J/K step between the issues of the column, H/L between the columns — and
  // the board publishes that order instead of holding the keys (M-69): the
  // panel owns the keyboard and walks what the face behind it published, so a
  // slice opened over the Inbox walks the Inbox, and a slice over a face that
  // publishes nothing does not walk at all. Each card carries its own opener,
  // so closing the issue after a step gives the focus to the card the reader
  // is standing on.
  const peekOwner = useRef<object>({})
  useEffect(() => {
    const owner = peekOwner.current
    peekOrder.publish(owner, {
      columns: walkableColumns.map(column => column.taskRefs.map(taskRef => ({
        taskRef,
        workspaceId,
        focusOpener: focusCardOf(taskRef),
      }))),
    })
    return () => { peekOrder.unpublish(owner) }
  }, [focusCardOf, peekOrder, walkableColumns, workspaceId])

  // The card the reader is on is scrolled into view: the slice opens over
  // the board, and the walk moves from card to card.
  useEffect(() => {
    if (openTaskRef === undefined) return
    const root = pageRef.current
    if (root === null) return
    const card = [...root.querySelectorAll<HTMLElement>('[data-task-ref]')]
      .find(entry => entry.getAttribute('data-task-ref') === openTaskRef)
    // jsdom has no scrollIntoView, and the card is the only thing that moves.
    if (card !== undefined && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [openTaskRef])

  const empty = (rows ?? []).length === 0
  const loading = rows === undefined && loadError === undefined

  return (
    <div ref={pageRef} className={`${look.multicaLook} ${css.page}`} data-testid="team-board-page">
      {/* Test seam: exposes the settle lock so specs can observe the window
          between the drop and the refetch without depending on timing. */}
      <span data-testid="board-debug-state" data-settling={[...settlingRefs].join(',')} hidden aria-hidden="true" />
      <div className={css.toolbar}>
        <BoardFilterBar filters={filters} onFiltersChange={setFilters} channels={channels} members={members} t={t} />
        <button type="button" className={css.newTaskButton} data-testid="board-new-task" onClick={openCreate}>
          + {t('boardNewTask')}
        </button>
      </div>
      {notice !== undefined && (
        <p className={css.notice} role="alert" data-tone={notice.tone} data-testid="board-notice">{notice.text}</p>
      )}
      {loadError !== undefined && <p className={css.notice} role="alert" data-tone="error" data-testid="board-load-error">{loadError}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t('boardDragInstructions') } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={pan.ref}
          onPointerDown={pan.onPointerDown}
          onPointerMove={pan.onPointerMove}
          onPointerUp={pan.onPointerUp}
          onPointerCancel={pan.onPointerCancel}
          onLostPointerCapture={pan.onLostPointerCapture}
          className={css.scroller}
          data-board-scroller=""
        >
          {loading ? (
            <div className={css.emptyBoard} role="status" data-testid="board-loading">{t('boardLoading')}</div>
          ) : rows !== undefined && empty && isEmptyTaskFilters(filters) ? (
            <div className={css.emptyBoard}>{t('boardEmpty')}</div>
          ) : (
            <>
              {visibleColumns.map(column => collapsed.has(column.id) ? (
                <CollapsedBoardColumn
                  key={column.id}
                  column={column}
                  count={(columnTasks.get(column.id) ?? []).length}
                  onExpand={() => { toggleCollapse(column.id) }}
                  t={t}
                />
              ) : (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={columnTasks.get(column.id) ?? []}
                  locked={activeTask !== null && columnDrop(activeTask, column, columnsRef.current).kind === 'locked'}
                  onCardClick={handleCardClick}
                  onCardUpdate={handleCardUpdate}
                  onHide={hideColumn}
                  onToggleCollapse={() => { toggleCollapse(column.id) }}
                  {...(column.builtin ? {} : { onRename: openRename, onArchive: handleArchive })}
                  onCreate={openCreate}
                  members={members}
                  activities={columnActivities.get(column.id) ?? []}
                  settlingRefs={settlingRefs}
                  t={t}
                />
              ))}
              <button type="button" className={css.addListButton} data-testid="board-add-list" onClick={openAddList}>
                + {t('boardAddList')}
              </button>
              {hiddenColumns.length > 0 && <HiddenColumnsPanel columns={hiddenColumns} onShow={showColumn} t={t} />}
            </>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask !== null ? (
            <div style={{ width: BOARD_COL_WIDTH - 24 }} className={css.dragOverlay}>
              <BoardCardContent
                task={activeTask}
                members={members}
                activities={activities.filter(activity => activity.threadRef === activeTask.threadRef)}
                settling={false}
                onUpdate={() => {}}
                onOpen={() => {}}
                t={t}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {createOpen && (
        <CreateTaskDialog
          channels={channels}
          members={members}
          onCreate={handleCreate}
          onClose={() => setCreateOpen(false)}
          t={t}
        />
      )}
      {editor !== undefined && (
        <StatusEditorDialog
          mode={editor.mode}
          {...(editor.mode === 'rename' ? { initial: { label: columnLabel(editor.column, t), category: editor.column.category } } : {})}
          onSave={async draft => { await handleListSave(draft) }}
          onClose={() => setEditor(undefined)}
          t={t}
        />
      )}
    </div>
  )
}

/** Flattens the view catalog into card rows. */
function deriveRows(view: AgentTeamView): readonly BoardCardTask[] {
  const numbers = new Map(view.taskNumbers.map(entry => [entry.taskRef, entry.taskNumber]))
  const channelNames = new Map(view.channels.map(channel => [channel.channelRef, channel.name]))
  const revisions = new Map(view.threads.map(thread => [thread.threadRef, thread.revision]))
  const claimsByThread = new Map<string, { owner: string; direction: string }>()
  for (const claim of view.claims) {
    if (claim.state !== 'active') continue
    // The first active Claim in catalog order headlines the Thread; later ones join it.
    if (claimsByThread.has(claim.threadRef)) continue
    claimsByThread.set(claim.threadRef, { owner: claim.owner, direction: claim.direction })
  }
  return view.tasks.map(task => {
    const number = numbers.get(task.taskRef) ?? 0
    const claim = claimsByThread.get(task.threadRef)
    return {
      taskRef: task.taskRef,
      channelRef: task.channelRef,
      threadRef: task.threadRef,
      status: task.status,
      ...(task.statusKey == null ? {} : { statusKey: task.statusKey }),
      taskNumber: number,
      channelName: channelNames.get(task.channelRef) ?? task.channelRef,
      threadRevision: revisions.get(task.threadRef) ?? 0,
      ...(task.title === undefined ? {} : { title: task.title }),
      ...(task.priority === undefined ? {} : { priority: task.priority }),
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      ...(task.position === undefined ? {} : { position: task.position }),
      ...(claim === undefined ? {} : { claim }),
    }
  })
}
