// Derived from multica-x packages/core/issues/stores/view-store.ts @ cbd75011884bd0ee75e9de57d86fbb05c150c421. Copyright Index Labs. Multica License.
//
// A collapsed board column is a display preference, not a filter: the column
// keeps its place and its count and shows no cards. Multica keeps the set in
// its view store beside the rest of the workspace's view state; this board has
// no view store, so the same set lives in localStorage, per Workspace.
//
// The set is keyed by the column id (`status:<key>`), never by a label, so a
// localized name can never decide which column is folded. It is local only: a
// collapse writes no Remote and no ledger operation.

const KEY_PREFIX = 'dsh.agent-team.board.collapsedColumns:'

/** The localStorage key one Workspace's collapsed set lives under. */
export function collapsedColumnsKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`
}

/**
 * The column ids this Workspace has collapsed, minus anything the board does
 * not know: a stale key — a column that went away — is dropped on read, so it
 * can never fold a live column.
 */
export function readCollapsedColumns(workspaceId: string, knownColumnIds: ReadonlySet<string>): ReadonlySet<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(collapsedColumnsKey(workspaceId)) ?? '[]')
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string' && knownColumnIds.has(entry)))
  } catch (error) {
    // A corrupt or blocked preference falls back to "nothing collapsed"; it never blocks the board.
    void error
    return new Set()
  }
}

/** Stores the set; a blocked or full quota leaves this visit's copy in memory. */
export function writeCollapsedColumns(workspaceId: string, ids: Iterable<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(collapsedColumnsKey(workspaceId), JSON.stringify([...ids]))
  } catch (error) {
    void error
  }
}

/** One column's collapse flipped, every other id left as it was. */
export function toggleCollapsedColumn(ids: ReadonlySet<string>, columnId: string): ReadonlySet<string> {
  const next = new Set(ids)
  if (!next.delete(columnId)) next.add(columnId)
  return next
}
