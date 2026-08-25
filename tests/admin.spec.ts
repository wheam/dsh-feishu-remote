import { describe, expect, it, vi } from 'vitest'
import { FeishuAdminService } from '../src/admin.js'
import { flatten, type FlatSettings } from '../src/settings.js'

/**
 * Every key the flat schema declares. The fake `mutate` below refuses any
 * other top-level path: the plugin may only ever address keys that live in
 * its OWN namespace schema, so a stale field name (docs/18 §3.2, audit M3:
 * `appSecret` in `LEGACY_ROOT_FIELDS`) fails loudly here instead of writing
 * a silent no-op op against the real Host.
 */
const FLAT_KEYS = new Set(Object.keys(flatten({})))
const FLAT_DEFAULTS = flatten({}) as unknown as Record<string, unknown>

type GuiState = { safe: boolean; reason?: 'purge_failed' | 'read_only_dirty' | 'user_layer_dirty' }

interface HarnessOptions {
  revision?: number
  credentialValue?: string
  writable?: boolean
  /** The DYNAMIC gate: re-read on every request, exactly like the real one. */
  guiState?: () => GuiState
  statuses?: unknown[]
}

function harness(initial: FlatSettings, options: HarnessOptions = {}) {
  const revision = options.revision ?? 7
  const credentialValue = options.credentialValue ?? 'secret'
  let current = structuredClone(initial)
  const mutate = vi.fn(async (_ns: unknown, ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, expected: number) => {
    if (expected !== revision) throw Object.assign(new Error('settings conflict'), { code: 'SETTINGS_CONFLICT' })
    for (const op of ops) {
      const key = op.path[0] as string
      if (!FLAT_KEYS.has(key)) throw new Error(`settings mutate 触及 schema 之外的字段 ${key}`)
      const target = current as unknown as Record<string, unknown>
      // `unset` drops the USER layer; the resolved value falls back to the
      // composition base (empty here) plus schema defaults.
      target[key] = op.op === 'set' ? structuredClone(op.value) : structuredClone(FLAT_DEFAULTS[key])
    }
  })
  const ctx = {
    credentials: { resolve: vi.fn(async () => ({ value: credentialValue })) },
    settings: {
      writable: options.writable ?? true,
      describe: () => [{ ns: 'feishu-remote', revision, value: current, applies: 'live' }],
      mutate,
    },
  }
  const scope = { get: () => current }
  const manager = {
    status: () => options.statuses ?? [{
      id: 'bot-a', enabled: true, status: 'connected', connected: true,
      terminalFailure: false, liveAgents: 0, provisionalAgents: 0,
    }],
  }
  return {
    service: new FeishuAdminService(
      ctx as never,
      scope as never,
      manager as never,
      { statePath: '/host/state.json', inboundDir: '/host/inbox', feishuCliPath: '/trusted/lark' },
      options.guiState ?? (() => ({ safe: true })),
    ),
    mutate,
    current: () => current,
  }
}

