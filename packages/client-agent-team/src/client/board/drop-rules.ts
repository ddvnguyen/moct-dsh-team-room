// The board's human drop rules, as one pure test shared by the drag handlers
// and the column lock hint.

import type { TaskStatus } from '../multica/types.ts'

/**
 * Where a Human may drop a card. Reordering inside a column is always free;
 * moving across columns follows the collaboration model: `done`/`closed` are
 * always reachable (accept/close), `todo` only from `done`/`closed` (reopen),
 * and `in_progress`/`in_review` are set by Claims, never by a drop.
 */
export function mayDrop(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true
  return to === 'done' || to === 'closed' || (to === 'todo' && (from === 'done' || from === 'closed'))
}

/** The Remote action a cross-column drop maps to. */
export function dropAction(to: 'todo' | 'done' | 'closed'): 'reopen' | 'accept' | 'close' {
  return to === 'todo' ? 'reopen' : to === 'done' ? 'accept' : 'close'
}
