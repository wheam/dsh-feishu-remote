import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

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
type StatusModel = { tone: string; label: string; detail: string; params?: Record<string, unknown>; safeDetail?: string; action?: string }

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
const friendlyError = client.friendlyError as (error: unknown) => { key: string; detail?: string } | undefined
const safeText = client.safeText as (value: unknown) => string | undefined
const guiBlocked = client.guiBlocked as (admin: unknown) => boolean
const guiBlockedKey = client.guiBlockedKey as (reason: unknown) => string
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

  it('separates a configuration problem from a connection problem (review M4)', () => {
    expect(botStatusModel(row(), { connected: false, reasonCode: 'credential_missing', detail: '还没有保存这个机器人的 Secret。' }, 'multi'))
      .toEqual({
        tone: 'err', label: 'status.misconfigured',
        detail: 'status.reason.credentialMissing', safeDetail: '还没有保存这个机器人的 Secret。',
      })
    const configReasons = [
      'duplicate_state_path', 'duplicate_inbound_dir', 'duplicate_app_id', 'duplicate_bot_id',
      'duplicate_session_namespace', 'invalid_bot_id', 'workspace_unavailable',
      'preset_unavailable', 'profile_unreadable', 'config_invalid',
    ]
    for (const reasonCode of configReasons) {
      const model = botStatusModel(row(), { connected: false, reasonCode }, 'multi')
      expect(model.tone).toBe('err')
      expect(model.label).toBe('status.misconfigured')
      expect(model.detail.startsWith('status.reason.')).toBe(true)
      expect(enDictionary[model.detail], model.detail).toBeTypeOf('string')
      expect(model.action).toBeUndefined()
    }
  })

  it('offers a retry only where the page renders one, and never a raw error string', () => {
    expect(botStatusModel(row(), { connected: false, reasonCode: 'connect_failed', detail: '连接被服务端关闭。' }, 'multi'))
      .toEqual({
        tone: 'err', label: 'status.failed', detail: 'status.failedDetail',
        safeDetail: '连接被服务端关闭。', action: 'retry',
      })
    // Still recognised when the Host only reports the coarse runtime state.
    expect(botStatusModel(row(), { connected: false, status: 'degraded' }, 'multi'))
      .toMatchObject({ tone: 'err', label: 'status.failed', action: 'retry' })
    expect(botStatusModel(row(), { connected: false, terminalFailure: true }, 'multi'))
      .toMatchObject({ tone: 'err', label: 'status.failed', action: 'retry' })
    // No `raw` channel exists any more — nothing unstructured can be rendered.
    expect(botStatusModel(row(), { connected: false, status: 'degraded', error: 'ws 1006 /Users/me/.dsh/state.json' }, 'multi'))
      .not.toHaveProperty('raw')
  })

  it('reports the Host-side rate limit and a Host-side disable without inventing an action', () => {
    expect(botStatusModel(row(), { connected: false, reasonCode: 'rate_limited' }, 'multi'))
      .toEqual({ tone: 'warn', label: 'status.rateLimited', detail: 'status.rateLimitedDetail' })
    expect(botStatusModel(row(), { connected: false, reasonCode: 'disabled' }, 'multi'))
      .toEqual({ tone: 'off', label: 'status.disabled', detail: 'status.disabledDetail' })
  })

  it('redacts an implementation word or path that leaks into the safe detail', () => {
    const model = botStatusModel(row(), {
      connected: false, reasonCode: 'profile_unreadable',
      detail: '无法读取 /Users/me/.dsh/bot-profiles/curio.md（revision 12）',
    }, 'multi')
    expect(model.safeDetail).not.toContain('/Users/me')
    expect(model.safeDetail?.toLowerCase()).not.toContain('revision')
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
    // 未连接 carries NO action: the page renders no button there (review M4).
    expect(botStatusModel(row(), { connected: false, status: 'stopping' }, 'multi'))
      .toEqual({ tone: 'err', label: 'status.offline', detail: 'status.offlineDetail' })
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
  it('maps every structured admin and onboarding code to friendly copy', () => {
    const cases: [string, string][] = [
      ['conflict', 'err.conflict'], ['read_only', 'err.readOnly'], ['legacy_mode', 'err.shapeChanged'],
      ['multi_mode', 'err.shapeChanged'], ['unknown_bot_id', 'err.unknownBot'], ['last_bot', 'err.lastBot'],
      ['validation', 'err.validation'], ['credential_missing', 'err.credential'],
      ['settings_unsafe', 'err.settingsUnsafe'], ['internal', 'err.generic'], ['bad_request', 'err.generic'],
      ['busy', 'err.busy'], ['duplicate_app', 'err.duplicateApp'], ['multi_bot_required', 'err.shapeChanged'],
      ['settings_unavailable', 'err.settingsUnsafe'], ['missing_app', 'err.notFound'],
      ['expired', 'err.expired'], ['cancelled', 'err.cancelled'],
    ]
    for (const [code, key] of cases) {
      expect(friendlyError(Object.assign(new Error('x'), { code })), code).toMatchObject({ key })
    }
  })

  it('carries the Host sentence only when it arrived with a structured code', () => {
    expect(friendlyError(Object.assign(new Error('这个飞书应用已经添加过了。'), { code: 'duplicate_app' })))
      .toEqual({ key: 'err.duplicateApp', detail: '这个飞书应用已经添加过了。' })
    // An unstructured throw has no safe sentence, so nothing is rendered from it.
    expect(friendlyError(new Error('TypeError: cannot read properties of undefined')))
      .toEqual({ key: 'err.generic' })
    expect(friendlyError('设置已被其他操作更新')).toEqual({ key: 'err.generic' })
    expect(friendlyError(undefined)).toBeUndefined()
  })

  it('still recognises a transport failure without echoing its text', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toEqual({ key: 'err.offline' })
    expect(friendlyError(new Error('NetworkError when attempting to fetch resource.'))).toEqual({ key: 'err.offline' })
  })
})

