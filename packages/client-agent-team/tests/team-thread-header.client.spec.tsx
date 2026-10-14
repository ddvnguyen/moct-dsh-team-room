// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

vi.setConfig({ testTimeout: 30_000 })
usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/**
 * L1 (issue 57): the Thread header row's action group — Convert to Task on a
 * taskless Thread, accept/close on an open Task — seats itself at the row's far
 * right instead of sitting beside the status pill in the middle.
 */
describe('Team Thread header actions', () => {
  const openThread = async (b: Awaited<ReturnType<typeof runtimeWithTeam>>) => {
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    await b.view.findByText('# engineering / Task #1')
  }

  it('seats the Thread action group at the far right of the header row', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openThread(b)

    const header = document.querySelector('[data-team-slim-header="thread"]') as HTMLElement
    expect(header).toBeTruthy()
    const accept = within(header).getByRole('button', { name: '验收' })
    const close = within(header).getByRole('button', { name: '关闭任务' })
    const group = close.parentElement as HTMLElement
    // One group, and it is the row's last child — the only thing after the
    // participants and the status pill.
    expect(accept.parentElement).toBe(group)
    expect(group.className).toContain('slimActions')
    expect(header.lastElementChild).toBe(group)
    const crumb = within(header).getByRole('button', { name: /返回/ })
    expect(crumb.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await b.runtime.dispose()
  })

  it('gives the Thread header action group the trailing auto margin, and the Channel header none', () => {
    // jsdom applies no CSS modules, so the rule is asserted against the source
    // it ships in: the Thread row's group carries the auto margin that seats it
    // at the far right, and the selector is scoped so the Channel header — whose
    // description already fills the row's free space — keeps its own layout.
    const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../src/client/channel.module.css'), 'utf8')
    expect(css).toMatch(/\.slimHeader\[data-team-slim-header="thread"\] \.slimActions \{[^}]*margin-left: auto/u)
    // The scoped rule is the only auto margin on the header: the base
    // `.slimHeader` rule itself and the Channel's own row carry none.
    const base = css.slice(css.indexOf('.slimHeader {'), css.indexOf('}', css.indexOf('.slimHeader {')))
    expect(base).not.toMatch(/margin-left: auto/u)
    expect(css.match(/margin-left: auto/gu)?.length).toBe(1)
  })
})
