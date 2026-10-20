// Derived from multica-x packages/views/inbox/components/inbox-list.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the items are the Team severity groups' flattened render
// list — group headings and rows alternate in one order the page computes —
// and the row is the seat's own InboxListItem. Multica's archive entry, load-
// more footer and scroll-restoration hooks are not ported: the Team queue is
// bounded by the Host's own page, and the scroller here is the list's own.

import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { TeamConversationProps } from '../slots.ts'
import type { InboxItem } from '../multica/types.ts'
import type { TeamAvatarHuman } from '../TeamAvatarStack.tsx'
import { InboxListItem } from './InboxListItem.tsx'
import type { InboxRow } from './inbox-items.ts'
import css from './inbox.module.css'

/** One entry of the flattened render list: a group heading or a row. */
export type InboxListEntry =
  | { readonly kind: 'heading'; readonly key: string; readonly severity: string; readonly label: string; readonly count: number }
  | { readonly kind: 'row'; readonly key: string; readonly row: InboxRow; readonly facet: InboxItem }

export interface InboxListProps {
  readonly entries: readonly InboxListEntry[]
  readonly selectedKey: string
  /** The Workspace is named on a row only while the rows span more than one. */
  readonly showWorkspace: boolean
  readonly human: TeamAvatarHuman | undefined
  readonly t: TeamConversationProps['t']
  /** Activate one row: select it on a wide seat, open its Thread on a narrow one. */
  readonly onActivate: (row: InboxRow, event?: MouseEvent<HTMLButtonElement>) => void
  /** Move the selection onto one row: what the arrow keys do. */
  readonly onSelect: (row: InboxRow) => void
}

/** Sizing only: the estimate Virtuoso starts from before the first measures land. */
const ROW_ESTIMATED_HEIGHT = 58
/** The slice the first frame renders before the scroller is measured. */
const SEED_COUNT = 24

/**
 * The queue's scroller, virtualized like Multica's own list: only the visible
 * window (plus a small overscan) mounts, so the queue stays one fixed cost
 * however long the Host's page runs. Group headings ride the same list — they
 * scroll with their rows and keep the one order the severity bands define.
 */
export function InboxList({ entries, selectedKey, showWorkspace, human, t, onActivate, onSelect }: InboxListProps) {
  // Virtuoso wants the scrolling element itself; a callback ref hands it over
  // once it mounts and triggers the re-render that attaches the list.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // Keyboard focus lives on the scroll container, not on a row: a row scrolled
  // out unmounts, and focus falling back to <body> would stop the next arrow
  // key from reaching the list.
  const focusList = useCallback(() => { scrollEl?.focus({ preventScroll: true }) }, [scrollEl])
  // The scroller asks for the key and the content of the entry it is about to
  // mount, and it asks for one frame after the list has already shrunk — a
  // filter narrows the queue — while it still holds the longer list. That
  // entry is missing for that one frame, so both callbacks read it as
  // possibly absent instead of dereferencing a field that is not there.
  const itemContent = useCallback((_index: number, entry: InboxListEntry | undefined) => {
    if (entry === undefined) return null
    return entry.kind === 'heading'
      ? <h3 className={css.groupTitle} data-severity={entry.severity} key={entry.key}>
          {entry.label}<span className={css.groupCount}>{entry.count}</span>
        </h3>
      : <InboxListItem
          row={entry.row}
          facet={entry.facet}
          selected={entry.key === selectedKey}
          showWorkspace={showWorkspace}
          human={human}
          t={t}
          onActivate={event => { onActivate(entry.row, event) }}
        />
  }, [selectedKey, showWorkspace, human, t, onActivate])
  // Arrow keys walk the rows and move the selection instead of scrolling the
  // container — the same mail-list grammar Multica's list speaks. The keys
  // are bound to the scroller so they fire only while the reader is in it.
  // The group headings ride the same list but are not rows: the walk skips
  // them, so a band boundary is not a dead end.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const target = event.target
    if (target instanceof HTMLElement && target.isContentEditable) return
    event.preventDefault()
    focusList()
    const rowIndexes = entries.flatMap((entry, index) => entry.kind === 'row' ? [index] : [])
    if (rowIndexes.length === 0) return
    const current = entries.findIndex(entry => entry.kind === 'row' && entry.key === selectedKey)
    const at = rowIndexes.findIndex(index => index === current)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = at < 0
      ? (step === 1 ? 0 : rowIndexes.length - 1)
      : Math.min(Math.max(at + step, 0), rowIndexes.length - 1)
    const index = rowIndexes[next]
    if (index === undefined) return
    const entry = entries[index]
    if (entry === undefined || entry.kind !== 'row') return
    virtuosoRef.current?.scrollIntoView({ index })
    onSelect(entry.row)
  }
  if (entries.length === 0) return null
  // The same missing entry the content callback reads: the key falls back to
  // the index for that one frame, and the scroller drops the stale row on its
  // next pass.
  const computeItemKey = (_index: number, entry: InboxListEntry | undefined): string => entry?.key ?? `entry:${_index}`
  return <div
    ref={setScrollEl}
    tabIndex={-1}
    onKeyDown={handleKeyDown}
    className={css.list}
    data-inbox-list
  >
    {scrollEl
      ? <Virtuoso
          // The scroller keeps the length of the list it was mounted with:
          // a shorter list leaves rows behind that no longer exist, and the
          // rows that come back are not mounted either. A filter changes the
          // length, so the scroller is remounted with it — the list it shows
          // is then the list the reader has.
          key={entries.length}
          ref={virtuosoRef}
          customScrollParent={scrollEl}
          data={entries}
          computeItemKey={computeItemKey}
          initialItemCount={Math.min(entries.length, SEED_COUNT)}
          defaultItemHeight={ROW_ESTIMATED_HEIGHT}
          increaseViewportBy={{ top: 400, bottom: 400 }}
          itemContent={itemContent}
        />
      : null}
  </div>
}
