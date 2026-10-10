import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Regression guard for the undeclared-service read. Cordis throws
// `cannot get property "<name>" without inject` when the plugin reads a service
// it does not declare in `static inject`, and the `?.` operator does not help.
// That throw is invisible in the in-process harness, which mounts every service,
// so this test reads the source instead. It must fail on any source that reads
// `this.ctx.<name>` for a name that is neither injected nor a built-in below.

/** Cordis built-ins a plugin may read on its own context, with no inject. */
const CORDIS_BUILTINS = new Set(['effect', 'emit', 'fiber', 'get', 'inject', 'logger', 'on', 'root'])

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

/** Names listed in the AgentTeam `static inject = [...]` array. */
function injectedNames(text: string): Set<string> {
  const block = /static inject = \[([\s\S]*?)\]/.exec(text)
  if (block === null) throw new Error('static inject array not found in src/index.ts')
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]))
}

/** Every `this.ctx.<name>` property read in the source, with its line number. */
function contextReads(text: string): Array<{ name: string; line: number }> {
  const reads: Array<{ name: string; line: number }> = []
  text.split('\n').forEach((lineText, index) => {
    for (const match of lineText.matchAll(/this\.ctx\.([A-Za-z_]\w*)/g)) {
      reads.push({ name: match[1], line: index + 1 })
    }
  })
  return reads
}

describe('AgentTeam ctx service reads', () => {
  it('reads only injected services or Cordis built-ins from this.ctx', () => {
    const injected = injectedNames(source)
    const undeclared = contextReads(source)
      .filter(read => !injected.has(read.name) && !CORDIS_BUILTINS.has(read.name))
      .map(read => `src/index.ts:${read.line} this.ctx.${read.name}`)
    expect(undeclared).toEqual([])
  })

  it('scanner catches a bare llm read, the defect this guard exists for', () => {
    expect(contextReads('  const providers = this.ctx.llm?.listProviders()').map(read => read.name)).toEqual(['llm'])
    expect(injectedNames(source).has('llm')).toBe(false)
  })
})
