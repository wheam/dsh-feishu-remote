import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

function loadClientExports(
  requireModule: (name: string) => unknown = () => ({}),
  sandboxConsole: unknown = console,
): Record<string, unknown> {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  let loaded: Record<string, unknown> | undefined
  const sandbox = {
    console: sandboxConsole,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    window: {
      __ModuleLoader__: {
        load: (definition: { factory: (require: (name: string) => unknown) => Record<string, unknown> }) => {
          loaded = definition.factory(requireModule)
        },
      },
    },
  }
  vm.runInNewContext(source, sandbox)
  if (loaded === undefined) throw new Error('client module did not load')
  return loaded
}

const client = loadClientExports()
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

type Row = Record<string, unknown>
type Issue = { botId: string; field: string; message: string }
type StatusModel = { tone: string; label: string; detail: string; params?: Record<string, unknown>; raw?: string; action?: string }

const normalizeBotRow = client.normalizeBotRow as (raw: unknown) => Row
const projectLegacyRow = client.projectLegacyRow as (config: unknown) => Row
const botStatusModel = client.botStatusModel as (bot: Row, status: unknown, mode: string) => StatusModel
const botRowSummary = client.botRowSummary as (bot: Row, status: unknown) => { key: string; params?: Record<string, unknown> }[]
const botIdentity = client.botIdentity as (bot: Row, status: unknown) => Record<string, unknown>
const buildBotsPayload = client.buildBotsPayload as (rows: Row[], max: unknown, revision: number) => Record<string, unknown>
const buildLegacyPayload = client.buildLegacyPayload as (original: Row | undefined, draft: Row, revision: number) => Record<string, unknown> | undefined
const changedBotKeys = client.changedBotKeys as (original: Row | undefined, draft: Row) => string[]
const draftChangeCount = client.draftChangeCount as (originals: Row[], drafts: Row[], originalMax: number, max: number) => number
const validateBotRows = client.validateBotRows as (rows: Row[], max: number, mode: string) => Issue[]
const friendlyError = client.friendlyError as (error: unknown) => { key: string; raw: string } | undefined
const maskId = client.maskId as (value: string) => string
const formatClock = client.formatClock as (ts: number, now?: number) => { sameDay: boolean; clock: string; date: string } | undefined

/** A complete, valid multi-bot row; individual tests override single fields. */
function row(patch: Row = {}): Row {
  return normalizeBotRow({
    id: 'curio-ops',
    appId: 'cli_aa00abefea385be9',
    appSecretRef: 'DSH_FEISHU_CURIO_SECRET',
    allowedOpenIds: ['ou_1234567890abcd'],
    defaultWorkspace: '/Users/me/curio',
    ...patch,
  })
}

describe('legacy Feishu transcript display', () => {
  const split = client.splitLegacyFeishuMessageText as (text: string) => string | undefined

  it('removes one valid context frame while preserving the exact user prompt', () => {
    const frame = JSON.stringify({
      type: 'feishu-context',
      count: 1,
      messages: [{ x: '带有 } 和 \\"引号\\" 的历史' }],
    })
    expect(split(`${frame}现在测试负责人是谁？`)).toBe('现在测试负责人是谁？')
  })

  it('ignores malformed, unrelated, and context-only text', () => {
    expect(split('{"type":"feishu-context"坏数据')).toBeUndefined()
    expect(split('{"type":"something-else"}用户问题')).toBeUndefined()
    expect(split('{"type":"feishu-context"}')).toBeUndefined()
    expect(split('普通用户问题')).toBeUndefined()
  })
})

