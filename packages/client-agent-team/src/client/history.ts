import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamChannelRef, AgentTeamDocRef, AgentTeamTaskRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamMode, TeamNavigation, TeamNavigationSnapshot } from './navigation.ts'

/**
 * The Team seat's history: the browser's own back and forward buttons walk the
 * seat's positions.
 *
 * The stack stores **positions**, not rendered views: the durable facts of
 * where the reader is. Replaying an entry rebuilds the same face from the
 * same fields, so an entry never holds a rendered view.
 *
 * The transport is the browser's own session history — one `pushState` per
 * navigation, the same URL and a state object only — and `popstate` is the
 * **only** way a position comes back, so the browser's button and the in-app
 * back cannot disagree about where the reader is.
 */

/** One position in the Team seat: the durable facts of where the reader is. */
export interface TeamPosition {
  /** The seat the reader is in. Persisted with the snapshot, so it is durable state. */
  readonly mode: TeamMode
  readonly workspaceId?: WorkspaceId
  readonly channelRef?: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly taskNumber?: number
  readonly docRef?: AgentTeamDocRef
  readonly inbox?: boolean
  readonly board?: boolean
  /** The Task whose issue surface is open, if any. Orthogonal to the face. */
  readonly issueRef?: AgentTeamTaskRef
  /** How the issue surface is presented; absent means the issue is not open. */
  readonly issueVariant?: 'slice' | 'page'
}

/** One entry of the stack: a position and the number that names it. */
interface TeamHistoryEntry {
  readonly seq: number
  readonly position: TeamPosition
}

/** The persisted stack: the tab's own path, rehydrated after a reload. */
interface PersistedHistory {
  readonly session: string
  readonly entries: readonly TeamHistoryEntry[]
  readonly index: number
  readonly seq: number
}

/** The `history.state` slot the Team owns; a foreign state is not ours to read. */
const STATE_KEY = 'agentTeam'
/** The stack's own storage: the tab's path, so a reload does not lose it. */
const HISTORY_STORAGE_KEY = 'dsh.agent-team.history'
/**
 * The URL query the Team owns: the issue the reader is on, and how it is
 * presented. The plugin manages these two parameters and leaves every other
 * parameter on the URL alone.
 */
const ISSUE_QUERY_KEY = 'issue'
const VARIANT_QUERY_KEY = 'variant'
/**
 * The cap. A few dozen positions is plenty for a seat, and a tab that never
 * closes must not grow its history without limit. The browser's own entries
 * are the browser's business — this bounds the model.
 */
const MAX_ENTRIES = 32

/**
 * The Team's history over the navigation snapshot.
 *
 * The stack observes the navigation and classifies every change:
 *
 * - a change of **where the reader is** pushes an entry;
 * - closing the issue consumes the entry its open pushed, so the browser's
 *   back closes the slice instead of walking out from under it;
 * - the same place presented differently — the issue's variant, the seat's
 *   mode — rewrites the current entry instead of stacking a new one;
 * - anything else (a picker, a disclosure, a filter, an inline edit) is not a
 *   place and creates no entry at all.
 */
export class TeamHistory {
  private entries: TeamHistoryEntry[] = []
  private index = 0
  private seq = 0
  private readonly session: string
  /** True while the stack is reacting to a change it caused itself. */
  private handling = false

  constructor(private readonly navigation: TeamNavigation) {
    this.session = this.readSession()
    this.rehydrate()
    // The restored position, before the boot's own rules touch it: the
    // snapshot is the tab's durable position, and the query is the link the
    // reader arrived with.
    const restored = this.position
    // The slice is a dialog over a live face: a cold start has no opener to
    // return the focus to, so the boot restores the face and drops the slice.
    // The snapshot itself stays honest — `readSnapshot` reads the slot back as
    // it was written, in either variant.
    if (restored.issueVariant === 'slice') this.navigation.actions().closeIssue()
    // The shared link: the URL's query names the issue, so a cold load opens
    // it. The boot is not a navigation — the position seam is not installed
    // yet, so the open creates no entry and the stack seeds with the issue
    // already open.
    this.openQueriedIssue(restored.issueRef)
    this.navigation.onPositionChange = (next, previous) => { this.onPositionChange(next, previous) }
    if (typeof window !== 'undefined') window.addEventListener('popstate', this.onPopState)
    this.seed()
  }

