// D10's mechanical fence: the issue surface is its own tree, and the legacy
// Thread view is a peer surface — never a component the issue view borrows.
//
// The rule is easy to state and easy to break: `TeamThreadPage` is 1400 lines
// of thread-shaped state sitting right beside the issue tree, and the cheap
// move is always to reach for it. This test is the part that cannot be
// forgotten. It also keeps the legacy marker in place, because "frozen" is a
// claim about the code and a claim nobody checks drifts.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')
const issueRoot = join(clientRoot, 'issue')

function sources(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('the issue surface is its own tree (D10)', () => {
  it('never imports the legacy Thread page', () => {
    const offenders = sources(issueRoot)
      .filter(path => /TeamThreadPage/.test(readFileSync(path, 'utf8')))
      .map(path => path.slice(clientRoot.length + 1))
    expect(offenders).toEqual([])
  })

  it('keeps the legacy Thread page marked as deprecated', () => {
    const page = readFileSync(join(clientRoot, 'TeamThreadPage.tsx'), 'utf8')
    expect(page).toContain('@deprecated')
    expect(page).toContain('legacy Thread view')
  })
})
