/**
 * Application-level outbound scheduler (docs/05 §1.3, §2.5; Codex F5).
 * The SDK has no global token bucket and `patchCard` has no retry, so every
 * outbound API call funnels through here:
 *
 * - global concurrency cap (rate does not scale with session count)
 * - card-update coalescing per messageId (only the newest card is sent)
 * - terminal updates jump the queue (终态优先)
 * - rate-limit aware backoff: 429 / 400+99991400 / 230020 are recognized as
 *   rate-limit signals regardless of the SDK's misclassification, honoring
 *   `x-ogw-ratelimit-reset` when readable, with jitter
 * - permanent errors (230025 超长 / 230031 超14天 / withdrawn / target gone)
 *   are never retried and surface to the caller for a new-card fallback
 */
import { setTimeout as sleep } from 'node:timers/promises'

export type TaskKind = 'send' | 'patch' | 'terminal-send' | 'terminal-patch'
export type TaskResult = 'sent' | 'permanent' | 'superseded' | 'closed'

export interface OutboundTask {
  kind: TaskKind
  chatId: string
  /** Present on patches: coalesces multiple updates for one card. */
  messageId?: string
  /** Session the delivery belongs to (persistent failure audit). */
  sessionId?: string
  label: string
  run: () => Promise<void>
  /** Invoked when the task fails permanently (caller falls back to a new card). */
  onPermanent?: (error: Error) => void
}

export interface SchedulerOptions {
  /** Global concurrency cap (default 1: strictly serial outbound). */
  concurrency?: number
  /** Minimum interval between dispatches, ms (default 200 → ≤5 QPS per receiver). */
  minIntervalMs?: number
  maxRetries?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Grace period shutdown() waits for active dispatches (default 10s). */
  shutdownGraceMs?: number
  logger?: {
    warn?: (message: string, ...args: unknown[]) => void
    error?: (message: string, ...args: unknown[]) => void
    info?: (message: string, ...args: unknown[]) => void
  }
}

export type ErrorClass = 'rate-limit' | 'permanent' | 'transient'

/** Inspect any thrown value and classify it for the outbound scheduler. */
export function classifyOutboundError(error: unknown): {
  kind: ErrorClass
  code?: number
  status?: number
  resetMs?: number
} {
  const raw = (error as { cause?: unknown })?.cause ?? error
  const record = raw as Record<string, unknown>
  const response = record.response as Record<string, unknown> | undefined
  const status = typeof response?.status === 'number'
    ? response.status as number
    : typeof record.status === 'number' ? record.status as number : undefined
  const data = (response?.data ?? record.data) as Record<string, unknown> | undefined
  const code = typeof data?.code === 'number'
    ? data.code as number
    : typeof record.code === 'number' ? record.code as number : undefined
  const message = String(record.message ?? '').toLowerCase()

  // Rate-limit signals the SDK misclassifies (docs/05 §1.3): 429, 400+99991400, 230020.
  if (status === 429) return { kind: 'rate-limit', status, code, resetMs: readResetHeader(response) }
  if (code === 230020 || code === 230017) return { kind: 'rate-limit', status, code, resetMs: readResetHeader(response) }
  if (status === 400 && code === 99991400) return { kind: 'rate-limit', status, code, resetMs: readResetHeader(response) }

  // Permanent business failures — never retry; caller falls back to a new card.
  if (code === 230025) return { kind: 'permanent', status, code }   // 超长
  if (code === 230031) return { kind: 'permanent', status, code }   // 超 14 天
  if (code === 230010) return { kind: 'permanent', status, code }   // 消息不存在/已撤回
  if (status === 404) return { kind: 'permanent', status, code }    // 目标失效
  if (code === 99991400 || code === 99991401) return { kind: 'permanent', status, code } // 权限错误不重试

  // Network blips are transient → retry with backoff.
  if (message.includes('timeout') || record.code === 'ETIMEDOUT'
    || record.code === 'ECONNRESET' || record.code === 'ECONNABORTED'
    || record.code === 'EPIPE' || record.code === 'ENOTFOUND') {
    return { kind: 'transient', status, code }
  }
  return { kind: 'transient', status, code }
}

function readResetHeader(response: Record<string, unknown> | undefined): number | undefined {
  const headers = response?.headers as Record<string, unknown> | undefined
  const raw = headers?.['x-ogw-ratelimit-reset']
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  // Feishu documents a UNIX timestamp (seconds); tolerate milliseconds too.
  const epoch = value > 10_000_000_000 ? value : value * 1000
  return Math.max(0, epoch - Date.now())
}

