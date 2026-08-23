import { describe, expect, it } from 'vitest'
import { OutboundScheduler, classifyOutboundError } from '../src/scheduler.js'

function fastScheduler(overrides: Record<string, unknown> = {}) {
  return new OutboundScheduler({
    concurrency: 1,
    minIntervalMs: 1,
    backoffBaseMs: 5,
    backoffMaxMs: 50,
    ...overrides,
  } as never)
}

function feishuError(code: number, status = 400, headers?: Record<string, string>) {
  return {
    cause: {
      response: {
        status,
        data: { code },
        ...(headers === undefined ? {} : { headers }),
      },
      message: 'feishu api error',
    },
  }
}

describe('classifyOutboundError', () => {
  it('recognizes the rate-limit signals the SDK misclassifies', () => {
    expect(classifyOutboundError(feishuError(230020)).kind).toBe('rate-limit')
    expect(classifyOutboundError(feishuError(230017)).kind).toBe('rate-limit')
    expect(classifyOutboundError(feishuError(99991400, 400)).kind).toBe('rate-limit')
    expect(classifyOutboundError(feishuError(0, 429)).kind).toBe('rate-limit')
  })

  it('classifies permanent business failures as non-retryable', () => {
    expect(classifyOutboundError(feishuError(230025)).kind).toBe('permanent') // 超长
    expect(classifyOutboundError(feishuError(230031)).kind).toBe('permanent') // 超 14 天
    expect(classifyOutboundError(feishuError(230001)).kind).toBe('permanent') // 格式错误
    expect(classifyOutboundError(feishuError(230002)).kind).toBe('permanent') // 参数错误
    expect(classifyOutboundError(feishuError(230010)).kind).toBe('permanent') // 消息不存在
    expect(classifyOutboundError(feishuError(230011)).kind).toBe('permanent') // 已撤回（Round 12 F5）
    expect(classifyOutboundError(feishuError(230110)).kind).toBe('permanent') // 已删除（Round 12 F5）
    expect(classifyOutboundError(feishuError(230013)).kind).toBe('permanent') // 机器人对用户不可用（Round 12 F5）
    expect(classifyOutboundError(feishuError(230027)).kind).toBe('permanent') // 无权限（Round 12 F5）
    expect(classifyOutboundError(feishuError(232009)).kind).toBe('permanent') // 群已解散（Round 12 F5）
    expect(classifyOutboundError({ cause: { response: { status: 404, data: {} } } }).kind).toBe('permanent')
  })

  it('reads x-ogw-ratelimit-reset in both second and millisecond epochs', () => {
    const futureSec = Math.floor(Date.now() / 1000) + 30
    const sec = classifyOutboundError(feishuError(0, 429, { 'x-ogw-ratelimit-reset': String(futureSec) }))
    expect(sec.resetMs).toBeGreaterThan(10_000)
    expect(sec.resetMs).toBeLessThanOrEqual(31_000)
    const futureMs = Date.now() + 30_000
    const ms = classifyOutboundError(feishuError(0, 429, { 'x-ogw-ratelimit-reset': String(futureMs) }))
    expect(ms.resetMs).toBeGreaterThan(10_000)
    expect(ms.resetMs).toBeLessThanOrEqual(31_000)
  })
})

