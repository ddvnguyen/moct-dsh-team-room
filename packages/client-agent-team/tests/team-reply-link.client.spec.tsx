// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AgentTeamMemberId, AgentTeamMessageRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { TeamMessage } from '../src/client/TeamMessage.tsx'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t = ((key: string) => key) as unknown as TeamConversationProps['t']
const parentRef = 'message:parent' as AgentTeamMessageRef
const ownRef = 'message:own' as AgentTeamMessageRef

function row(props: Partial<Parameters<typeof TeamMessage>[0]> = {}) {
  return render(<TeamMessage senderName="@builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body="answer" t={t} messageRef={ownRef} {...props} />)
}

describe('reply-link quote line (TeamMessage)', () => {
  it('leads the body with the resolved author and excerpt, and jumps to the parent on click', () => {
    const onOpenReplyTo = vi.fn()
    const view = row({ replyTo: { senderName: '@ann', excerpt: 'Ship plan', messageRef: parentRef }, onOpenReplyTo })
    const quote = view.container.querySelector('[data-quote-line]') as HTMLElement
    expect(quote.tagName).toBe('BUTTON')
    expect(quote.textContent).toBe('@annShip plan')
    fireEvent.click(quote)
    expect(onOpenReplyTo).toHaveBeenCalledWith(parentRef)
  })

  it('stays inert without a jump handler, and renders nothing for a Message that quotes nothing', () => {
    const inert = row({ replyTo: { senderName: '@ann', excerpt: 'Ship plan', messageRef: parentRef } })
    expect((inert.container.querySelector('[data-quote-line]') as HTMLElement).tagName).toBe('SPAN')
    cleanup()
    const plain = row()
    expect(plain.container.querySelector('[data-quote-line]')).toBeNull()
  })

  it('offers the quote action only with a handler, passing the row\'s own ref', () => {
    const onReply = vi.fn()
    const view = row({ onReply })
    fireEvent.click(view.container.querySelector('[data-quote-message]')!)
    expect(onReply).toHaveBeenCalledWith(ownRef)
    expect(view.container.querySelector('article')!.getAttribute('data-message-ref')).toBe(ownRef)
    cleanup()
    expect(row().container.querySelector('[data-quote-message]')).toBeNull()
  })
})

describe('reply-link in the Thread page', () => {
  const threadRef = 'thread:quotes' as AgentTeamThreadRef

  async function openThread() {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true, seedThreadRef: threadRef,
      seededMessages: [
        { body: 'first question\nwith detail', occurredAt: '2026-08-21T09:00:00.000Z' },
        { body: 'agent answer', occurredAt: '2026-08-21T09:10:00.000Z', sender: 'agent', replyToMessageRef: 'message:seed-0' },
      ],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click((await b.view.findAllByText('Task #1'))[0]!.closest('button')!)
    const page = await waitFor(() => {
      const node = b.view.container.querySelector('[data-team-thread]') as HTMLElement | null
      if (node === null) throw new Error('thread page not mounted')
      return node
    })
    return { b, page }
  }

  it('resolves a reply\'s parent through the Host and renders its quote', async () => {
    const { b, page } = await openThread()
    await waitFor(() => expect(b.resolveMessageRefs).toHaveBeenCalled())
    expect(b.resolveMessageRefs.mock.calls[0]![0].messageRefs).toEqual(['message:seed-0'])
    const quote = await waitFor(() => {
      const node = page.querySelector('[data-quote-line]') as HTMLElement | null
      if (node === null || !node.textContent!.includes('first question')) throw new Error('quote not resolved')
      return node
    })
    // The excerpt is the first line only; the body below it is never pasted again.
    expect(quote.textContent).not.toContain('with detail')
    const parentRow = page.querySelector('[data-message-ref="message:seed-0"]') as HTMLElement & { scrollIntoView: () => void }
    parentRow.scrollIntoView = vi.fn()
    fireEvent.click(quote)
    expect(parentRow.scrollIntoView).toHaveBeenCalled()
    expect(parentRow.hasAttribute('data-reply-flash')).toBe(true)
  })

  it('sends the quoted Message as replyToMessageRef, shows the banner, and clears it after the send', async () => {
    const { b, page } = await openThread()
    const parentRow = await waitFor(() => {
      const node = page.querySelector('[data-message-ref="message:seed-1"]') as HTMLElement | null
      if (node === null) throw new Error('row missing')
      return node
    })
    fireEvent.click(within(parentRow).getByRole('button', { name: '引用这条消息' }))
    const banner = await waitFor(() => {
      const node = page.querySelector('[data-reply-banner]') as HTMLElement | null
      if (node === null || !node.textContent!.includes('agent answer')) throw new Error('banner not resolved')
      return node
    })
    expect(banner.textContent).toContain('引用 @builder')
    expect(parentRow.hasAttribute('data-replying-to')).toBe(true)
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'thanks' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.reply).toHaveBeenCalled())
    expect(b.reply.mock.calls[0]![0].replyToMessageRef).toBe('message:seed-1')
    await waitFor(() => expect(page.querySelector('[data-reply-banner]')).toBeNull())
  })

  it('the will-notify row names a quoted Agent but never the Human quoting their own Message', async () => {
    const { page } = await openThread()
    const rowOf = (ref: string) => waitFor(() => {
      const node = page.querySelector(`[data-message-ref="${ref}"]`) as HTMLElement | null
      if (node === null) throw new Error('row missing')
      return node
    })
    fireEvent.click(within(await rowOf('message:seed-1')).getByRole('button', { name: '引用这条消息' }))
    await waitFor(() => expect(page.querySelector('[data-team-notify]')?.textContent).toContain('@builder'))
    // seed-0 is the Human's own Message: its author is the reader, so nobody is notified.
    fireEvent.click(within(await rowOf('message:seed-0')).getByRole('button', { name: '引用这条消息' }))
    await waitFor(() => expect(page.querySelector('[data-reply-banner]')?.textContent).toContain('first question'))
    expect(page.querySelector('[data-team-notify]')).toBeNull()
  })

  it('cancelling the quote sends a plain reply', async () => {
    const { b, page } = await openThread()
    const parentRow = await waitFor(() => {
      const node = page.querySelector('[data-message-ref="message:seed-1"]') as HTMLElement | null
      if (node === null) throw new Error('row missing')
      return node
    })
    fireEvent.click(within(parentRow).getByRole('button', { name: '引用这条消息' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消引用' }))
    expect(page.querySelector('[data-reply-banner]')).toBeNull()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'plain' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.reply).toHaveBeenCalled())
    expect('replyToMessageRef' in b.reply.mock.calls[0]![0]).toBe(false)
  })
})