interface PendingTask {
  task: OutboundTask
  resolve: (result: TaskResult) => void
  attempts: number
  notBefore: number
  /** Monotonic per-messageId patch generation: a retry only runs while still newest. */
  generation: number
}

export class OutboundScheduler {
  private readonly terminalQueue: PendingTask[] = []
  private readonly normalQueue: PendingTask[] = []
  private readonly coalesced = new Map<string, PendingTask>()
  /** Newest patch generation per messageId — stale retries must not overwrite newer cards. */
  private readonly generations = new Map<string, number>()
  /** messageIds with a patch currently executing — patches per messageId never run concurrently. */
  private readonly inflightPatches = new Set<string>()
  /** Single-flight drain loop promise. */
  private drainPromise?: Promise<void>
  private active = 0
  private lastDispatch = 0
  private pausedUntil = 0
  private running = false
  private closed = false
  private readonly options: Required<Omit<SchedulerOptions, 'logger'>>

  constructor(options: SchedulerOptions = {}) {
    const {
      concurrency = 1,
      minIntervalMs = 200,
      maxRetries = 4,
      backoffBaseMs = 500,
      backoffMaxMs = 30_000,
      shutdownGraceMs = 10_000,
    } = options
    this.options = { concurrency, minIntervalMs, maxRetries, backoffBaseMs, backoffMaxMs, shutdownGraceMs }
    this.logger = options.logger ?? {}
  }

  private readonly logger: NonNullable<SchedulerOptions['logger']>

  /** Queued + in-flight work. Coalesced patches live in the queues; the map is only an index. */
  get pendingCount(): number {
    return this.normalQueue.length + this.terminalQueue.length + this.active
  }

  /** Enqueue one outbound operation. Resolves when it lands, fails permanently, is superseded, or the scheduler closes. */
  enqueue(task: OutboundTask): Promise<TaskResult> {
    if (this.closed) return Promise.resolve('closed')
    return new Promise<TaskResult>((resolve) => {
      let generation = 0
      if (task.messageId !== undefined && task.kind.endsWith('patch')) {
        generation = (this.generations.get(task.messageId) ?? 0) + 1
        this.generations.set(task.messageId, generation)
      }
      const pending: PendingTask = { task, resolve, attempts: 0, notBefore: 0, generation }
      if (task.messageId !== undefined && task.kind.endsWith('patch')) {
        const existing = this.coalesced.get(task.messageId)
        if (existing !== undefined) {
          // Coalesce: the newer card wins; the older caller is told it was superseded.
          existing.resolve('superseded')
          this.removeFromQueues(existing)
          existing.task = task
          existing.resolve = resolve
          existing.attempts = 0
          existing.notBefore = 0
          existing.generation = generation
          this.coalesced.set(task.messageId, existing)
          this.insert(existing)
          this.pump()
          return
        }
        this.coalesced.set(task.messageId, pending)
      }
      this.insert(pending)
      this.pump()
    })
  }

  private insert(pending: PendingTask): void {
    const queue = pending.task.kind.startsWith('terminal') ? this.terminalQueue : this.normalQueue
    // Insertion-sort by notBefore so delayed (backoff) tasks wake in order.
    const index = queue.findIndex(item => item.notBefore > pending.notBefore)
    if (index < 0) queue.push(pending)
    else queue.splice(index, 0, pending)
  }

  private removeFromQueues(pending: PendingTask): void {
    let index = this.terminalQueue.indexOf(pending)
    if (index >= 0) this.terminalQueue.splice(index, 1)
    index = this.normalQueue.indexOf(pending)
    if (index >= 0) this.normalQueue.splice(index, 1)
  }

  private pump(): void {
    if (this.running || this.closed) return
    this.running = true
    void this.drain().catch((error) => {
      this.logger.error?.('dsh-feishu-remote: outbound scheduler crashed: %s', String(error))
    }).finally(() => {
      this.running = false
      // A task may have been enqueued while the loop was finishing.
      if (!this.closed && this.pendingCount > 0) this.pump()
    })
  }

  private async throttle(now: number): Promise<void> {
    const interval = this.options.minIntervalMs
    const nextAllowed = this.lastDispatch + interval
    const wait = Math.max(nextAllowed - now, this.pausedUntil - now, 0)
    if (wait > 0) await sleep(wait)
    this.lastDispatch = Date.now()
  }

