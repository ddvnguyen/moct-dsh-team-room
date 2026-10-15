import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does not lay out, so this guards the declarations the real-browser run
// (Playwright, 1280x720 and 390x844, 25 records) proved: the page owns its
// overflow and may shrink inside the host's fixed-height flex parent.
const rule = (file: string, selector: string): string => {
  const css = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

describe('scroll containers', () => {
  it.each([['team-settings.module.css', '.page'], ['agent-detail.module.css', '.viewBody']])('%s %s scrolls inside a flex parent', (file, selector) => {
    const body = rule(file, selector)
    expect(body).toMatch(/overflow-y:\s*auto/)
    expect(body).toMatch(/min-height:\s*0/)
  })
})