describe('OutboundScheduler', () => {
  it('dispatches tasks in order and reports results', async () => {
    const scheduler = fastScheduler()
    const order: string[] = []
    const results = await Promise.all([
      scheduler.enqueue({ kind: 'send', chatId: 'oc_1', label: 'a', run: async () => { order.push('a') } }),
      scheduler.enqueue({ kind: 'send', chatId: 'oc_1', label: 'b', run: async () => { order.push('b') } }),
    ])
    expect(results).toEqual(['sent', 'sent'])
    expect(order).toEqual(['a', 'b'])
    await scheduler.drain()
  })

  it('coalesces patches per messageId, keeping only the newest card', async () => {
    const scheduler = fastScheduler()
    const sent: string[] = []
    const first = scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'patch-1',
      run: async () => { sent.push('card-1') },
    })
    const second = scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'patch-2',
      run: async () => { sent.push('card-2') },
    })
    expect(await first).toBe('superseded')
    expect(await second).toBe('sent')
    expect(sent).toEqual(['card-2'])
    await scheduler.drain()
  })

  it('prioritizes terminal updates over regular sends', async () => {
    const scheduler = fastScheduler()
    const order: string[] = []
    const yieldFirst = async (label: string) => {
      await new Promise(resolve => setTimeout(resolve, 0))
      order.push(label)
    }
    void scheduler.enqueue({ kind: 'send', chatId: 'oc_1', label: 'normal', run: () => yieldFirst('normal') })
    void scheduler.enqueue({ kind: 'terminal-patch', chatId: 'oc_1', messageId: 'om_x', label: 'terminal', run: () => yieldFirst('terminal') })
    void scheduler.enqueue({ kind: 'send', chatId: 'oc_1', label: 'normal2', run: () => yieldFirst('normal2') })
    await scheduler.drain()
    expect(order).toEqual(['terminal', 'normal', 'normal2'])
  })

  it('retries rate-limited tasks with backoff and succeeds', async () => {
    const scheduler = fastScheduler({ minIntervalMs: 0 })
    let calls = 0
    const result = await scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'flaky',
      run: async () => {
        calls += 1
        if (calls < 3) throw feishuError(230020)
      },
    })
    expect(result).toBe('sent')
    expect(calls).toBe(3)
    await scheduler.drain()
  })

  it('stops retrying permanent errors and notifies the caller', async () => {
    const scheduler = fastScheduler()
    let calls = 0
    let permanent: Error | undefined
    const result = await scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'patch',
      run: async () => {
        calls += 1
        throw feishuError(230031)
      },
      onPermanent: error => { permanent = error },
    })
    expect(result).toBe('permanent')
    expect(calls).toBe(1)
    expect(permanent).toBeDefined()
    await scheduler.drain()
  })

  it('gives up after maxRetries on persistent rate limits', async () => {
    const scheduler = fastScheduler({ maxRetries: 2 })
    let calls = 0
    const result = await scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'always-429',
      run: async () => {
        calls += 1
        throw feishuError(0, 429)
      },
    })
    expect(result).toBe('permanent')
    expect(calls).toBe(3) // 1 + 2 retries
    await scheduler.drain()
  })

  it('settles ALL work as closed when close() lands before dispatch', async () => {
    const scheduler = fastScheduler()
    let started = false
    const first = scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'blocked',
      run: async () => {
        started = true
        await new Promise(resolve => setTimeout(resolve, 100))
      },
    })
    const queued = scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'never-runs',
      run: async () => undefined,
    })
    scheduler.close()
    expect(await queued).toBe('closed')
    expect(await first).toBe('closed')
    expect(started).toBe(false) // the dispatch recheck stops work after close
  })

  it('serializes dispatches at the global concurrency cap', async () => {
    const scheduler = fastScheduler({ concurrency: 2, minIntervalMs: 0 })
    let inFlight = 0
    let peak = 0
    const tasks = Array.from({ length: 6 }, (_, index) => scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: `t${index}`,
      run: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        inFlight -= 1
      },
    }))
    expect(await Promise.all(tasks)).toEqual(Array(6).fill('sent'))
    expect(peak).toBeLessThanOrEqual(2)
    await scheduler.drain()
  })
})

