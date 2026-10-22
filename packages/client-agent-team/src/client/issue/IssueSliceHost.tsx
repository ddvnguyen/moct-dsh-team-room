// Derived from multica-x packages/views/issues/components/issue-peek.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the host of the issue slice — the one place the slice
// lives. It sits in the shell's floating layer, above every column, so the
// issue opens over whatever screen the reader is on and the screen behind it
// stays live.
//
// The host reads the navigation's slot (M-35's `issueRef` / `issueVariant`)
// and renders the slice only while the slot says the slice is open: one host,
// one dialog, and no flag of this card's own.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { TeamNavigation } from '../navigation.ts'
import { useHumanIdentity, type TeamHumanIdentitySource } from '../human-identity.ts'
import type { IssueContextStore } from './issue-client.ts'
import { IssueSlice, type IssueSliceProps } from './IssueSlice.tsx'

export interface IssueSliceHostProps extends Omit<IssueSliceProps, 'workspaceId' | 'taskRef' | 'humanName' | 'closeIssue' | 'maximize'> {
  /** The navigation slot: the issue that is open, and how it is presented. */
  readonly navigation: TeamNavigation
  /** The open issue's context: the Workspace it is read in, and its opener. */
  readonly issueContext: IssueContextStore
  /** The Human the rows name: their own messages read as literal text. */
  readonly humanIdentity: TeamHumanIdentitySource
}

/**
 * The issue slice's host: the dialog exists exactly while the navigation's
 * issue slot names the slice. The page is the other presentation of the same
 * slot, so the two never stand at once.
 */
export function IssueSliceHost(props: IssueSliceHostProps) {
  const { navigation, humanIdentity, issueContext, ...surface } = props
  const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const context = useSyncExternalStore(issueContext.subscribe, issueContext.get, issueContext.get)
  const identity = useHumanIdentity(humanIdentity)
  const taskRef = snapshot.issueRef
  // The issue is read in the Workspace it was opened from: an Inbox row may
  // name a Workspace the reader has not selected, and selecting it would
  // leave the very face the slice is over.
  const workspaceId = context !== undefined && context.taskRef === taskRef ? context.workspaceId : snapshot.workspaceId
  const open = taskRef !== undefined && snapshot.issueVariant === 'slice'
  // Escape closes the slice, and the focus goes back to the control the
  // reader came from. The dialog's own layer gives the focus back to
  // whatever held it when it opened — and a card's face holds none — so the
  // seam moves the focus to the opener before the dialog opens, and this
  // gives it back when the issue closes. The issue closing is the moment,
  // not the presentation changing: Maximize hands the focus to the page.
  const issueOpen = taskRef !== undefined
  const wasOpen = useRef(issueOpen)
  useEffect(() => {
    if (wasOpen.current && !issueOpen) issueContext.restoreFocus()
    wasOpen.current = issueOpen
  }, [issueOpen, issueContext])
  if (workspaceId === undefined || taskRef === undefined || !open) return null
  return (
    <IssueSlice
      {...surface}
      workspaceId={workspaceId}
      taskRef={taskRef}
      humanName={identity.name ?? props.t('human')}
      closeIssue={() => { navigation.actions().closeIssue() }}
      maximize={() => { navigation.actions().setIssueVariant('page') }}
    />
  )
}
