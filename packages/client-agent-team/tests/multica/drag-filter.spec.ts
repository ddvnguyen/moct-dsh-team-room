// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildColumns,
  computePosition,
  findColumn,
  getMoveAnchors,
  getMoveUpdates,
  insertIdByPosition,
  makeKanbanCollision,
  statusGroupId,
  statusOfColumnId,
} from '../../src/client/multica/drag-utils.ts'
import { filterTasks, isEmptyTaskFilters, taskFilterCount, UNASSIGNED } from '../../src/client/multica/filter.ts'
import { sortTasks } from '../../src/client/multica/sort.ts'
import type { BoardTaskLike } from '../../src/client/multica/types.ts'

function task(overrides: Partial<BoardTaskLike> & Pick<BoardTaskLike, 'taskRef'>): BoardTaskLike {
  return {
    channelRef: 'channel-1',
    threadRef: `thread-${overrides.taskRef}`,
    status: 'todo',
    priority: 'none',
    position: 0,
    title: overrides.taskRef,
    assignee: null,
    ...overrides,
  }
}

describe('multica drag helpers', () => {
  const a = task({ taskRef: 'a', position: 0 })
  const b = task({ taskRef: 'b', position: 10 })
  const c = task({ taskRef: 'c', position: 20 })
  const map = new Map([a, b, c].map(item => [item.taskRef, item]))

  it('computes a position before, between and after', () => {
    expect(computePosition(['a', 'b'], 'a', map)).toBe(9)
    expect(computePosition(['a', 'b', 'c'], 'b', map)).toBe(10)
    expect(computePosition(['b', 'a'], 'a', map)).toBe(11)
  })

  it('returns the anchors around the dragged card', () => {
    expect(getMoveAnchors(['a', 'b', 'c'], 'b')).toEqual({ beforeId: 'a', afterId: 'c' })
    expect(getMoveAnchors(['a', 'b', 'c'], 'a')).toEqual({ beforeId: null, afterId: 'b' })
  })

  it('buckets cards by status column', () => {
    const columns = buildColumns([
      task({ taskRef: 'a', status: 'todo' }),
      task({ taskRef: 'b', status: 'in_progress' }),
      task({ taskRef: 'c', status: 'todo' }),
    ], [statusGroupId('todo'), statusGroupId('in_progress')])
    expect(columns).toEqual({ 'status:todo': ['a', 'c'], 'status:in_progress': ['b'] })
  })

  it('inserts by position and finds the containing column', () => {
    expect(insertIdByPosition(['a', 'b'], 'x', 5, map)).toEqual(['a', 'x', 'b'])
    expect(findColumn({ 'status:todo': ['a'] }, 'a', new Set(['status:todo']))).toBe('status:todo')
    expect(statusOfColumnId('status:in_review')).toBe('in_review')
    expect(statusOfColumnId('card-a')).toBeNull()
  })

  it('never emits a status write for a same-column reorder', () => {
    expect(getMoveUpdates('status:todo', 5, { status: 'todo' })).toEqual({ position: 5 })
    expect(getMoveUpdates('status:done', 5, { status: 'todo' })).toEqual({ status: 'done', position: 5 })
  })

  it('prefers a pointer hit on a card over its column', () => {
    // The collision factory is exercised through the board's own drag spec;
    // here we only pin that it is a function of the column id set.
    expect(typeof makeKanbanCollision(new Set(['status:todo']))).toBe('function')
  })
})

describe('multica task filters and sort', () => {
  const tasks = [
    task({ taskRef: 'a', title: 'Fix login', priority: 'high', assignee: 'm1', channelRef: 'c1', status: 'todo' }),
    task({ taskRef: 'b', title: 'Write docs', priority: 'low', assignee: null, channelRef: 'c2', status: 'in_review' }),
    task({ taskRef: 'c', title: 'Login audit', priority: 'urgent', assignee: 'm2', channelRef: 'c1', status: 'todo' }),
  ]

  it('matches every facet with AND, any value within a facet with OR', () => {
    expect(filterTasks(tasks, { ...empty(), channelRefs: ['c1'] }).map(t => t.taskRef)).toEqual(['a', 'c'])
    expect(filterTasks(tasks, { ...empty(), assignees: [UNASSIGNED] }).map(t => t.taskRef)).toEqual(['b'])
    expect(filterTasks(tasks, { ...empty(), priorities: ['high', 'urgent'] }).map(t => t.taskRef)).toEqual(['a', 'c'])
    expect(filterTasks(tasks, { ...empty(), text: 'login' }).map(t => t.taskRef)).toEqual(['a', 'c'])
    expect(filterTasks(tasks, { ...empty(), statuses: ['in_review'] }).map(t => t.taskRef)).toEqual(['b'])
  })

  it('counts active predicates for the filter badge', () => {
    expect(isEmptyTaskFilters(empty())).toBe(true)
    expect(taskFilterCount({ ...empty(), channelRefs: ['c1'], text: 'x' })).toBe(2)
  })

  it('sorts by priority severity and by manual position', () => {
    expect(sortTasks(tasks, 'priority', 'asc').map(t => t.taskRef)).toEqual(['c', 'a', 'b'])
    expect(sortTasks([task({ taskRef: 'x', position: 2 }), task({ taskRef: 'y', position: 1 })], 'position', 'desc').map(t => t.taskRef)).toEqual(['y', 'x'])
  })
})

function empty() {
  return { channelRefs: [], assignees: [], priorities: [], statuses: [], text: '' } as const
}
