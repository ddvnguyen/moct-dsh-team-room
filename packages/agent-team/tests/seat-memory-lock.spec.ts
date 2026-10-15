/**
 * Task-16 seat-memory lock, end to end through `installSeatMemoryLock`: a fake agent context fires
 * `tools/pre-execute` and `tools/post-execute` the way a Session's tool calls do. No test here calls
 * `noteRead` or `noteWritten`; revisions come from the install-time seed and the lock's own refusals.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AgentTeam from '../src/index.ts'
import { seatMemoryGuard } from '../src/seat-memory.ts'

type Handler = (...args: never[]) => Promise<unknown>
const root = join(process.cwd(), 'packages/agent-team/tests')
let dir = ''

beforeEach(() => { dir = mkdtempSync(join(root, '.seat-lock-')); writeFileSync(join(dir, 'memory.md'), '- base\n') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** One Session of the seat: install the real lock and expose its tool path. */
function session(id: string) {
  const handlers = new Map<string, Handler>()
  const agentCtx = { on: (event: string, handler: Handler) => { handlers.set(event, handler) } }
  const host = Object.create(AgentTeam.prototype) as { installSeatMemoryLock(ctx: unknown, agent: unknown, directory: string): void }
  host.installSeatMemoryLock(agentCtx, { id }, dir)
  const call = async (args: { content: string }) => {
    const exec = { name: 'write', arguments: args }
    const decision = await (handlers.get('tools/pre-execute') as (e: unknown, n: () => unknown) => Promise<unknown>)(exec, () => 'next') as { kind?: string; reason?: string } | string
    if (decision === 'next') {
      writeFileSync(join(dir, 'memory.md'), args.content)
      // The write has happened; then the post-execute hook settles the Session's own revision.
      await (handlers.get('tools/post-execute') as (e: unknown, r: unknown, n: () => unknown) => Promise<unknown>)(exec, { isError: false }, () => undefined)
    }
    return decision
  }
  const write = async (content: string) => {
    return call({ path: join(dir, 'memory.md'), content } as { content: string })
  }
  return { write }
}
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve)) }

describe('seat memory lock through installSeatMemoryLock', () => {
  it('refuses a stale write with the current content, then lets the retry through', async () => {
    const a = session('s-a')
    const b = session('s-b')
    expect(await a.write('- base\n- from A\n')).toBe('next')
    await settle()
    const refused = await b.write('- base\n- from B\n') as { kind: string; reason: string }
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('stale-memory')
    expect(refused.reason).toContain('- from A')
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('- base\n- from A\n')
    // B re-applies on top of A's content and the retry is allowed: no livelock.
    expect(await b.write('- base\n- from A\n- from B\n')).toBe('next')
    await settle()
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('- base\n- from A\n- from B\n')
    // And B's own next write compares against its own result.
    expect(await b.write('- base\n- from A\n- from B\n- again\n')).toBe('next')
  })

  it('checks a late-starting Session against the memory it started with', async () => {
    const a = session('s-a2')
    const c = session('s-c2')
    expect(await a.write('- base\n- from A\n')).toBe('next')
    await settle()
    // C started before A wrote; its first write is a full overwrite and must not clobber A.
    const refused = await c.write('- C only\n') as { kind: string }
    expect(refused.kind).toBe('deny')
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('- base\n- from A\n')
  })

  it('allows a write to an absent file', async () => {
    rmSync(join(dir, 'memory.md'))
    const a = session('s-a3')
    expect(await a.write('- new\n')).toBe('next')
  })
})
afterEach(() => { for (const id of ['s-a', 's-b', 's-a2', 's-c2', 's-a3']) seatMemoryGuard.forget(id) })
