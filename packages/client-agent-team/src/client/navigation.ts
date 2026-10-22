import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AgentTeamChannelRef, AgentTeamDocRef, AgentTeamTaskRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'

export type TeamMode = 'conversation' | 'team'

/**
 * The global panel the Team is entered as, addressed by the sidebar's panel
 * rail. Team mode and this panel selection are one fact: the rail's row selects
 * it and the mode follows (see the panel-ownership effect in `index.ts`).
 */
export const TEAM_PANEL_ID = 'agent-team' as MainPanelId

/**
 * The Team Detail page: the side menu row that replaced the Team row. It is
 * mode-neutral — selecting it neither enters nor leaves Team mode — so the Team
 * tab keeps its Channel view beside it, and any Team destination picked while
 * it holds the column hands the column back to `TEAM_PANEL_ID`.
 *
 * The id keeps its old value: the host may persist the selected panel, and the
 * patched codex-ui keys its top-level list on it. Only the visible label says
 * "Team Detail".
 */
export const TEAM_DETAIL_PANEL_ID = 'agent-team-settings' as MainPanelId

/**
 * The Board page as a global panel: the row in the sidebar's main list that
 * opens the Board in the main column. It is a panel of its own (not a face of
 * the Team panel) because the Board wants the whole column, and because a
 * destination in the main list is a panel: the host renders the row and the
 * click opens this panel's seat.
 */
export const BOARD_PANEL_ID = 'agent-team-board' as MainPanelId

export interface TeamNavigationSnapshot {
  mode: TeamMode
  workspaceId?: WorkspaceId
  channelRef?: AgentTeamChannelRef
  taskRef?: AgentTeamTaskRef
  threadRef?: AgentTeamThreadRef
  taskNumber?: number
  /** A Team Document opened over its Thread; it always rides with that Thread's `threadRef`. */
  docRef?: AgentTeamDocRef
  /**
   * Durable position of the Human mention-Inbox page (a navigation fact, not
   * an unread fact): selecting Inbox clears the Channel/Thread faces, and a
   * reload reopens the page. Read markers only move through Thread reads.
   */
  inbox?: boolean
  /**
   * Durable position of the Board page, beside the Inbox: a navigation fact
   * that clears the Channel/Thread faces the same way, and a reload reopens
   * it. A board Task pick (a card click) opens the issue surface over it — the
   * issue slot, not this flag — so the board stays behind the issue.
   */
  board?: boolean
  /** Runtime-only Member Session embedded in the conversation seat; never persisted. */
  memberSessionId?: SessionId
  /** Runtime-only session to restore when the Member view closes; never persisted. */
  returnToSessionId?: SessionId
  /**
   * The Task whose issue surface is open, if any. **Orthogonal to the face
   * flags**: the face behind the issue (board / inbox / overview / thread) stays
   * where it was, so closing the issue returns to exactly where the reader was.
   * The issue is not a face — a face flag would clear the face underneath it.
   */
  issueRef?: AgentTeamTaskRef
  /**
   * How the issue surface is presented. Absent means the issue is not open.
   * `page` is the whole-column presentation; `slice` is the dialog over the
   * live face (the slice chrome is M-38's; the slot is this client's).
   */
  issueVariant?: 'slice' | 'page'
}

const STORAGE_KEY = 'dsh.agent-team.navigation'

function readSnapshot(): TeamNavigationSnapshot {
  if (typeof localStorage === 'undefined') return { mode: 'conversation' }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<TeamNavigationSnapshot>
    const hasThread = typeof parsed.threadRef === 'string'
    return {
      mode: parsed.mode === 'team' ? 'team' : 'conversation',
      ...(typeof parsed.workspaceId === 'string' ? { workspaceId: parsed.workspaceId as WorkspaceId } : {}),
      ...(typeof parsed.channelRef === 'string' ? { channelRef: parsed.channelRef as AgentTeamChannelRef } : {}),
      ...(parsed.inbox === true ? { inbox: true } : {}),
      ...(parsed.board === true ? { board: true } : {}),
      // The Task identity and the issue slot are restored on their own, not
      // inside the Thread branch: the issue surface is mutually exclusive with
      // the Thread face, so a position that carries a Task and no Thread — the
      // issue position — would lose its Task on reload.
      ...(typeof parsed.taskRef === 'string' ? { taskRef: parsed.taskRef as AgentTeamTaskRef } : {}),
      ...(typeof parsed.issueRef === 'string' ? { issueRef: parsed.issueRef as AgentTeamTaskRef } : {}),
      ...(parsed.issueVariant === 'slice' || parsed.issueVariant === 'page' ? { issueVariant: parsed.issueVariant } : {}),
      ...(hasThread ? {
        threadRef: parsed.threadRef as AgentTeamThreadRef,
        ...(typeof parsed.taskNumber === 'number' && Number.isInteger(parsed.taskNumber) && parsed.taskNumber > 0 ? { taskNumber: parsed.taskNumber } : {}),
        ...(typeof parsed.docRef === 'string' ? { docRef: parsed.docRef as AgentTeamDocRef } : {}),
      } : {}),
    }
  } catch {
    return { mode: 'conversation' }
  }
}

