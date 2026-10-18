// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { dropAction, mayDrop } from '../src/client/board/drop-rules.ts'
import { planPositionWrites } from '../src/client/board/reorder.ts'
import type { TaskStatus } from '../src/client/multica/types.ts'

const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']

describe('board drop rules', () => {
  it('lets a card reorder inside every column, including the claim-driven ones', () => {
    for (const status of STATUSES) expect(mayDrop(status, status)).toBe(true)
  })

  it('reaches done and closed from anywhere, and todo only from done or closed', () => {
    for (const from of STATUSES) {
      expect(mayDrop(from, 'done')).toBe(true)
      expect(mayDrop(from, 'closed')).toBe(true)
    }
    expect(mayDrop('done', 'todo')).toBe(true)
    expect(mayDrop('closed', 'todo')).toBe(true)
    expect(mayDrop('in_progress', 'todo')).toBe(false)
    expect(mayDrop('in_review', 'todo')).toBe(false)
  })

  it('never drops into the claim-driven columns from another column', () => {
    for (const from of ['todo', 'done', 'closed'] as const) {
      expect(mayDrop(from, 'in_progress')).toBe(false)
      expect(mayDrop(from, 'in_review')).toBe(false)
    }
    expect(mayDrop('in_progress', 'in_review')).toBe(false)
  })

  it('maps each reachable column to its Remote action', () => {
    expect(dropAction('done')).toBe('accept')
    expect(dropAction('closed')).toBe('close')
    expect(dropAction('todo')).toBe('reopen')
  })
})

describe('position writes for a same-column drop', () => {
  const tasks = (positions: Record<string, number | undefined>) => new Map(Object.entries(positions).map(([ref, position]) => [ref, { position }]))

  it('writes one number between distinct neighbours', () => {
    expect(planPositionWrites(['b', 'a', 'c'], 'a', tasks({ a: 1, b: 2, c: 4 }))).toEqual([{ taskRef: 'a', position: 3 }])
  })

  it('moves a card to either end of the column', () => {
    expect(planPositionWrites(['c', 'a', 'b'], 'c', tasks({ a: 2, b: 3, c: 4 }))).toEqual([{ taskRef: 'c', position: 1 }])
    expect(planPositionWrites(['b', 'c', 'a'], 'a', tasks({ a: 1, b: 2, c: 3 }))).toEqual([{ taskRef: 'a', position: 4 }])
  })

  it('writes nothing when the persisted number already fits the new place', () => {
    expect(planPositionWrites(['a', 'b'], 'a', tasks({ a: 1, b: 2 }))).toEqual([])
  })

  it('renumbers the column when the neighbours tie, writing only the cards that change', () => {
    expect(planPositionWrites(['b', 'a', 'c'], 'a', tasks({ a: undefined, b: undefined, c: undefined })))
      .toEqual([{ taskRef: 'b', position: 1 }, { taskRef: 'a', position: 2 }, { taskRef: 'c', position: 3 }])
    // Cards already holding their new number are skipped.
    expect(planPositionWrites(['a', 'b', 'c'], 'b', tasks({ a: 1, b: 5, c: 1 })))
      .toEqual([{ taskRef: 'b', position: 2 }, { taskRef: 'c', position: 3 }])
  })

  it('writes nothing for a card that is not in the column', () => {
    expect(planPositionWrites(['a', 'b'], 'x', tasks({ a: 1, b: 2 }))).toEqual([])
  })
})
