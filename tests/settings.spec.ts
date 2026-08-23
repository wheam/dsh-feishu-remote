import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { Config } from '../src/config.js'
import { createSettingsGuard, purgeForbiddenSettingsKeys } from '../src/index.js'
import {
  HOST_ONLY_BOT_KEYS,
  SETTINGS_NAMESPACE,
  findForbiddenSettingsKeys,
  flatSchema,
  flatten,
  settingsPurgePlan,
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
    // The entry declares all three, so the entry wins all three: the settings
    // layer is never AUTHORITATIVE for a host-only key.
    const config = unflatten(stale, { bots: [{
      id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A',
      statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark',
    }] })
    expect(config.bots?.[0]).toMatchObject({
      statePath: '/hidden/a.json', inboundDir: '/hidden/a', feishuCliPath: '/trusted/lark',
    })
    expect(JSON.stringify(config.bots)).not.toContain('/evil')
    expect(JSON.stringify(config.bots)).not.toContain('leaked')
  })

  /**
   * Codex batch-4 BLOCKER-2. `settingsPurgePlan()` REFUSES to delete a
   * host-only path the trusted entry config does not declare — it is the only
   * copy a pre-f774159 install has. The runtime projection therefore has to
   * use it: dropping it moved the bot to the default state file, silently.
   */
  it('projects a RETAINED user-layer host-only value when the entry provides none', () => {
    const entry: Config = { bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }
    const flat = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    Object.assign(flat.bots[0]!, {
      statePath: '/legacy/only-here.json', inboundDir: '/legacy/inbox', feishuCliPath: '/legacy/lark',
    })
    expect(settingsPurgePlan({ bots: [{ id: 'bot-a', statePath: '/legacy/only-here.json' }] }, entry).retained)
      .toEqual([{ scope: 'bots.bot-a', key: 'statePath' }])
    expect(unflatten(flat, entry).bots?.[0]).toMatchObject({
      statePath: '/legacy/only-here.json', inboundDir: '/legacy/inbox', feishuCliPath: '/legacy/lark',
    })
  })

  it('lets the entry win key by key while retaining the keys it says nothing about', () => {
    const entry: Config = {
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/host/a.json' }],
    }
    const flat = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    Object.assign(flat.bots[0]!, { statePath: '/legacy/a.json', inboundDir: '/legacy/inbox' })
    expect(unflatten(flat, entry).bots?.[0]).toMatchObject({
      statePath: '/host/a.json', inboundDir: '/legacy/inbox',
    })
  })

  it('keeps a retained ROOT host-only value in single-bot mode and on the legacy continuation bot', () => {
    const flat = flatten({ appId: 'cli_old' })
    Object.assign(flat, { statePath: '/legacy/root-state.json' })
    // Single-bot: straight onto the root config.
    expect(unflatten(flat, { appId: 'cli_old' }))
      .toMatchObject({ statePath: '/legacy/root-state.json' })
    // Converted to multi in the GUI: it belongs to the bot that continues the
    // legacy session identity, and to no other bot.
    const converted = {
      ...flat,
      bots: flatten({ bots: [
        { id: 'bot-new', appId: 'cli_new', appSecretRef: 'REF_NEW' },
        { id: 'primary-bot', appId: 'cli_old', appSecretRef: 'REF_P', sessionNamespace: 'legacy' as const },
      ] }).bots,
    }
    const config = unflatten(converted, { appId: 'cli_old' })
    expect(config.bots?.[0]).not.toHaveProperty('statePath')
    expect(config.bots?.[1]).toMatchObject({ statePath: '/legacy/root-state.json' })
    // …and the ENTRY root still outranks it.
    expect(unflatten(converted, { appId: 'cli_old', statePath: '/host/root-state.json' }).bots?.[1])
      .toMatchObject({ statePath: '/host/root-state.json' })
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
    // Every stale path here is REDUNDANT with the trusted entry config, so the
    // purge is lossless and the GUI ends up provably safe.
    expect(await purgeForbiddenSettingsKeys(ctx as never, HOST_CONFIG)).toEqual({ safe: true })
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
    expect(await purgeForbiddenSettingsKeys(ctx as never, HOST_CONFIG)).toEqual({ safe: true })
    expect(settings.describe({ redactSecrets: true })[0]?.revision).toBe(revision)
  })

  /**
   * Audit M1: a pre-f774159 install could legitimately hold `statePath` /
   * `inboundDir` / `feishuCliPath` in the USER layer, and the trusted entry
   * config may know nothing about them. Deleting such a value silently moves
   * a bot's session state, so the purge keeps it, tells the admin to move it
   * into cordis.patch.yml, and fails the GUI closed until they do. The stale
   * SECRET is purged either way.
   */
  it('keeps a user-layer host-only value the entry config does not declare, and fails the GUI closed', async () => {
    const entry: Config = { bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] }
    const ctx = await bootSettings({
      appSecret: 'super-secret',
      model: 'kept-model',
      bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/legacy/only-here.json' }],
    })
    const settings = (ctx as unknown as { settings: SettingsSurface }).settings
    const scope = settings.register(SETTINGS_NAMESPACE, flatSchema, { base: flatten(entry) })
    const warnings: string[] = []
    ;(ctx as unknown as { logger?: unknown }).logger = {
      warn: (text: string, ...args: unknown[]) => warnings.push([text, ...args.map(String)].join(' ')),
      info: () => undefined,
    }
    expect(await purgeForbiddenSettingsKeys(ctx as never, entry))
      .toEqual({ safe: false, reason: 'user_layer_dirty' })
    // The operator's only copy of that path survives …
    expect(JSON.stringify(scope.get().bots[0])).toContain('/legacy/only-here.json')
    // … and, batch-4 BLOCKER-2, it actually reaches the bridge: the bot keeps
    // reading the very state file it read before the upgrade.
    expect(unflatten(scope.get(), entry).bots?.[0]).toMatchObject({ statePath: '/legacy/only-here.json' })
    // … the stale secret does not …
    expect(JSON.stringify(settings.describe({ redactSecrets: true })[0]?.user)).not.toContain('super-secret')
    expect(scope.get().model).toBe('kept-model')
    // … and the admin is told exactly what to do about it.
    expect(warnings.some(line => line.includes('cordis.patch.yml') && line.includes('statePath'))).toBe(true)
  })

  it('purges a user-layer host-only value the entry config already provides', async () => {
    const entry: Config = { bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/hidden/a.json' }] }
    const plan = settingsPurgePlan({
      bots: [{ id: 'bot-a', statePath: '/hidden/a.json', inboundDir: '' }],
    }, entry)
    expect(plan.retained).toEqual([])
    expect(plan.ops).toEqual([{ op: 'set', path: ['bots'], value: [{ id: 'bot-a' }] }])
  })

  /**
   * Codex batch-4 MAJOR-1. The common case is "the admin MOVED the path in
   * cordis.patch.yml": the entry now says something else, and the entry is
   * authoritative in `unflatten()`. Keeping the stale user value there only
   * locked the GUI forever, so a differing entry value purges too — retaining
   * is reserved for the keys the entry says nothing about.
   */
  it('purges a user-layer host-only value the entry OVERRIDES with a different one', () => {
    const entry: Config = { bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', statePath: '/moved/a.json' }] }
    const plan = settingsPurgePlan({ bots: [{ id: 'bot-a', statePath: '/old/a.json' }] }, entry)
    expect(plan.retained).toEqual([])
    expect(plan.ops).toEqual([{ op: 'set', path: ['bots'], value: [{ id: 'bot-a' }] }])
    // The moved path is what actually runs, so nothing was lost.
    const flat = flatten({ bots: [{ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' }] })
    expect(unflatten(flat, entry).bots?.[0]).toMatchObject({ statePath: '/moved/a.json' })
  })

  it('purges a differing ROOT host-only value the entry overrides, and retains one it does not', () => {
    const moved = settingsPurgePlan({ statePath: '/old/root.json' }, { statePath: '/moved/root.json' })
    expect(moved.retained).toEqual([])
    expect(moved.ops).toEqual([{ op: 'unset', path: ['statePath'] }])
    const orphan = settingsPurgePlan({ statePath: '/old/root.json' }, {})
    expect(orphan.ops).toEqual([])
    expect(orphan.retained).toEqual([{ scope: 'root', key: 'statePath' }])
  })

  /**
   * The purge planner and the runtime projection must agree about who owns a
   * legacy ROOT path: purging a value the projection then refuses to lend
   * back would move that bot's state file (batch-4 BLOCKER-2/MAJOR-1).
   */
  it('lends a legacy entry ROOT path to the continuation bot only, in both directions', () => {
    const entry: Config = { appId: 'cli_old', statePath: '/host/root.json' }
    const plan = settingsPurgePlan({ bots: [
      { id: 'bot-new', appId: 'cli_new', statePath: '/legacy/new.json' },
      { id: 'primary-bot', appId: 'cli_old', sessionNamespace: 'legacy', statePath: '/host/root.json' },
    ] }, entry)
    // The continuation bot's copy is redundant with the entry root …
    expect(plan.retained).toEqual([{ scope: 'bots.bot-new', key: 'statePath' }])
    // … the other bot's is the only copy there is, and it survives the trip.
    const flat = flatten({ bots: [
      { id: 'bot-new', appId: 'cli_new', appSecretRef: 'REF_NEW' },
      { id: 'primary-bot', appId: 'cli_old', appSecretRef: 'REF_P', sessionNamespace: 'legacy' },
    ] })
    Object.assign(flat.bots[0]!, { statePath: '/legacy/new.json' })
    const config = unflatten(flat, entry)
    expect(config.bots?.[0]).toMatchObject({ statePath: '/legacy/new.json' })
    expect(config.bots?.[1]).toMatchObject({ statePath: '/host/root.json' })
  })
})

/** Fail-closed GUI state (Codex batch-3 B2): only a clean descriptor unlocks it. */
describe('settings GUI safety gate', () => {
  const DIRTY_USER = { appSecret: 'super-secret', statePath: '/legacy/only-here.json' }

  function fakeCtx(options: {
    writable?: boolean
    user?: Record<string, unknown>
    mutate?: () => Promise<void>
    describe?: () => unknown[]
  }) {
    const user = options.user ?? DIRTY_USER
    return {
      logger: { warn: () => undefined, info: () => undefined },
      settings: {
        writable: options.writable ?? true,
        describe: options.describe ?? (() => [{ ns: 'feishu-remote', revision: 3, base: {}, value: user, user }]),
        mutate: options.mutate ?? (async () => undefined),
      },
    }
  }

  it('reports read_only_dirty when a read-only provider cannot be cleaned', async () => {
    const ctx = fakeCtx({ writable: false })
    expect(await purgeForbiddenSettingsKeys(ctx as never, {}))
      .toEqual({ safe: false, reason: 'read_only_dirty' })
  })

  it('reports purge_failed when the CAS write conflicts', async () => {
    const ctx = fakeCtx({
      mutate: async () => { throw Object.assign(new Error('settings conflict'), { code: 'SETTINGS_CONFLICT' }) },
    })
    expect(await purgeForbiddenSettingsKeys(ctx as never, {}))
      .toEqual({ safe: false, reason: 'purge_failed' })
  })

  it('reports purge_failed when persisting the purge throws', async () => {
    const ctx = fakeCtx({ mutate: async () => { throw new Error('disk is read-only') } })
    expect(await purgeForbiddenSettingsKeys(ctx as never, {}))
      .toEqual({ safe: false, reason: 'purge_failed' })
  })

  it('reports purge_failed when the descriptor cannot be read at all', async () => {
    const ctx = fakeCtx({ describe: () => [] })
    expect(await purgeForbiddenSettingsKeys(ctx as never, {}))
      .toEqual({ safe: false, reason: 'purge_failed' })
  })

  it('unlocks the GUI once every layer is clean', async () => {
    let user: Record<string, unknown> = { ...DIRTY_USER }
    const ctx = {
      logger: { warn: () => undefined, info: () => undefined },
      settings: {
        writable: true,
        describe: () => [{ ns: 'feishu-remote', revision: 3, base: {}, value: user, user }],
        mutate: async () => { user = {} },
      },
    }
    expect(await purgeForbiddenSettingsKeys(ctx as never, { statePath: '/legacy/only-here.json' }))
      .toEqual({ safe: true })
  })

  /**
   * Codex batch-4 MAJOR-2: the verdict is a live re-scan, not a value cached
   * at startup. An admin who cleans the settings file must get the GUI back
   * on the next request — and a layer that turns dirty must lock again.
   */
  it('re-scans on every call, so a cleaned layer unlocks without a restart', () => {
    let user: Record<string, unknown> = { ...DIRTY_USER }
    const ctx = fakeCtx({ describe: () => [{ ns: 'feishu-remote', revision: 3, base: {}, value: user, user }] })
    const guard = createSettingsGuard(ctx as never)
    expect(guard()).toEqual({ safe: false, reason: 'user_layer_dirty' })
    user = { model: 'kept' }
    expect(guard()).toEqual({ safe: true })
    user = { ...DIRTY_USER }
    expect(guard()).toEqual({ safe: false, reason: 'user_layer_dirty' })
  })

  it('reports read_only_dirty / purge_failed through the same dynamic guard', () => {
    expect(createSettingsGuard(fakeCtx({ writable: false }) as never)())
      .toEqual({ safe: false, reason: 'read_only_dirty' })
    expect(createSettingsGuard(fakeCtx({ describe: () => [] }) as never)())
      .toEqual({ safe: false, reason: 'purge_failed' })
    // A failed startup purge keeps its reason while the layer stays dirty …
    const guard = createSettingsGuard(fakeCtx({}) as never, { purgeFailed: true })
    expect(guard()).toEqual({ safe: false, reason: 'purge_failed' })
    // … and a clean scan clears it for good.
    expect(createSettingsGuard(fakeCtx({ user: {} }) as never, { purgeFailed: true })())
      .toEqual({ safe: true })
  })

  it('scans every nesting level for a forbidden key', () => {
    expect(findForbiddenSettingsKeys({ bots: [{ id: 'a', feishuCliPath: '/bin/lark' }] })).toEqual(['feishuCliPath'])
    expect(findForbiddenSettingsKeys({ appSecretRef: 'REF' })).toEqual([])
  })
})