function persistSnapshot(snapshot: TeamNavigationSnapshot): void {
  if (typeof localStorage === 'undefined') return
  try {
    const { mode, workspaceId, channelRef, taskRef, threadRef, taskNumber, docRef, inbox, board, issueRef, issueVariant } = snapshot
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(channelRef === undefined ? {} : { channelRef }),
      ...(inbox === true ? { inbox: true } : {}),
      ...(board === true ? { board: true } : {}),
      ...(taskRef === undefined ? {} : { taskRef }),
      ...(threadRef === undefined ? {} : { threadRef }),
      ...(taskNumber === undefined ? {} : { taskNumber }),
      ...(docRef === undefined ? {} : { docRef }),
      ...(issueRef === undefined ? {} : { issueRef }),
      ...(issueVariant === undefined ? {} : { issueVariant }),
    }))
  } catch {
    // Local persistence is a convenience; private mode and quota failures do not block navigation.
  }
}

/**
 * What the navigation needs from the Team's history: the in-app back and
 * forward, so the control on the page and the browser's own buttons walk the
 * same stack.
 */
export interface TeamHistoryPort {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  /** Go back one position; false when the stack has nowhere to go. */
  back: () => boolean
  /** Go forward one position; false when the stack has nowhere to go. */
  forward: () => boolean
}

export interface TeamNavigationActions {
  enterTeam: () => void
  leaveTeam: () => void
  selectWorkspace: (workspaceId: WorkspaceId) => void
  selectChannel: (channelRef: AgentTeamChannelRef) => void
  selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void
  /** Open one Team Document over its Thread; leaving it goes back to that Thread. */
  selectDoc: (docRef: AgentTeamDocRef, threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef) => void
  /** Open the Human mention-Inbox page; clears the Channel/Thread faces. */
  selectInbox: () => void
  /** Open the Board page; clears the Channel/Thread faces the same way. */
  selectBoard: () => void
  /**
   * Open the issue surface of one Task, over the face the reader is on. The
   * face flags are untouched: the issue is an orthogonal slot, so closing it
   * returns to exactly where the reader was.
   */
  openIssue: (taskRef: AgentTeamTaskRef, variant: 'slice' | 'page') => void
  /** Close the issue surface; the face behind it stays where it was. */
  closeIssue: () => void
  /**
   * Move the open issue between its presentations — the slice dialog and the
   * whole-column page. The Task stays the same; only the presentation moves.
   */
  setIssueVariant: (variant: 'slice' | 'page') => void
  backToWorkspace: () => void
  /** Leave the selected Channel for the workspace Channel list; keeps mode and Workspace. */
  backToChannels: () => void
  /**
   * Swap the conversation seat to a Member Session while Team chrome stays
   * mounted. `returnToSessionId` is captured once — switching between Member
   * Sessions keeps the original target.
   */
  enterMemberSession: (sessionId: SessionId, returnToSessionId?: SessionId) => void
  /** Close the embedded Member Session view and return to the Team views. */
  exitMemberSession: () => void
  /**
   * Go back one position in the Team's history — the same stack the browser's
   * back button walks. False when the stack has nowhere to go, and the caller
   * keeps its own destination.
   */
  back: () => boolean
  /** Go forward one position in the Team's history. */
  forward: () => boolean
}

/** Root-scoped Team mode state. Slot lifetimes subscribe to this source. */
export class TeamNavigation {
  private snapshot = readSnapshot()
  /** The snapshot as it was before the current change; the position seam's "previous". */
  private previous = this.snapshot
  private readonly listeners = new Set<() => void>()
  /** True while a position from the history stack is being applied. */
  private restoring = false

  /**
   * The position seam: the history stack hears every navigation that changed
   * the durable position and decides what that change means — a new place, a
   * closed issue, or nothing at all. The navigation does not know how a
   * position is stored.
   */
  onPositionChange: ((next: TeamNavigationSnapshot, previous: TeamNavigationSnapshot) => void) | undefined

