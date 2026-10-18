// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../../../scripts/check-multica-provenance.mjs', import.meta.url))
const SHA = '0123456789abcdef0123456789abcdef01234567'
const HEADER = `// Derived from multica-x packages/core/issues/config/status.ts @ ${SHA}. Copyright Index Labs. Multica License.\n`
const clientDirectory = 'packages/client-agent-team/src/client'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Builds a throwaway tree and runs the gate against it with `--root`. */
function run(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'multica-provenance-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const notice = `Pinned upstream sources\nSource files: multica-x commit ${SHA}.\n`

describe('multica provenance gate', () => {
  it('accepts a ported file with a header whose commit NOTICE pins', () => {
    const result = run({ NOTICE: notice, [`${clientDirectory}/multica/status.ts`]: `${HEADER}export const x = 1\n` })
    expect(result.status).toBe(0)
  })

  it('rejects a ported file without a derivation header', () => {
    const result = run({ NOTICE: notice, [`${clientDirectory}/multica/status.ts`]: 'export const x = 1\n' })
    expect(result.status).toBe(1)
    expect(result.output).toContain('multica/status.ts: missing or malformed header')
  })

  it('rejects a header whose commit is not a full 40-hex sha', () => {
    const header = '// Derived from multica-x packages/core/x.ts @ abc1234. Copyright Index Labs. Multica License.\n'
    const result = run({ NOTICE: notice, [`${clientDirectory}/multica/x.ts`]: `${header}export const x = 1\n` })
    expect(result.status).toBe(1)
    expect(result.output).toContain('missing or malformed header')
  })

  it('rejects a @multica/* import anywhere in the Client source', () => {
    const result = run({
      NOTICE: notice,
      [`${clientDirectory}/board/Page.tsx`]: "import { useIssues } from '@multica/core/issues'\nexport const Page = () => null\n",
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('imports a @multica/* package')
  })

  it('rejects a header commit that NOTICE does not pin', () => {
    const result = run({ NOTICE: 'Pinned upstream sources\n', [`${clientDirectory}/multica/status.ts`]: `${HEADER}export const x = 1\n` })
    expect(result.status).toBe(1)
    expect(result.output).toContain(`NOTICE does not pin upstream commit ${SHA}`)
  })

  it('validates a header outside the ported directories once it names multica-x', () => {
    const result = run({ NOTICE: notice, [`${clientDirectory}/board/Card.tsx`]: '// Derived from multica-x broken header\nexport const x = 1\n' })
    expect(result.status).toBe(1)
    expect(result.output).toContain('board/Card.tsx: missing or malformed header')
  })

  it('reads a header inside a block comment, as the stylesheet carries it', () => {
    const css = `/*\n * The look layer.\n *\n * Derived from multica-x packages/ui/styles/tokens.css @ ${SHA}.\n * Copyright Index Labs. Multica License.\n */\n.a { color: red; }\n`
    const result = run({ NOTICE: notice, [`${clientDirectory}/multica-look.module.css`]: css })
    expect(result.status).toBe(0)
  })
})
