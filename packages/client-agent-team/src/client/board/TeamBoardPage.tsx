// Derived from multica-x packages/views/issues/components/board-view.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: five fixed status columns built from the `view` catalog;
// no projects, custom statuses, workflows, saved views or pagination. The
// house rule replaces Multica's optimistic mutations: a drop never moves data
// locally — the Remote commits, the change wake refetches, and only then does
// the card move; a rejected drop snaps the preview back with an inline hint.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  AgentTeamChannelRef,
  AgentTeamMemberId,
  AgentTeamTaskPriority,
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
import { STATUS_ORDER } from '../multica/status.ts'
import { filterTasks, type TaskFilters } from '../multica/filter.ts'
import { sortTasks } from '../multica/sort.ts'
import {
  buildColumns,
  computePosition,
  findColumn,
  makeKanbanCollision,
  statusGroupId,
} from '../multica/drag-utils.ts'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { BoardCardContent } from './BoardCard.tsx'
import { BoardColumn, BOARD_COL_WIDTH } from './BoardColumn.tsx'
import { BoardFilterBar } from './BoardFilterBar.tsx'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { HiddenColumnsPanel } from './HiddenColumnsPanel.tsx'
import { useDragSettle } from './use-drag-settle.ts'
import { useBoardDragPan } from './use-board-drag-pan.ts'
import type { BoardCardTask } from './board-types.ts'
import look from '../multica-look.module.css'
import css from './board.module.css'

const HIDDEN_KEY = 'dsh.agent-team.board.hiddenColumns'

function readHiddenColumns(): TaskStatus[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is TaskStatus =>
      typeof entry === 'string' && STATUS_ORDER.includes(entry as TaskStatus)) : []
  } catch {
    return []
  }
}

function writeHiddenColumns(hidden: readonly TaskStatus[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)) } catch { /* private mode */ }
}

export interface TeamBoardPageProps {
  readonly workspaceId: WorkspaceId
  readonly loadBoard: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<AgentTeamView>>
  readonly loadMembers: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
  readonly loadMemberActivity: (request: { readonly workspaceId: WorkspaceId }) => Promise<RemoteResult<AgentTeamMemberActivityResult>>
  readonly createTask: (request: AgentTeamCreateTaskRequest) => Promise<RemoteResult<AgentTeamCreateTaskResult>>
  readonly updateTask: (request: AgentTeamUpdateTaskRequest) => Promise<RemoteResult<AgentTeamUpdateTaskResult>>
  readonly changeTask: TeamConversationProps['changeTask']
  readonly subscribeChanges: (scope: { readonly kind: 'workspace' | 'activity'; readonly workspaceId: WorkspaceId }, listener: () => void) => () => void
  readonly selectThread: TeamConversationProps['selectThread']
  readonly t: TeamSidebarProps['t']
}

