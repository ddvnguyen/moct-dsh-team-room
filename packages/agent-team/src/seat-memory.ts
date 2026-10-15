/**
 * Seat memory writes under the per-seat lock (task-16 memory rule).
 *
 * Every Session of a seat may write the seat's memory.md: the "only slot 0
 * writes" refusal is gone. What replaces it is optimistic concurrency on the
 * file. Each write carries the memory revision (a content hash) the Session
 * last read; under the per-seat lock a mismatched revision is refused with
 * `stale-memory` and the refusal returns the current content, so the Session
 * re-reads and retries instead of silently dropping another instance's edit.
 * Appending a new note needs no merge on the retry; only an edit to an
 * existing line is revision-checked, and a first write of a Session that has
 * never read the file is allowed (nothing exists yet to be stale against).
 *
 * Pure state plus injected I/O: the caller supplies the read, so the lock is
 * testable without a real filesystem. Fails closed: an unreadable memory.md
 * never blocks a write that would create it, and a stale read is never a
 * silent allow.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Tools that only read: a read never changes the file, so it is never refused. */
export const MEMORY_READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'read_image', 'grep', 'glob', 'lsp'])

/** The revision of one memory file content: a stable, short content hash. */
export function memoryRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32)
}

/** One stale write refusal: the revision the Session compared against, and the content it must re-read. */
export interface SeatMemoryStaleRefusal {
  readonly kind: 'stale-memory'
  readonly revision: string
  readonly content: string
}

/** What one probe decided: allow the call, or refuse it as stale. */
export type SeatMemoryProbeResult = SeatMemoryStaleRefusal | undefined

export interface SeatMemoryProbeInput {
  readonly toolName: string
  readonly args: unknown
  /** The seat memory directory; a trailing separator is ignored. */
  readonly memoryDirectory: string
  /** The Session making the call: its own last-read revision decides staleness. */
  readonly sessionId: string
  /** Injectable read of memory.md; defaults to nothing (an absent file allows the write). */
  readonly read?: (path: string) => Promise<string>
}

/** The model-facing text of a stale refusal, with the current content it must re-read. */
export function seatMemoryStaleReason(refusal: SeatMemoryStaleRefusal): string {
  return `Seat memory changed under you (stale-memory, revision ${refusal.revision}): another instance of this seat wrote memory.md since you last read it. Re-read the current memory.md below and re-apply your edit on top of it, then retry; do not overwrite it.\n<seat-memory-current revision="${refusal.revision}">\n${refusal.content}\n</seat-memory-current>`
}

/**
 * The per-seat memory lock: one write queue per seat directory, plus the
 * revision each Session last read. A module-level singleton is correct here
 * because Session ids are process-unique and every instance of a seat runs in
 * this same process; tests construct their own guard.
 */
export class SeatMemoryGuard {
  /** Seat write queues, keyed by the normalized memory directory. */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** The memory revision each Session last read or wrote, by Session id. */
  private readonly revisions = new Map<string, string>()

  /** Record what one Session observed, from the memory block its step re-entered. */
  noteRead(sessionId: string, revision: string): void {
    this.revisions.set(sessionId, revision)
  }

  /** Record the revision one Session's own write left behind, so its next write compares against it. */
  noteWritten(sessionId: string, revision: string): void {
    this.revisions.set(sessionId, revision)
  }

  /** Forget one ended Session; a respawned slot is a new Session and starts unread. */
  forget(sessionId: string): void {
    this.revisions.delete(sessionId)
  }

  /** The revision one Session last read, for diagnostics and tests. */
  revisionOf(sessionId: string): string | undefined {
    return this.revisions.get(sessionId)
  }

  /** Serialize one seat's memory work behind its queue; a rejected body still releases the queue. */
  private withLock<T>(seat: string, body: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(seat) ?? Promise.resolve()
    const result = previous.then(body, body)
    const release = result.then(() => undefined, () => undefined)
    this.queues.set(seat, release)
    void release.then(() => { if (this.queues.get(seat) === release) this.queues.delete(seat) })
    return result
  }

  /**
   * Decide one tool call that names the seat memory directory. Read-only tools
   * and calls that never name the directory are allowed untouched; everything
   * else runs under the seat lock against the file's current revision.
   */
  probe(input: SeatMemoryProbeInput): Promise<SeatMemoryProbeResult> {
    if (MEMORY_READ_ONLY_TOOLS.has(input.toolName)) return Promise.resolve(undefined)
    const seat = input.memoryDirectory.replace(/[\\/]+$/, '')
    if (seat === '') return Promise.resolve(undefined)
    let text: string
    try {
      text = JSON.stringify(input.args) ?? ''
    } catch {
      return Promise.resolve(undefined)
    }
    if (!text.includes(seat)) return Promise.resolve(undefined)
    const read = input.read
    if (read === undefined) return Promise.resolve(undefined)
    return this.withLock(seat, async () => {
      let content: string
      try {
        content = await read(join(seat, 'memory.md'))
      } catch {
        // Absent or unreadable: this write creates or repairs the file, so there
        // is no committed revision to be stale against.
        this.revisions.delete(input.sessionId)
        return undefined
      }
      const revision = memoryRevision(content)
      const last = this.revisions.get(input.sessionId)
      if (last === undefined || last === revision) {
        this.revisions.set(input.sessionId, revision)
        return undefined
      }
      return Object.freeze({ kind: 'stale-memory' as const, revision, content })
    })
  }

  /**
   * After an allowed write resolved, re-read and record the revision it left
   * behind, so this Session's next write compares against its own result
   * rather than the content it replaced. Called off the tool path; the seat
   * queue keeps it ordered ahead of the next probe.
   */
  noteWriteSettled(seat: string, sessionId: string, read: (path: string) => Promise<string>): void {
    const normalized = seat.replace(/[\\/]+$/, '')
    if (normalized === '') return
    void this.withLock(normalized, async () => {
      try {
        this.noteWritten(sessionId, memoryRevision(await read(join(normalized, 'memory.md'))))
      } catch {
        this.revisions.delete(sessionId)
      }
    })
  }
}

/** The process-wide guard every seat instance shares. */
export const seatMemoryGuard = new SeatMemoryGuard()
