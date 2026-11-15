import { describe, expect, it } from 'vitest'
import type { AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createIssuePeekOrders, orderHolding, stepPeekOrder, type IssuePeekOrder, type IssuePeekStep } from '../src/client/issue/peek-order.ts'

const workspaceId = 'workspace:alpha' as WorkspaceId
const task = (ref: string): AgentTeamTaskRef => ref as AgentTeamTaskRef

/** One published order from column names: `order(['a', 'b'], ['c'])`. */
function order(...columns: readonly (readonly string[])[]): IssuePeekOrder {
  return { columns: columns.map(column => column.map(ref => ({ taskRef: task(ref), workspaceId }) satisfies IssuePeekStep)) }
}

function stepOf(peek: IssuePeekOrder | undefined, ref: string, key: 'j' | 'k' | 'h' | 'l'): string | undefined {
  if (peek === undefined) return undefined
  return stepPeekOrder(peek, task(ref), key)?.taskRef
}

describe('the published walk', () => {
  it('steps within the issue\'s own column and stops at its ends', () => {
    const peek = order(['a', 'b', 'c'], ['d'])
    expect(stepOf(peek, 'a', 'j')).toBe('b')
    expect(stepOf(peek, 'c', 'j')).toBeUndefined()
    expect(stepOf(peek, 'c', 'k')).toBe('b')
    expect(stepOf(peek, 'a', 'k')).toBeUndefined()
  })

  it('moves to the nearest column that holds an issue, carrying the index', () => {
    // The empty column is a stop the walk skips, and the neighbour's length
    // clamps the index it lands on: `d` is the third card of its column.
    const peek = order(['a', 'b'], [], ['c', 'd', 'e'])
    expect(stepOf(peek, 'b', 'l')).toBe('d')
    expect(stepOf(peek, 'd', 'h')).toBe('b')
    // At the last column there is nowhere right to go.
    expect(stepOf(peek, 'e', 'l')).toBeUndefined()
    expect(stepOf(peek, 'a', 'h')).toBeUndefined()
  })

  it('carries an index the neighbour cannot hold', () => {
    const peek = order(['a', 'b', 'c'], ['d'])
    // The third card steps across onto the only card the neighbour has.
    expect(stepOf(peek, 'c', 'l')).toBe('d')
  })

  it('does not walk an issue the order does not hold', () => {
    const peek = order(['a', 'b'])
    expect(stepPeekOrder(peek, task('elsewhere'), 'j')).toBeUndefined()
    expect(orderHolding([peek], task('a'))).toBe(peek)
    expect(orderHolding([peek], task('elsewhere'))).toBeUndefined()
  })
})

describe('the published orders', () => {
  it('keeps one entry per face and drops it when the face withdraws', () => {
    const orders = createIssuePeekOrders()
    const board = {}
    const inbox = {}
    orders.publish(board, order(['a', 'b']))
    orders.publish(inbox, order(['c']))
    expect(orders.get()).toHaveLength(2)
    // Republishing the same order changes nothing the walk can see.
    orders.publish(board, order(['a', 'b']))
    expect(orders.get()).toHaveLength(2)
    orders.unpublish(board)
    expect(orders.get()).toHaveLength(1)
    expect(orderHolding(orders.get(), task('c'))).toBeDefined()
    orders.unpublish(board)
    expect(orders.get()).toHaveLength(1)
  })

  it('picks the order that holds the open issue when two faces published', () => {
    const orders = createIssuePeekOrders()
    const board = {}
    const inbox = {}
    orders.publish(board, order(['a'], ['b']))
    orders.publish(inbox, order(['c']))
    expect(orderHolding(orders.get(), task('b'))?.columns).toHaveLength(2)
    expect(orderHolding(orders.get(), task('c'))?.columns).toHaveLength(1)
    expect(orderHolding(orders.get(), task('nowhere'))).toBeUndefined()
  })
})