  private classifyDelay(error: unknown, attempts: number): { retry: boolean; delayMs: number } {
    const classification = classifyOutboundError(error)
    if (classification.kind === 'permanent') return { retry: false, delayMs: 0 }
    if (classification.kind === 'rate-limit') {
      // 429/限流码：等待 reset 或指数退避，加抖动（docs/05 §1.3 验收）。
      const resetMs = classification.resetMs
      if (resetMs !== undefined && Number.isFinite(resetMs)) {
        return { retry: true, delayMs: Math.min(resetMs + jitter(300), this.options.backoffMaxMs) }
      }
    }
    const exponential = this.options.backoffBaseMs * 2 ** attempts
    return { retry: true, delayMs: Math.min(exponential + jitter(this.options.backoffBaseMs), this.options.backoffMaxMs) }
  }

  private async dispatch(pending: PendingTask): Promise<void> {
    // Remove from the coalescing index BEFORE the task runs: an in-flight
    // patch must never be mutated by a successor enqueue (the successor
    // becomes its own task and wins by dispatch order).
    this.release(pending)
    const { task } = pending
    const messageId = task.messageId
    const isPatch = messageId !== undefined && task.kind.endsWith('patch')
    if (isPatch) this.inflightPatches.add(messageId)
    try {
      // Generation check per attempt: a stale retry must never overwrite a
      // newer card that already landed (Codex review #2 finding 1).
      if (isPatch && (this.generations.get(messageId) ?? 0) !== pending.generation) {
        pending.resolve('superseded')
        return
      }
      await task.run()
      pending.resolve('sent')
    } catch (error) {
      if (this.closed) {
        pending.resolve('closed')
        return
      }
      const { retry, delayMs } = this.classifyDelay(error, pending.attempts)
      if (!retry || pending.attempts >= this.options.maxRetries) {
        const wrapped = error instanceof Error ? error : new Error(String(error))
        this.logger.warn?.(
          'dsh-feishu-remote: outbound task permanently failed after %d attempts: %s',
          pending.attempts + 1,
          wrapped.message,
        )
        pending.resolve('permanent')
        task.onPermanent?.(wrapped)
        return
      }
      pending.attempts += 1
      pending.notBefore = Date.now() + delayMs
      if (delayMs > 0) this.pausedUntil = pending.notBefore
      this.logger.warn?.('dsh-feishu-remote: outbound task "%s" backing off %dms (attempt %d)',
        task.label, delayMs, pending.attempts + 1)
      this.insert(pending)
    } finally {
      if (isPatch) this.inflightPatches.delete(messageId)
      this.pruneGenerations()
      this.notifyChange()
    }
  }

  /** Drop generation bookkeeping once no queued/in-flight patch references it (review #3 finding 4). */
  private pruneGenerations(): void {
    for (const messageId of [...this.generations.keys()]) {
      const referenced = this.inflightPatches.has(messageId)
        || this.coalesced.has(messageId)
        || this.terminalQueue.some(item => item.task.messageId === messageId)
        || this.normalQueue.some(item => item.task.messageId === messageId)
      if (!referenced) this.generations.delete(messageId)
    }
  }

  private readonly wakeWaiters = new Set<() => void>()

  private notifyChange(): void {
    for (const waiter of this.wakeWaiters) waiter()
    this.wakeWaiters.clear()
  }

