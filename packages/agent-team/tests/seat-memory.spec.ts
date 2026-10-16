/**
 * Task-16 seat-memory rule: every Session of a seat may write memory.md, guarded by a
 * per-seat revision lock instead of a "only slot 0 writes" refusal.
 *
 * - an append (or any first write by a Session that never read the file) is allowed;
 * - a write whose revision is still the one this Session last read is allowed;
 * - a write to a file another Session moved is refused with `stale-memory`, the
 *   refusal returns the current content, and the retry after re-reading succeeds;
 * - read-only tools and calls that never name the seat directory are never refused;
 * - the lock serializes two Sessions' probes on the same seat.
 */
import { describe, expect, it } from 'vitest'
import { SeatMemoryGuard, MEMORY_READ_ONLY_TOOLS, memoryRevision, seatMemoryStaleReason } from '../src/seat-memory.ts'

const dir = '/tmp-forbidden/dsh/members/m1'

/**
 * A mutable in-memory memory.md behind the injected read. `content` is a live
 * accessor on the same state `read` closes over, so writing the file the way a
 * Session's tool call does is visible to the next probe.
 */
function file(initial: string): { content: string; reads: number; read(path: string): Promise<string> } {
  const state = { path: `${dir}/memory.md`, content: initial, reads: 0 }
  return {
    get content(): string { return state.content },
    set content(next: string) { state.content = next },
    get reads(): number { return state.reads },
    read: async (path: string) => {
      state.reads += 1
      if (path !== state.path) throw new Error('ENOENT')
      return state.content
    },
  }
}

const write = { name: 'write', args: { path: `${dir}/memory.md`, content: 'x' } }

describe('seat memory revision lock (task-16)', () => {
  it('allows a first write by a Session that never read the file', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('# index\n')
    await expect(guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: store.read })).resolves.toBeUndefined()
  })

  it('allows a write whose revision is the one this Session last read', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('# index\n')
    const revision = memoryRevision(store.content)
    guard.noteRead('s1', revision)
    await expect(guard.probe({ toolName: 'write', args: write.args, memoryDirectory: `${dir}/`, sessionId: 's1', read: store.read })).resolves.toBeUndefined()
  })

  it('refuses a stale edit with the current content, and lets the retry through after a re-read', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('- old line\n')
    guard.noteRead('s1', memoryRevision(store.content))
    // Another session of the same seat writes the file.
    store.content = '- other session line\n'
    const refusal = await guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: store.read })
    expect(refusal).toEqual({ kind: 'stale-memory', revision: memoryRevision(store.content), content: store.content })
    const reason = seatMemoryStaleReason(refusal!)
    expect(reason).toContain('stale-memory')
    // The model re-reads (the new revision is what it now holds) and retries.
    guard.noteRead('s1', memoryRevision(store.content))
    await expect(guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: store.read })).resolves.toBeUndefined()
  })

  it('neither concurrent edit is lost: the second probe sees the first write under the seat lock', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('- a\n')
    guard.noteRead('s1', memoryRevision(store.content))
    guard.noteRead('s2', memoryRevision(store.content))
    // s1's write is allowed against the content it read; the write lands between the
    // two probes, exactly as a real write tool would move the file.
    const first = await guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: store.read })
    store.content = '- a\n- s1 line\n'
    const second = await guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's2', read: store.read })
    expect(first).toBeUndefined()
    expect(second).toEqual({ kind: 'stale-memory', revision: memoryRevision(store.content), content: store.content })
  })

  it('never refuses a read-only tool or a call outside the seat directory', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('- a\n')
    expect([...MEMORY_READ_ONLY_TOOLS]).toEqual(['read', 'read_image', 'grep', 'glob', 'lsp'])
    await expect(guard.probe({ toolName: 'read', args: { path: `${dir}/memory.md` }, memoryDirectory: dir, sessionId: 's1', read: store.read })).resolves.toBeUndefined()
    await expect(guard.probe({ toolName: 'write', args: { path: '/mnt/workspace/x.md', content: 'x' }, memoryDirectory: dir, sessionId: 's1', read: store.read })).resolves.toBeUndefined()
    await expect(guard.probe({ toolName: 'bash', args: { command: 'echo hi' }, memoryDirectory: '', sessionId: 's1', read: store.read })).resolves.toBeUndefined()
  })

  it('an absent memory.md is nothing to be stale against', async () => {
    const guard = new SeatMemoryGuard()
    guard.noteRead('s1', 'some-old-revision')
    const missing = async (): Promise<string> => { throw new Error('ENOENT') }
    await expect(guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: missing })).resolves.toBeUndefined()
    expect(guard.revisionOf('s1')).toBeUndefined()
  })

  it('forget() drops an ended Session, so a respawned slot starts unread', async () => {
    const guard = new SeatMemoryGuard()
    guard.noteRead('s1', 'r1')
    guard.forget('s1')
    expect(guard.revisionOf('s1')).toBeUndefined()
  })

  it('noteWriteSettled records the revision a write left behind, even mid-queue', async () => {
    const guard = new SeatMemoryGuard()
    const store = file('- a\n')
    guard.noteRead('s1', memoryRevision(store.content))
    guard.noteWriteSettled(dir, 's1', store.read)
    await guard.probe({ toolName: 'write', args: write.args, memoryDirectory: dir, sessionId: 's1', read: store.read })
    expect(guard.revisionOf('s1')).toBe(memoryRevision(store.content))
  })
})