describe('single-bot (root config) projection', () => {
  it('projects the flat root fields as ONE editable row with split lists', () => {
    expect(projectLegacyRow({
      appId: 'cli_aa00a7baf7f8dbe8',
      appSecretRef: 'DSH_FEISHU_APP_SECRET',
      brand: 'lark',
      allowedOpenIds: 'ou_a, ou_b',
      allowedChatIds: '',
      requireMention: false,
      workspacePolicy: 'locked',
      defaultWorkspace: '/tmp/w',
      maxLiveAgents: 4,
      contextMode: 'off',
    })).toEqual({
      id: 'legacy',
      enabled: true,
      appId: 'cli_aa00a7baf7f8dbe8',
      appSecretRef: 'DSH_FEISHU_APP_SECRET',
      brand: 'lark',
      allowedOpenIds: ['ou_a', 'ou_b'],
      allowedChatIds: [],
      allowAllUsers: false,
      requireMention: false,
      defaultWorkspace: '/tmp/w',
      workspacePolicy: 'locked',
      agentPreset: '',
      profileFile: '',
      provider: '',
      model: '',
      maxLiveAgents: 4,
      contextMode: 'off',
    })
  })

  it('shows the scan card instead of a row when nothing is bound yet', () => {
    const botRowsFrom = client.botRowsFrom as (snapshot: unknown) => Row[]
    expect(botRowsFrom({ mode: 'legacy', config: { appId: '', appSecretRef: 'REF' } })).toEqual([])
    expect(botRowsFrom({ mode: 'legacy', config: { appId: 'cli_a', appSecretRef: 'REF' } })).toHaveLength(1)
    expect(botRowsFrom({ mode: 'multi', config: { bots: [{ id: 'bot-a' }, { id: 'bot-b' }] } }).map(bot => bot.id))
      .toEqual(['bot-a', 'bot-b'])
  })

  it('never carries host-only or shape-revealing keys into the row', () => {
    const projected = projectLegacyRow({ appId: 'cli_x', statePath: '/host', feishuCliPath: '/bin/lark', bots: [] })
    expect(projected).not.toHaveProperty('statePath')
    expect(projected).not.toHaveProperty('feishuCliPath')
    expect(projected).not.toHaveProperty('sessionNamespace')
    expect(projected).not.toHaveProperty('bots')
  })
})

describe('bot status model', () => {
  it('ranks disabled above every other state, but only where disabling is real', () => {
    const off = row({ enabled: false, appId: '', appSecretRef: '' })
    expect(botStatusModel(off, undefined, 'multi')).toMatchObject({ tone: 'off', label: 'status.disabled' })
    // A single-bot config has no enabled flag to project, so the row keeps
    // reporting the real problem instead of a state the user cannot toggle.
    expect(botStatusModel(off, undefined, 'legacy')).toMatchObject({ tone: 'err', label: 'status.incomplete' })
  })

  it('reports an incomplete binding before any runtime state', () => {
    expect(botStatusModel(row({ appSecretRef: '' }), { connected: true }, 'multi'))
      .toMatchObject({ tone: 'err', label: 'status.incomplete' })
  })

  it('waits for the first runtime poll instead of claiming a failure', () => {
    expect(botStatusModel(row(), undefined, 'multi')).toMatchObject({ tone: 'off', label: 'status.loading' })
  })

  it('keeps the raw runtime error out of the primary line but available for 详情', () => {
    expect(botStatusModel(row(), { status: 'degraded', error: 'ws 1006', connected: false }, 'multi')).toEqual({
      tone: 'err', label: 'status.failed', detail: 'status.failedDetail', raw: 'ws 1006', action: 'retry',
    })
  })

  it('flags a connected bot that nobody is allowed to use', () => {
    expect(botStatusModel(row({ allowedOpenIds: [] }), { connected: true, liveAgents: 0 }, 'multi'))
      .toMatchObject({ tone: 'warn', label: 'status.noUsers', action: 'users' })
    expect(botStatusModel(row({ allowedOpenIds: [], allowAllUsers: true }), { connected: true, liveAgents: 0 }, 'multi'))
      .toMatchObject({ tone: 'ok', label: 'status.connected' })
  })

  it('reports live task count, then connecting, then offline', () => {
    expect(botStatusModel(row(), { connected: true, liveAgents: 2 }, 'multi'))
      .toEqual({ tone: 'ok', label: 'status.connected', detail: 'status.connectedDetail', params: { live: 2 } })
    expect(botStatusModel(row(), { connected: false, status: 'starting' }, 'multi'))
      .toMatchObject({ tone: 'warn', label: 'status.connecting' })
    expect(botStatusModel(row(), { connected: false, status: 'stopping' }, 'multi'))
      .toMatchObject({ tone: 'err', label: 'status.offline', action: 'retry' })
  })

  it('returns dictionary keys, never raw Chinese, so both locales work', () => {
    const model = botStatusModel(row(), { connected: true, liveAgents: 0 }, 'multi')
    expect(model.label.startsWith('status.')).toBe(true)
    expect(model.detail.startsWith('status.')).toBe(true)
  })
})

