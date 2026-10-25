// Derived from multica-x packages/views/issues/components/board-view.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: five fixed status columns built from the `view` catalog;
// no projects, custom statuses, workflows, saved views or pagination. The
// house rule replaces Multica's optimistic mutations: a drop never moves data
// locally — the Remote commits, the change wake refetches, and only then does
// the card move; a rejected drop snaps the preview back with an inline hint.

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
  AgentTeamChannelRef,
  AgentTeamMemberId,
  AgentTeamTaskPriority,
  AgentTeamTaskRef,
  AgentTeamRequestId,
  AgentTeamClientMemberStatus,
  AgentTeamCreateTaskRequest,
  AgentTeamCreateTaskResult,
  AgentTeamMemberActivityResult,
  AgentTeamUpdateTaskRequest,
  AgentTeamUpdateTaskResult,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamConversationProps, TeamSidebarProps } from '../slots.ts'
import type { ActivitySource, TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY, STATUS_ORDER } from '../multica/status.ts'
import { filterTasks, isEmptyTaskFilters, type TaskFilters } from '../multica/filter.ts'
import { sortTasks } from '../multica/sort.ts'
import {
  buildColumns,
  findColumn,
  makeKanbanCollision,
  statusGroupId,
  statusOfColumnId,
} from '../multica/drag-utils.ts'
import { mintRequestId } from '../requests.ts'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { BoardCardContent } from './BoardCard.tsx'
import { BoardColumn, BOARD_COL_WIDTH } from './BoardColumn.tsx'
import { CollapsedBoardColumn } from './CollapsedBoardColumn.tsx'
import { readCollapsedColumns, toggleCollapsedColumn, writeCollapsedColumns } from './collapsed-columns.ts'
import { BoardFilterBar } from './BoardFilterBar.tsx'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { HiddenColumnsPanel } from './HiddenColumnsPanel.tsx'
import { dropAction, mayDrop } from './drop-rules.ts'
import { planPositionWrites } from './reorder.ts'
import { useDragSettle } from './use-drag-settle.ts'
import { useBoardDragPan } from './use-board-drag-pan.ts'
import type { BoardCardTask } from './board-types.ts'
import look from '../multica-look.module.css'
import css from './board.module.css'

const HIDDEN_KEY = 'dsh.agent-team.board.hiddenColumns'

/**
 * Every column id the board knows: today the five status columns are the whole
 * set, and M-51's status catalog is the seam that widens this one list.
 */
const KNOWN_COLUMN_IDS: ReadonlySet<string> = new Set(STATUS_ORDER.map(statusGroupId))

function readHiddenColumns(): TaskStatus[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is TaskStatus =>
      typeof entry === 'string' && STATUS_ORDER.includes(entry as TaskStatus)) : []
  } catch (error) {
    // A corrupt or blocked preference falls back to "nothing hidden"; it never blocks the board.
    void error
    return []
  }
}

