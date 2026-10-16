// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { TeamComposer } from '../src/client/TeamComposer.tsx'
import { TeamDraftStore } from '../src/client/drafts.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

// Interpolating translate: the component's own t supports params, so the spec
// double must too, or the accessible-name assertions read raw templates.
const translate = ((key: keyof typeof zh, params?: Record<string, string>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('@{' + name + '}', '@' + value).replaceAll('{' + name + '}', value)
  return text
}) as unknown as TeamConversationProps['t']

const member = (id: string, handle: string): AgentTeamClientMemberStatus => ({
  member: { memberId: id, handle, description: 'Builds things', state: 'active', presetId: 'p', workspaceIds: [], sessionId: 'session:' + id },
} as unknown as AgentTeamClientMemberStatus)

function renderComposer(members: readonly AgentTeamClientMemberStatus[]) {
  const drafts = new TeamDraftStore()
  render(<TeamComposer
    members={members}
    drafts={drafts}
    loadTriggerCatalog={vi.fn()}
    draftKey={'channel:channel:test' as never}
    pending={false}
    onSubmit={vi.fn()}
    onAsTaskChange={vi.fn()}
    t={translate}
  />)
}

describe('TeamComposer agent picker (A14 amendment g)', () => {
  it('shows only the glyph plus the selected handle once an agent is picked', () => {
    renderComposer([member('member:a', '@alpha'), member('member:b', '@beta')])
    const button = screen.getByRole('button', { name: 'Agent：@alpha，更换' })
    expect(button.getAttribute('title')).toBe('更换 Agent')
    // The "Select Agent" words are gone in the selected state, from both the
    // visible label and the accessible name.
    expect(button.textContent).not.toContain('选择 Agent')
    expect(button.querySelector('[data-team-agent-picker-current]')?.textContent).toBe('@alpha')
  })

  it('renders no picker at all on an empty roster', () => {
    // No members, no control: the empty-Channel face carries no picker (the
    // Channel header menu's Manage members item still reaches the dialog, so
    // the way in is not lost). Neither the selected-state name nor the
    // Select Agent name may appear.
    renderComposer([])
    expect(document.querySelector('[data-team-agent-picker]')).toBeNull()
    expect(screen.queryByRole('button', { name: '选择 Agent' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Agent：@/ })).toBeNull()
  })

  it('keeps the As task control on its own checklist icon', () => {
    renderComposer([member('member:a', '@alpha')])
    const asTask = screen.getByRole('button', { name: '作为任务' })
    const picker = screen.getByRole('button', { name: 'Agent：@alpha，更换' })
    // Different glyphs: the picker no longer shares the task-list icon with
    // As task, so their inline artwork must differ.
    expect(asTask.querySelector('svg')?.innerHTML).not.toBe(picker.querySelector('svg')?.innerHTML)
  })
})
