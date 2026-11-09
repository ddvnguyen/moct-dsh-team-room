/**
 * MoctOperationsTable — the Agent Team ledger's `operations` table backed by the
 * MOCT Team Room backend (contract v0.3 §2, `/team/v1/operations`).
 *
 * The ledger replays from `entries()` synchronously in its constructor, and reads
 * `get`/`size` from memory afterwards. So `open()` loads every stored operation
 * before the ledger is built. Writes are fail-closed: `put` resolves only after the
 * backend has stored the record. Until then the in-memory view is not changed, so a
 * failed write leaves no local state behind (no split brain).
 *
 * Retries reuse the same operationId. The backend answers a stored operationId with
 * the same record as a 200 replay, so a retry after a lost response is safe.
 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

export const MOCT_TEAM_URL_DEFAULT = 'http://127.0.0.1:8110'
const PAGE_LIMIT = 1000
const WRITE_ATTEMPTS = 4
const RETRY_BASE_MS = 250
const REQUEST_TIMEOUT_MS = 10_000

/** Backend answered with a non-retryable status (409 conflict, 400 bad record, 404, ...). */
export class MoctTeamError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message)
    this.name = 'MoctTeamError'
  }
}

export interface MoctOperationsOptions {
  /** Backend base URL, e.g. MOCT_TEAM_URL (default http://127.0.0.1:8110). */
  baseUrl?: string
  /** Team Room workspace id that owns this ledger's sequence space. */
  workspaceId: string
  /** Per-request timeout. A timed-out request is a transport error: writes retry with the same operationId. */
  requestTimeoutMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

type StoredRecord = { operationId: string; sequence: number; kind: string } & Record<string, unknown>

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export class MoctOperationsTable<K extends string = string, V = StoredRecord> implements KvTable<K, V> {
  private readonly records = new Map<K, V>()
  private readonly baseUrl: string
  private readonly workspaceId: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly requestTimeoutMs: number

  private constructor(options: MoctOperationsOptions) {
    this.baseUrl = (options.baseUrl ?? MOCT_TEAM_URL_DEFAULT).replace(/\/+$/, '')
    this.workspaceId = options.workspaceId
    this.fetchImpl = options.fetch ?? fetch
    this.sleep = options.sleep ?? defaultSleep
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  }

  /**
   * Loads the whole stored log, in sequence order, before the ledger replays it.
   * Memory: the full log is held in RAM. That is fine at current ledger sizes; once it
   * is not, replay needs to stream pages into the ledger instead.
   */
  static async open<K extends string = string, V = StoredRecord>(options: MoctOperationsOptions): Promise<MoctOperationsTable<K, V>> {
    const table = new MoctOperationsTable<K, V>(options)
    let after = 0
    for (;;) {
      const page = await table.getJson<{ operations: StoredRecord[]; hasMore: boolean; nextAfterSequence: number }>(
        `/team/v1/operations?workspaceId=${encodeURIComponent(table.workspaceId)}&afterSequence=${after}&limit=${PAGE_LIMIT}`,
      )
      for (const record of page.operations) {
        table.records.set(record.operationId as K, record as unknown as V)
      }
      if (!page.hasMore) break
      after = page.nextAfterSequence
    }
    return table
  }

  get(key: K): V | undefined {
    return this.records.get(key)
  }

  /** Order is Map insertion order, which `open()` fills in sequence order. Replay depends on it. */
  entries(): IterableIterator<[K, V]> {
    return new Map(this.records).entries()
  }

  keys(): IterableIterator<K> {
    return new Map(this.records).keys()
  }

  get size(): number {
    return this.records.size
  }

  /** Stores one record durably, then mirrors it. A rejected write changes nothing locally. */
  async put(key: K, value: V): Promise<void> {
    const record = value as unknown as StoredRecord
    if (record.operationId !== key) {
      throw new MoctTeamError(400, 'KEY_MISMATCH', `operation key ${key} does not match record ${record.operationId}`)
    }
    const body = JSON.stringify({ workspaceId: this.workspaceId, record })
    await this.postWithRetry(body)
    this.records.set(key, value)
  }

  /** The ledger is append-only: a stored operation is never removed. */
  async delete(_key: K): Promise<boolean> {
    throw new MoctTeamError(405, 'APPEND_ONLY', 'agent-team operations are append-only')
  }

  /** Append-only as well: a batch delete is refused like a single one. */
  async deleteMany(_keys: readonly K[]): Promise<number> {
    throw new MoctTeamError(405, 'APPEND_ONLY', 'agent-team operations are append-only')
  }

  /** Read-modify-write through `put`, so the same fail-closed rule applies. */
  async update(key: K, fn: (current: V) => V): Promise<V> {
    const current = this.records.get(key)
    if (current === undefined) throw new MoctTeamError(404, 'NOT_FOUND', `no operation ${key}`)
    const next = fn(current)
    await this.put(key, next)
    return next
  }

  private async postWithRetry(body: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(`${this.baseUrl}/team/v1/operations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        })
      } catch (error) {
        if (attempt >= WRITE_ATTEMPTS) throw error
        await this.sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
        continue
      }
      if (response.status === 201 || response.status === 200) return
      const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string }
      // 5xx may be transient (backend restarting); a 4xx is a decision and is not retried.
      if (response.status >= 500 && attempt < WRITE_ATTEMPTS) {
        await this.sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
        continue
      }
      throw new MoctTeamError(response.status, payload.code, payload.error ?? `backend answered ${response.status}`)
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.requestTimeoutMs) })
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      throw new MoctTeamError(response.status, undefined, payload.error ?? `backend answered ${response.status}`)
    }
    return (await response.json()) as T
  }
}
