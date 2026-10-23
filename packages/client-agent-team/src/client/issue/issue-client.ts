// The issue's client-side seam and context.
//
// The navigation slot (the `issueRef` / `issueVariant` pair) says WHICH issue
// is open and HOW it is presented. Two facts the slot does not carry travel
// beside it, here:
//
// - the Workspace the issue is read in. The Inbox merges every visible
//   Workspace, so a row may name a Workspace the reader has not selected, and
//   selecting it would leave the Inbox — the very face the issue must stay
//   over. The issue reads in the Workspace it was opened from, and the face
//   behind it never moves.
// - the control the reader invoked. The focus returns to it when the slice
//   closes.
//
// Neither is a navigation flag: this context is not persisted, it is not part
// of the snapshot, and it never touches the face flags. The slot stays the
// navigation's.

import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { focusWithoutRing } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamNavigation } from '../navigation.ts'

/**
 * Gives the focus to one control. The reader's own control is named as a
 * function, not as a node: a card's title is re-created whenever the board
 * reloads, and a captured node would be stale by the time the focus comes
 * back.
 */
export type FocusOpener = () => void

/** The open issue's client-side facts. */
export interface IssueContext {
  /** The Task whose issue is open. */
  readonly taskRef: AgentTeamTaskRef
  /** The Workspace the Task lives in: the Host reads the issue in it. */
  readonly workspaceId: WorkspaceId
  /** The control the reader invoked, if any: the focus returns to it. */
  readonly focusOpener?: FocusOpener | undefined
}

/** How one issue is opened. */
export interface IssueOpenOptions {
  /**
   * The Workspace the Task lives in. Without it the seam reads the issue in
   * the Workspace the navigation currently holds — right for the Board, the
   * Thread and the Agent page, wrong for an Inbox row that names another
   * Workspace.
   */
  readonly workspaceId?: WorkspaceId
  /**
   * The control the reader invoked, as a way to focus it. The seam moves the
   * focus to it before the dialog opens, and gives it back when the issue
   * closes.
   */
  readonly focusOpener?: FocusOpener | undefined
}

/** The open issue's context, and who is listening for it to change. */
export interface IssueContextStore {
  /** The context of the open issue, if one is open. */
  readonly get: () => IssueContext | undefined
  /** Records the open issue's context. */
  readonly set: (context: IssueContext) => void
  /** Forgets the open issue's context. */
  readonly clear: () => void
  /** Subscribes to the context's changes. */
  readonly subscribe: (listener: () => void) => (() => void)
  /**
   * Gives the focus back to the control the reader came from. The dialog's own
   * layer restores whatever held the focus when it opened, and a card's face
   * holds none — so the seam moves the focus to the opener *before* the
   * dialog opens, and this is the other half: the focus comes back when the
   * dialog closes.
   */
  readonly restoreFocus: () => void
}

/** The client's issue surface: the one seam, and the context it fills. */
export interface IssueClient {
  /**
   * Opens one Task's issue as a slice over the face the reader is on. Every
   * surface calls this one function: the board card, the Inbox row, a cited
   * Task and the Agent page's task rows.
   */
  readonly openIssue: (taskRef: AgentTeamTaskRef, options?: IssueOpenOptions) => void
  /** The open issue's context. */
  readonly context: IssueContextStore
}

/**
 * The control the focus returns to, when the caller names none.
 *
 * A card's face is a `<div>` with a click handler, so clicking it moves no
 * focus — the card names its own title instead. Everywhere else the reader
 * pressed a button, and the button holds the focus already: the element that
 * holds it now is the element that held it when the issue opened.
 */
function activeOpener(): FocusOpener | undefined {
  if (typeof document === 'undefined') return undefined
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return undefined
  return () => { if (active.isConnected) focusWithoutRing(active) }
}

/**
 * The issue client's own state: one context, one seam.
 *
 * The seam writes the navigation's slot — M-35's, unchanged — and fills the
 * context beside it. It never touches a face flag, so the face behind the
 * issue is the face the reader was on when they opened it.
 */
export function createIssueClient(navigation: TeamNavigation): IssueClient {
  let context: IssueContext | undefined
  const listeners = new Set<() => void>()
  const store: IssueContextStore = {
    get: () => context,
    set: (next) => {
      context = next
      for (const listener of listeners) listener()
    },
    clear: () => {
      if (context === undefined) return
      context = undefined
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    restoreFocus: () => { context?.focusOpener?.() },
  }
  return {
    context: store,
    openIssue: (taskRef, options) => {
      const workspaceId = options?.workspaceId ?? navigation.getSnapshot().workspaceId
      // The Host reads the issue in a Workspace; without one there is nothing
      // to read, and the slot is not written.
      if (workspaceId === undefined) return
      // The focus moves to the opener BEFORE the dialog opens. The dsh modal
      // layer restores the element that held the focus when it opened, so
      // this is what makes Escape return the focus to where the reader came
      // from — the card's title, not the body.
      const focusOpener = options?.focusOpener ?? activeOpener()
      focusOpener?.()
      store.set({ taskRef, workspaceId, focusOpener })
      navigation.actions().openIssue(taskRef, 'slice')
    },
  }
}
