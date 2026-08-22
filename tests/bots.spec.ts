import { describe, expect, it, vi } from 'vitest'
import { FeishuBotManager } from '../src/bots.js'
import type { Config } from '../src/config.js'

class FakeBridge {
  started = 0
  stopped = 0
  live = 0
  provisional = 0
  async start() { this.started += 1 }
  async stop() { this.stopped += 1 }
  health() { return { appId: this.appId, connected: true, terminalFailure: false, botName: `${this.appId} name` } }
  liveAgentCount() { return this.live }
  provisionalAgentCount() { return this.provisional }
  profileStatus() { return undefined }
  runtimeError() { return undefined }
  constructor(readonly appId: string) {}
}

function harness(secrets: Record<string, string> = { REF_A: 'a', REF_B: 'b' }) {
  const bridges: FakeBridge[] = []
  const ctx = {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    credentials: { resolve: vi.fn(async (ref: { name?: string } | string) => {
      const key = typeof ref === 'string' ? ref : String(ref)
      const value = secrets[key] ?? secrets[(ref as { name?: string }).name ?? '']
      return value === undefined ? undefined : { value }
    }) },
    get: () => undefined,
  }
  const manager = new FeishuBotManager(ctx as never, {
    bridgeFactory: ((_bridgeCtx: unknown, config: { appId: string }) => {
      const bridge = new FakeBridge(config.appId)
      bridges.push(bridge)
      return bridge
    }) as never,
  })
  return { ctx, manager, bridges }
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    maxTotalLiveAgents: 0,
    bots: [
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' },
      { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', contextBackend: 'sdk' },
    ],
    ...overrides,
  }
}

describe('FeishuBotManager', () => {
  it('starts independent bridges and isolates one invalid bot', async () => {
    const h = harness({ REF_A: 'a' })
    await h.manager.reconcile(config())
    expect(h.bridges.map(item => item.appId)).toEqual(['cli_a'])
    expect(h.manager.status().find(item => item.id === 'bot-a')).toMatchObject({ status: 'connected', connected: true, botName: 'cli_a name' })
    expect(h.manager.status().find(item => item.id === 'bot-b')).toMatchObject({ status: 'disabled', connected: false })
    await h.manager.stop()
  })

  it('keyed reconcile restarts only the changed bot', async () => {
    const h = harness()
    await h.manager.reconcile(config())
    const [firstA, firstB] = h.bridges
    const next = config()
    next.bots![0]!.model = 'new-model'
    await h.manager.reconcile(next)
    expect(firstA!.stopped).toBe(1)
    expect(firstB!.stopped).toBe(0)
    expect(h.bridges).toHaveLength(3)
    await h.manager.stop()
  })

  it('serializes overlapping reconciles for the same changed bot', async () => {
    const h = harness()
    await h.manager.reconcile(config())
    const firstA = h.bridges[0]!
    let releaseStop!: () => void
    const stopGate = new Promise<void>(resolve => { releaseStop = resolve })
    firstA.stop = vi.fn(async () => { firstA.stopped += 1; await stopGate })
    const changed = config()
    changed.bots![0]!.model = 'new-model'
    const first = h.manager.reconcile(changed)
    await vi.waitFor(() => expect(firstA.stopped).toBe(1))
    const second = h.manager.reconcile(structuredClone(changed))
    releaseStop()
    await Promise.all([first, second])
    expect(h.bridges).toHaveLength(3)
    await h.manager.stop()
  })

  it('enforces the global live plus provisional capacity and replacing semantics', async () => {
    const h = harness()
    await h.manager.reconcile(config({ maxTotalLiveAgents: 2 }))
    h.bridges[0]!.live = 1
    h.bridges[1]!.live = 1
    expect(() => h.manager.reserveGlobalAgent('bot-a', { replacing: false })).toThrow('上限 2')
    const replacing = h.manager.reserveGlobalAgent('bot-a', { replacing: true })
    expect(() => h.manager.reserveGlobalAgent('bot-b', { replacing: false })).toThrow('上限 2')
    replacing.release()
    await h.manager.stop()
  })

  it('counts an outgoing bridge while replacement stop is still pending', async () => {
    const h = harness()
    await h.manager.reconcile(config({ maxTotalLiveAgents: 1 }))
    const firstA = h.bridges[0]!
    firstA.live = 1
    let releaseStop!: () => void
    const stopGate = new Promise<void>(resolve => { releaseStop = resolve })
    firstA.stop = vi.fn(async () => { firstA.stopped += 1; await stopGate })
    const changed = config({ maxTotalLiveAgents: 1 })
    changed.bots![0]!.model = 'new-model'
    const replacing = h.manager.reconcile(changed)
    await vi.waitFor(() => expect(firstA.stopped).toBe(1))
    expect(() => h.manager.reserveGlobalAgent('bot-b', { replacing: false })).toThrow('上限 1')
    releaseStop()
    await replacing
    await h.manager.stop()
  })

  it('fails closed for duplicate app identities', async () => {
    const h = harness()
    const duplicate = config()
    duplicate.bots![1]!.appId = 'cli_a'
    await h.manager.reconcile(duplicate)
    expect(h.bridges).toHaveLength(0)
    expect(h.manager.status().every(item => item.status === 'disabled')).toBe(true)
    await h.manager.stop()
  })
})
