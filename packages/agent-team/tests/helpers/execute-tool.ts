import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolBatchResult, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** A single-call view of the dsh 0.2.2 batch executor, for tests that exercise one tool. */
export interface SingleToolCall {
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: unknown
  readonly agent?: Agent
  readonly signal: AbortSignal
}

/**
 * dsh 0.2.2 executes a batch of `ToolCallBlock`s and returns `results[]`. Wrap one call and
 * hand back its `ToolExecutionResult` (`isError` / `error` / `value`).
 * @param tools - the `ctx.tools` service of the Agent or Host under test.
 * @param call - the one call to execute; `arguments` is JSON-encoded as the model would send it.
 * @returns the settled result of that call.
 */
export async function executeTool(
  tools: { execute(input: { calls: readonly { type: 'tool-call', id: ToolCallId, name: string, arguments: string }[], signal: AbortSignal, agent?: Agent }): Promise<ToolBatchResult> },
  call: SingleToolCall,
): Promise<ToolExecutionResult> {
  const batch = await tools.execute({
    calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) }],
    signal: call.signal,
    ...(call.agent === undefined ? {} : { agent: call.agent }),
  })
  const [settled] = batch.results
  if (settled === undefined) throw new Error(`tool call '${call.name}' returned no result`)
  return settled.result
}
