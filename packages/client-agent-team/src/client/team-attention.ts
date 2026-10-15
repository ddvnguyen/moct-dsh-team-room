import { useRef, useState } from 'react'
import { mintRequestId } from './requests.ts'
import type {
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamThreadAttentionRequest,
  AgentTeamThreadAttentionResult,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** One Thread Attention intent for the Human's own follow. */
export interface ThreadAttentionChange {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadAttentionRequest['threadRef']
  readonly taskRef?: AgentTeamThreadAttentionRequest['taskRef']
  readonly action: 'follow' | 'unfollow'
}

export interface ThreadAttentionTransport {
  readonly changeAttention: (request: AgentTeamThreadAttentionRequest) => Promise<RemoteResult<AgentTeamThreadAttentionResult>>
}
/**
 * Shared Thread Attention mutation. Host `changeAttention` is the Human's
 * PERSONAL op — it binds `actor` itself and carries no memberId — so it can
 * only turn the reading Human's own follow of this Thread on or off; it can
 * never add or remove another seat. One stable requestId per direction and
 * Thread survives transport failures until the Host commits it, matching the
 * Channel membership mutation's contract.
 */
export function useThreadAttention(
  transport: ThreadAttentionTransport,
  onCommitted: (change: ThreadAttentionChange) => void | Promise<void>,
): {
  readonly pending: boolean
  readonly error?: string | undefined
  readonly change: (change: ThreadAttentionChange) => Promise<void>
  readonly clearError: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const requestIds = useRef(new Map<string, AgentTeamRequestId>())

  const change = async (attention: ThreadAttentionChange): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(undefined)
    const key = `${attention.action}:${attention.threadRef ?? attention.taskRef ?? ''}`
    const requestId = requestIds.current.get(key) ?? mintRequestId()
    requestIds.current.set(key, requestId)
    const request: AgentTeamThreadAttentionRequest = {
      requestId,
      workspaceId: attention.workspaceId,
      ...(attention.threadRef === undefined ? {} : { threadRef: attention.threadRef }),
      ...(attention.taskRef === undefined ? {} : { taskRef: attention.taskRef }),
      action: attention.action,
    }
    try {
      const result = await transport.changeAttention(request)
      if (result.ok) {
        requestIds.current.delete(key)
        await onCommitted(attention)
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return { pending, error, change, clearError: () => { setError(undefined) } }
}
