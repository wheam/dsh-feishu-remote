import { describe, expect, it, vi } from 'vitest'
import { FeishuAdminService } from '../src/admin.js'
import { flatten, type FlatSettings } from '../src/settings.js'

function harness(initial: FlatSettings, revision = 7) {
  let current = structuredClone(initial)
  const mutate = vi.fn(async (_ns: unknown, ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, expected: number) => {
    if (expected !== revision) throw Object.assign(new Error('settings conflict'), { code: 'SETTINGS_CONFLICT' })
    for (const op of ops) {
      const key = op.path[0] as keyof FlatSettings
      if (op.op === 'set') (current as unknown as Record<string, unknown>)[key] = structuredClone(op.value)
    }
  })
  const ctx = {
    credentials: { resolve: vi.fn(async () => ({ value: 'secret' })) },
    settings: {
      writable: true,
      describe: () => [{ ns: 'feishu-remote', revision, value: current, applies: 'live' }],
      mutate,
    },
  }
  const scope = { get: () => current }
  const manager = { status: () => [{ id: 'bot-a', enabled: true, status: 'connected' }] }
  return {
    service: new FeishuAdminService(ctx as never, scope as never, manager as never, {
      statePath: '/host/state.json', inboundDir: '/host/inbox', feishuCliPath: '/trusted/lark',
    }),
    mutate,
    current: () => current,
  }
}

describe('FeishuAdminService', () => {
  it('exposes revisioned editor and redacted runtime snapshots', async () => {
    const h = harness(flatten({ appId: 'cli_a', appSecretRef: 'REF_A' }))
    const editor = await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal)
    expect(editor).toMatchObject({ ok: true, value: { revision: 7, mode: 'legacy', writable: true } })
    const status = await h.service.handleRpc('bots/status', {}, new AbortController().signal)
    expect(status).toMatchObject({ ok: true, value: { bots: [{ id: 'bot-a', status: 'connected' }] } })
  })

  it('strips undeclared nested bot fields from the editor wire snapshot', async () => {
    const initial = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    Object.assign(initial.bots[0]!, { appSecret: 'must-not-leak', futureSecret: 'also-hidden' })
    const h = harness(initial)
    const editor = await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal)
    expect(JSON.stringify(editor)).not.toContain('must-not-leak')
    expect(JSON.stringify(editor)).not.toContain('also-hidden')
  })

  it('converts legacy config with one CAS mutation and preserves legacy session identity', async () => {
    const h = harness(flatten({
      appId: 'cli_primary', appSecretRef: 'REF_PRIMARY', allowedOpenIds: ['ou_owner'],
      defaultWorkspace: '/work/project', profileFile: '/profiles/primary.md',
    }))
    const result = await h.service.handleRpc('settings/convert-legacy', {}, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { mode: 'multi' } })
    expect(h.mutate).toHaveBeenCalledTimes(1)
    const [, ops, expected] = h.mutate.mock.calls[0]!
    expect(expected).toBe(7)
    const bots = (ops as Array<{ op: string; path: string[]; value?: unknown }>).find(op => op.path[0] === 'bots')?.value as Array<Record<string, unknown>>
    expect(bots[0]).toMatchObject({
      appId: 'cli_primary', appSecretRef: 'REF_PRIMARY', sessionNamespace: 'legacy',
      contextBackend: 'sdk', statePath: '/host/state.json', inboundDir: '/host/inbox',
    })
  })

  it('saves bots atomically, preserves host-only fields, and forces new bots to app namespace', async () => {
    const h = harness(flatten({ bots: [{
      id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/hidden/a.json',
      inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark', sessionNamespace: 'app',
    }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 5,
      bots: [
        { id: 'bot-a', enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', model: 'new-model', contextBackend: 'sdk' },
        { id: 'bot-b', enabled: true, appId: 'cli_b', appSecretRef: 'REF_B', contextBackend: 'sdk' },
      ],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true })
    const bots = h.current().bots
    expect(bots[0]).toMatchObject({ model: 'new-model', statePath: '/hidden/a.json', inboundDir: '/hidden/a' })
    expect(bots[1]).toMatchObject({ id: 'bot-b', sessionNamespace: 'app' })
    expect(h.current().maxTotalLiveAgents).toBe(5)
  })

  it('rejects unknown or host-only fields from the editor payload', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/overwrite' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('returns a fresh redacted snapshot on a CAS conflict', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 6,
      maxTotalLiveAgents: 0,
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'bad-request', details: { latest: { revision: 7, mode: 'multi' } } },
    })
  })
})
