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

import { useSyncExternalStore } from 'react'
import type { TeamNavigation } from '../navigation.ts'
import { useHumanIdentity, type TeamHumanIdentitySource } from '../human-identity.ts'
import { IssueSlice, type IssueSliceProps } from './IssueSlice.tsx'

export interface IssueSliceHostProps extends Omit<IssueSliceProps, 'workspaceId' | 'taskRef' | 'humanName' | 'closeIssue' | 'maximize'> {
  /** The navigation slot: the issue that is open, and how it is presented. */
  readonly navigation: TeamNavigation
  /** The Human the rows name: their own messages read as literal text. */
  readonly humanIdentity: TeamHumanIdentitySource
}

/**
 * The issue slice's host: the dialog exists exactly while the navigation's
 * issue slot names the slice. The page is the other presentation of the same
 * slot, so the two never stand at once.
 */
export function IssueSliceHost(props: IssueSliceHostProps) {
  const { navigation, humanIdentity, ...surface } = props
  const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const identity = useHumanIdentity(humanIdentity)
  const workspaceId = snapshot.workspaceId
  const taskRef = snapshot.issueRef
  if (workspaceId === undefined || taskRef === undefined || snapshot.issueVariant !== 'slice') return null
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