  /** Resolve when an in-flight task completes (or a 50ms fallback elapses). */
  private awaitChange(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeWaiters.delete(done)
        resolve()
      }, 50)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      this.wakeWaiters.add(done)
    })
  }

  private release(pending: PendingTask): void {
    if (pending.task.messageId !== undefined && pending.task.kind.endsWith('patch')) {
      if (this.coalesced.get(pending.task.messageId) === pending) {
        this.coalesced.delete(pending.task.messageId)
      }
    }
  }

  /**
   * Run queued work until the queues drain. SINGLE-FLIGHT: concurrent callers
   * (pump and public users) share one loop, so the concurrency cap cannot be
   * violated by parallel drain loops (review #4 finding 3).
   */
  async drain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise
    const run = this.drainLoop().finally(() => {
      this.drainPromise = undefined
    })
    this.drainPromise = run
    return run
  }

  private async drainLoop(): Promise<void> {
    while (!this.closed) {
      if (this.active >= this.options.concurrency) {
        await sleep(10)
        continue
      }
      if (!this.hasReadyWork()) {
        if (this.active === 0) {
          const nextWake = Math.min(
            ...[
              ...this.normalQueue.map(item => item.notBefore),
              ...this.terminalQueue.map(item => item.notBefore),
            ].filter(value => value > Date.now()),
          )
          if (!Number.isFinite(nextWake)) return
          await sleep(Math.max(1, Math.min(nextWake - Date.now(), 250)))
          continue
        }
        await sleep(10)
        continue
      }
      // Wait out the interval slot, THEN select — priority is evaluated at
      // dispatch time, so a terminal task landing during the wait wins.
      await this.throttle(Date.now())
      // Recheck after the await: a concurrent drain could have filled the
      // capacity or the scheduler could have closed meanwhile.
      if (this.closed || this.active >= this.options.concurrency) continue
      // Patches for one messageId never run concurrently: a slow older patch
      // must not land after a faster newer one (generation ordering).
      const pending = this.nextDispatchable()
      if (pending === undefined) {
        // Ready work exists but is all blocked by in-flight patches: wait on
        // a completion signal instead of busy-spinning the loop (F4 liveness).
        await this.awaitChange()
        continue
      }
      this.active += 1
      void this.dispatch(pending).finally(() => {
        this.active -= 1
      })
    }
    // Closed: settle everything.
    for (const pending of [...this.terminalQueue, ...this.normalQueue]) {
      pending.resolve('closed')
    }
    this.terminalQueue.length = 0
    this.normalQueue.length = 0
    this.coalesced.clear()
    this.generations.clear()
  }

  /** Like nextPending(), but skips patches whose messageId is already executing. */
  private nextDispatchable(): PendingTask | undefined {
    const now = Date.now()
    // Terminal queue first, in full: a blocked head must not demote later
    // terminal work below ordinary sends (review #3 finding 4).
    for (let index = 0; index < this.terminalQueue.length; index += 1) {
      const item = this.terminalQueue[index]!
      if (item.notBefore > now) continue
      if (item.task.kind.endsWith('patch') && this.inflightPatches.has(item.task.messageId!)) continue
      this.terminalQueue.splice(index, 1)
      return item
    }
    for (let index = 0; index < this.normalQueue.length; index += 1) {
      const item = this.normalQueue[index]!
      if (item.notBefore > now) continue
      if (item.task.kind.endsWith('patch') && this.inflightPatches.has(item.task.messageId!)) continue
      this.normalQueue.splice(index, 1)
      return item
    }
    return undefined
  }

  private hasReadyWork(): boolean {
    const now = Date.now()
    return this.terminalQueue.some(item => item.notBefore <= now)
      || this.normalQueue.some(item => item.notBefore <= now)
  }

  /** Stop accepting new work synchronously; queued tasks settle as 'closed'. */
  close(): void {
    this.closed = true
  }

  private shutdownPromise?: Promise<void>

  /**
   * Asynchronous shutdown: close the gate, settle every queued task as
   * 'closed', wake blocked waiters, and await every ACTIVE dispatch — nothing
   * outbound may still run after this resolves (review #4 finding 2).
   * MEMOIZED: repeated calls share ONE shutdown operation and ONE grace
   * deadline (review #6 finding 2).
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise
    const run = this.shutdownLoop().finally(() => {
      this.shutdownPromise = undefined
    })
    this.shutdownPromise = run
    return run
  }

  private async shutdownLoop(): Promise<void> {
    this.closed = true
    this.notifyChange()
    for (const pending of [...this.terminalQueue, ...this.normalQueue]) {
      pending.resolve('closed')
    }
    this.terminalQueue.length = 0
    this.normalQueue.length = 0
    this.coalesced.clear()
    this.generations.clear()
    // Await active dispatches with a grace cap: a hung operation must not
    // hang plugin teardown forever (bridge stop awaits this).
    const deadline = Date.now() + this.options.shutdownGraceMs
    while (this.active > 0 && Date.now() < deadline) {
      await sleep(5)
    }
    if (this.active > 0) {
      this.logger.warn?.('dsh-feishu-remote: %d outbound dispatch(es) still in flight after the shutdown grace period', this.active)
    }
  }
}

function jitter(scale: number): number {
  return Math.floor(Math.random() * scale)
}
