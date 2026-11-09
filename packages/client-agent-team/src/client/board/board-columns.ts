// Derived from multica-x packages/core/issues/stores/status-store.ts and
// packages/views/issues/utils/drag-utils.ts @ cbd75011884bd0ee75e9de57d86fbb05c150c421.
// Copyright Index Labs. Multica License.
//
// The Team board's column model. Multica derives its columns from the
// Workspace's status catalog; the Team ledger now holds the same catalog
// beside its five derived statuses, so this module is the one place that turns
// it into columns and one place that turns a cross-column drop into the write
// it means. DOM-free: the specs drive it directly.

import type { AgentTeamBoardStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { STATUS_CATEGORY, STATUS_LABEL_KEY, STATUS_ORDER } from '../multica/status.ts'
import type { StatusCategory, TaskStatus } from '../multica/types.ts'
import type { TeamSidebarProps } from '../slots.ts'

/** One board column: a catalog entry with the id both dnd-kit and the card map key on. */
export interface BoardColumnModel {
  /** `status:<key>` — the id the hidden set, the collapsed set and the droppable share. */
  readonly id: string
  readonly key: string
  /** A built-in holds its locale key, a custom list the name the Human stored; `columnLabel` resolves both. */
  readonly label: string
  readonly builtin: boolean
  readonly archived: boolean
  readonly category: StatusCategory
}

/** The five built-ins as columns: the answer when a Host replies without a catalog. */
export const BUILTIN_BOARD_COLUMNS: readonly BoardColumnModel[] = Object.freeze(STATUS_ORDER.map(status => Object.freeze({
  id: `status:${status}`,
  key: status,
  label: STATUS_LABEL_KEY[status],
  builtin: true,
  archived: false,
  category: STATUS_CATEGORY[status],
})))

/**
 * The Workspace's columns, in the catalog's order: the five built-ins, then the
 * custom lists in creation order. Archived lists keep their entry in the
 * catalog but draw no column, so they are dropped here — the one place that
 * decides — rather than at each render site.
 */
export function boardColumns(catalog: readonly AgentTeamBoardStatus[] | undefined): readonly BoardColumnModel[] {
  if (catalog === undefined || catalog.length === 0) return BUILTIN_BOARD_COLUMNS
  return catalog.filter(entry => !entry.archived).map(entry => Object.freeze({
    id: `status:${entry.key}`,
    key: entry.key,
    // A built-in is localized here, not by the Host: the ledger has no locale,
    // so its own name for the five is only a fallback.
    label: entry.builtin ? STATUS_LABEL_KEY[entry.key as TaskStatus] ?? entry.label : entry.label,
    builtin: entry.builtin,
    archived: false,
    category: entry.category,
  }))
}

/** The name a column draws: the localized built-in, or the name the Human stored. */
export function columnLabel(column: BoardColumnModel, t: TeamSidebarProps['t']): string {
  // A built-in's `label` is its locale key; a custom list's is already the text.
  return column.builtin ? t(column.label as Parameters<TeamSidebarProps['t']>[0]) : column.label
}

/** The built-in column a derived status draws: where a card goes back to. */
export function builtinColumnId(status: TaskStatus): string {
  return `status:${status}`
}

/**
 * The column a card stands in right now: the custom list the Human placed it
 * in, or the built-in column for its derived status when it has no placement
 * (or the list is gone).
 */
export function columnIdOf(task: { readonly status: TaskStatus; readonly statusKey?: string | null | undefined },
  columns: readonly BoardColumnModel[]): string {
  if (task.statusKey != null) {
    const placed = columns.find(column => !column.builtin && column.key === task.statusKey)
    if (placed !== undefined) return placed.id
  }
  return builtinColumnId(task.status)
}

/** Bucket card refs into the visible columns, in the order they are drawn. */
export function buildBoardMirror(
  tasks: readonly { readonly taskRef: string; readonly status: TaskStatus; readonly statusKey?: string | null | undefined }[],
  visible: readonly BoardColumnModel[],
): Record<string, string[]> {
  const mirror: Record<string, string[]> = {}
  for (const column of visible) mirror[column.id] = []
  for (const task of tasks) {
    const column = mirror[columnIdOf(task, visible)]
    if (column !== undefined) column.push(task.taskRef)
  }
  return mirror
}

/** What one cross-column drop writes. */
export type ColumnDrop =
  /** The card is already in that column: the page reorders it, no status or placement write. */
  | { readonly kind: 'reorder' }
  | { readonly kind: 'accept' | 'close' | 'reopen' }
  /** Placement only: `null` sends the card back to its built-in column. */
  | { readonly kind: 'place'; readonly statusKey: string | null }
  /** The drop is not a write this board makes; the caller snaps the card back and says why. */
  | { readonly kind: 'locked' }

const TERMINAL = new Set<TaskStatus>(['done', 'closed'])

/**
 * The write a drop from `task`'s column into `target` means.
 *
 * A built-in column keeps its rules: `done` accepts, `closed` closes, `todo`
 * reopens from a terminal status, and `in_progress`/`in_review` belong to
 * Claims. A custom column is placement: the card moves there and its status
 * stays what the ledger derived — except for a terminal card, which keeps its
 * built-in column so the board never calls a Done task "QA".
 */
export function columnDrop(
  task: { readonly status: TaskStatus; readonly statusKey?: string | null | undefined },
  target: BoardColumnModel,
  columns: readonly BoardColumnModel[],
): ColumnDrop {
  if (columnIdOf(task, columns) === target.id) return { kind: 'reorder' }
  if (target.builtin) {
    // Dragging a placed card back to its own derived column is a clear, not a lifecycle write.
    if (task.statusKey != null && builtinColumnId(task.status) === target.id) return { kind: 'place', statusKey: null }
    const status = target.key as TaskStatus
    if (status === 'done') return { kind: 'accept' }
    if (status === 'closed') return { kind: 'close' }
    if (status === 'todo') return TERMINAL.has(task.status) ? { kind: 'reopen' } : { kind: 'locked' }
    return { kind: 'locked' }
  }
  if (target.archived || TERMINAL.has(task.status)) return { kind: 'locked' }
  return { kind: 'place', statusKey: target.key }
}
