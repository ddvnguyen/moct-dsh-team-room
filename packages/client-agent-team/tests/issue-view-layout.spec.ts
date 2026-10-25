import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does not lay out, so the scroll structure is guarded at its source:
// the declarations the real-browser run (Playwright, desktop and 390x844)
// reads. Three facts are at stake — the header band never scrolls, each pane
// owns exactly one scrollbar, and the slice dialog is not a second scroller
// wrapped around the page (M-71).
const rule = (file: string, selector: string): string => {
  const css = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

const view = (selector: string): string => rule('issue/issue-view.module.css', selector)
const slice = (selector: string): string => rule('issue/issue-slice.module.css', selector)

describe('the issue view scrolls one pane at a time', () => {
  it('the header band stays put: the page is no longer the scroller, the timeline pane is', () => {
    const page = view('.page')
    expect(page).toMatch(/overflow:\s*hidden/)
    expect(page).not.toMatch(/overflow-y:\s*auto/)
    expect(page).toMatch(/flex:\s*1/)
    expect(view('.head')).toMatch(/flex:\s*none/)

    const content = view('.content')
    expect(content).toMatch(/overflow-y:\s*auto/)
    expect(content).toMatch(/min-height:\s*0/)
    expect(content).toMatch(/overscroll-behavior:\s*contain/)
  })

  it('the side panel gets a bounded box of its own to scroll in', () => {
    const bodyRow = view('.bodyRow')
    expect(bodyRow).toMatch(/flex:\s*1/)
    expect(bodyRow).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\)/)

    const side = view('.side')
    expect(side).toMatch(/overflow-y:\s*auto/)
    expect(side).toMatch(/min-height:\s*0/)
  })

  it('the slice dialog carries one scrollbar per pane, not a scroller around them', () => {
    const tree = slice('.tree')
    expect(tree).not.toMatch(/overflow-y:\s*auto/)
    expect(tree).toMatch(/overflow:\s*hidden/)
    expect(tree).toMatch(/flex:\s*1/)
    expect(view('.page')).not.toMatch(/overflow-y:\s*auto/)
  })
})