describe('bot list row summary', () => {
  it('summarises workspace, who can use it, and running tasks', () => {
    expect(botRowSummary(row({ workspacePolicy: 'locked', allowedChatIds: ['oc_a'] }), { connected: true, liveAgents: 2 }))
      .toEqual([
        { key: 'row.workspaceLocked', params: { path: '/Users/me/curio' } },
        { key: 'row.users', params: { count: 1 } },
        { key: 'row.chats', params: { count: 1 } },
        { key: 'row.tasks', params: { count: 2 } },
      ])
  })

  it('says what is missing when the bot is not usable yet', () => {
    expect(botRowSummary(row({ defaultWorkspace: '', allowedOpenIds: [] }), undefined))
      .toEqual([{ key: 'row.workspaceUnset' }, { key: 'row.noUsers' }])
  })

  it('names a bot from its live name, then its App suffix, then as new', () => {
    expect(botIdentity(row(), { botName: '探所运维' })).toMatchObject({ name: '探所运维' })
    expect(botIdentity(row(), undefined)).toMatchObject({ key: 'row.unnamed', params: { suffix: '385be9' } })
    expect(botIdentity(row({ appId: '' }), undefined)).toMatchObject({ key: 'row.newBot' })
  })

  it('masks pasted ids visually while keeping the full value available', () => {
    expect(maskId('ou_1234567890abcd')).toBe('ou_…abcd')
    expect(maskId('ou_short')).toBe('ou_short')
  })

  it('formats the last connection of THIS run as a clock time', () => {
    const at = new Date(2026, 7, 23, 21, 48).getTime()
    expect(formatClock(at, new Date(2026, 7, 23, 22, 10).getTime())).toEqual({ sameDay: true, clock: '21:48', date: '8-23' })
    expect(formatClock(at, new Date(2026, 7, 24, 9, 0).getTime())).toMatchObject({ sameDay: false })
    expect(formatClock(Number.NaN)).toBeUndefined()
  })
})