function requestId(prefix: string): AgentTeamRequestId {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}` as AgentTeamRequestId
}

export function TeamBoardPage({ workspaceId, loadBoard, loadMembers, loadMemberActivity, createTask, updateTask, changeTask, subscribeChanges, selectThread, t }: TeamBoardPageProps) {
  const [rows, setRows] = useState<readonly BoardCardTask[]>()
  const [channels, setChannels] = useState<readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string }[]>([])
  const [members, setMembers] = useState<readonly AssigneeOption[]>([])
  const [activities, setActivities] = useState<readonly ActivitySource[]>([])
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<{ readonly text: string; readonly tone: 'error' | 'info' }>()
  const [filters, setFilters] = useState<TaskFilters>({ channelRefs: [], assignees: [], priorities: [], statuses: [], text: '' })
  const [hidden, setHidden] = useState<TaskStatus[]>(readHiddenColumns)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<BoardCardTask | null>(null)
  const [settlingRefs, setSettlingRefs] = useState<ReadonlySet<string>>(new Set())

  // --- Data loads ---
  const reloadBoard = useCallback(async () => {
    const [viewResult, memberResult] = await Promise.all([
      loadBoard({ workspaceId }),
      loadMembers({ workspaceId }),
    ])
    if (!viewResult.ok) {
      setLoadError(viewResult.error instanceof Error ? viewResult.error.message : String(viewResult.error))
      return
    }
    setLoadError(undefined)
    const view = viewResult.value
    setChannels(view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })))
    setMembers(memberResult.ok
      ? memberResult.value.map(member => ({ memberId: member.member.memberId, handle: member.member.handle }))
      : [])
    setRows(deriveRows(view))
  }, [loadBoard, loadMembers, workspaceId])

  const reloadActivity = useCallback(async () => {
    const result = await loadMemberActivity({ workspaceId })
    if (result.ok) setActivities(result.value.activities)
  }, [loadMemberActivity, workspaceId])

  const reloadRef = useRef(reloadBoard)
  reloadRef.current = reloadBoard
  const reloadActivityRef = useRef(reloadActivity)
  reloadActivityRef.current = reloadActivity

  useEffect(() => {
    void reloadRef.current()
    void reloadActivityRef.current()
    // Workspace commits move Tasks; activity wakes move the live badges.
    const stopWorkspace = subscribeChanges({ kind: 'workspace', workspaceId }, () => { void reloadRef.current() })
    const stopActivity = subscribeChanges({ kind: 'activity', workspaceId }, () => { void reloadActivityRef.current() })
    return () => { stopWorkspace(); stopActivity() }
  }, [subscribeChanges, workspaceId])

  // --- Derivation ---
  const visibleStatuses = useMemo(() => STATUS_ORDER.filter(status => !hidden.includes(status)), [hidden])
  const columnIds = useMemo(() => visibleStatuses.map(statusGroupId), [visibleStatuses])
  const filtered = useMemo(() => {
    const base = rows ?? []
    const sorted = sortTasks(base, 'position', 'asc')
    return filterTasks(sorted, filters)
  }, [rows, filters])

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

  const taskMap = useMemo(() => new Map<string, BoardCardTask>(filtered.map(task => [task.taskRef as string, task])), [filtered])
  const taskMapRef = useRef(taskMap)
  if (!isDraggingRef.current && !isSettlingRef.current) {
    taskMapRef.current = taskMap
  }

  const collisionDetection = useMemo(() => makeKanbanCollision(new Set(columnIds)), [columnIds])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const pan = useBoardDragPan<HTMLDivElement>()

  const columnStatusOf = useCallback((columnId: string): TaskStatus | null =>
    visibleStatuses.find(status => statusGroupId(status) === columnId) ?? null, [visibleStatuses])

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
      const activeCol = findColumn(prev, activeId, new Set(columnIds))
      const overCol = findColumn(prev, overId, new Set(columnIds))
      if (!activeCol || !overCol || activeCol === overCol) return prev
      recentlyMovedRef.current = true
      const oldIds = (prev[activeCol] ?? []).filter(id => id !== activeId)
      const newIds = [...(prev[overCol] ?? [])]
      const overIndex = newIds.indexOf(overId)
      newIds.splice(overIndex >= 0 ? overIndex : newIds.length, 0, activeId)
      return { ...prev, [activeCol]: oldIds, [overCol]: newIds }
    })
  }, [columnIds, recentlyMovedRef, setColumns])

  /** Marks one card settling until the mutation's onSettled runs. */
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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    isDraggingRef.current = false
    setActiveTask(null)

    const resetColumns = () => setColumns(buildColumns(filtered, columnIds))
    if (!over) {
      resetColumns()
      return
    }
    const activeId = active.id as string
    const overId = over.id as string
    const cols = columnsRef.current
    const activeCol = findColumn(cols, activeId, new Set(columnIds))
    const overCol = findColumn(cols, overId, new Set(columnIds))
    if (!activeCol || !overCol) {
      resetColumns()
      return
    }
    const task = taskMapRef.current.get(activeId)
    if (task === undefined) {
      resetColumns()
      return
    }

    // The origin is the Task's own status, not the mirror column: onDragOver
    // has already moved the card across the mirror, so a cross-column drop
    // would otherwise read as a same-column reorder.
    const currentStatus = task.status
    const targetStatus = columnStatusOf(overCol)

    // Same-column reorder: persist a fractional position between neighbours.
    if (targetStatus === currentStatus) {
      const ids = cols[activeCol] ?? []
      const oldIndex = ids.indexOf(activeId)
      const newIndex = ids.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        resetColumns()
        return
      }
      const reordered = [...ids]
      reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, activeId)
      const finalColumns = { ...cols, [activeCol]: reordered }
      setColumns(finalColumns)
      const position = computePosition(reordered, activeId, taskMapRef.current)
      if (position === (task.position ?? 0)) {
        resetColumns()
        return
      }
      const release = beginCardSettle(activeId)
      void (async () => {
        const result = await updateTask({
          requestId: requestId('task-position'),
          workspaceId,
          taskRef: task.taskRef,
          baseRevision: task.threadRevision,
          patch: { position },
        })
        if (result.ok && result.value.kind === 'committed') {
          setNotice(undefined)
          void reloadRef.current()
        } else {
          resetColumns()
          setNotice({ text: errorMessage(result), tone: 'error' })
        }
        release()
      })()
      return
    }

    // Cross-column drop. The human rules: done/closed/todo only, and todo
    // only from done/closed. The locked live statuses answer with a hint and
    // a snap-back — the preview is discarded, no Remote is called.
    if (targetStatus === null || currentStatus === null) {
      resetColumns()
      return
    }
    const allowed = targetStatus === 'done' || targetStatus === 'closed'
      || (targetStatus === 'todo' && (currentStatus === 'done' || currentStatus === 'closed'))
    if (!allowed || targetStatus === currentStatus) {
      resetColumns()
      if (!allowed) setNotice({ text: t('boardDropLocked'), tone: 'info' })
      return
    }

    // The card moves only after the Remote result plus the change event: the
    // settle lock holds the preview, the reload re-derives the columns, and
    // the settle release resyncs the mirror. On error the resync snaps the
    // card back and the notice explains why.
    const release = beginCardSettle(activeId)
    void (async () => {
      const action = targetStatus === 'done' ? 'accept' : targetStatus === 'closed' ? 'close' : 'reopen'
      const result = await changeTask({
        requestId: requestId('task-status'),
        workspaceId,
        taskRef: task.taskRef,
        action,
        baseRevision: task.threadRevision,
      })
      const committed = (result as { ok?: boolean; value?: { kind?: string } }).ok === true
        && (result as { value?: { kind?: string } }).value?.kind === 'committed'
      if (committed) {
        setNotice(undefined)
        void reloadRef.current()
      } else {
        resetColumns()
        setNotice({ text: errorMessage(result), tone: 'error' })
      }
      release()
    })()
  }, [beginCardSettle, changeTask, columnIds, columnStatusOf, filtered, setColumns, t, updateTask, workspaceId])

  const handleDragCancel = useCallback(() => {
    isDraggingRef.current = false
    setActiveTask(null)
    setColumns(buildColumns(filtered, columnIds))
  }, [columnIds, filtered, isDraggingRef, setColumns])

  // --- Card actions ---
  const handleCardUpdate = useCallback((taskRef: string, update: { readonly priority?: string; readonly assignee?: string | null }) => {
    const task = taskMapRef.current.get(taskRef)
    if (task === undefined) return
    const release = beginCardSettle(taskRef)
    void (async () => {
      const result = await updateTask({
        requestId: requestId('task-field'),
        workspaceId,
        taskRef: task.taskRef,
        baseRevision: task.threadRevision,
        patch: {
          ...(update.priority === undefined ? {} : { priority: update.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' }),
          ...(update.assignee === undefined ? {} : { assignee: update.assignee as AgentTeamMemberId | null }),
        },
      })
      if (result.ok && result.value.kind === 'committed') {
        setNotice(undefined)
        void reloadRef.current()
      } else {
        setNotice({ text: errorMessage(result), tone: 'error' })
      }
      release()
    })()
  }, [beginCardSettle, updateTask, workspaceId])

  const handleCardClick = useCallback((task: BoardCardTask) => {
    selectThread(task.threadRef, task.channelRef, task.taskRef, task.taskNumber)
  }, [selectThread])

  const handleCreate = useCallback(async (request: { readonly channelRef: AgentTeamChannelRef; readonly title: string; readonly body: string; readonly priority?: AgentTeamTaskPriority; readonly assignee?: AgentTeamMemberId | null }) => {
    const result = await createTask({
      requestId: requestId('task-create'),
      workspaceId,
      channelRef: request.channelRef,
      title: request.title,
      body: request.body,
      ...(request.priority === undefined ? {} : { priority: request.priority }),
      assignee: request.assignee as AgentTeamMemberId | null,
    })
    if (result.ok) {
      setCreateOpen(false)
      setNotice(undefined)
      void reloadRef.current()
      return
    }
    throw new Error(errorMessage(result))
  }, [createTask, workspaceId])

  /** The human rules as a pure test: where may this card be dropped? */
  const mayDrop = useCallback((from: TaskStatus, to: TaskStatus): boolean =>
    to === 'done' || to === 'closed' || (to === 'todo' && (from === 'done' || from === 'closed')), [])

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

  const empty = (rows ?? []).length === 0
  const columnTasks = useCallback((status: TaskStatus): BoardCardTask[] => {
    const ids = columns[statusGroupId(status)] ?? []
    return ids.flatMap(id => {
      const task = taskMapRef.current.get(id)
      return task === undefined ? [] : [task]
    })
  }, [columns])

  return (
    <div className={`${look.multicaLook} ${css.page}`} data-testid="team-board-page">
      {/* Test seam: exposes the settle lock so specs can observe the window
          between the drop and the refetch without depending on timing. */}
      <span data-testid="board-debug-state" data-settling={[...settlingRefs].join(',')} hidden aria-hidden="true" />
      <div className={css.toolbar}>
        <BoardFilterBar filters={filters} onFiltersChange={setFilters} channels={channels} members={members} t={t} />
        <span className={css.spacer} />
        <button type="button" className={css.newTaskButton} data-testid="board-new-task" onClick={() => setCreateOpen(true)}>
          + {t('boardNewTask')}
        </button>
      </div>
      {notice !== undefined && (
        <p className={css.notice} role="alert" data-tone={notice.tone} data-testid="board-notice">{notice.text}</p>
      )}
      {loadError !== undefined && <p className={css.notice} role="alert" data-tone="error">{loadError}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
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
          {empty && (filters.channelRefs.length === 0 && filters.assignees.length === 0 && filters.priorities.length === 0 && (filters.text ?? '') === '') ? (
            <div className={css.emptyBoard}>{t('boardEmpty')}</div>
          ) : (
            <>
              {visibleStatuses.map(status => (
                <BoardColumn
                  key={status}
                  status={status}
                  tasks={columnTasks(status)}
                  totalCount={columnTasks(status).length}
                  locked={activeTask !== null && !mayDrop(activeTask.status, status)}
                  onCardClick={handleCardClick}
                  onCardUpdate={handleCardUpdate}
                  onHide={() => hideColumn(status)}
                  onCreate={() => setCreateOpen(true)}
                  members={members}
                  activities={activities.filter(activity => columnTasks(status).some(task => task.threadRef === activity.threadRef))}
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

function errorMessage(result: unknown): string {
  const failure = result as { error?: { message?: string } | Error }
  if (failure?.error instanceof Error) return failure.error.message
  if (typeof failure?.error?.message === 'string') return failure.error.message
  return 'unknown error'
}

/** Flattens the view catalog into card rows. */
function deriveRows(view: AgentTeamView): readonly BoardCardTask[] {
  const numbers = new Map(view.taskNumbers.map(entry => [entry.taskRef, entry.taskNumber]))
  const channelNames = new Map(view.channels.map(channel => [channel.channelRef, channel.name]))
  const revisions = new Map(view.threads.map(thread => [thread.threadRef, thread.revision]))
  const claimsByThread = new Map<string, { owner: string; direction: string }>()
  for (const claim of view.claims) {
    if (claim.state !== 'active') continue
    const existing = claimsByThread.get(claim.threadRef)
    // The oldest active Claim owns the Thread's headline; later ones join it.
    if (existing !== undefined) continue
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