  /** The position the reader is at now. */
  get position(): TeamPosition {
    return positionOf(this.navigation.getSnapshot())
  }

  /** True when there is a position to go back to. */
  get canGoBack(): boolean {
    return this.index > 0
  }

  /** How many positions the stack holds. */
  get length(): number {
    return this.entries.length
  }

  /** True when there is a position to go forward to. */
  get canGoForward(): boolean {
    return this.index < this.entries.length - 1
  }

  /**
   * Go back one position — the browser's back button, so the in-app control
   * and the browser's button walk the same stack. False when the stack has
   * nowhere to go, and the caller keeps its own destination.
   */
  back(): boolean {
    if (!this.canGoBack) return false
    this.browser()?.back()
    return true
  }

  /** Go forward one position. False when the stack has nowhere to go. */
  forward(): boolean {
    if (!this.canGoForward) return false
    this.browser()?.forward()
    return true
  }

  /** Drop the stack's listener; the seat is going away. */
  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('popstate', this.onPopState)
    this.navigation.onPositionChange = undefined
  }

  /**
   * Every navigation that changed the position. The navigation reports the
   * snapshot before and after; the stack decides what that change means.
   */
  private onPositionChange(next: TeamNavigationSnapshot, previous: TeamNavigationSnapshot): void {
    // A change the stack itself caused is not a navigation: the issue closing
    // because the face changed, or a restore, must not push.
    if (this.handling) return
    this.handling = true
    try {
      const to = positionOf(next)
      const from = positionOf(previous)
      // The face: the place the reader is at, without the issue slot riding
      // on it. The slot has its own rules — it is opened and closed, not
      // walked into.
      const faceChanged = to.workspaceId !== from.workspaceId
        || to.channelRef !== from.channelRef
        || to.taskRef !== from.taskRef
        || to.threadRef !== from.threadRef
        || to.taskNumber !== from.taskNumber
        || to.docRef !== from.docRef
        || to.inbox !== from.inbox
        || to.board !== from.board
      if (to.issueRef === undefined && from.issueRef !== undefined && !faceChanged) {
        // The issue closed on its own: the entry its open pushed is consumed,
        // and the browser's back closes the slice with it.
        this.pop(true)
        return
      }
      if (faceChanged) {
        // The issue is bound to the face it was opened over: a face change
        // closes it, so the reader lands on the face they asked for, and the
        // issue's own entry stays in the stack as the step it was.
        if (to.issueRef !== undefined && from.issueRef !== undefined) this.navigation.actions().closeIssue()
        this.push(this.position)
        return
      }
      if (to.issueRef !== undefined && from.issueRef === undefined) {
        // The issue opened: a new place, one entry deeper.
        this.push(this.position)
        return
      }
      if (to.issueRef !== undefined && to.issueRef !== from.issueRef) {
        // A different issue: a different place.
        this.push(this.position)
        return
      }
      if (to.issueVariant !== from.issueVariant || to.mode !== from.mode) {
        // The same place, presented differently: the entry is rewritten, not
        // stacked. The conversation↔Team toggle is a change of seat, not a
        // change of place, so it never pushes.
        this.replace(this.position)
        return
      }
      // Nothing that makes a place changed: a filter, a picker, a disclosure.
    } finally {
      this.handling = false
    }
  }

  /** The browser's own entry for a position: the query names the issue, and the state object carries the position. */
  private writeState(seq: number, position: TeamPosition, replace: boolean): void {
    const browser = this.browser()
    if (browser === undefined) return
    const state = { [STATE_KEY]: { v: 1, session: this.session, seq, position } }
    const url = this.urlFor(position)
    if (replace) browser.replaceState(state, '', url)
    else browser.pushState(state, '', url)
  }

  /**
   * The URL for a position: the plugin's query, and nothing else.
   *
   * The URL is a **query-only relative URL**, so it resolves against the
   * current document: the path and the mount never move, and the harness's
   * base (`<base href="./">`) is never contradicted. The plugin sets its two
   * parameters and leaves every other parameter on the URL alone.
   */
  private urlFor(position: TeamPosition): string {
    const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
    if (position.issueRef === undefined) {
      params.delete(ISSUE_QUERY_KEY)
      params.delete(VARIANT_QUERY_KEY)
    } else {
      params.set(ISSUE_QUERY_KEY, position.issueRef)
      params.set(VARIANT_QUERY_KEY, position.issueVariant ?? 'page')
    }
    const query = params.toString()
    return query === '' ? '?' : `?${query}`
  }

  /**
   * Open the issue the URL names. A shared link is a position, so a cold
   * load of it opens that issue — in the `page` variant, because a slice is
   * transient and a cold start has no opener to return the focus to. The
   * query's variant is dropped; the URL is rewritten to the position's truth
   * by the seed below.
   *
   * The snapshot's own issue stands: the tab's durable position is not
   * replaced by the link, and the slice the snapshot carried is still the
   * slice the boot drops.
   */
  private openQueriedIssue(restoredIssue: AgentTeamTaskRef | undefined): void {
    const issueRef = issueFromQuery()
    if (issueRef === undefined || issueRef === restoredIssue) return
    this.navigation.actions().openIssue(issueRef, 'page')
  }

  /** Add a position to the stack and to the browser's history. */
  private push(position: TeamPosition): void {
    this.seq += 1
    const entry: TeamHistoryEntry = { seq: this.seq, position }
    this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-MAX_ENTRIES)
    this.index = this.entries.length - 1
    this.writeState(entry.seq, position, false)
    this.persist()
  }

  /** Rewrite the current entry: the same place, presented differently. */
  private replace(position: TeamPosition): void {
    const current = this.entries[this.index]
    if (current === undefined) {
      this.push(position)
      return
    }
    this.entries = [
      ...this.entries.slice(0, this.index),
      { ...current, position },
      ...this.entries.slice(this.index + 1),
    ]
    this.writeState(current.seq, position, true)
    this.persist()
  }

  /**
   * Consume the current entry: the browser's back button. The `popstate`
   * handler restores the position and moves the index. A consumed entry is
   * not a step in the path any more, so it leaves the model; a plain
   * traversal keeps it, the way the browser keeps its forward entries.
   */
  private pop(consume: boolean): void {
    if (!this.canGoBack) {
      // Nowhere to go back to: the position stands, and the current entry is
      // rewritten so the model and the browser's history agree.
      this.replace(this.position)
      return
    }
    if (consume) {
      this.entries = this.entries.slice(0, this.index)
      this.index = this.entries.length - 1
      this.persist()
    }
    this.browser()?.back()
  }

  /**
   * The browser's own history is the only way a position comes back, so the
   * in-app back and the browser's button restore the same way.
   */
  private readonly onPopState = (event: PopStateEvent): void => {
    const state = event.state as { agentTeam?: { v?: number, session?: string, seq?: number, position?: TeamPosition } } | null
    const ours = state?.agentTeam
    if (ours?.v !== 1 || ours.session !== this.session || ours.position === undefined) {
      // The entry is not ours — another plugin's, or the page before this
      // one. The Team keeps the place it is in.
      return
    }
    this.restore(ours.position, ours.seq)
  }

  /** Apply a position the stack owns. A restore never pushes. */
  private restore(position: TeamPosition, seq?: number): void {
    this.handling = true
    try {
      this.navigation.applyPosition(position)
    } finally {
      this.handling = false
    }
    const index = seq === undefined ? -1 : this.entries.findIndex(entry => entry.seq === seq)
    this.index = index >= 0 ? index : Math.max(0, Math.min(this.index, this.entries.length - 1))
    this.persist()
  }

  /**
   * The stack starts at the position the reader is in now. The base entry is
   * written into the browser's current entry — not pushed — so the browser's
   * back lands on it instead of leaving the page, and so the tab's session
   * survives a reload.
   *
   * A rehydrated stack keeps its entries, and the browser's current entry is
   * already the reader's: it is rewritten to the position as it is now, so
   * the URL and the position agree after a reload.
   */
  private seed(): void {
    if (this.entries.length > 0) {
      const current = this.entries[this.index]
      this.writeState(current?.seq ?? this.seq, this.position, true)
      this.persist()
      return
    }
    this.seq += 1
    const entry: TeamHistoryEntry = { seq: this.seq, position: this.position }
    this.entries = [entry]
    this.index = 0
    this.writeState(entry.seq, entry.position, true)
    this.persist()
  }

  private browser(): History | undefined {
    return typeof window === 'undefined' ? undefined : window.history
  }

  /**
   * This tab's identity. The browser preserves the current entry's
   * `history.state` across a reload, so the session survives one — and a
   * second tab, with its own session, starts with an empty stack instead of
   * inheriting another tab's path.
   */
  private readSession(): string {
    const state = this.browser()?.state as { agentTeam?: { session?: string } } | null
    const existing = state?.agentTeam?.session
    if (typeof existing === 'string' && existing !== '') return existing
    return `session:${Math.random().toString(36).slice(2)}`
  }

  /** Read this tab's path back after a reload. */
  private rehydrate(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
      if (raw === null) return
      const parsed = JSON.parse(raw) as PersistedHistory
      if (parsed.session !== this.session) return
      if (!Array.isArray(parsed.entries)) return
      const entries = parsed.entries.filter(isEntry).slice(-MAX_ENTRIES)
      if (entries.length === 0) return
      this.entries = entries
      this.seq = typeof parsed.seq === 'number' ? parsed.seq : entries.length
      // The browser's current entry names the position the reader was at when
      // the page reloaded; the persisted index is only the fallback.
      const current = this.browser()?.state as { agentTeam?: { seq?: number } } | null
      const seq = current?.agentTeam?.seq
      const index = typeof seq === 'number' ? entries.findIndex(entry => entry.seq === seq) : -1
      this.index = index >= 0 ? index : Math.max(0, Math.min(parsed.index, entries.length - 1))
    } catch {
      // A corrupt record is a lost path, not a broken seat.
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const record: PersistedHistory = { session: this.session, entries: this.entries, index: this.index, seq: this.seq }
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(record))
    } catch {
      // Local persistence is a convenience; private mode and quota failures do not block navigation.
    }
  }
}

