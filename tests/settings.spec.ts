import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { Config } from '../src/config.js'
import { purgeForbiddenSettingsKeys } from '../src/index.js'
import {
  HOST_ONLY_BOT_KEYS,
  SETTINGS_NAMESPACE,
  flatSchema,
  flatten,
  unflatten,
  type FlatSettings,
} from '../src/settings.js'

describe('settings namespace (flat ↔ nested)', () => {
  it('flattens the bridge config into the scalar-only shape', () => {
    const flat = flatten({
      appId: 'cli_1',
      allowedOpenIds: ['ou_1', 'ou_2'],
      allowedChatIds: [],
      allowAllUsers: false,
      cwd: '/tmp/work',
      workspaceRoot: '/tmp/work',
      commandAllowlist: ['status'],
    })
    expect(flat.appId).toBe('cli_1')
    expect(flat.allowedOpenIds).toBe('ou_1, ou_2')
    expect(flat.allowedChatIds).toBe('')
    expect(flat.appSecretRef).toBe('DSH_FEISHU_APP_SECRET')
    expect(flat.brand).toBe('feishu')
    expect(flat.onboardingManaged).toBe(false)
    expect(flat.contextP2pMaxMessages).toBe(80)
    expect(flat.contextP2pMaxChars).toBe(50000)
    expect('appSecret' in flat).toBe(false)
  })

  it('never carries the secret VALUE through the settings layer (credential ref only)', () => {
    const flat = flatten({ appId: 'cli_1', appSecret: 'super-secret' })
    expect(JSON.stringify(flat)).not.toContain('super-secret')
    const config = unflatten({ appSecretRef: 'MY_REF' }, { appSecret: 'super-secret' })
    expect(config.appSecretRef).toBe('MY_REF')
    expect(config.appSecret).toBe('super-secret') // entry value preserved, never written by settings
  })

  it('drops a legacy inline secret after QR onboarding selects a provider ref', () => {
    const config = unflatten({
      appId: 'cli_new',
      appSecretRef: 'DSH_FEISHU_APP_SECRET_NEW',
      onboardingManaged: true,
      brand: 'lark',
    }, { appSecret: 'legacy-secret', brand: 'feishu' })
    expect(config.appSecret).toBe('')
    expect(config.brand).toBe('lark')
  })

  it('round-trips through unflatten, keeping entry fields GUI does not expose', () => {
    const entry = { appSecretRef: 'DSH_FEISHU_APP_SECRET', brand: 'feishu' as const }
    const flat = flatten({
      appId: 'cli_1',
      allowedOpenIds: ['ou_1'],
      allowedChatIds: ['oc_1'],
      cwd: '/tmp/work',
      workspaceRoot: '/tmp/work',
      progressUpdateMs: 500,
    })
    const config = unflatten(flat, entry)
    expect(config.appId).toBe('cli_1')
    expect(config.allowedOpenIds).toEqual(['ou_1'])
    expect(config.allowedChatIds).toEqual(['oc_1'])
    expect(config.progressUpdateMs).toBe(500)
    expect(config.appSecretRef).toBe('DSH_FEISHU_APP_SECRET')
    expect(config.brand).toBe('feishu')
    expect(config.contextP2pMaxMessages).toBe(80)
    expect(config.contextP2pMaxChars).toBe(50000)
  })

  it('parses empty list strings as empty arrays', () => {
    const config = unflatten(flatten({}), {})
    expect(config.allowedOpenIds).toEqual([])
    expect(config.allowedChatIds).toEqual([])
    expect(config.commandAllowlist).toEqual([])
  })

  it('exposes only the credential reference, not a secret field', () => {
    const json = JSON.stringify(flatSchema.toJSON?.() ?? flatSchema)
    expect(json).toContain('appSecretRef')
    expect(json).not.toContain('"appSecret"')
  })

  it('keeps every host-only key out of the GUI schema AND out of the flat value', () => {
    const json = JSON.stringify(flatSchema.toJSON?.() ?? flatSchema)
    for (const key of HOST_ONLY_BOT_KEYS) expect(json).not.toContain(key)
    const flat = flatten({
      statePath: '/host/legacy.json',
      inboundDir: '/host/legacy-inbox',
      feishuCliPath: '/trusted/lark',
      bots: [{
        id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A',
        statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark-a',
      }],
    })
    // The flat shape is what the registration `base` publishes to the browser:
    // an undeclared key would survive the non-strict resolve, so the key must
    // not be produced in the first place.
    const text = JSON.stringify(flatSchema(flat))
    for (const key of HOST_ONLY_BOT_KEYS) expect(text).not.toContain(key)
    for (const value of ['/host/legacy.json', '/host/legacy-inbox', '/trusted/lark', '/hidden/a.json', '/hidden/a', '/trusted/lark-a']) {
      expect(text).not.toContain(value)
    }
  })

  it('re-overlays the patch.yml host-only paths onto the matching bot id', () => {
    const entry: Config = {
      feishuCliPath: '/root/should-not-be-used',
      bots: [
        { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark' },
        { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B' },
      ],
    }
    const flat = flatten(entry)
    const config = unflatten(flat, entry)
    expect(config.bots?.[0]).toMatchObject({
      id: 'bot-a', statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark',
    })
    // A bot patch.yml declares without host-only paths keeps the defaults; the
    // ROOT feishuCliPath must not leak into a multi-bot entry.
    expect(config.bots?.[1]).not.toHaveProperty('statePath')
    expect(config.bots?.[1]).not.toHaveProperty('feishuCliPath')
  })

  it('gives a GUI-converted legacy bot the entry ROOT host-only paths', () => {
    const entry: Config = {
      appId: 'cli_primary', statePath: '/host/state.json', inboundDir: '/host/inbox', feishuCliPath: '/trusted/lark',
    }
    // The GUI converted legacy → multi: settings now carry a bots[] the entry
    // config knows nothing about, but it is the SAME Feishu app.
    const flat = { ...flatten(entry), bots: flatten({
      bots: [
        { id: 'primary-bot', appId: 'cli_primary', appSecretRef: 'REF_PRIMARY' },
        { id: 'bot-new', appId: 'cli_new', appSecretRef: 'REF_NEW' },
      ],
    }).bots }
    const config = unflatten(flat, entry)
    expect(config.bots?.[0]).toMatchObject({
      id: 'primary-bot', statePath: '/host/state.json', inboundDir: '/host/inbox', feishuCliPath: '/trusted/lark',
    })
    expect(config.bots?.[1]).not.toHaveProperty('statePath')
  })

  it('follows the legacy session marker when the converted bot was rebound to a new app', () => {
    const entry: Config = { appId: 'cli_old', statePath: '/host/state.json', feishuCliPath: '/trusted/lark' }
    const flat = { ...flatten(entry), bots: flatten({
      bots: [
        { id: 'bot-new', appId: 'cli_new', appSecretRef: 'REF_NEW' },
        { id: 'primary-bot', appId: 'cli_rebound', appSecretRef: 'REF_P', sessionNamespace: 'legacy' as const },
      ],
    }).bots }
    const config = unflatten(flat, entry)
    expect(config.bots?.[0]).not.toHaveProperty('statePath')
    expect(config.bots?.[1]).toMatchObject({ statePath: '/host/state.json', feishuCliPath: '/trusted/lark' })
  })

  it('ignores host-only keys and a stale secret left in the flat value by an older build', () => {
    const stale = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    Object.assign(stale.bots[0]!, {
      statePath: '/evil/state.json', inboundDir: '/evil/inbox', feishuCliPath: '/evil/bin', appSecret: 'leaked',
    })
    const config = unflatten(stale, { bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/hidden/a.json' }] })
    expect(config.bots?.[0]).toMatchObject({ statePath: '/hidden/a.json' })
    expect(JSON.stringify(config.bots)).not.toContain('/evil')
    expect(JSON.stringify(config.bots)).not.toContain('leaked')
  })

  it('round-trips bots[] and process capacity without carrying secret values', () => {
    const flat = flatten({
      maxTotalLiveAgents: 9,
      bots: [{
        id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', profileFile: '/profiles/a.md',
        defaultWorkspace: '/work/a', sessionNamespace: 'app', statePath: '/state/a.json',
      }],
    })
    expect(flat.maxTotalLiveAgents).toBe(9)
    expect(flat.bots[0]).toMatchObject({ id: 'bot-a', appSecretRef: 'REF_A' })
    expect(JSON.stringify(flat)).not.toContain('"appSecret"')
    expect(JSON.stringify(flat)).not.toContain('/state/a.json')
    const roundTrip = unflatten(flat, {})
    expect(roundTrip.bots?.[0]).toMatchObject({ id: 'bot-a', profileFile: '/profiles/a.md' })
  })
})

/**
 * End-to-end against the REAL settings provider (Codex batch-2 B1). The
 * standard settings surface ships `describe({ redactSecrets: true })` — the
 * composition `base`, the resolved `value` AND the raw `user` section — to the
 * browser, and the flat schema resolves non-strictly, so anything that reaches
 * any of those three layers reaches the browser. Nothing in this plugin may
 * put a host-only path or a secret value into them.
 */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  private readonly doc: Record<string, unknown>
  constructor(ctx: never, doc: Record<string, unknown>) {
    super(ctx)
    this.doc = doc ?? {}
  }

  protected async load(): Promise<Record<string, unknown>> { return this.doc }

  protected async persist(ns: never, section: Record<string, unknown>): Promise<void> {
    this.doc[String(ns)] = section
  }
}

interface SettingsSurface {
  writable: boolean
  register(ns: unknown, schema: unknown, options: unknown): { get(): FlatSettings }
  describe(options: unknown): Array<{ ns: unknown; revision: number; value: unknown; base?: unknown; user?: unknown }>
  mutate(ns: unknown, ops: unknown, revision: number): Promise<void>
}

const HOST_ONLY_VALUES = [
  '/host/legacy-state.json', '/host/legacy-inbox', '/trusted/lark',
  '/hidden/a.json', '/hidden/a', '/trusted/lark-a', 'super-secret',
]

async function bootSettings(userSection: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(MemorySettings as never, { [String(SETTINGS_NAMESPACE)]: userSection } as never)
  return ctx
}

const HOST_CONFIG: Config = {
  appId: 'cli_primary',
  appSecret: 'super-secret',
  statePath: '/host/legacy-state.json',
  inboundDir: '/host/legacy-inbox',
  feishuCliPath: '/trusted/lark',
  bots: [{
    id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A',
    statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark-a',
  }],
}

describe('settings descriptor (the layers the browser actually receives)', () => {
  it('never publishes host-only paths or the secret through base/value/user', async () => {
    const ctx = await bootSettings({})
    const settings = (ctx as unknown as { settings: SettingsSurface }).settings
    settings.register(SETTINGS_NAMESPACE, flatSchema, { base: flatten(HOST_CONFIG) })
    const descriptor = settings.describe({ redactSecrets: true })
      .find(item => String(item.ns) === String(SETTINGS_NAMESPACE))!
    for (const layer of ['base', 'value', 'user'] as const) {
      const text = JSON.stringify(descriptor[layer] ?? {})
      for (const key of ['appSecret', ...HOST_ONLY_BOT_KEYS]) {
        // Quoted: `appSecretRef` legitimately contains `appSecret` as a substring.
        expect(text, `${layer}.${key}`).not.toContain(`"${key}"`)
      }
      for (const value of HOST_ONLY_VALUES) expect(text, `${layer} ${value}`).not.toContain(value)
    }
  })

  it('purges host-only paths and a stale secret an older build wrote into the user layer', async () => {
    const ctx = await bootSettings({
      appSecret: 'super-secret',
      statePath: '/host/legacy-state.json',
      inboundDir: '/host/legacy-inbox',
      feishuCliPath: '/trusted/lark',
      model: 'kept-model',
      bots: [{
        id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', model: 'kept-bot-model',
        statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark-a',
      }],
    })
    const settings = (ctx as unknown as { settings: SettingsSurface }).settings
    const scope = settings.register(SETTINGS_NAMESPACE, flatSchema, { base: flatten(HOST_CONFIG) })
    // Before the migration the raw user layer really does leak (this is the
    // bug Codex found); after it, all three layers are clean.
    expect(JSON.stringify(settings.describe({ redactSecrets: true })[0]?.user)).toContain('super-secret')
    await purgeForbiddenSettingsKeys(ctx as never)
    const descriptor = settings.describe({ redactSecrets: true })
      .find(item => String(item.ns) === String(SETTINGS_NAMESPACE))!
    for (const layer of ['base', 'value', 'user'] as const) {
      const text = JSON.stringify(descriptor[layer] ?? {})
      for (const key of ['appSecret', ...HOST_ONLY_BOT_KEYS]) {
        // Quoted: `appSecretRef` legitimately contains `appSecret` as a substring.
        expect(text, `${layer}.${key}`).not.toContain(`"${key}"`)
      }
      for (const value of HOST_ONLY_VALUES) expect(text, `${layer} ${value}`).not.toContain(value)
    }
    // Real user edits survive the purge…
    expect(scope.get().model).toBe('kept-model')
    expect(scope.get().bots[0]).toMatchObject({ id: 'bot-a', model: 'kept-bot-model' })
    // …and the trusted-admin paths still reach the bridge, from the entry config.
    expect(unflatten(scope.get(), HOST_CONFIG).bots?.[0]).toMatchObject({
      statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark-a',
    })
    // A second run is a no-op (no revision bump, no write).
    const revision = descriptor.revision
    await purgeForbiddenSettingsKeys(ctx as never)
    expect(settings.describe({ redactSecrets: true })[0]?.revision).toBe(revision)
  })
})