describe('OutboundScheduler regression (Codex P1-3)', () => {
  it('does not mutate an in-flight patch when a successor is enqueued', async () => {
    const scheduler = fastScheduler()
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const ran: string[] = []
    const first = scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'patch-1',
      run: async () => { ran.push('card-1'); await firstGate },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    const second = scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'patch-2',
      run: async () => { ran.push('card-2') },
    })
    releaseFirst()
    expect(await first).toBe('sent')
    expect(await second).toBe('sent')
    expect(ran).toEqual(['card-1', 'card-2'])
    await scheduler.drain()
  })

  it('settles a failing in-flight task as closed instead of reinserting after close()', async () => {
    const scheduler = fastScheduler({ minIntervalMs: 0 })
    const result = scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'failing',
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        throw new Error('boom')
      },
    })
    scheduler.close()
    expect(await result).toBe('closed')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(scheduler.pendingCount).toBe(0)
  })
})

describe('OutboundScheduler generation ordering (Codex review #2 F1)', () => {
  it('never lets a stale patch retry overwrite a newer terminal patch', async () => {
    const scheduler = fastScheduler({ minIntervalMs: 0, backoffBaseMs: 500, backoffMaxMs: 1000 })
    const landed: string[] = []
    let failFirst = true
    const old = scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'old',
      run: async () => {
        if (failFirst) {
          failFirst = false
          throw new Error('transient boom') // retryable → backoff reinsert
        }
        landed.push('old')
      },
    })
    await new Promise(resolve => setTimeout(resolve, 15)) // let attempt 1 fail + backoff
    const newer = scheduler.enqueue({
      kind: 'terminal-patch', chatId: 'oc_1', messageId: 'om_x', label: 'terminal',
      run: async () => { landed.push('terminal') },
    })
    expect(await old).toBe('superseded')
    expect(await newer).toBe('sent')
    expect(landed).toEqual(['terminal']) // the stale retry must NOT run
    await scheduler.drain()
  })
})

describe('OutboundScheduler blocked-head priority (Codex review #3 F4)', () => {
  it('dispatches later terminal work before normals even with a blocked head', async () => {
    const scheduler = fastScheduler({ concurrency: 2, minIntervalMs: 0 })
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const order: string[] = []
    void scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'old',
      run: async () => { order.push('old'); await gate },
    })
    await new Promise(resolve => setTimeout(resolve, 10)) // old in flight
    void scheduler.enqueue({
      kind: 'terminal-patch', chatId: 'oc_1', messageId: 'om_x', label: 'blocked-terminal',
      run: async () => { order.push('blocked-terminal') },
    })
    void scheduler.enqueue({
      kind: 'terminal-send', chatId: 'oc_2', label: 'other-terminal',
      run: async () => { order.push('other-terminal') },
    })
    void scheduler.enqueue({
      kind: 'send', chatId: 'oc_3', label: 'normal',
      run: async () => { order.push('normal') },
    })
    // While `old` is still in flight, the blocked head must not demote the
    // later terminal work below normals: wait for it to dispatch first.
    const deadline = Date.now() + 1_000
    while (!order.includes('other-terminal')) {
      if (Date.now() > deadline) throw new Error('other-terminal was never dispatched')
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    release()
    await scheduler.drain()
    expect(order).toEqual(['old', 'other-terminal', 'blocked-terminal', 'normal'])
  })

  it('prunes generation bookkeeping once no patch references a messageId', async () => {
    const scheduler = fastScheduler()
    await scheduler.enqueue({
      kind: 'patch', chatId: 'oc_1', messageId: 'om_x', label: 'p1',
      run: async () => undefined,
    })
    await scheduler.drain()
    expect((scheduler as never as { generations: Map<string, number> }).generations.size).toBe(0)
  })
})

describe('OutboundScheduler async shutdown (Codex review #4 F2)', () => {
  it('awaits active dispatches and settles queued work as closed', async () => {
    const scheduler = fastScheduler()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const order: string[] = []
    void scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'active',
      run: async () => { order.push('start'); await gate; order.push('end') },
    })
    const deadline = Date.now() + 1_000
    while (!order.includes('start')) {
      if (Date.now() > deadline) throw new Error('active task never started')
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    const queued = scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'queued',
      run: async () => { order.push('queued') },
    })
    let shutdownDone = false
    const shutting = scheduler.shutdown().then(() => { shutdownDone = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(shutdownDone).toBe(false) // still awaiting the active dispatch
    expect(await queued).toBe('closed')
    release()
    await shutting
    expect(order).toEqual(['start', 'end'])
  })
})