describe('save payload builders', () => {
  it('sends bots[] list fields as ARRAYS and drops everything the GUI does not own', () => {
    const payload = buildBotsPayload(
      [normalizeBotRow({ id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', allowedOpenIds: 'ou_a, ou_b', allowedChatIds: ['oc_a'], statePath: '/host-only', contextBackend: 'cli', sessionNamespace: 'app' })],
      3,
      7,
    )
    expect(payload.revision).toBe(7)
    expect(payload.maxTotalLiveAgents).toBe(3)
    const bot = (payload.bots as Row[])[0]!
    expect(bot.allowedOpenIds).toEqual(['ou_a', 'ou_b'])
    expect(bot.allowedChatIds).toEqual(['oc_a'])
    expect(bot.id).toBe('bot-a')
    expect(bot).not.toHaveProperty('statePath')
    expect(bot).not.toHaveProperty('contextBackend')
    expect(bot).not.toHaveProperty('sessionNamespace')
  })

  it('sends only the CHANGED root keys, with list fields as comma-separated STRINGS', () => {
    const original = projectLegacyRow({ appId: 'cli_a', appSecretRef: 'REF', allowedOpenIds: 'ou_a', defaultWorkspace: '/a' })
    const draft = { ...original, allowedOpenIds: ['ou_a', 'ou_b'], workspacePolicy: 'locked' }
    expect(buildLegacyPayload(original, draft, 11)).toEqual({
      revision: 11,
      config: { allowedOpenIds: 'ou_a,ou_b', workspacePolicy: 'locked' },
    })
  })

  it('never sends a root save for keys the flat schema has no counterpart for', () => {
    const original = projectLegacyRow({ appId: 'cli_a', appSecretRef: 'REF' })
    const draft = { ...original, id: 'renamed', enabled: false }
    expect(buildLegacyPayload(original, draft, 1)).toBeUndefined()
  })

  it('treats a re-serialised but equal list as unchanged', () => {
    const original = projectLegacyRow({ appId: 'cli_a', appSecretRef: 'REF', allowedOpenIds: 'ou_a, ou_b' })
    expect(buildLegacyPayload(original, { ...original }, 1)).toBeUndefined()
    expect(changedBotKeys(original, { ...original, allowedOpenIds: ['ou_a', 'ou_b'] })).toEqual([])
  })
})

describe('draft diffing', () => {
  it('counts each changed field once and ignores the bot key itself', () => {
    const original = row()
    expect(changedBotKeys(original, { ...original, defaultWorkspace: '/x', enabled: false })).toEqual(['enabled', 'defaultWorkspace'])
    expect(changedBotKeys(undefined, original)).not.toContain('id')
  })

  it('counts removed bots and the global limit in the unsaved-change badge', () => {
    const a = row({ id: 'bot-a' })
    const b = row({ id: 'bot-b' })
    expect(draftChangeCount([a, b], [a, b], 0, 0)).toBe(0)
    expect(draftChangeCount([a, b], [a], 0, 0)).toBe(1)
    expect(draftChangeCount([a], [{ ...a, model: 'm' }], 0, 2)).toBe(2)
  })
})

describe('field-level validation', () => {
  it('reports each problem against its own field instead of one generic sentence', () => {
    const issues = validateBotRows(
      [normalizeBotRow({ id: 'Bad Id', appId: '', appSecretRef: '', workspacePolicy: 'locked', maxLiveAgents: -1 })],
      -1,
      'multi',
    )
    expect(issues.map(issue => `${issue.field}:${issue.message}`)).toEqual([
      'maxTotalLiveAgents:invalid.number',
      'id:invalid.id',
      'appId:invalid.appId',
      'appSecretRef:invalid.appSecretRef',
      'defaultWorkspace:invalid.lockedWorkspace',
      'maxLiveAgents:invalid.number',
    ])
  })

  it('rejects duplicates in multi mode and skips the id rule for the projected row', () => {
    const duplicates = validateBotRows([row({ id: 'bot-a' }), row({ id: 'bot-a' })], 0, 'multi')
    expect(duplicates.map(issue => issue.message)).toEqual(['invalid.duplicateId', 'invalid.duplicateApp'])
    expect(validateBotRows([projectLegacyRow({ appId: 'cli_a', appSecretRef: 'REF' })], 0, 'legacy')).toEqual([])
  })

  it('accepts a complete bot', () => {
    expect(validateBotRows([row()], 0, 'multi')).toEqual([])
  })
})

describe('backend error copy', () => {
  it('maps known messages and codes to friendly keys and keeps the raw text for 详情', () => {
    expect(friendlyError('设置已被其他操作更新；已获取最新版本，请检查当前编辑后重试。'))
      .toEqual({ key: 'err.conflict', raw: '设置已被其他操作更新；已获取最新版本，请检查当前编辑后重试。' })
    expect(friendlyError(new Error('不能移除最后一个机器人：如果暂时不用，请把它停用'))?.key).toBe('err.lastBot')
    expect(friendlyError(new Error('bot x 的 credential ref REF 尚未配置'))?.key).toBe('err.credential')
    expect(friendlyError(Object.assign(new Error('another onboarding is running'), { code: 'busy' }))?.key).toBe('err.busy')
  })

  it('never leaves a raw English backend string as the primary line', () => {
    const failure = friendlyError(new Error('TypeError: cannot read properties of undefined'))
    expect(failure).toEqual({ key: 'err.generic', raw: 'TypeError: cannot read properties of undefined' })
    expect(friendlyError(undefined)).toBeUndefined()
  })
})

describe('settings copy rules', () => {
  const dictionaries = source.slice(source.indexOf('const en = {'), source.indexOf('// ------------------------------------------------ legacy transcript display'))

  it('keeps implementation vocabulary out of every user-visible string (docs/18 §2.4)', () => {
    for (const banned of ['legacy', '主机器人', 'namespace', '凭据引用', 'loopback', 'revision']) {
      expect(dictionaries.toLowerCase()).not.toContain(banned.toLowerCase())
    }
  })

  it('says the one approved thing on a non-Host page', () => {
    expect(dictionaries).toContain('"page.remote": "此页面不是在 Host 本机打开，无法管理机器人"')
  })

  it('translates every bot-editor string instead of hardcoding zh in the components', () => {
    const components = source.slice(0, source.indexOf('const en = {'))
    expect(components).not.toMatch(/children: "[^"]*[一-龥]/u)
    expect(components).not.toContain('"话题首次使用需要 @机器人"')
  })

  it('uses theme tokens only, so labels stay readable in light and dark themes', () => {
    // The QR quiet zone is the single deliberate literal (a QR code must sit on
    // white in both themes); no text or surface colour may be hardcoded.
    expect(source).not.toMatch(/color:\s*#[0-9a-f]/iu)
    expect(source).toContain('color:var(--dsw-alias-label-primary)')
  })

  it('drops the retired flat form, staged writes, and nested disclosures', () => {
    expect(source).not.toContain('FIELD_GROUPS')
    expect(source).not.toContain('LegacyAdvancedSettings')
    expect(source).not.toContain('CardForm')
    expect(source).not.toContain('contextBackend:')
    expect(source).not.toContain('progressUpdateMs')
    expect(source).not.toContain('commandAllowlist')
    expect(source).not.toContain('workspaceRoot')
  })
})

describe('save routing through the admin controller', () => {
  type Call = { endpoint: string; payload: Record<string, unknown> }

  async function mountAdmin(editor: Record<string, unknown>) {
    const calls: Call[] = []
    const disposers: (() => void)[] = []
    const store = <T,>(initial: T) => {
      let value = initial
      return { get: () => value, set: (next: T) => { value = next }, subscribe: () => () => undefined }
    }
    const requireModule = (name: string) => name === '@deepseek-ai/dsh-client-runtime/client'
      ? { createSnapshotStore: store }
      : {}
    const registered: Record<string, unknown>[] = []
    const apply = loadClientExports(requireModule).apply as (ctx: unknown) => void
    apply({
      effect: (setup: () => unknown) => { const stop = setup(); if (typeof stop === 'function') disposers.push(stop as () => void) },
      locale: { register: () => undefined, bind: () => (key: string) => key },
      settingsScope: { bind: () => ({ subscribe: () => () => undefined, getSnapshot: () => ({ status: 'ready', writable: true }) }) },
      connection: {
        isLoopback: true,
        rpc: {
          call: async (_channel: string, endpoint: string, payload: Record<string, unknown>) => {
            calls.push({ endpoint, payload })
            if (endpoint === 'settings/editor-snapshot') return { ok: true, value: editor }
            if (endpoint === 'bots/status') return { ok: true, value: { bots: [] } }
            return { ok: true, value: editor }
          },
        },
      },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: Record<string, unknown>) => { registered.push(options); return () => undefined },
      },
    })
    const section = registered.find(options => options.name === 'settings.section')!
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
    const api = (section.inject as () => Record<string, unknown>)()
    return {
      calls,
      api,
      state: () => (api.hooks as { feishuBotAdmin: { get: () => Record<string, unknown> } }).feishuBotAdmin.get(),
      stop: () => { for (const dispose of disposers) dispose() },
    }
  }

  it('routes a single-bot edit to settings/save-legacy with only the changed root key', async () => {
    const mounted = await mountAdmin({
      revision: 9, writable: true, mode: 'legacy',
      config: { appId: 'cli_a', appSecretRef: 'REF', allowedOpenIds: 'ou_a', defaultWorkspace: '/a', bots: [] },
    })
    ;(mounted.api.editBot as (id: string, field: string, value: unknown) => void)('legacy', 'allowedOpenIds', ['ou_a', 'ou_b'])
    await (mounted.api.saveBots as () => Promise<boolean>)()
    const save = mounted.calls.find(call => call.endpoint.startsWith('settings/save'))!
    expect(save.endpoint).toBe('settings/save-legacy')
    expect(save.payload).toEqual({ revision: 9, config: { allowedOpenIds: 'ou_a,ou_b' } })
    mounted.stop()
  })

  it('routes a multi-bot edit to settings/save-bots and keeps every stored bot id', async () => {
    const mounted = await mountAdmin({
      revision: 4, writable: true, mode: 'multi',
      config: {
        maxTotalLiveAgents: 2,
        bots: [
          { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', allowedOpenIds: ['ou_a'] },
          { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', allowedOpenIds: ['ou_b'] },
        ],
      },
    })
    ;(mounted.api.editBot as (id: string, field: string, value: unknown) => void)('bot-b', 'model', 'deepseek-v4-pro')
    await (mounted.api.saveBots as () => Promise<boolean>)()
    const save = mounted.calls.find(call => call.endpoint.startsWith('settings/save'))!
    expect(save.endpoint).toBe('settings/save-bots')
    expect(save.payload.revision).toBe(4)
    expect(save.payload.maxTotalLiveAgents).toBe(2)
    const saved = save.payload.bots as Record<string, unknown>[]
    expect(saved.map(bot => bot.id)).toEqual(['bot-a', 'bot-b'])
    expect(saved[1]!.model).toBe('deepseek-v4-pro')
    mounted.stop()
  })

  it('refuses to remove the only bot and never converts the config shape on a plain save', async () => {
    const mounted = await mountAdmin({
      revision: 1, writable: true, mode: 'legacy',
      config: { appId: 'cli_a', appSecretRef: 'REF', bots: [] },
    })
    expect(await (mounted.api.removeBot as (id: string) => Promise<boolean>)('legacy')).toBe(false)
    expect(mounted.calls.some(call => call.endpoint === 'settings/save-bots')).toBe(false)
    expect(mounted.calls.some(call => call.endpoint === 'settings/convert-legacy')).toBe(false)
    mounted.stop()
  })
})

describe('settings slot registration isolation', () => {
  type SlotOptions = Record<string, unknown>

  function runApply(throwingSlot: string | undefined) {
    const registered: SlotOptions[] = []
    const errors: string[] = []
    const sandboxConsole = {
      ...console,
      error: (...args: unknown[]) => { errors.push(args.map(String).join(' ')) },
    }
    // Only createSnapshotStore is reached during apply(); react is never rendered here.
    const requireModule = (name: string) => name === '@deepseek-ai/dsh-client-runtime/client'
      ? {
          createSnapshotStore: (initial: unknown) => {
            let value = initial
            return { get: () => value, set: (next: unknown) => { value = next }, subscribe: () => () => undefined }
          },
        }
      : {}
    const apply = loadClientExports(requireModule, sandboxConsole).apply as (ctx: unknown) => void
    const scope = {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', writable: true, value: {}, base: {}, user: {}, secrets: [] }),
      set: async () => undefined,
      unset: async () => undefined,
    }
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: { register: () => undefined, bind: () => (key: string) => key },
      settingsScope: { bind: () => scope },
      // isLoopback:false keeps both controllers' mount() off their polling timers.
      connection: { isLoopback: false, rpc: { call: async () => ({ ok: false, error: { message: 'offline' } }) } },
      slots: {
        inject: (name: string, register: () => unknown) => {
          if (name === throwingSlot) throw new Error(`slot "${name}" is unavailable`)
          return register()
        },
        register: (options: SlotOptions) => { registered.push(options); return () => undefined },
      },
    }
    apply(ctx)
    return { registered, errors, names: registered.map(options => options.name) }
  }

  it('registers both settings slots with their required keyed/list identifiers', () => {
    const { registered, names, errors } = runApply(undefined)
    expect(names).toEqual(['settings.plugin.item', 'settings.section'])
    // rc.7+ keyed slot contract (docs/11): the plugin item must carry options.key.
    expect(registered[0]).toMatchObject({ name: 'settings.plugin.item', key: 'feishu-remote' })
    expect(registered[1]).toMatchObject({ name: 'settings.section', id: 'feishu-remote', order: 18 })
    expect(errors).toEqual([])
  })

  it('still registers settings.section when the plugin item slot throws', () => {
    const { names, errors } = runApply('settings.plugin.item')
    expect(names).toEqual(['settings.section'])
    expect(errors.some(line => line.includes('settings.plugin.item'))).toBe(true)
  })

  it('still registers settings.plugin.item when the section slot throws', () => {
    const { names, errors } = runApply('settings.section')
    expect(names).toEqual(['settings.plugin.item'])
    expect(errors.some(line => line.includes('settings.section'))).toBe(true)
  })

  it('uses a short nav label for the section so the 800px dialog does not truncate it', () => {
    const { registered } = runApply(undefined)
    const label = registered[1]!.label as () => string
    expect(label()).toBe('settings.navLabel')
    expect(source).toContain('"settings.navLabel": "飞书遥控"')
    expect(source).toContain('"settings.navLabel": "Feishu Remote"')
  })
})
