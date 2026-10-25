// The issue's agent activity: the cards of the seats running on this Task
// right now, and the history of the runs that already finished.
//
// One read, two regions. `useThreadLog` is the Thread page's own fold of
// `threadSessions`, `memberActivity` and the Turn failures — the same source
// the log rows and the live figures come from — and calling it once here keeps
// the two regions from disagreeing: a card cannot claim a run the history still
// lists, and the token total cannot count a run the cards are still watching.

import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { useThreadLog, type ThreadLogSource } from '../thread/ExecutionLog.tsx'
import { IssueExecutionLog } from './IssueExecutionLog.tsx'
import { IssueRunningAgents } from './IssueRunningAgents.tsx'

export interface IssueAgentActivityProps extends ThreadLogSource {
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's agent activity region: the running cards, then the execution
 * history. The running seats are the cards and never the history list, because
 * `useThreadLog` folds a seat's live Session out of its past rows — one run is
 * never on screen twice.
 */
export function IssueAgentActivity({ openMemberSession, members, t, ...source }: IssueAgentActivityProps) {
  const { pastRows, activities, stopping, error, stop } = useThreadLog(source)
  return (
    <>
      <IssueRunningAgents
        members={members}
        threadRef={source.threadRef}
        activities={activities}
        stopping={stopping}
        onOpenSession={openMemberSession}
        onStop={stop}
        t={t}
      />
      <IssueExecutionLog
        rows={pastRows}
        openMemberSession={openMemberSession}
        members={members}
        error={error}
        t={t}
      />
    </>
  )
}