const BANNED_WORDS = ['legacy', '主机器人', 'namespace', '凭据引用', 'loopback', 'revision', '内部名称', 'wire']

describe('redacting Host text before it reaches the screen', () => {
  it('redacts a whole implementation word, never a longer word that contains one', () => {
    expect(safeText('wireless 连接不稳定')).toBe('wireless 连接不稳定')
    expect(safeText('revision 12 冲突')).toBe('… 12 冲突')
  })

  it('keeps a link the user can follow, and still redacts a local path', () => {
    expect(safeText('详见 https://example.com/help 页面')).toBe('详见 https://example.com/help 页面')
    // The banned vocabulary pass must not chew up a link's own host or path.
    expect(safeText('详见 https://wire.example.com/revision/12')).toBe('详见 https://wire.example.com/revision/12')
    expect(safeText('读取 /Users/me/.dsh/settings.json 失败')).toBe('读取 … 失败')
    // `file://…` is a local path wearing a scheme, so it stays redacted.
    expect(safeText('读取 file:///Users/me/.dsh/settings.json 失败')).not.toContain('/Users/')
  })
})

describe('settings copy rules', () => {
  const dictionaries = source.slice(source.indexOf('const en = {'), source.indexOf('// ------------------------------------------------ legacy transcript display'))

  it('keeps implementation vocabulary out of every user-visible string (docs/18 §2.4)', () => {
    for (const banned of BANNED_WORDS) {
      expect(dictionaries.toLowerCase()).not.toContain(banned.toLowerCase())
    }
  })

  it('translates every key in both locales', () => {
    const keysOf = (block: string) => new Set([...block.matchAll(/"([\w.]+)":/gu)].map(match => match[1]!))
    const enKeys = keysOf(dictionaries.slice(0, dictionaries.indexOf('const zh = {')))
    const zhKeys = keysOf(dictionaries.slice(dictionaries.indexOf('const zh = {')))
    expect([...enKeys].filter(key => !zhKeys.has(key))).toEqual([])
    expect([...zhKeys].filter(key => !enKeys.has(key))).toEqual([])
    for (const key of ['gui.blocked.purgeFailed', 'gui.blocked.readOnlyDirty', 'gui.blocked.userLayerDirty', 'gui.blocked.generic']) {
      expect(enKeys.has(key), key).toBe(true)
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
    // EVERY custom property must come from the host alias layer: `--dsw-specific-*`
    // is an internal token that is not guaranteed to exist in both themes.
    const tokens = [...source.matchAll(/var\((--[\w-]+)/gu)].map(match => match[1]!)
    expect(tokens.length).toBeGreaterThan(20)
    for (const token of new Set(tokens)) expect(token, token).toMatch(/^--dsw-alias-/u)
  })

  it('sends a shared data folder to the file the user can actually edit, not to a field that does not exist', () => {
    for (const key of ['status.reason.duplicateStatePath', 'status.reason.duplicateInboundDir']) {
      expect(enDictionary[key], key).toContain('cordis.patch.yml')
      expect(zhDictionary[key], key).toContain('cordis.patch.yml')
    }
    // 「单独设置」 promised a per-bot field the redesigned GUI never had.
    expect(dictionaries).not.toContain('单独设置')
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

// ---------------------------------------------------------------- render harness
type Node = { type: unknown; props: Record<string, unknown>; key?: unknown }

/** Load the module with just enough of react/jsx-runtime to build a plain tree. */
function loadRenderableClient(): Record<string, unknown> {
  const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown) => ({ type, props, key })
  const reactStub = {
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
  }
  return loadClientExports((name) => {
    if (name === 'react') return reactStub
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === '@deepseek-ai/dsh-client-runtime/client') {
      return { createSnapshotStore: (initial: unknown) => ({ get: () => initial, set: () => undefined, subscribe: () => () => undefined }) }
    }
    return {}
  })
}

const renderable = loadRenderableClient()

function walk(node: unknown, visit: (node: Node) => void): void {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return }
  if (typeof node !== 'object') return
  const element = node as Node
  if (!('type' in element)) return
  visit(element)
  walk((element.props ?? {}).children, visit)
}

function inspect(tree: unknown) {
  const types: unknown[] = []
  const text: string[] = []
  const nodes: Node[] = []
  walk(tree, node => {
    nodes.push(node)
    types.push(node.type)
    const children = (node.props ?? {}).children
    for (const child of Array.isArray(children) ? children : [children]) {
      if (typeof child === 'string') text.push(child)
    }
  })
  return { types, text, nodes }
}

/** Every `"key": "copy"` pair of one dictionary block, so tests read the OUTPUT. */
function parseDictionary(block: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const match of block.matchAll(/"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/gu)) entries[match[1]!] = match[2]!
  return entries
}

const dictionaryBlock = source.slice(source.indexOf('const en = {'), source.indexOf('// ------------------------------------------------ legacy transcript display'))
const enDictionary = parseDictionary(dictionaryBlock.slice(0, dictionaryBlock.indexOf('const zh = {')))
const zhDictionary = parseDictionary(dictionaryBlock.slice(dictionaryBlock.indexOf('const zh = {')))

describe('no implementation vocabulary reaches the rendered OUTPUT (review M6)', () => {
  // Representative of what a Host could throw before the copy layer sees it.
  const failures: unknown[] = [
    Object.assign(new Error('settings/save-bots: revision 12 conflicts with the legacy root config at /Users/me/.dsh/settings.json'), { code: 'conflict' }),
    Object.assign(new Error('bot curio-ops namespace 冲突：/Users/me/.dsh/feishu/state.json 已被主机器人占用'), { code: 'validation' }),
    Object.assign(new Error('凭据引用 DSH_FEISHU_SECRET 写入 /Users/me/.dsh 失败'), { code: 'credential_missing' }),
    Object.assign(new Error('loopback only'), { code: 'read_only' }),
    Object.assign(new Error('wire payload rejected'), { code: 'internal' }),
    new Error('TypeError: cannot read properties of undefined at /Users/me/dsh/lib/admin.js:120:5'),
  ]

  it('renders friendly copy plus a redacted Host sentence, never the raw throw', () => {
    for (const locale of [enDictionary, zhDictionary]) {
      for (const error of failures) {
        const failure = friendlyError(error)!
        expect(locale[failure.key], failure.key).toBeTypeOf('string')
        const output = `${locale[failure.key]} ${failure.detail ?? ''}`
        for (const banned of BANNED_WORDS) expect(output.toLowerCase(), banned).not.toContain(banned.toLowerCase())
        expect(output).not.toContain('/Users/')
        expect(output).not.toContain('TypeError')
        expect(output).not.toContain('admin.js')
      }
    }
  })

  it('renders a bot status without leaking the reason text it was handed', () => {
    const model = botStatusModel(row(), {
      connected: false,
      reasonCode: 'duplicate_state_path',
      detail: 'legacy 主机器人 /Users/me/.dsh/feishu/state.json 与本机器人重复（revision 3）',
    }, 'multi')
    for (const locale of [enDictionary, zhDictionary]) {
      const output = `${locale[model.label]} ${locale[model.detail]} ${model.safeDetail ?? ''}`
      for (const banned of BANNED_WORDS) expect(output.toLowerCase(), banned).not.toContain(banned.toLowerCase())
      expect(output).not.toContain('/Users/')
    }
  })
})

describe('GUI fail-closed rendering', () => {
  const Section = renderable.FeishuRemoteSection as (props: Record<string, unknown>) => unknown
  const SummaryCard = renderable.FeishuRemoteSummaryCard as (props: Record<string, unknown>) => unknown
  const guiBlockedKey = renderable.guiBlockedKey as (reason: unknown) => string

  function admin(patch: Record<string, unknown> = {}) {
    return {
      loaded: true, writable: true, mode: 'multi', revision: 2, guiSafe: false, guiReason: 'purge_failed',
      bots: [row({ id: 'bot-a' })], originalBots: [row({ id: 'bot-a' })], statuses: [],
      maxTotalLiveAgents: 0, originalMax: 0, dirty: false, issues: [], saving: false,
      ...patch,
    }
  }
  const props = (snapshot: Record<string, unknown>) => ({
    t: (key: string) => key,
    useFeishuBotAdmin: (select: (value: unknown) => unknown) => select(snapshot),
    usePersonalAgentOnboarding: () => undefined,
  })

  it('names one explanatory message per reason, in both locales', () => {
    const keys = {
      purge_failed: 'gui.blocked.purgeFailed',
      read_only_dirty: 'gui.blocked.readOnlyDirty',
      user_layer_dirty: 'gui.blocked.userLayerDirty',
    }
    for (const [reason, key] of Object.entries(keys)) expect(guiBlockedKey(reason)).toBe(key)
    expect(guiBlockedKey(undefined)).toBe('gui.blocked.generic')
    for (const key of [...Object.values(keys), 'gui.blocked.generic']) {
      expect(enDictionary[key], key).toBeTypeOf('string')
      expect(zhDictionary[key], key).toBeTypeOf('string')
    }
  })

  it('renders the section as one message with no editor and no action', () => {
    const { types, text } = inspect(Section(props(admin())))
    expect(text).toContain('gui.blocked.purgeFailed')
    expect(text.filter(line => line.startsWith('gui.blocked.'))).toHaveLength(1)
    for (const forbidden of ['button', 'input', 'details']) expect(types).not.toContain(forbidden)
  })

  it('falls back to one generic message when the Host names no reason', () => {
    const { text } = inspect(Section(props(admin({ guiReason: undefined }))))
    expect(text).toContain('gui.blocked.generic')
  })

  it('hands over to the normal bot list as soon as the Host reports it is safe', () => {
    const { types, text } = inspect(Section(props(admin({ guiSafe: true }))))
    expect(text.some(line => line.startsWith('gui.blocked.'))).toBe(false)
    expect(types.some(type => typeof type === 'function')).toBe(true)
  })

  it('reduces the summary card to the same message, with no status dots', () => {
    const { types, text } = inspect(SummaryCard(props(admin())))
    expect(text).toContain('gui.blocked.purgeFailed')
    expect(text).not.toContain('card.manageHint')
    expect(types.filter(type => type === 'span')).toHaveLength(2)
  })
})

describe('bot removal never commits the pending draft (review M2)', () => {
  const DetailPage = renderable.BotDetailPage as (props: Record<string, unknown>) => unknown
  const bot = row({ id: 'bot-a' })

  function detail(dirty: boolean) {
    return inspect(DetailPage({
      t: (key: string) => key,
      admin: {
        writable: true, mode: 'multi', dirty, saving: false, issues: [],
        bots: [bot, row({ id: 'bot-b' })], originalBots: [bot, row({ id: 'bot-b' })],
      },
      bot, busy: false, original: bot, status: undefined,
      usePersonalAgentOnboarding: () => undefined,
      onboardingStart: () => undefined, onboardingCancel: () => undefined, onboardingRetry: () => undefined,
      editBot: () => undefined, onBack: () => undefined, onSave: () => undefined,
      onDiscard: () => undefined, onRemove: () => undefined,
    }))
  }

  function removeButton(tree: ReturnType<typeof detail>) {
    return tree.nodes.find(node => node.type === 'button' && (node.props ?? {}).children === 'f.removeAction')
  }

  it('disables 「移除机器人…」 while the draft has unsaved changes, and says why', () => {
    const dirty = detail(true)
    expect(removeButton(dirty)?.props.disabled).toBe(true)
    expect(dirty.text).toContain('f.removeDirtyHint')
    expect(zhDictionary['f.removeDirtyHint']).toBe('请先保存或放弃当前修改')
  })

  it('enables it again once nothing is pending', () => {
    const clean = detail(false)
    expect(removeButton(clean)?.props.disabled).toBe(false)
    expect(clean.text).toContain('f.removeHint')
  })
})

describe('the detail page renders every action the status model claims (review M4)', () => {
  const DetailPage = renderable.BotDetailPage as (props: Record<string, unknown>) => unknown
  const bot = row({ id: 'bot-a' })

  function render(patch: Record<string, unknown>, status: unknown, retried: string[] = []) {
    return inspect(DetailPage({
      t: (key: string) => key,
      admin: {
        writable: true, mode: 'multi', dirty: false, saving: false, issues: [],
        bots: [bot, row({ id: 'bot-b' })], originalBots: [bot, row({ id: 'bot-b' })],
        ...patch,
      },
      bot: patch.bot ?? bot, busy: false, original: bot, status,
      usePersonalAgentOnboarding: () => undefined,
      onboardingStart: () => undefined, onboardingCancel: () => undefined,
      onboardingRetry: () => { retried.push('retry') },
      editBot: () => undefined, onBack: () => undefined, onSave: () => undefined,
      onDiscard: () => undefined, onRemove: () => undefined,
    }))
  }
  const buttonFor = (tree: ReturnType<typeof render>, label: string) =>
    tree.nodes.find(node => node.type === 'button' && (node.props ?? {}).children === label)

  it('renders 「重试」 for a failed connection and 「添加用户」 for an unused bot', () => {
    expect(buttonFor(render({}, { connected: false, reasonCode: 'connect_failed' }), 'status.actionRetry')).toBeDefined()
    const noUsers = render({ bot: row({ id: 'bot-a', allowedOpenIds: [] }) }, { connected: true, liveAgents: 0 })
    expect(buttonFor(noUsers, 'status.actionUsers')).toBeDefined()
  })

  it('retries through onboarding in single-bot mode', () => {
    const retried: string[] = []
    const tree = render({ mode: 'legacy', bots: [bot], originalBots: [bot] }, { connected: false, reasonCode: 'connect_failed' }, retried)
    const button = buttonFor(tree, 'status.actionRetry')!
    ;(button.props.onClick as () => void)()
    expect(retried).toEqual(['retry'])
  })

  it('renders no action at all for the states that carry none', () => {
    for (const status of [
      { connected: false, status: 'stopping' },
      { connected: false, reasonCode: 'credential_missing' },
      { connected: false, reasonCode: 'rate_limited' },
    ]) {
      const tree = render({}, status)
      expect(buttonFor(tree, 'status.actionRetry'), JSON.stringify(status)).toBeUndefined()
      expect(buttonFor(tree, 'status.actionUsers'), JSON.stringify(status)).toBeUndefined()
    }
  })
})

describe('save routing through the admin controller', () => {
  type Call = { endpoint: string; payload: Record<string, unknown> }
  type Handler = (endpoint: string, payload: Record<string, unknown>) => unknown

  async function settle(times = 8) {
    for (let tick = 0; tick < times; tick += 1) await Promise.resolve()
  }

  async function mountAdmin(initialEditor: Record<string, unknown>, handler?: Handler) {
    const calls: Call[] = []
    // The raw settings scope carries appSecret/statePath/…: binding it would put
    // the unsanitized descriptor in the browser (review B1). It must stay unused.
    let scopeBinds = 0
    const disposers: (() => void)[] = []
    let editor = initialEditor
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
      settingsScope: {
        bind: () => {
          scopeBinds += 1
          throw new Error('the raw settings scope must never be bound in the browser')
        },
      },
      connection: {
        isLoopback: true,
        rpc: {
          call: async (_channel: string, endpoint: string, payload: Record<string, unknown>) => {
            calls.push({ endpoint, payload })
            const custom = handler?.(endpoint, payload)
            if (custom !== undefined) return await custom
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
    await settle()
    const api = (section.inject as () => Record<string, unknown>)()
    return {
      calls,
      api,
      scopeBinds: () => scopeBinds,
      setEditor: (next: Record<string, unknown>) => { editor = next },
      state: () => (api.hooks as { feishuBotAdmin: { get: () => Record<string, unknown> } }).feishuBotAdmin.get(),
      stop: () => { for (const dispose of disposers) dispose() },
    }
  }

  const editBot = (api: Record<string, unknown>) => api.editBot as (id: string, field: string, value: unknown) => void
  const save = (api: Record<string, unknown>) => api.saveBots as () => Promise<boolean>
  const remove = (api: Record<string, unknown>) => api.removeBot as (id: string) => Promise<boolean>
  const botsOf = (state: Record<string, unknown>) => state.bots as Row[]
  const originalsOf = (state: Record<string, unknown>) => state.originalBots as Row[]

  function multiEditor(revision: number, bots: Record<string, unknown>[], max = 2) {
    return { revision, writable: true, mode: 'multi', guiSafe: true, config: { maxTotalLiveAgents: max, bots } }
  }
  const botA = { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', allowedOpenIds: ['ou_a'] }
  const botB = { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', allowedOpenIds: ['ou_b'] }

  it('routes a single-bot edit to settings/save-legacy with only the changed root key', async () => {
    const mounted = await mountAdmin({
      revision: 9, writable: true, mode: 'legacy', guiSafe: true,
      config: { appId: 'cli_a', appSecretRef: 'REF', allowedOpenIds: 'ou_a', defaultWorkspace: '/a', bots: [] },
    })
    editBot(mounted.api)('legacy', 'allowedOpenIds', ['ou_a', 'ou_b'])
    await save(mounted.api)()
    const call = mounted.calls.find(item => item.endpoint.startsWith('settings/save'))!
    expect(call.endpoint).toBe('settings/save-legacy')
    expect(call.payload).toEqual({ revision: 9, config: { allowedOpenIds: 'ou_a,ou_b' } })
    mounted.stop()
  })

  it('routes a multi-bot edit to settings/save-bots and keeps every stored bot id', async () => {
    const mounted = await mountAdmin(multiEditor(4, [botA, botB]))
    editBot(mounted.api)('bot-b', 'model', 'deepseek-v4-pro')
    await save(mounted.api)()
    const call = mounted.calls.find(item => item.endpoint.startsWith('settings/save'))!
    expect(call.endpoint).toBe('settings/save-bots')
    expect(call.payload.revision).toBe(4)
    expect(call.payload.maxTotalLiveAgents).toBe(2)
    const saved = call.payload.bots as Record<string, unknown>[]
    expect(saved.map(bot => bot.id)).toEqual(['bot-a', 'bot-b'])
    expect(saved[1]!.model).toBe('deepseek-v4-pro')
    mounted.stop()
  })

  it('refuses to remove the only bot and never converts the config shape on a plain save', async () => {
    const mounted = await mountAdmin({
      revision: 1, writable: true, mode: 'legacy', guiSafe: true,
      config: { appId: 'cli_a', appSecretRef: 'REF', bots: [] },
    })
    expect(await remove(mounted.api)('legacy')).toBe(false)
    expect(mounted.calls.some(item => item.endpoint === 'settings/save-bots')).toBe(false)
    expect(mounted.calls.some(item => item.endpoint === 'settings/convert-legacy')).toBe(false)
    mounted.stop()
  })

  it('never commits the pending draft when a bot is removed (review M2)', async () => {
    const mounted = await mountAdmin(multiEditor(4, [botA, botB]))
    editBot(mounted.api)('bot-a', 'model', 'draft-only')
    expect(await remove(mounted.api)('bot-b')).toBe(false)
    expect(mounted.calls.some(item => item.endpoint === 'settings/save-bots')).toBe(false)
    ;(mounted.api.discardBots as () => void)()
    await remove(mounted.api)('bot-b')
    const call = mounted.calls.find(item => item.endpoint === 'settings/save-bots')!
    const saved = call.payload.bots as Record<string, unknown>[]
    expect(saved.map(bot => bot.id)).toEqual(['bot-a'])
    expect(saved[0]!.model).toBe('')
    mounted.stop()
  })

  describe('CAS conflict handling (review B4)', () => {
    /**
     * The real dual-carrier envelope from `pluginRpcFailure` (src/admin.ts): the
     * plugin code and details survive only inside `error.details.issues[0]`.
     */
    function conflict(latest: Record<string, unknown>) {
      const message = '设置刚刚在别处被改动。'
      const details = { latest }
      return {
        ok: false, code: 'conflict', message, details,
        error: { code: 'bad-request', message, details: { issues: [{ code: 'conflict', message, details }] } },
      }
    }

    it('keeps a remote edit to another bot while replaying the local one', async () => {
      const latest = multiEditor(5, [botA, { ...botB, defaultWorkspace: '/remote/b' }])
      const mounted = await mountAdmin(multiEditor(4, [botA, botB]), (endpoint) =>
        endpoint === 'settings/save-bots' ? conflict(latest) : undefined)
      editBot(mounted.api)('bot-a', 'model', 'local-model')
      expect(await save(mounted.api)()).toBe(false)
      const state = mounted.state()
      expect(state.revision).toBe(5)
      expect(botsOf(state).map(bot => bot.id)).toEqual(['bot-a', 'bot-b'])
      expect(botsOf(state)[0]!.model).toBe('local-model')
      expect(botsOf(state)[1]!.defaultWorkspace).toBe('/remote/b')
      expect(state.dirty).toBe(true)
      expect(state.conflictNotice).toBeUndefined()
      // The old full list is never resent behind the user's back.
      expect(mounted.calls.filter(item => item.endpoint === 'settings/save-bots')).toHaveLength(1)
      mounted.stop()
    })

    it('adopts the latest value as the base while keeping the edit on the same field', async () => {
      const latest = multiEditor(5, [{ ...botA, model: 'remote-model' }, botB])
      const mounted = await mountAdmin(multiEditor(4, [botA, botB]), (endpoint) =>
        endpoint === 'settings/save-bots' ? conflict(latest) : undefined)
      editBot(mounted.api)('bot-a', 'model', 'local-model')
      await save(mounted.api)()
      const state = mounted.state()
      expect(originalsOf(state)[0]!.model).toBe('remote-model')
      expect(botsOf(state)[0]!.model).toBe('local-model')
      expect(state.dirty).toBe(true)
      mounted.stop()
    })

    it('drops edits aimed at a bot that no longer exists and says so', async () => {
      const latest = multiEditor(5, [botA])
      const mounted = await mountAdmin(multiEditor(4, [botA, botB]), (endpoint) =>
        endpoint === 'settings/save-bots' ? conflict(latest) : undefined)
      editBot(mounted.api)('bot-b', 'model', 'gone')
      await save(mounted.api)()
      const state = mounted.state()
      expect(botsOf(state).map(bot => bot.id)).toEqual(['bot-a'])
      expect(state.conflictNotice).toBe('conflict.dropped')
      expect(state.dirty).toBe(false)
      mounted.stop()
    })

    it('drops the whole draft when the list shape changed underneath it', async () => {
      const latest = { revision: 6, writable: true, mode: 'legacy', guiSafe: true, config: { appId: 'cli_a', appSecretRef: 'REF', bots: [] } }
      const mounted = await mountAdmin(multiEditor(4, [botA, botB]), (endpoint) =>
        endpoint === 'settings/save-bots' ? conflict(latest) : undefined)
      editBot(mounted.api)('bot-a', 'model', 'local-model')
      await save(mounted.api)()
      const state = mounted.state()
      expect(state.mode).toBe('legacy')
      expect(state.conflictNotice).toBe('conflict.modeChanged')
      expect(botsOf(state).map(bot => bot.id)).toEqual(['legacy'])
      mounted.stop()
    })
  })

  describe('a save is never undone by a poll racing its forced read (review major-3)', () => {
    interface AdminController {
      snapshot: Record<string, unknown>
      mount: () => () => void
      refresh: (force?: boolean) => Promise<void>
      save: () => Promise<boolean>
      inject: () => Record<string, unknown>
    }

    /** The controller on its own, so BOTH read paths can be driven by hand. */
    function makeController(handler: Handler): AdminController {
      const store = <T,>(initial: T) => {
        let value = initial
        return { get: () => value, set: (next: T) => { value = next }, subscribe: () => () => undefined }
      }
      const loaded = loadClientExports(name => name === '@deepseek-ai/dsh-client-runtime/client'
        ? { createSnapshotStore: store }
        : {})
      const Controller = loaded.FeishuBotAdminController as new (connection: unknown) => AdminController
      return new Controller({
        isLoopback: true,
        rpc: {
          call: async (_channel: string, endpoint: string, payload: Record<string, unknown>) => handler(endpoint, payload),
        },
      })
    }

    const stale = multiEditor(4, [botA, botB])
    const fresh = multiEditor(5, [botA, { ...botB, model: 'saved-model' }])

    /** `held` is the 1-based editor read the scenario keeps in flight. */
    function scenario(held: number) {
      let release: ((value: unknown) => void) | undefined
      let reads = 0
      const controller = makeController((endpoint) => {
        if (endpoint === 'bots/status') return { ok: true, value: { bots: [] } }
        if (endpoint === 'settings/save-bots') return { ok: true, value: fresh }
        reads += 1
        if (reads === held) return new Promise(resolve => { release = resolve })
        // Every other read still serves the OLD content, so a snapshot that
        // lands out of order shows up as the revision going backwards.
        return { ok: true, value: stale }
      })
      return { controller, release: (value: unknown) => release?.(value) }
    }

    async function saveEdit(controller: AdminController) {
      const api = controller.inject()
      ;(api.editBot as (id: string, field: string, value: unknown) => void)('bot-b', 'model', 'saved-model')
      expect(controller.snapshot.dirty).toBe(true)
      return controller.save()
    }

    it('keeps the saved revision when a poll starts during the forced read and resolves first', async () => {
      // Reads: 1 = mount, 2 = the save's own forced read (held open here).
      const { controller, release } = scenario(2)
      const stop = controller.mount()
      await settle()
      expect(controller.snapshot.revision).toBe(4)
      const saving = saveEdit(controller)
      await settle()
      // A regular poll starts while the forced read is still in flight…
      await controller.refresh(false)
      await settle()
      // …and lands BEFORE it. It must not roll the page back to revision 4.
      release({ ok: true, value: fresh })
      expect(await saving).toBe(true)
      await settle()
      expect(controller.snapshot.revision).toBe(5)
      expect(controller.snapshot.dirty).toBe(false)
      expect((controller.snapshot.bots as Row[])[1]!.model).toBe('saved-model')
      stop()
    })

    it('keeps the saved revision when a poll started before the save resolves after it', async () => {
      // Reads: 1 = mount, 2 = the poll held open here, 3 = the save's forced read.
      const { controller, release } = scenario(2)
      const stop = controller.mount()
      await settle()
      const stalePoll = controller.refresh(false)
      await settle()
      expect(await saveEdit(controller)).toBe(true)
      expect(controller.snapshot.revision).toBe(5)
      // The old poll lands last, carrying the pre-save content.
      release({ ok: true, value: stale })
      await stalePoll
      await settle()
      expect(controller.snapshot.revision).toBe(5)
      expect(controller.snapshot.dirty).toBe(false)
      expect((controller.snapshot.bots as Row[])[1]!.model).toBe('saved-model')
      stop()
    })

    it('adopts the snapshot the save itself returned, without waiting for another read', async () => {
      // Every editor read after the mount hangs: only the save's own answer can
      // move the page forward.
      const { controller } = scenario(2)
      const stop = controller.mount()
      await settle()
      void saveEdit(controller)
      await settle()
      expect(controller.snapshot.revision).toBe(5)
      expect(controller.snapshot.dirty).toBe(false)
      stop()
    })

    it('finishes the save and resumes polling when the post-save read never answers', async () => {
      // The Host takes the write but then goes silent: every editor read after
      // the mount hangs forever (review major-4).
      vi.useFakeTimers()
      try {
        let reads = 0
        const controller = makeController((endpoint) => {
          if (endpoint === 'bots/status') return { ok: true, value: { bots: [] } }
          if (endpoint === 'settings/save-bots') return { ok: true, value: fresh }
          reads += 1
          return reads === 1 ? { ok: true, value: stale } : new Promise(() => undefined)
        })
        const stop = controller.mount()
        await settle()
        // The save completes on the write's own answer — it never waits for the read.
        expect(await saveEdit(controller)).toBe(true)
        await settle()
        expect(controller.snapshot.revision).toBe(5)
        expect(controller.snapshot.saving).toBe(false)
        expect(reads).toBe(2)
        // While that read holds the single-flight slot a poll is postponed, and a
        // second forced read joins it instead of stacking another RPC.
        void controller.refresh(false)
        void controller.refresh(true)
        await settle()
        expect(reads).toBe(2)
        // Past the bound the slot is released and ordinary polling reads again.
        await vi.advanceTimersByTimeAsync(10_000)
        const before = reads
        void controller.refresh(false)
        await settle()
        expect(reads).toBe(before + 1)
        stop()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('ignores a poll that started before a save and resolves after it (review M3)', async () => {
    let release: ((value: unknown) => void) | undefined
    let reads = 0
    const stale = multiEditor(4, [botA, botB])
    const fresh = multiEditor(5, [botA, { ...botB, model: 'saved-model' }])
    const mounted = await mountAdmin(stale, (endpoint) => {
      if (endpoint !== 'settings/editor-snapshot') return undefined
      reads += 1
      // The FIRST read is the mount; the second is the poll this test holds open.
      return reads === 2 ? new Promise(resolve => { release = resolve }) : undefined
    })
    // A poll is in flight against the OLD content…
    const stalePoll = (mounted.api.refreshBots as () => Promise<void>)()
    await settle()
    // …while the user saves; the save's own refresh reads the new content.
    mounted.setEditor(fresh)
    editBot(mounted.api)('bot-b', 'model', 'saved-model')
    expect(await save(mounted.api)()).toBe(true)
    expect(mounted.state().revision).toBe(5)
    // The stale read lands last and must change nothing.
    release?.({ ok: true, value: stale })
    await stalePoll
    await settle()
    expect(mounted.state().revision).toBe(5)
    expect(botsOf(mounted.state())[1]!.model).toBe('saved-model')
    mounted.stop()
  })

  it('ignores an editor snapshot older than the one already adopted', async () => {
    let served = multiEditor(7, [botA, { ...botB, model: 'current' }])
    const mounted = await mountAdmin(served, (endpoint) =>
      endpoint === 'settings/editor-snapshot' ? { ok: true, value: served } : undefined)
    expect(mounted.state().revision).toBe(7)
    served = multiEditor(6, [botA, { ...botB, model: 'older' }])
    await (mounted.api.refreshBots as () => Promise<void>)()
    expect(mounted.state().revision).toBe(7)
    expect(botsOf(mounted.state())[1]!.model).toBe('current')
    mounted.stop()
  })

  it('reads the plugin failure code out of the envelope the Host actually sends', async () => {
    const message = '这个机器人在本机已经不存在了。'
    const mounted = await mountAdmin(multiEditor(4, [botA, botB]), (endpoint) => endpoint === 'settings/save-bots'
      ? {
        ok: false, code: 'unknown_bot_id', message,
        error: { code: 'bad-request', message, details: { issues: [{ code: 'unknown_bot_id', message }] } },
      }
      : undefined)
    editBot(mounted.api)('bot-a', 'model', 'x')
    expect(await save(mounted.api)()).toBe(false)
    const failure = friendlyError(mounted.state().error)!
    expect(failure.key).toBe('err.unknownBot')
    expect(failure.detail).toBe(message)
    mounted.stop()
  })

  it('fails closed when the Host reports the settings are not safe to edit', async () => {
    const mounted = await mountAdmin({
      revision: 3, writable: true, mode: 'multi', guiSafe: false, guiReason: 'user_layer_dirty',
      config: { maxTotalLiveAgents: 0, bots: [botA] },
    })
    expect(mounted.state().guiSafe).toBe(false)
    expect(mounted.state().guiReason).toBe('user_layer_dirty')
    mounted.stop()
  })

  it('fails closed, with the generic reason, when the Host does not report guiSafe at all', async () => {
    const { guiSafe: _omitted, ...withoutFlag } = multiEditor(1, [botA])
    const mounted = await mountAdmin(withoutFlag)
    expect(mounted.state().guiSafe).toBe(false)
    // No reason to name → the section renders the generic sentence.
    expect(mounted.state().guiReason).toBeUndefined()
    expect(guiBlocked(mounted.state())).toBe(true)
    expect(guiBlockedKey(mounted.state().guiReason)).toBe('gui.blocked.generic')
    mounted.stop()
  })

  it('never binds the raw settings scope, and takes writable from the sanitized snapshot (review B1)', async () => {
    const mounted = await mountAdmin(multiEditor(1, [botA]))
    expect(mounted.scopeBinds()).toBe(0)
    expect(mounted.state().writable).toBe(true)
    expect(mounted.calls.some(item => item.endpoint === 'settings/editor-snapshot')).toBe(true)
    mounted.stop()
    const readOnly = await mountAdmin({ ...multiEditor(1, [botA]), writable: false })
    expect(readOnly.scopeBinds()).toBe(0)
    expect(readOnly.state().writable).toBe(false)
    readOnly.stop()
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
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: { register: () => undefined, bind: () => (key: string) => key },
      // Touching it at all is the bug (review B1); throwing proves nothing does.
      settingsScope: {
        bind: () => { throw new Error('the raw settings scope must never be bound in the browser') },
      },
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
