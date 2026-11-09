// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isHumanStatusTarget, isTerminalStatus, ISSUE_STATUS_OPTIONS, STATUS_ORDER, STATUS_RANK, statusCategoryOf, isTaskStatus } from '../../src/client/multica/status.ts'
import { normalizePriority, PRIORITY_DISPLAY_ORDER, PRIORITY_ORDER, PRIORITY_RANK, isTaskPriority } from '../../src/client/multica/priority.ts'

describe('multica status helpers', () => {
  it('keeps the five ledger statuses in board order', () => {
    expect(STATUS_ORDER).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed'])
    expect(STATUS_RANK.todo).toBe(0)
    expect(STATUS_RANK.closed).toBe(4)
  })

  // M-51: the issue status picker and the M-70 actions menu render this list.
  // A Workspace's custom board lists are columns, never issuable statuses, so
  // both surfaces must keep offering exactly the five built-ins.
  it('offers the five built-ins, and only those, on the issue picker and the actions menu', () => {
    expect(ISSUE_STATUS_OPTIONS).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed'])
    expect(ISSUE_STATUS_OPTIONS).toBe(STATUS_ORDER)
    expect(ISSUE_STATUS_OPTIONS.every(isTaskStatus)).toBe(true)
  })

  it('maps every status to its lifecycle category', () => {
    expect(statusCategoryOf('todo')).toBe('unstarted')
    expect(statusCategoryOf('in_progress')).toBe('started')
    expect(statusCategoryOf('in_review')).toBe('started')
    expect(statusCategoryOf('done')).toBe('done')
    expect(statusCategoryOf('closed')).toBe('closed')
  })

  it('only allows human drops on todo/done/closed', () => {
    expect(STATUS_ORDER.filter(isHumanStatusTarget)).toEqual(['todo', 'done', 'closed'])
    expect(isTerminalStatus('done')).toBe(true)
    expect(isTerminalStatus('in_review')).toBe(false)
  })

  it('narrows strings to a Task status', () => {
    expect(isTaskStatus('in_review')).toBe(true)
    expect(isTaskStatus('backlog')).toBe(false)
  })
})

describe('multica priority helpers', () => {
  it('sorts severity descending with none last', () => {
    expect(PRIORITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low', 'none'])
    expect(PRIORITY_RANK.urgent).toBe(0)
    expect(PRIORITY_RANK.none).toBe(4)
  })

  it('leads every menu with the empty value', () => {
    expect(PRIORITY_DISPLAY_ORDER).toEqual(['none', 'urgent', 'high', 'medium', 'low'])
  })

  it('reads an absent priority as none', () => {
    expect(normalizePriority(undefined)).toBe('none')
    expect(normalizePriority(null)).toBe('none')
    expect(normalizePriority('high')).toBe('high')
    expect(isTaskPriority('urgent')).toBe(true)
    expect(isTaskPriority('critical')).toBe(false)
  })
})