describe('OutboundScheduler shutdown grace (Codex review #5 F2)', () => {
  it('returns after the grace period even when a dispatch never settles', async () => {
    const scheduler = fastScheduler({ shutdownGraceMs: 60 })
    const never = new Promise<void>(() => undefined) // never resolves
    let started = false
    void scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'hung',
      run: async () => { started = true; await never },
    })
    const deadline = Date.now() + 1_000
    while (!started) {
      if (Date.now() > deadline) throw new Error('dispatch never started')
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    const begin = Date.now()
    await scheduler.shutdown()
    const elapsed = Date.now() - begin
    expect(elapsed).toBeGreaterThanOrEqual(40)  // waited the grace period
    expect(elapsed).toBeLessThan(2_000)         // but did not hang forever
  })
})

/**
 * M6: the channel-wide pause is a RATE-LIMIT signal, not a per-task backoff,
 * and it may only ever move forward. Before the fix a single transient socket
 * error stalled every other outbound task, and a short 429 window arriving
 * after a long one shortened the pause already in effect.
 */
describe('OutboundScheduler rate-limit pause (M6)', () => {
  /** The channel-wide pause is private state; this invariant is exactly what M6 is about. */
  const pausedUntil = (scheduler: OutboundScheduler): number =>
    (scheduler as unknown as { pausedUntil: number }).pausedUntil

  it('does not pause the whole channel for a non-rate-limit transient failure', async () => {
    const scheduler = new OutboundScheduler({
      concurrency: 1, minIntervalMs: 0, backoffBaseMs: 40, backoffMaxMs: 200, maxRetries: 3,
    })
    let flakyCalls = 0
    const flaky = scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'flaky-socket',
      run: async () => {
        flakyCalls += 1
        if (flakyCalls === 1) throw new Error('socket hang up') // transient, not 429
      },
    })
    // A healthy task queued behind the failure must not inherit its backoff.
    const startedAt = Date.now()
    let healthyAt = 0
    const healthy = scheduler.enqueue({
      kind: 'send', chatId: 'oc_2', label: 'healthy',
      run: async () => { healthyAt = Date.now() },
    })

    expect(await healthy).toBe('sent')
    expect(healthyAt - startedAt).toBeLessThan(40) // never waited out the flaky task's backoff
    expect(pausedUntil(scheduler)).toBe(0) // no channel-wide pause was armed
    expect(await flaky).toBe('sent')
    expect(flakyCalls).toBe(2)
    scheduler.close()
    await scheduler.shutdown()
  })

  it('arms the channel-wide pause for a rate limit', async () => {
    const scheduler = new OutboundScheduler({
      concurrency: 1, minIntervalMs: 0, backoffBaseMs: 20, backoffMaxMs: 60, maxRetries: 3,
    })
    let calls = 0
    const result = await scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'rate-limited',
      run: async () => {
        calls += 1
        if (calls === 1) throw feishuError(0, 429)
      },
    })
    expect(result).toBe('sent')
    expect(pausedUntil(scheduler)).toBeGreaterThan(0)
    scheduler.close()
    await scheduler.shutdown()
  })

  it('never shortens a rate-limit pause that is already in effect', async () => {
    const scheduler = new OutboundScheduler({
      concurrency: 1, minIntervalMs: 0, backoffBaseMs: 5, backoffMaxMs: 50, maxRetries: 3,
    })
    let calls = 0
    let seeded = 0
    let observed = -1
    let secondAttemptAt = 0
    const result = await scheduler.enqueue({
      kind: 'send', chatId: 'oc_1', label: 'short-429-after-long-429',
      run: async () => {
        calls += 1
        if (calls === 1) {
          // Stand in for a long 429 window an earlier task already armed.
          seeded = Date.now() + 300
          ;(scheduler as unknown as { pausedUntil: number }).pausedUntil = seeded
          // A SHORT backoff (no reset header) must not roll the pause back.
          throw feishuError(0, 429)
        }
        secondAttemptAt = Date.now()
        observed = pausedUntil(scheduler)
      },
    })
    expect(result).toBe('sent')
    expect(calls).toBe(2)
    expect(observed).toBe(seeded) // Math.max kept the longer window
    expect(secondAttemptAt).toBeGreaterThanOrEqual(seeded) // and it was honored
    scheduler.close()
    await scheduler.shutdown()
  })
})

