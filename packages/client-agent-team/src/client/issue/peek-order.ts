// Derived from multica-x packages/views/issues/components/issue-peek.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the peek's walk. Upstream keeps the board's position in a
// store the panel reads; here the face behind the panel publishes the order it
// shows — the Board's columns, the Inbox's one list — and the panel walks what
// was published. The panel never reads the navigation for the order, so a face
// that publishes nothing simply has no walk, and the walk itself is a pure
// function over the published columns.
//
// The store is deliberately not a React context: the panel lives in the
// shell's overlay slot and the faces live in the main seat, so no provider
// spans both. It is a plain external store with one instance per Client, held
// by the issue client beside the context it already owns.

import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { FocusOpener } from './issue-client.ts'

/** One step of the walk: the issue, and the Workspace the face shows it in. */
export interface IssuePeekStep {
  readonly taskRef: AgentTeamTaskRef
  readonly workspaceId: WorkspaceId
  /**
   * The control the focus goes back to when the reader closes the issue while
   * standing on this step — the card, the row. A face may publish none, and
   * the seam falls back to whatever held the focus when the issue opened.
   * It is a lookup, not a captured node: a face re-draws its rows, and the
   * closure is only ever called while the issue is open.
   */
  readonly focusOpener?: FocusOpener | undefined
}

/**
 * The order one face published: its columns in display order, each column's
 * steps in reading order. The Board publishes one column per walkable column;
 * the Inbox publishes its queue as one column, so H/L has nothing to move
 * between there — the walk stops at the edge either way.
 */
export interface IssuePeekOrder {
  readonly columns: readonly (readonly IssuePeekStep[])[]
}

/** The four steps the panel's keys name: J, K, H, L. */
export type PeekStepKey = 'j' | 'k' | 'h' | 'l'

/** The published orders, newest publication per face included. */
export interface IssuePeekOrders {
  /**
   * Publishes one face's order. `owner` is the publishing component's own
   * instance (a ref), so a face that republishes replaces itself and a face
   * that unmounts withdraws only its own order.
   */
  readonly publish: (owner: object, order: IssuePeekOrder) => void
  /** Withdraws one face's order: the face unmounted, or it has nothing to show. */
  readonly unpublish: (owner: object) => void
  /** The orders as they stand: read at the keypress, never cached. */
  readonly get: () => readonly IssuePeekOrder[]
}

/**
 * A face's own step key, spelled once: the store keys an order by identity,
 * so publishing the same order twice notifies nobody.
 */
function signatureOf(order: IssuePeekOrder): string {
  return order.columns.map(column => column.map(step => `${step.workspaceId}\u0000${step.taskRef}`).join(',')).join(';')
}

export function createIssuePeekOrders(): IssuePeekOrders {
  const orders = new Map<object, { readonly signature: string; readonly order: IssuePeekOrder }>()
  let snapshot: readonly IssuePeekOrder[] = []
  return {
    publish: (owner, order) => {
      const signature = signatureOf(order)
      const current = orders.get(owner)
      if (current !== undefined && current.signature === signature) return
      orders.set(owner, { signature, order })
      snapshot = [...orders.values()].map(entry => entry.order)
    },
    unpublish: (owner) => {
      if (!orders.delete(owner)) return
      snapshot = [...orders.values()].map(entry => entry.order)
    },
    get: () => snapshot,
  }
}

/** The published order that holds the open issue, if any face published one. */
export function orderHolding(orders: readonly IssuePeekOrder[], taskRef: AgentTeamTaskRef): IssuePeekOrder | undefined {
  return orders.find(order => order.columns.some(column => column.some(step => step.taskRef === taskRef)))
}

/**
 * The next step of the walk: J/K move within the issue's own column, H/L move
 * to the nearest column that holds an issue — a walk that lands on an empty
 * column is a walk that stops — and the index is carried across, clamped to
 * the neighbour's length. `undefined` means the walk does not move: the issue
 * is not in this order, or the key has nowhere to go.
 */
export function stepPeekOrder(order: IssuePeekOrder, taskRef: AgentTeamTaskRef, key: PeekStepKey): IssuePeekStep | undefined {
  const columnIndex = order.columns.findIndex(column => column.some(step => step.taskRef === taskRef))
  if (columnIndex === -1) return undefined
  const column = order.columns[columnIndex]
  if (column === undefined) return undefined
  const index = column.findIndex(step => step.taskRef === taskRef)
  if (key === 'j' || key === 'k') {
    const nextIndex = key === 'j' ? Math.min(index + 1, column.length - 1) : Math.max(index - 1, 0)
    return nextIndex === index ? undefined : column[nextIndex]
  }
  let nextColumn = columnIndex
  for (let distance = 1; distance < order.columns.length; distance += 1) {
    const candidate = key === 'l' ? columnIndex + distance : columnIndex - distance
    const entry = order.columns[candidate]
    if (entry === undefined || entry.length === 0) continue
    nextColumn = candidate
    break
  }
  if (nextColumn === columnIndex) return undefined
  const neighbour = order.columns[nextColumn]
  if (neighbour === undefined) return undefined
  const nextIndex = Math.min(index, Math.max(neighbour.length - 1, 0))
  return neighbour[nextIndex]
}
