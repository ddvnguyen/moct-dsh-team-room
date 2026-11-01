// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { boardColumns, columnDrop, columnIdOf, columnLabel, type BoardColumnModel } from '../src/client/board/board-columns.ts'
import { planPositionWrites } from '../src/client/board/reorder.ts'
import { ISSUE_STATUS_OPTIONS } from '../src/client/multica/status.ts'
import type { TaskStatus } from '../src/client/multica/types.ts'

const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']

describe('board drop rules', () => {
  const builtins = boardColumns(undefined)
  const column = (key: string, columns: readonly BoardColumnModel[]) => {
    const found = columns.find(entry => entry.key === key)
    if (found === undefined) throw new Error(`missing column ${key}`)
    return found
  }
  const withLists = boardColumns([
    ...builtins.map(entry => ({ key: entry.key, label: entry.label, category: entry.category, builtin: true, archived: false })),
    { key: 'qa', label: 'QA', category: 'started' as const, builtin: false, archived: false },
  ])

  it('reorders inside a column instead of writing a drop', () => {
    for (const status of STATUSES) {
      expect(columnDrop({ status }, column(status, builtins), builtins)).toEqual({ kind: 'reorder' })
    }
  })

  it('reaches done and closed from anywhere, and todo only from done or closed', () => {
    for (const status of ['todo', 'in_progress', 'in_review'] as const) {
      expect(columnDrop({ status }, column('done', builtins), builtins)).toEqual({ kind: 'accept' })
      expect(columnDrop({ status }, column('closed', builtins), builtins)).toEqual({ kind: 'close' })
    }
    expect(columnDrop({ status: 'done' }, column('done', builtins), builtins)).toEqual({ kind: 'reorder' })
    expect(columnDrop({ status: 'closed' }, column('closed', builtins), builtins)).toEqual({ kind: 'reorder' })
    expect(columnDrop({ status: 'done' }, column('todo', builtins), builtins)).toEqual({ kind: 'reopen' })
    expect(columnDrop({ status: 'closed' }, column('todo', builtins), builtins)).toEqual({ kind: 'reopen' })
    expect(columnDrop({ status: 'in_progress' }, column('todo', builtins), builtins)).toEqual({ kind: 'locked' })
    expect(columnDrop({ status: 'in_review' }, column('todo', builtins), builtins)).toEqual({ kind: 'locked' })
  })

  it('never drops into the claim-driven columns from another column', () => {
    for (const status of ['todo', 'done', 'closed'] as const) {
      expect(columnDrop({ status }, column('in_progress', builtins), builtins)).toEqual({ kind: 'locked' })
      expect(columnDrop({ status }, column('in_review', builtins), builtins)).toEqual({ kind: 'locked' })
    }
    expect(columnDrop({ status: 'in_progress' }, column('in_review', builtins), builtins)).toEqual({ kind: 'locked' })
  })

  it('places a live card in a custom list, and sends it home when it is dropped on its own built-in column', () => {
    expect(columnDrop({ status: 'in_review' }, column('qa', withLists), withLists)).toEqual({ kind: 'place', statusKey: 'qa' })
    expect(columnDrop({ status: 'todo', statusKey: 'qa' }, column('qa', withLists), withLists)).toEqual({ kind: 'reorder' })
    // Its built-in column is a clear, not a lifecycle write.
    expect(columnDrop({ status: 'todo', statusKey: 'qa' }, column('todo', withLists), withLists)).toEqual({ kind: 'place', statusKey: null })
  })

  it('keeps a terminal card in its built-in column: a Done task is never shown as "QA"', () => {
    expect(columnDrop({ status: 'done' }, column('qa', withLists), withLists)).toEqual({ kind: 'locked' })
    expect(columnDrop({ status: 'closed' }, column('qa', withLists), withLists)).toEqual({ kind: 'locked' })
  })

  it('draws a column per live list, in catalog order, and drops an archived one', () => {
    const catalog = [
      ...builtins.map(entry => ({ key: entry.key, label: entry.label, category: entry.category, builtin: true, archived: false })),
      { key: 'qa', label: 'QA', category: 'started' as const, builtin: false, archived: false },
      { key: 'old', label: 'Old', category: 'started' as const, builtin: false, archived: true },
    ]
    expect(boardColumns(catalog).map(entry => entry.key)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed', 'qa'])
    // A card placed in a list that is gone falls back to its built-in column.
    expect(columnIdOf({ status: 'in_progress', statusKey: 'old' }, boardColumns(catalog))).toBe('status:in_progress')
  })

  // M-51: one catalog, two surfaces. The board draws the five built-in columns
  // in the order the issue picker and the actions menu offer them, and a
  // custom list is appended after them — never spliced between them.
  it('leads with the five built-ins the issue surfaces offer, in their order', () => {
    expect(boardColumns(undefined).map(entry => entry.key)).toEqual([...ISSUE_STATUS_OPTIONS])
    expect(boardColumns([
      ...builtins.map(entry => ({ key: entry.key, label: entry.label, category: entry.category, builtin: true, archived: false })),
      { key: 'qa', label: 'QA', category: 'started' as const, builtin: false, archived: false },
    ]).map(entry => entry.key)).toEqual([...ISSUE_STATUS_OPTIONS, 'qa'])
  })

  it('localizes a built-in and keeps a custom list’s own name', () => {
    const ru = ((key: string) => `ru:${key}`) as unknown as Parameters<typeof columnLabel>[1]
    expect(columnLabel(column('todo', withLists), ru)).toBe('ru:statusTodo')
    expect(columnLabel(column('qa', withLists), ru)).toBe('QA')
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