/**
 * Blocker 4 (review batch 2): `dispatch()` runs the caller's `onPermanent`
 * hook on its own stack and the drain loop fires it detached. An exception
 * from either used to surface as a process-wide unhandledRejection, which
 * Node 22's `--unhandled-rejections=throw` default turns into a dead `dsh web`.
 */
describe('OutboundScheduler unhandled-rejection containment (blocker 4)', () => {
  async function waitFor(condition: () => boolean, label = 'condition', timeoutMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  /** Collect unhandled rejections for the duration of `body`. */
  async function withUnhandledRejectionCapture<T>(body: (seen: unknown[]) => Promise<T>): Promise<T> {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => { seen.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const result = await body(seen)
      // Unhandled rejections are reported on a later macrotask — let them land.
      for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve))
      return result
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  }

  it('contains an onPermanent hook that throws', async () => {
    await withUnhandledRejectionCapture(async seen => {
      const errors: unknown[][] = []
      const scheduler = new OutboundScheduler({
        concurrency: 1, minIntervalMs: 0, maxRetries: 0,
        logger: { error: (...args: unknown[]) => { errors.push(args) } },
      } as never)
      const result = await scheduler.enqueue({
        kind: 'send', chatId: 'oc_1', label: 'permanent-with-throwing-hook',
        run: async () => { throw feishuError(230025) }, // 超长：permanent, no retry
        onPermanent: () => { throw new Error('新卡片兜底炸了') },
      })
      expect(result).toBe('permanent')
      for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve))
      expect(seen).toEqual([])
      expect(errors.some(args => String(args[0]).includes('onPermanent hook threw'))).toBe(true)

      // The scheduler is still alive and draining.
      expect(await scheduler.enqueue({
        kind: 'send', chatId: 'oc_1', label: 'after-the-throwing-hook', run: async () => undefined,
      })).toBe('sent')
      scheduler.close()
      await scheduler.shutdown()
    })
  })

  it('contains an unexpected throw from the detached dispatch chain and keeps draining', async () => {
    await withUnhandledRejectionCapture(async seen => {
      const errors: unknown[][] = []
      const scheduler = new OutboundScheduler({
        concurrency: 1, minIntervalMs: 0,
        logger: { error: (...args: unknown[]) => { errors.push(args) } },
      } as never)
      // Break dispatch BEFORE its own try/catch can see it (bookkeeping throw).
      const internals = scheduler as unknown as { release: (pending: unknown) => void }
      const originalRelease = internals.release.bind(scheduler)
      let broken = 0
      internals.release = (pending: unknown) => {
        if (broken === 0) { broken += 1; throw new Error('coalescing index exploded') }
        originalRelease(pending)
      }
      // Never settles (its dispatch died) — deliberately not awaited.
      void scheduler.enqueue({ kind: 'send', chatId: 'oc_1', label: 'dispatch-blows-up', run: async () => undefined })
      await waitFor(() => errors.some(args => String(args[0]).includes('dispatch threw unexpectedly')))

      // Concurrency was released, so the next task still runs.
      expect(await scheduler.enqueue({
        kind: 'send', chatId: 'oc_1', label: 'after-the-broken-dispatch', run: async () => undefined,
      })).toBe('sent')
      expect(seen).toEqual([])
      scheduler.close()
      await scheduler.shutdown()
    })
  })
})
