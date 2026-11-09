import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPERT } from '../lib/typert.host.js'
import remote from '../lib/typert.remote-client.js'

interface GeneratedInvocation {
  readonly method: string
}

interface GeneratedHost {
  readonly invocations: readonly GeneratedInvocation[]
}

interface GeneratedRemote {
  readonly descriptors: readonly GeneratedInvocation[]
}

describe('Agent Team generated Typert boundary', () => {
  it('publishes the complete Agent Team Client boundary', () => {
    const host = TYPERT as GeneratedHost
    const client = remote as unknown as GeneratedRemote
    const expected = [
      'addMember',
      'answerDecision',
      'archiveChannel',
      'archiveMember',
      'changeAttention',
      'changeTask',
      'changes',
      'clearMemberContext',
      'commentDoc',
      'contextJudge',
      'createChannel',
      'createTask',
      'decisionRecords',
      'decisions',
      'doc',
      'docSectionHistory',
      'docs',
      'environment',
      'forkMemberSession',
      'getAttachment',
      'getHumanAvatar',
      'humanProfile',
      'inbox',
      'issueView',
      'joinChannel',
      'joinWorkspace',
      'leaveWorkspace',
      'memberActivity',
      'memberSessions',
      'members',
      'memoryAct',
      'memoryList',
      'memoryRecord',
      'memoryRuleFeed',
      'memorySettings',
      'memoryUsage',
      'promoteThread',
      'putAttachment',
      'putHumanAvatar',
      'readThread',
      'recoverMember',
      'removeChannelMember',
      'removeHumanAvatar',
      'reply',
      'resolveComment',
      'resolveDocComment',
      'resolveMessageRefs',
      'resolveTaskRefs',
      'resolveThreadRefs',
      'resumeMemberSession',
      'reviewDoc',
      'roomActivity',
      'sendMessage',
      'sessionStats',
      'setHumanProfile',
      'threadHistory',
      'threadObservations',
      'threadReplyStats',
      'threadSessions',
      'threadSummary',
      'threadTurnFailures',
      'updateChannel',
      'updateMember',
      'updateMemorySettings',
      'updateTask',
      'view',
      'workspaceActivity',
      'writeDocSection',
    ]
    expect(host.invocations.map(invocation => invocation.method).sort()).toEqual(expected)
    expect(client.descriptors.map(invocation => invocation.method).sort()).toEqual(expected)
  })

  it('emits threadTurnFailures into both generated outputs (lib/ is git-ignored, so the generator is the source of truth)', () => {
    const libDir = new URL('../lib/', import.meta.url)
    for (const file of ['typert.host.js', 'typert.remote-client.js', 'typert.remote-client.d.ts']) {
      expect(readFileSync(new URL(file, libDir), 'utf8'), file).toContain('threadTurnFailures')
    }
  })
})
