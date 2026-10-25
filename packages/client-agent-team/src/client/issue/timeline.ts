// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica builds one `TimelineItem` list out of comments,
// runs, collapsed resolved threads and grouped activity (`:572`, `:590–604`).
// Here the merge is a pure function over the Host's two ordered regions and
// the Thread's Session runs, so the order is testable without a renderer.
//
// The key is the instant, not `sequence`: comments and activities carry one
// (`occurredAt`), Session runs carry `startedAt`, and no run has a ledger
// sequence at all. Within one ledger the instant order is the sequence order,
// so the two agree; a tie keeps the comment first, then the activity, then the
// run, because that is the order the atoms are pushed in and the sort is
// stable.

import type {
  AgentTeamIssueActivityFact, AgentTeamIssueComment, AgentTeamSessionRun,
} from '@ddvnguyen/moct-dsh-team-room/types'

/** One run the timeline draws, and whether it is the seat's live one. */
export interface TimelineRun {
  readonly run: AgentTeamSessionRun
  readonly running: boolean
}

/**
 * One row of the issue's timeline.
 *
 * `activity-group` is a run of consecutive activities: the group boundary is
 * "a non-activity row sat between them", so two activities split by a comment
 * are two groups and never one.
 */
export type TimelineRow =
  | { readonly kind: 'comment'; readonly entry: AgentTeamIssueComment; readonly at: number }
  | {
    readonly kind: 'activity-group'
    /** The first fact's ref: stable across a refetch, so React reuses the row. */
    readonly id: string
    readonly entries: readonly AgentTeamIssueActivityFact[]
    readonly at: number
  }
  | { readonly kind: 'run'; readonly run: AgentTeamSessionRun; readonly running: boolean; readonly at: number }

/** What one timeline merges: the Host's regions, and where the contiguous window starts. */
export interface TimelineInput {
  readonly comments: readonly AgentTeamIssueComment[]
  readonly activity: readonly AgentTeamIssueActivityFact[]
  readonly runs: readonly TimelineRun[]
  /**
   * The instant the oldest carried comment happened, when the Host says it
   * holds more. Anything older is outside the window and is dropped: the
   * activity region and the run list are bounded independently of the comment
   * page, so without this the list would show a gap in the middle of history.
   * `null` means the comment page is the whole history.
   */
  readonly windowStart: number | null
}

/** The instant of one ISO value, or NaN when it is unreadable. */
function instantOf(value: string): number {
  return Date.parse(value)
}

/**
 * The issue's one chronological list.
 *
 * Comments, consecutive activities folded into one group, and Session runs,
 * oldest first. An activity that happened between two comments sits between
 * them; two activities with nothing between them are one group.
 */
export function buildTimeline({ comments, activity, runs, windowStart }: TimelineInput): readonly TimelineRow[] {
  const inWindow = (at: number): boolean => windowStart === null || !(at < windowStart)

  type Atom =
    | { readonly kind: 'comment'; readonly at: number; readonly entry: AgentTeamIssueComment }
    | { readonly kind: 'activity'; readonly at: number; readonly fact: AgentTeamIssueActivityFact }
    | { readonly kind: 'run'; readonly at: number; readonly run: AgentTeamSessionRun; readonly running: boolean }

  const atoms: Atom[] = []
  // Pushed in tie-break order: a comment, then an activity, then a run.
  for (const entry of comments) {
    const at = instantOf(entry.occurredAt)
    if (inWindow(at)) atoms.push({ kind: 'comment', at, entry })
  }
  for (const fact of activity) {
    const at = instantOf(fact.occurredAt)
    if (inWindow(at)) atoms.push({ kind: 'activity', at, fact })
  }
  for (const { run, running } of runs) {
    const at = instantOf(run.startedAt)
    if (inWindow(at)) atoms.push({ kind: 'run', at, run, running })
  }
  // Stable: equal instants keep the push order above.
  atoms.sort((left, right) => left.at - right.at)

  const rows: TimelineRow[] = []
  let group: AgentTeamIssueActivityFact[] = []
  const flush = (): void => {
    if (group.length === 0) return
    rows.push({ kind: 'activity-group', id: group[0]!.activity.activityRef, entries: group, at: instantOf(group[0]!.occurredAt) })
    group = []
  }
  for (const atom of atoms) {
    if (atom.kind === 'activity') { group.push(atom.fact); continue }
    flush()
    if (atom.kind === 'comment') rows.push({ kind: 'comment', entry: atom.entry, at: atom.at })
    else rows.push({ kind: 'run', run: atom.run, running: atom.running, at: atom.at })
  }
  flush()
  return rows
}

/**
 * The window start for a comment page: the oldest carried comment's instant
 * when the Host says it holds more, and `null` when the page is the history.
 *
 * The cursor is the oldest carried `sequence`; the comment it names is the
 * first item, so the instant is read from the item rather than re-derived.
 */
export function commentWindowStart(comments: { readonly items: readonly AgentTeamIssueComment[]; readonly hasMore: boolean }): number | null {
  if (!comments.hasMore) return null
  const oldest = comments.items[0]
  return oldest === undefined ? null : instantOf(oldest.occurredAt)
}

/** The runs of one Thread, the live one flagged: the active run is also in the history. */
export function timelineRuns(seats: readonly { readonly active: AgentTeamSessionRun | null; readonly history: readonly AgentTeamSessionRun[] }[]): readonly TimelineRun[] {
  const bySession = new Map<string, TimelineRun>()
  for (const seat of seats) {
    for (const run of seat.history) bySession.set(run.sessionId, { run, running: false })
    if (seat.active !== null) bySession.set(seat.active.sessionId, { run: seat.active, running: true })
  }
  return [...bySession.values()]
}