function writeHiddenColumns(hidden: readonly TaskStatus[]): void {
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
  readonly changeTask: TeamConversationProps['changeTask']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  /** The global opener: the issue opens as a slice over the board. */
  readonly openIssue: TeamConversationProps['openIssue']
  /**
   * The navigation slot: the board reads the open issue's Task from it, to
   * step between the issues with the keyboard and to scroll the card the
   * reader is on into view.
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

export function TeamBoardPage({ workspaceId, loadBoard, loadMembers, loadMemberActivity, createTask, updateTask, changeTask, subscribeChanges, openIssue, navigation, t }: TeamBoardPageProps) {
  const [rows, setRows] = useState<readonly BoardCardTask[]>()
  const [channels, setChannels] = useState<readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string }[]>([])
  const [members, setMembers] = useState<readonly AssigneeOption[]>([])
  const [activities, setActivities] = useState<readonly ActivitySource[]>([])
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [filters, setFilters] = useState<TaskFilters>({ channelRefs: [], assignees: [], priorities: [], statuses: [], text: '' })
  const [hidden, setHidden] = useState<TaskStatus[]>(readHiddenColumns)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedColumns(workspaceId, KNOWN_COLUMN_IDS))
  const [createOpen, setCreateOpen] = useState(false)
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
    // activity wakes move the live badges.
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
  const visibleStatuses = useMemo(() => STATUS_ORDER.filter(status => !hidden.includes(status)), [hidden])
  const columnIds = useMemo(() => visibleStatuses.map(statusGroupId), [visibleStatuses])
  const columnIdSet = useMemo(() => new Set(columnIds), [columnIds])
  const filtered = useMemo(() => {
    const base = rows ?? []
    const sorted = sortTasks(base, 'position', 'asc')
    return filterTasks(sorted, filters)
  }, [rows, filters])
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  const columnIdsRef = useRef(columnIds)
  columnIdsRef.current = columnIds

  const {
    columns,
    setColumns,
    columnsRef,
    isDraggingRef,
    isSettlingRef,
    recentlyMovedRef,
    settleVersion,
    beginSettle,
  } = useDragSettle(() => buildColumns(rows ?? [], columnIds))

  // Between drags the mirror follows the loaded rows; during a drag or a
  // settle it is frozen by the locks.
  useEffect(() => {
    if (!isDraggingRef.current && !isSettlingRef.current) {
      setColumns(buildColumns(filtered, columnIds))
    }
  }, [filtered, columnIds, settleVersion, setColumns, isDraggingRef, isSettlingRef])

  const resyncColumns = useCallback(() => {
    setColumns(buildColumns(filteredRef.current, columnIdsRef.current))
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

  // A collapsed column and a hidden one both resolve to no status: a drop over
  // either moves nothing and writes nothing.
  const columnStatusOf = useCallback((columnId: string): TaskStatus | null => {
    const status = statusOfColumnId(columnId)
    if (status === null || !visibleStatuses.includes(status)) return null
    return collapsed.has(columnId) ? null : status
  }, [collapsed, visibleStatuses])

  // --- Screen-reader announcements (dnd-kit's defaults are English only) ---
  const announcements = useMemo<Announcements>(() => {
    const titleOf = (id: string): string => {
      const task = taskMapRef.current.get(id)
      return task === undefined ? id : task.title ?? `#${task.taskNumber}`
    }
    const columnLabel = (overId: string): string => {
      const columnId = findColumn(columnsRef.current, overId, columnIdSet)
      const status = columnId === null ? null : statusOfColumnId(columnId)
      return status === null ? '' : t(STATUS_LABEL_KEY[status])
    }
    return {
      onDragStart: ({ active }) => t('boardAnnounceStart', { title: titleOf(active.id as string) }),
      onDragOver: ({ active, over }) => over === null ? undefined : t('boardAnnounceOver', { title: titleOf(active.id as string), column: columnLabel(over.id as string) }),
      onDragEnd: ({ active, over }) => over === null ? t('boardAnnounceCancel', { title: titleOf(active.id as string) }) : t('boardAnnounceDrop', { title: titleOf(active.id as string), column: columnLabel(over.id as string) }),
      onDragCancel: ({ active }) => t('boardAnnounceCancel', { title: titleOf(active.id as string) }),
    }
  }, [columnIdSet, columnsRef, t])

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
      if (columnStatusOf(overCol) === null) return prev
      recentlyMovedRef.current = true
      const oldIds = (prev[activeCol] ?? []).filter(id => id !== activeId)
      const newIds = [...(prev[overCol] ?? [])]
      const overIndex = newIds.indexOf(overId)
      newIds.splice(overIndex >= 0 ? overIndex : newIds.length, 0, activeId)
      return { ...prev, [activeCol]: oldIds, [overCol]: newIds }
    })
  }, [columnIdSet, columnStatusOf, recentlyMovedRef, setColumns])

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
    const cols = columnsRef.current
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

    // The origin is the Task's own status, not the mirror column: onDragOver
    // has already moved the card across the mirror, so a cross-column drop
    // would otherwise read as a same-column reorder.
    const currentStatus = task.status
    const targetStatus = columnStatusOf(overCol)
    if (targetStatus === null) {
      resyncColumns()
      return
    }

    // Same-column reorder: persist a position between the neighbours.
    if (targetStatus === currentStatus) {
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

    // Cross-column drop. The human rules: done/closed/todo only, and todo
    // only from done/closed. The locked live statuses answer with a hint and
    // a snap-back — the preview is discarded, no Remote is called.
    if (!mayDrop(currentStatus, targetStatus) || (targetStatus !== 'todo' && targetStatus !== 'done' && targetStatus !== 'closed')) {
      resyncColumns()
      setNotice({ text: t('boardDropLocked'), tone: 'info' })
      return
    }

    // The card moves only after the Remote result plus the change event: the
    // settle lock holds the preview, the reload re-derives the columns, and
    // the settle release resyncs the mirror. On a refusal the resync snaps the
    // card back and the notice explains why.
    const release = beginCardSettle(activeId)
    const action = dropAction(targetStatus)
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
  }, [beginCardSettle, changeTask, columnIdSet, columnStatusOf, columnsRef, conclude, isDraggingRef, requestIds, resyncColumns, setColumns, t, updateTask, workspaceId])

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

  const hideColumn = useCallback((status: TaskStatus) => {
    setHidden(prev => {
      const next = prev.includes(status) ? prev : [...prev, status]
      writeHiddenColumns(next)
      return next
    })
  }, [])

  const showColumn = useCallback((status: TaskStatus) => {
    setHidden(prev => {
      const next = prev.filter(entry => entry !== status)
      writeHiddenColumns(next)
      return next
    })
  }, [])

  const openCreate = useCallback(() => { setCreateOpen(true) }, [])

  const toggleCollapse = useCallback((columnId: string) => {
    setCollapsed(prev => {
      const next = toggleCollapsedColumn(prev, columnId)
      writeCollapsedColumns(workspaceId, next)
      return next
    })
  }, [workspaceId])

  // The preference is per Workspace and the board stays mounted when the reader
  // switches Workspace, so the set is re-read when the id changes.
  const collapsedWorkspace = useRef(workspaceId)
  useEffect(() => {
    if (collapsedWorkspace.current === workspaceId) return
    collapsedWorkspace.current = workspaceId
    setCollapsed(readCollapsedColumns(workspaceId, KNOWN_COLUMN_IDS))
  }, [workspaceId])

  // The columns' tasks and live badges, derived once per render of the mirror.
  // `visibleTaskMap` is the frozen map while a drag or settle holds the mirror, the live one otherwise.
  const visibleTaskMap = taskMapRef.current
  const columnTasks = useMemo(() => new Map(STATUS_ORDER.map(status => {
    const ids = columns[statusGroupId(status)] ?? []
    return [status, ids.flatMap(id => {
      const task = visibleTaskMap.get(id)
      return task === undefined ? [] : [task]
    })] as const
  })), [columns, visibleTaskMap])
  const columnActivities = useMemo(() => new Map(STATUS_ORDER.map(status => {
    const threads = new Set((columnTasks.get(status) ?? []).map(task => task.threadRef as string))
    return [status, activities.filter(activity => activity.threadRef !== undefined && threads.has(activity.threadRef))] as const
  })), [activities, columnTasks])

  // The open issue's Task: the slice the reader is in, if any. The board
  // reads it to walk between the issues and to scroll the card into view.
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const openTaskRef = navigationState.issueVariant === 'slice' ? navigationState.issueRef : undefined

  // The columns as they stand, with the Tasks in each: the walk moves
  // between the issues of a column, and between the columns. A collapsed
  // column shows no cards, so the walk never opens an issue into it.
  const walkableColumns = useMemo(() => visibleStatuses
    .filter(status => !collapsed.has(statusGroupId(status)))
    .map(status => ({
      status,
      taskRefs: (columnTasks.get(status) ?? []).map(task => task.taskRef),
    })), [visibleStatuses, collapsed, columnTasks])

  // J/K step between the issues of the column, H/L between the columns. The
  // walk is the board's: a slice opened over another face has no board to
  // walk, and the keys do nothing there. A field or a menu keeps its own
  // keys — the comment composer inside the slice is a field.
  useEffect(() => {
    if (openTaskRef === undefined) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, input, select, [role="menu"], [role="listbox"]') !== null)) return
      const key = event.key.toLowerCase()
      if (key !== 'j' && key !== 'k' && key !== 'h' && key !== 'l') return
      const column = walkableColumns.findIndex(entry => entry.taskRefs.includes(openTaskRef))
      if (column === -1) return
      const current = walkableColumns[column]
      if (current === undefined) return
      const taskRefs = current.taskRefs
      const index = taskRefs.indexOf(openTaskRef)
      let nextColumn = column
      let nextIndex = index
      if (key === 'j') nextIndex = Math.min(index + 1, taskRefs.length - 1)
      else if (key === 'k') nextIndex = Math.max(index - 1, 0)
      else {
        // H/L move between the columns, to the nearest one that holds a card:
        // a walk that lands on an empty column is a walk that stops.
        nextColumn = column
        for (let step = 1; step < walkableColumns.length; step += 1) {
          const candidate = key === 'l' ? column + step : column - step
          const entry = walkableColumns[candidate]
          if (entry === undefined || entry.taskRefs.length === 0) continue
          nextColumn = candidate
          break
        }
        if (nextColumn === column) return
        const neighbour = walkableColumns[nextColumn]
        if (neighbour === undefined) return
        nextIndex = Math.min(index, Math.max(neighbour.taskRefs.length - 1, 0))
      }
      const nextRef = walkableColumns[nextColumn]?.taskRefs[nextIndex]
      if (nextRef === undefined || nextRef === openTaskRef) return
      event.preventDefault()
      openIssue(nextRef, { workspaceId })
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [openTaskRef, walkableColumns, openIssue, workspaceId])

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
              {visibleStatuses.map(status => collapsed.has(statusGroupId(status)) ? (
                <CollapsedBoardColumn
                  key={status}
                  status={status}
                  count={(columnTasks.get(status) ?? []).length}
                  onExpand={() => { toggleCollapse(statusGroupId(status)) }}
                  t={t}
                />
              ) : (
                <BoardColumn
                  key={status}
                  status={status}
                  tasks={columnTasks.get(status) ?? []}
                  locked={activeTask !== null && !mayDrop(activeTask.status, status)}
                  onCardClick={handleCardClick}
                  onCardUpdate={handleCardUpdate}
                  onHide={hideColumn}
                  onToggleCollapse={() => { toggleCollapse(statusGroupId(status)) }}
                  onCreate={openCreate}
                  members={members}
                  activities={columnActivities.get(status) ?? []}
                  settlingRefs={settlingRefs}
                  t={t}
                />
              ))}
              {hidden.length > 0 && <HiddenColumnsPanel hidden={hidden} onShow={showColumn} t={t} />}
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
