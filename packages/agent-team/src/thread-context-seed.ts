export interface ThreadContextSeedSummary {
  generation: number
  text: string
}

export interface ThreadContextSeedMessage {
  messageRef: string
  sender: string
  body: string
}

/**
 * A7b context seed: the next prompt after a fresh start or cold restart is
 * steered with the latest Thread summary and the last 10 Messages. This is the
 * pure formatting half, so the seeding shape has a regression spec that does
 * not depend on an AgentTeam instance.
 */
export function buildThreadContextSeed(input: {
  summary?: ThreadContextSeedSummary
  messages: ThreadContextSeedMessage[]
}): string {
  const lines = ['Thread context seed (A7b):']
  if (input.summary === undefined) {
    lines.push('Latest summary (generation 0): (none)')
  } else {
    lines.push('Latest summary (generation ' + String(input.summary.generation) + '):', input.summary.text)
  }
  lines.push('Recent messages (last 10):')
  lines.push(...input.messages.map(message => '[' + message.messageRef + '] ' + message.sender + ': ' + message.body))
  lines.push('Answer using the summary and recent messages above.')
  return lines.join('\n')
}
