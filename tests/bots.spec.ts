import { describe, expect, it, vi } from 'vitest'
import { toClientBotStatus } from '../src/admin.js'
import { FeishuBotManager, classifyBotFailure, safeStatusText } from '../src/bots.js'
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
    expect(h.manager.status()[0]).toMatchObject({ reasonCode: 'duplicate_app_id' })
    await h.manager.stop()
  })

  /**
   * Codex batch-3 B1. A duplicate statePath/inboundDir used to be reported as
   * a raw error string containing the RESOLVED ABSOLUTE PATH, which
   * `bots/status` forwarded verbatim to the browser.
   */
  it.each([
    ['statePath', 'duplicate_state_path', '/tmp/dsh-feishu-dup/shared-state.json'],
    ['inboundDir', 'duplicate_inbound_dir', '/tmp/dsh-feishu-dup/shared-inbox'],
  ])('never leaks a duplicate %s to the browser DTO', async (key, reasonCode, path) => {
    const h = harness()
    const duplicate = config()
    Object.assign(duplicate.bots![0]!, { [key]: path })
    Object.assign(duplicate.bots![1]!, { [key]: path })
    await h.manager.reconcile(duplicate)
    expect(h.bridges).toHaveLength(0)
    // The raw text stays host-side: it is logged and kept on the runtime status…
    expect(h.ctx.logger.warn).toHaveBeenCalled()
    expect(h.manager.status()[0]?.error).toContain(key)
    // …but the wire DTO carries only a stable code and a fixed sentence.
    const wire = JSON.stringify({ bots: h.manager.status().map(toClientBotStatus) })
    for (const forbidden of ['statePath', 'inboundDir', 'feishuCliPath', 'error', path, '/tmp']) {
      expect(wire, forbidden).not.toContain(forbidden)
    }
    expect(JSON.parse(wire).bots[0]).toMatchObject({ status: 'disabled', reasonCode })
    await h.manager.stop()
  })

  it('reports an operator-disabled bot as such, with no error text at all', async () => {
    const h = harness()
    const disabled = config()
    disabled.bots![1]!.enabled = false
    await h.manager.reconcile(disabled)
    const status = h.manager.status().find(item => item.id === 'bot-b')
    expect(status).toMatchObject({ enabled: false, status: 'disabled', reasonCode: 'disabled' })
    expect(status?.error).toBeUndefined()
    await h.manager.stop()
  })

  it('classifies a missing credential and keeps the raw text host-side', async () => {
    const h = harness({ REF_A: 'a' })
    await h.manager.reconcile(config())
    const failed = h.manager.status().find(item => item.id === 'bot-b')
    expect(failed).toMatchObject({ reasonCode: 'credential_missing', status: 'disabled' })
    expect(JSON.stringify(toClientBotStatus(failed!))).not.toContain('missing app secret')
    await h.manager.stop()
  })
})

describe('bot failure classification', () => {
  it('collapses anything path-shaped and bounds the text', () => {
    expect(safeStatusText('cannot read /Users/me/.dsh/feishu-remote/cli_a.json'))
      .toBe('cannot read …')
    expect(safeStatusText('C:\\Users\\me\\state.json failed')).not.toContain('Users')
    expect(safeStatusText('x'.repeat(500)).length).toBeLessThanOrEqual(200)
    expect(safeStatusText('app_secret: hunter2')).not.toContain('hunter2')
  })

  it('maps common runtime failures onto stable codes', () => {
    expect(classifyBotFailure(new Error('missing app secret for credential REF_A')).reasonCode)
      .toBe('credential_missing')
    expect(classifyBotFailure(new Error('HTTP 429 too many requests')).reasonCode).toBe('rate_limited')
    expect(classifyBotFailure(new Error('Profile a.md 文件不存在')).reasonCode).toBe('profile_unreadable')
    expect(classifyBotFailure(new Error('websocket connect failed')).reasonCode).toBe('connect_failed')
    const unknown = classifyBotFailure(new Error('weird failure at /var/db/x'))
    expect(unknown.reasonCode).toBe('unknown')
    expect(unknown.detail).not.toContain('/var/db/x')
  })
})
