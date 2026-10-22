// Derived from multica-x packages/views/issues/components/execution-log-section.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the execution log is already a port of Multica's, in
// `thread/ExecutionLog.tsx` — it reads the Thread's Session runs, folds the
// live row's step and tool from the activity snapshot, and stops a run behind
// a confirm. This region is that component, with the issue's Thread: the
// region is the log, and the log is the Thread's runs.
//
// The contract's `executionLog` region is the Host-side mirror of the same
// runs (a snapshot, C5); the live tool line is the client's own read, so the
// log renders the live rows through the same remotes the Thread page uses.

import type { AgentTeamClientMemberStatus, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { ExecutionLog } from '../thread/ExecutionLog.tsx'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueExecutionLogProps {
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  readonly loadThreadSessions: TeamConversationProps['loadThreadSessions']
  readonly loadMemberActivity: TeamConversationProps['loadMemberActivity']
  readonly threadTurnFailures: TeamConversationProps['threadTurnFailures']
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly stopSession: TeamConversationProps['stopSession']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly t: TeamConversationProps['t']
}

/** The issue's execution log: the seats' runs on this Task, the live one first. */
export function IssueExecutionLog(props: IssueExecutionLogProps) {
  return (
    <section className={css.region} aria-label={props.t('issueExecutionLogLabel')}>
      <h2 className={css.regionHeading}>{props.t('issueExecutionLogLabel')}</h2>
      <ExecutionLog
        workspaceId={props.workspaceId}
        threadRef={props.threadRef}
        loadThreadSessions={props.loadThreadSessions}
        loadMemberActivity={props.loadMemberActivity}
        threadTurnFailures={props.threadTurnFailures}
        openMemberSession={props.openMemberSession}
        stopSession={props.stopSession}
        subscribeChanges={props.subscribeChanges}
        members={props.members}
        t={props.t}
      />
    </section>
  )
}