/**
 * The issue the URL's query names, if it names one. The query is the
 * plugin's own state: a shared link carries the issue, and the boot opens it.
 */
function issueFromQuery(): AgentTeamTaskRef | undefined {
  if (typeof location === 'undefined') return undefined
  const value = new URLSearchParams(location.search).get(ISSUE_QUERY_KEY)
  if (value === null || value === '') return undefined
  return value as AgentTeamTaskRef
}

/** The durable facts of a snapshot: where the reader is, and nothing else. */
function positionOf(snapshot: TeamNavigationSnapshot): TeamPosition {
  return {
    mode: snapshot.mode,
    ...(snapshot.workspaceId === undefined ? {} : { workspaceId: snapshot.workspaceId }),
    ...(snapshot.channelRef === undefined ? {} : { channelRef: snapshot.channelRef }),
    ...(snapshot.taskRef === undefined ? {} : { taskRef: snapshot.taskRef }),
    ...(snapshot.threadRef === undefined ? {} : { threadRef: snapshot.threadRef }),
    ...(snapshot.taskNumber === undefined ? {} : { taskNumber: snapshot.taskNumber }),
    ...(snapshot.docRef === undefined ? {} : { docRef: snapshot.docRef }),
    ...(snapshot.inbox === true ? { inbox: true } : {}),
    ...(snapshot.board === true ? { board: true } : {}),
    ...(snapshot.issueRef === undefined ? {} : { issueRef: snapshot.issueRef }),
    ...(snapshot.issueVariant === undefined ? {} : { issueVariant: snapshot.issueVariant }),
  }
}

/** A persisted entry is only an entry when it names a position. */
function isEntry(entry: unknown): entry is TeamHistoryEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as { seq?: unknown, position?: unknown }
  return typeof candidate.seq === 'number' && typeof candidate.position === 'object' && candidate.position !== null
}