  /** The history stack, once it exists: the in-app back and forward ride it. */
  private history: TeamHistoryPort | undefined

  readonly getSnapshot = (): TeamNavigationSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Hand the navigation the Team's history, so the in-app back and forward
   * walk the same stack the browser's buttons do.
   */
  attachHistory(history: TeamHistoryPort): void {
    this.history = history
  }

  /** True when the Team's history has a position to go back to. */
  canGoBack(): boolean {
    return this.history?.canGoBack ?? false
  }

  /** True when the Team's history has a position to go forward to. */
  canGoForward(): boolean {
    return this.history?.canGoForward ?? false
  }

  /**
   * Apply a position the history stack owns. It is a restore, not a
   * navigation: it never pushes, and it leaves the runtime-only Member
   * Session overlay alone — that overlay is not a place.
   */
  applyPosition(position: TeamNavigationSnapshot): void {
    this.restoring = true
    try {
      // The position replaces the durable facts — the face it was captured
      // with, and nothing of the face the reader was at before it.
      const { memberSessionId, returnToSessionId } = this.snapshot
      this.snapshot = {
        ...position,
        ...(memberSessionId === undefined ? {} : { memberSessionId }),
        ...(returnToSessionId === undefined ? {} : { returnToSessionId }),
      }
      this.commit()
    } finally {
      this.restoring = false
    }
  }

  actions(): TeamNavigationActions {
    return {
      enterTeam: () => { this.clearMemberSession(); this.setMode('team') },
      leaveTeam: () => { this.setMode('conversation') },
      selectWorkspace: workspaceId => { this.clearMemberSession(); this.setWorkspace(workspaceId) },
      selectChannel: channelRef => { this.clearMemberSession(); this.setChannel(channelRef) },
      selectThread: (threadRef, channelRef, taskRef, taskNumber) => { this.clearMemberSession(); this.setThread(threadRef, channelRef, taskRef, taskNumber) },
      selectDoc: (docRef, threadRef, channelRef) => {
        this.clearMemberSession()
        // Opening a Doc from its own Thread keeps that Thread's Task identity, so going back restores the same face.
        const same = this.snapshot.threadRef === threadRef
        this.setThread(threadRef, channelRef ?? (same ? this.snapshot.channelRef : undefined), same ? this.snapshot.taskRef : undefined, same ? this.snapshot.taskNumber : undefined, docRef)
      },
      selectInbox: () => { this.clearMemberSession(); this.setInbox() },
      selectBoard: () => { this.clearMemberSession(); this.setBoard() },
      openIssue: (taskRef, variant) => { this.clearMemberSession(); this.setIssue(taskRef, variant) },
      closeIssue: () => { this.clearMemberSession(); this.setIssue(undefined) },
      setIssueVariant: variant => { this.clearMemberSession(); this.setIssueVariant(variant) },
      backToWorkspace: () => { this.clearMemberSession(); this.setThread(undefined) },
      backToChannels: () => { this.clearMemberSession(); this.clearChannel() },
      enterMemberSession: (sessionId, returnToSessionId) => { this.setMemberSession(sessionId, returnToSessionId) },
      exitMemberSession: () => { this.clearMemberSession() },
      back: () => this.history?.back() ?? false,
      forward: () => this.history?.forward() ?? false,
    }
  }

  dispose(): void {
    this.listeners.clear()
  }

  private setMode(mode: TeamMode): void {
    if (this.snapshot.mode === mode) return
    this.snapshot = { ...this.snapshot, mode }
    this.commit()
  }

  private setMemberSession(sessionId: SessionId, returnToSessionId?: SessionId): void {
    // Re-selecting the active Member keeps the original return target.
    if (this.snapshot.memberSessionId === sessionId && this.snapshot.mode === 'team') return
    const { memberSessionId: _memberSessionId, ...base } = this.snapshot
    this.snapshot = {
      ...base,
      mode: 'team',
      memberSessionId: sessionId,
      ...(returnToSessionId === undefined ? {} : { returnToSessionId }),
    }
    this.commit()
  }

  /** Any explicit Team navigation or the footer leave closes a Member view. */
  private clearMemberSession(): void {
    if (this.snapshot.memberSessionId === undefined && this.snapshot.returnToSessionId === undefined) return
    const { memberSessionId: _memberSessionId, returnToSessionId: _returnToSessionId, ...base } = this.snapshot
    this.snapshot = base
    this.commit()
  }