function failure(result: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  return result as { code: string; message: string; details?: Record<string, unknown> }
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
    const json = JSON.stringify(editor)
    expect(json).not.toContain('must-not-leak')
    expect(json).not.toContain('also-hidden')
    expect(json).not.toContain('allowedOpenIds')
    expect(json).not.toContain('allowAllUsers')
  })

  it('never sends host-only paths (feishuCliPath/statePath/inboundDir) to the browser', async () => {
    // `flatten()` already drops them; a stale user layer written by an older
    // build is the case that still has to be filtered here.
    const initial = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    Object.assign(initial.bots[0]!, {
      statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark',
    })
    const h = harness(initial)
    const editor = await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal)
    const json = JSON.stringify(editor)
    for (const key of ['feishuCliPath', 'statePath', 'inboundDir']) expect(json).not.toContain(key)
    for (const value of ['/hidden/a.json', '/hidden/a', '/trusted/lark']) expect(json).not.toContain(value)
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
      appId: 'cli_primary', appSecretRef: 'REF_PRIMARY', sessionNamespace: 'legacy', contextBackend: 'sdk',
      allowedOpenIds: [], allowAllUsers: true,
    })
    // Host-only paths must NOT be copied into the settings layer; the entry
    // ROOT values are re-overlaid host-side by unflatten() instead.
    expect(JSON.stringify(bots)).not.toContain('/host/state.json')
    expect(JSON.stringify(bots)).not.toContain('/host/inbox')
    expect(JSON.stringify(bots)).not.toContain('/trusted/lark')
  })

  it('saves known bots atomically and keeps stored fields the editor never sends', async () => {
    const initial = flatten({ bots: [
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', sessionNamespace: 'app', cardBodyMaxChars: 5000 },
      { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', sessionNamespace: 'app' },
    ] })
    // A stale host-only key left by an older build must be dropped, not re-persisted.
    Object.assign(initial.bots[0]!, { statePath: '/hidden/a.json' })
    const h = harness(initial)
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
    expect(bots[0]).toMatchObject({ id: 'bot-a', model: 'new-model', cardBodyMaxChars: 5000 })
    expect(bots[0]).not.toHaveProperty('statePath')
    expect(bots[1]).toMatchObject({ id: 'bot-b', sessionNamespace: 'app' })
    expect(bots[1]).not.toHaveProperty('feishuCliPath')
    expect(h.current().maxTotalLiveAgents).toBe(5)
  })

  /**
   * Codex batch-3 B3: `id` is immutable and a save can never MINT one.
   * Accepting an unknown id turned delete-then-resubmit into a silent rename
   * (the resubmitted row lost every stored field and the bot's identity moved).
   */
  it('rejects a bots[] entry whose id is not in the current snapshot', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [
        { id: 'bot-a', enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' },
        { id: 'bot-renamed', enabled: true, appId: 'cli_b', appSecretRef: 'REF_B', contextBackend: 'sdk' },
      ],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'unknown_bot_id', details: { botId: 'bot-renamed' } })
    expect(failure(result).message).toContain('bot-renamed')
    // The offending id is named, but nothing about the host filesystem is.
    expect(JSON.stringify(result)).not.toContain('/')
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.current().bots).toHaveLength(1)
  })

  it('refuses a bots[] save while the config is still single-bot (legacy)', async () => {
    const h = harness(flatten({ appId: 'cli_primary', appSecretRef: 'REF_PRIMARY' }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [{ id: 'bot-a', enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'legacy_mode' })
    expect(failure(result).message).toContain('转换为多机器人配置')
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.current().bots).toEqual([])
  })

  it('merges stored bots strictly by id, so swapping two ids cannot swap their identities', async () => {
    const initial = flatten({ bots: [
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', cardBodyMaxChars: 5000, sessionNamespace: 'legacy' },
      { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', cardBodyMaxChars: 9000 },
    ] })
    const h = harness(initial)
    // The payload swaps the two ids while keeping each row's appId.
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [
        { id: 'bot-b', enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' },
        { id: 'bot-a', enabled: true, appId: 'cli_b', appSecretRef: 'REF_B', contextBackend: 'sdk' },
      ],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true })
    // Every non-editable stored field stays with its OWN stored id — the
    // payload only moved the editable appId/ref, never bot-a's identity.
    const byId = new Map(h.current().bots.map(bot => [bot.id, bot]))
    expect(byId.get('bot-a')).toMatchObject({ cardBodyMaxChars: 5000, sessionNamespace: 'legacy' })
    expect(byId.get('bot-b')).toMatchObject({ cardBodyMaxChars: 9000, sessionNamespace: 'app' })
  })

  it('rejects a bots[] entry that drops its id', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [{ enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'bad_request' })
    expect(failure(result).message).toContain('id')
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('refuses to delete the last bot even when it is already disabled', async () => {
    const h = harness(flatten({
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', enabled: false }],
    }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7, maxTotalLiveAgents: 0, bots: [],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'last_bot' })
    expect(failure(result).message).toContain('停用')
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.current().bots).toHaveLength(1)
  })

  it('rejects unknown or host-only fields from the editor payload', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/overwrite' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'bad_request' })
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('saves single-bot root fields with one CAS mutation and never converts to multi', async () => {
    const h = harness(flatten({ appId: 'cli_primary', appSecretRef: 'REF_PRIMARY' }))
    const result = await h.service.handleRpc('settings/save-legacy', {
      revision: 7,
      config: {
        defaultWorkspace: '/work/project',
        workspacePolicy: 'locked',
        maxLiveAgents: 3,
        contextMode: 'off',
      },
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { mode: 'legacy', revision: 7 } })
    expect(h.mutate).toHaveBeenCalledTimes(1)
    const [, ops, expected] = h.mutate.mock.calls[0]!
    expect(expected).toBe(7)
    expect(ops.every(op => op.op === 'set')).toBe(true)
    expect(ops.map(op => op.path[0]).sort()).toEqual([
      'contextMode', 'defaultWorkspace', 'maxLiveAgents', 'workspacePolicy',
    ])
    expect(h.current()).toMatchObject({
      defaultWorkspace: '/work/project', workspacePolicy: 'locked', maxLiveAgents: 3,
      contextMode: 'off', appId: 'cli_primary',
    })
    expect(h.current().bots).toEqual([])
  })

  it('rejects host-only, unknown and shape-changing keys in a single-bot save', async () => {
    for (const config of [
      { feishuCliPath: '/evil/bin' },
      { statePath: '/evil/state.json' },
      { inboundDir: '/evil/inbox' },
      { cwd: '/evil' },
      { workspaceRoot: '/evil' },
      { onboardingManaged: true },
      { allowedOpenIds: 'ou_owner' },
      { allowAllUsers: false },
      { appSecret: 'super-secret' },
      { bots: [] },
      { maxTotalLiveAgents: 4 },
      { nonsense: 1 },
    ]) {
      const h = harness(flatten({ appId: 'cli_primary' }))
      const result = await h.service.handleRpc('settings/save-legacy', { revision: 7, config }, new AbortController().signal)
      expect(result, JSON.stringify(config)).toMatchObject({ ok: false, code: 'bad_request' })
      expect(h.mutate).not.toHaveBeenCalled()
    }
  })

  it('refuses a single-bot save while the config is in multi-bot mode', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }))
    const result = await h.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { appId: 'cli_other' },
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'multi_mode' })
    expect(failure(result).message).toContain('机器人列表')
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('validates single-bot numbers, locked workspaces and credential refs', async () => {
    const outOfRange = harness(flatten({ appId: 'cli_primary' }))
    expect(await outOfRange.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { progressUpdateMs: 10 },
    }, new AbortController().signal)).toMatchObject({ ok: false, code: 'validation' })
    expect(outOfRange.mutate).not.toHaveBeenCalled()

    const locked = harness(flatten({ appId: 'cli_primary' }))
    const lockedResult = await locked.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { workspacePolicy: 'locked' },
    }, new AbortController().signal)
    expect(lockedResult).toMatchObject({ ok: false, code: 'validation' })
    expect(failure(lockedResult).message).toContain('默认工作区')
    expect(locked.mutate).not.toHaveBeenCalled()

    const missingSecret = harness(flatten({ appId: 'cli_primary' }), { credentialValue: '' })
    const secretResult = await missingSecret.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { appSecretRef: 'REF_MISSING' },
    }, new AbortController().signal)
    expect(secretResult).toMatchObject({ ok: false, code: 'credential_missing' })
    expect(failure(secretResult).message).toContain('REF_MISSING')
    expect(missingSecret.mutate).not.toHaveBeenCalled()

    const stale = harness(flatten({ appId: 'cli_primary' }))
    expect(await stale.service.handleRpc('settings/save-legacy', {
      revision: 6, config: { model: 'm' },
    }, new AbortController().signal)).toMatchObject({
      ok: false, code: 'conflict', details: { latest: { revision: 7, mode: 'legacy' } },
    })
  })

  /**
   * Codex batch-3 B1. `bots/status` used to forward the manager's RAW error
   * text (which embeds resolved absolute statePath/inboundDir values), the
   * appId and the profile PATH straight to the browser.
   */
  it('projects bots/status onto the safe DTO: no raw error, no appId, no paths', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }), {
      statuses: [{
        id: 'bot-a',
        appId: 'cli_a',
        enabled: true,
        status: 'disabled',
        error: 'dsh-feishu-remote: duplicate statePath /Users/me/.dsh/feishu-remote/cli_a.json',
        reasonCode: 'duplicate_state_path',
        detail: '与另一个机器人共用同一份会话状态文件，请在 cordis.patch.yml 中为它单独配置',
        connected: false,
        terminalFailure: false,
        liveAgents: 0,
        provisionalAgents: 0,
        profile: { path: '/Users/me/profiles/a.md', digest: 'd', bytes: 12, loadedAt: 1 },
      }],
    })
    const result = await h.service.handleRpc('bots/status', {}, new AbortController().signal)
    const json = JSON.stringify(result)
    for (const key of ['error', 'appId', 'profile', 'statePath', 'inboundDir', 'feishuCliPath']) {
      expect(json, key).not.toContain(key)
    }
    expect(json).not.toContain('/Users/me')
    expect(result).toMatchObject({
      ok: true,
      value: { bots: [{
        id: 'bot-a',
        status: 'disabled',
        reasonCode: 'duplicate_state_path',
        detail: '与另一个机器人共用同一份会话状态文件，请在 cordis.patch.yml 中为它单独配置',
        liveAgents: 0,
        provisionalAgents: 0,
      }] },
    })
  })

  /**
   * Codex batch-3 B2: when the settings layers are not provably clean the GUI
   * fails closed — and so does every write, because a bots[] rewrite would
   * drop a legitimate user-layer statePath along with it.
   */
  it('publishes the GUI fail-closed state and refuses every write while unsafe', async () => {
    const h = harness(flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }), {
      guiState: () => ({ safe: false, reason: 'user_layer_dirty' }),
    })
    expect(await h.service.handleRpc('settings/gui-state', {}, new AbortController().signal))
      .toEqual({ ok: true, value: { safe: false, reason: 'user_layer_dirty' } })
    expect(await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal))
      .toMatchObject({ ok: true, value: { guiSafe: false, guiReason: 'user_layer_dirty' } })
    const result = await h.service.handleRpc('settings/save-bots', {
      revision: 7,
      maxTotalLiveAgents: 0,
      bots: [{ id: 'bot-a', enabled: true, appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'sdk' }],
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'settings_unsafe', details: { reason: 'user_layer_dirty' } })
    expect(h.mutate).not.toHaveBeenCalled()
  })

  /**
   * Codex batch-4 MAJOR-2: the gate is re-evaluated per request. An admin who
   * cleans the offending field must get the GUI back on the NEXT call, not
   * after a restart of the whole web profile.
   */
  it('unlocks the GUI on the next request once the layers are cleaned, with no restart', async () => {
    let dirty = true
    const h = harness(flatten({ appId: 'cli_primary' }), {
      guiState: () => (dirty ? { safe: false, reason: 'user_layer_dirty' } : { safe: true }),
    })
    expect(await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal))
      .toMatchObject({ ok: true, value: { guiSafe: false, guiReason: 'user_layer_dirty' } })
    expect(await h.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { model: 'm' },
    }, new AbortController().signal)).toMatchObject({ ok: false, code: 'settings_unsafe' })
    expect(h.mutate).not.toHaveBeenCalled()

    dirty = false
    const snapshot = await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal)
    expect(snapshot).toMatchObject({ ok: true, value: { guiSafe: true } })
    expect((snapshot as { value: Record<string, unknown> }).value).not.toHaveProperty('guiReason')
    expect(await h.service.handleRpc('settings/gui-state', {}, new AbortController().signal))
      .toEqual({ ok: true, value: { safe: true } })
    expect(await h.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { model: 'm' },
    }, new AbortController().signal)).toMatchObject({ ok: true })
    expect(h.mutate).toHaveBeenCalledTimes(1)
  })

  it('reports a clean GUI state and allows writes when the layers are safe', async () => {
    const h = harness(flatten({ appId: 'cli_primary' }))
    expect(await h.service.handleRpc('settings/gui-state', {}, new AbortController().signal))
      .toEqual({ ok: true, value: { safe: true } })
    expect(await h.service.handleRpc('settings/editor-snapshot', {}, new AbortController().signal))
      .toMatchObject({ ok: true, value: { guiSafe: true } })
  })

  it('refuses writes on a read-only settings provider', async () => {
    const h = harness(flatten({ appId: 'cli_primary' }), { writable: false })
    const result = await h.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { model: 'm' },
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'read_only' })
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('never puts an absolute path in a failure message', async () => {
    const h = harness(flatten({ appId: 'cli_primary' }))
    const result = await h.service.handleRpc('settings/save-legacy', {
      revision: 7, config: { defaultWorkspace: '/Users/me/secret-project', workspacePolicy: 'locked', nonsense: 1 },
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, code: 'bad_request' })
    expect(JSON.stringify(result)).not.toContain('/Users/me')
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
      code: 'conflict',
      details: { latest: { revision: 7, mode: 'multi' } },
    })
    // The Host RpcResult envelope must ALSO carry the structured failure:
    // the browser re-parses the response with the Host's closed error schema,
    // which strips unknown keys everywhere except `details.issues`.
    const envelope = (result as { error: { code: string; details: { issues: unknown[] } } }).error
    expect(envelope.code).toBe('bad-request')
    expect(envelope.details.issues[0]).toMatchObject({ code: 'conflict' })
  })
})
