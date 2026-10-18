// Derived from multica-x packages/views/issues/components/use-drag-settle.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// The settle lock keeps the board's local column mirror frozen while a drop is
// in flight. One house rule bends the port: the Team board performs no
// optimistic mutation, so a card sits in its origin column until the Remote
// commits and the change wake refetches — the mirror freeze still matters for
// the same-column reorder path, where the drop's own placement must survive
// the invalidation that immediately follows the commit.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Content equality for the column map (`columnId -> ordered task refs`). Two
 * maps are equal when they have the same column keys and each column's ref
 * list matches element-for-element. Used to skip no-op `setColumns` writes.
 */
function columnsEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    const av = a[key]
    const bv = b[key]
    if (av === bv) continue
    if (!av || !bv || av.length !== bv.length) return false
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false
    }
  }
  return true
}

/**
 * The board's drag/settle state machine.
 *
 *   - Local column state mirrors the loaded tasks between drags.
 *   - While dragging, or while a drop is settling (the mutation is in flight),
 *     that mirror is frozen so a refetch landing mid-flight cannot clobber the
 *     drop's own placement.
 *   - On settle the lock releases and `settleVersion` bumps, forcing one
 *     resync from the reloaded data.
 *
 * `initialColumns` is read once; callers drive later updates through their own
 * resync effect, which reads `settleVersion` and the refs from here.
 */
export function useDragSettle(initialColumns: () => Record<string, string[]>) {
  const isDraggingRef = useRef(false)
  const isSettlingRef = useRef(false)
  // Throttles onDragOver: set true after a local move, cleared one frame later.
  const recentlyMovedRef = useRef(false)
  const [settleVersion, setSettleVersion] = useState(0)

  const [columns, setColumnsState] = useState<Record<string, string[]>>(initialColumns)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  // Equality-guarded column setter: a content-equal rebuild returns the SAME
  // reference so React bails out of the re-render and the resync effect cannot
  // spin on an unstable input.
  const setColumns = useCallback<Dispatch<SetStateAction<Record<string, string[]>>>>((update) => {
    setColumnsState(prev => {
      const next = typeof update === 'function'
        ? (update as (p: Record<string, string[]>) => Record<string, string[]>)(prev)
        : update
      return columnsEqual(prev, next) ? prev : next
    })
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => { recentlyMovedRef.current = false })
    return () => cancelAnimationFrame(id)
  }, [columns])

  /**
   * Engage the settle lock and return the callback to invoke once the drop's
   * Remote answers. The callback releases the lock and triggers one resync.
   */
  const beginSettle = useCallback(() => {
    isSettlingRef.current = true
    return () => {
      isSettlingRef.current = false
      setSettleVersion(v => v + 1)
    }
  }, [])

  return {
    columns,
    setColumns,
    columnsRef,
    isDraggingRef,
    isSettlingRef,
    recentlyMovedRef,
    settleVersion,
    beginSettle,
  }
}