  private setWorkspace(workspaceId: WorkspaceId): void {
    if (this.snapshot.workspaceId === workspaceId && this.snapshot.inbox !== true) return
    // With no Workspace selected yet this is the browser adopting the default it
    // is already showing, not a switch: a Channel picked before the adoption (the
    // one-gesture landing from a plain conversation) belongs to that Workspace
    // and must survive it. Only a real switch to another Workspace clears.
    if (this.snapshot.workspaceId === undefined && this.snapshot.channelRef !== undefined) {
      const { inbox: _inbox, board: _board, ...base } = this.snapshot
      this.snapshot = { ...base, workspaceId }
      this.commit()
      return
    }
    const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, inbox: _inbox, board: _board, ...base } = this.snapshot
    this.snapshot = { ...base, workspaceId }
    this.commit()
  }

  private setChannel(channelRef: AgentTeamChannelRef): void {
    if (this.snapshot.channelRef === channelRef && this.snapshot.threadRef === undefined && this.snapshot.inbox !== true && this.snapshot.board !== true) return
    const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, inbox: _inbox, board: _board, ...base } = this.snapshot
    this.snapshot = { ...base, channelRef }
    this.commit()
  }

  /** The Inbox is a face, not workspace content: selecting a Workspace leaves it. */
  private setInbox(): void {
    if (this.snapshot.inbox === true && this.snapshot.channelRef === undefined && this.snapshot.threadRef === undefined) return
    const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, board: _board, ...base } = this.snapshot
    this.snapshot = { ...base, inbox: true }
    this.commit()
  }

  /** The Board is a face, not workspace content: selecting a Workspace leaves it. */
  private setBoard(): void {
    if (this.snapshot.board === true && this.snapshot.channelRef === undefined && this.snapshot.threadRef === undefined) return
    const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, inbox: _inbox, ...base } = this.snapshot
    this.snapshot = { ...base, board: true }
    this.commit()
  }

  private clearChannel(): void {
    const { channelRef: _channelRef, ...base } = this.snapshot
    if (this.snapshot.channelRef === undefined) return
    this.snapshot = base
    this.commit()
  }

  /**
   * The issue slot: the Task whose issue surface is open and how it is
   * presented. It is orthogonal to the face flags — the face behind it stays
   * exactly where it was, so closing the issue returns the reader to it.
   */
  private setIssue(taskRef: AgentTeamTaskRef | undefined, variant?: 'slice' | 'page'): void {
    if (taskRef === undefined) {
      if (this.snapshot.issueRef === undefined && this.snapshot.issueVariant === undefined) return
      const { issueRef: _issueRef, issueVariant: _issueVariant, ...base } = this.snapshot
      this.snapshot = base
      this.commit()
      return
    }
    if (this.snapshot.issueRef === taskRef && this.snapshot.issueVariant === variant) return
    this.snapshot = { ...this.snapshot, issueRef: taskRef, issueVariant: variant ?? 'slice' }
    this.commit()
  }

  /** Move the open issue between its presentations; the Task stays the same. */
  private setIssueVariant(variant: 'slice' | 'page'): void {
    if (this.snapshot.issueRef === undefined) return
    if (this.snapshot.issueVariant === variant) return
    this.snapshot = { ...this.snapshot, issueVariant: variant }
    this.commit()
  }

  private setThread(threadRef: AgentTeamThreadRef | undefined, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number, docRef?: AgentTeamDocRef): void {
    if (this.snapshot.threadRef === threadRef && this.snapshot.taskRef === taskRef && this.snapshot.channelRef === channelRef && this.snapshot.taskNumber === taskNumber
      && this.snapshot.docRef === docRef && this.snapshot.inbox !== true && this.snapshot.board !== true) return
    if (threadRef === undefined) {
      const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, board: _board, ...base } = this.snapshot
      this.snapshot = base
    } else {
      const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, docRef: _docRef, inbox: _inbox, board: _board, ...base } = this.snapshot
      this.snapshot = {
        ...base,
        threadRef,
        ...(channelRef === undefined ? {} : { channelRef }),
        ...(taskRef === undefined ? {} : { taskRef }),
        ...(taskNumber === undefined ? {} : { taskNumber }),
        ...(docRef === undefined ? {} : { docRef }),
      }
    }
    this.commit()
  }

  private commit(): void {
    const previous = this.previous
    this.previous = this.snapshot
    persistSnapshot(this.snapshot)
    // A restore is not a navigation: the position came *from* the stack, so
    // the stack must not be told about it as a new place.
    if (!this.restoring) this.onPositionChange?.(this.snapshot, previous)
    for (const listener of this.listeners) listener()
  }

}

export { STORAGE_KEY }
