// Derived from multica-x packages/core/issues/config/status.ts and packages/core/issues/status-category.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Multica keys its columns on the concrete status. The Team ledger derives
// exactly five statuses — accept, close and reopen are Claims- and
// resolution-driven, never catalog-driven — so `STATUS_ORDER` stays the five
// built-ins and the issue status picker and the actions menu offer exactly
// those, pinned by test. The board's own columns come from the Workspace's
// status catalog (`board/board-columns.ts`), which is this list plus the
// custom lists the Human added. Categories stay separate because behaviour is
// category-driven.

import type { StatusCategory, TaskStatus } from './types.ts'

/** Board column order, left to right. */
export const STATUS_ORDER: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']

/** The four lifecycle categories, in board order. */
export const STATUS_CATEGORY_ORDER: readonly StatusCategory[] = ['unstarted', 'started', 'done', 'closed']

export const STATUS_CATEGORY: Readonly<Record<TaskStatus, StatusCategory>> = {
  todo: 'unstarted',
  in_progress: 'started',
  in_review: 'started',
  done: 'done',
  closed: 'closed',
}

/** The category names, resolved through `locales.ts`: the list editor's four choices. */
export const STATUS_CATEGORY_LABEL_KEY = {
  unstarted: 'statusCategoryUnstarted',
  started: 'statusCategoryStarted',
  done: 'statusCategoryDone',
  closed: 'statusCategoryClosed',
} as const satisfies Readonly<Record<StatusCategory, string>>

/** Display keys are resolved through `locales.ts`; this map is the stable id. */
export const STATUS_LABEL_KEY = {
  todo: 'statusTodo',
  in_progress: 'statusInProgress',
  in_review: 'statusInReview',
  done: 'statusDone',
  closed: 'statusClosed',
} as const satisfies Readonly<Record<TaskStatus, string>>

export function isTaskStatus(value: string): value is TaskStatus {
  return (STATUS_ORDER as readonly string[]).includes(value)
}

export function statusCategoryOf(status: TaskStatus): StatusCategory {
  return STATUS_CATEGORY[status]
}

/**
 * The statuses the issue's status picker and the M-70 header actions menu
 * offer — the same five, in the same order, through one constant.
 *
 * A custom list is a board column, never an issue status: it holds no Claim
 * and no resolution, so the ledger could not derive a status from it. Pinning
 * both surfaces to this list is what keeps a `+ Add list` from silently
 * appearing as a sixth choice in the issue view.
 */
export const ISSUE_STATUS_OPTIONS: readonly TaskStatus[] = STATUS_ORDER

/** Human-driven targets: a card may be dragged to these; claims drive the rest. */
export const HUMAN_STATUS_TARGETS: readonly TaskStatus[] = ['todo', 'done', 'closed']

export function isHumanStatusTarget(status: TaskStatus): boolean {
  return HUMAN_STATUS_TARGETS.includes(status)
}

/** Terminal statuses never move again through a claim. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'closed'
}

/** Column rank, used by the ported status sort. */
export const STATUS_RANK: Readonly<Record<TaskStatus, number>> = Object.fromEntries(
  STATUS_ORDER.map((status, index) => [status, index]),
) as Readonly<Record<TaskStatus, number>>
