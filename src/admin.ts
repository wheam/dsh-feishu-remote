import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { validateMultiBotConfig, type BotConfig, type Config } from './config.js'
import type { FeishuBotManager } from './bots.js'
import { HOST_ONLY_BOT_KEYS, SETTINGS_NAMESPACE, flatSchema, type FlatSettings } from './settings.js'

export const ADMIN_RPC_CHANNEL = '/dsh-feishu-remote'

type AdminResult = { ok: true; value: unknown } | {
  ok: false
  error:
    | { code: 'bad-request'; message: string; details: { issues: []; latest?: unknown } }
    | { code: 'cancelled'; message: string; details: Record<string, never> }
    | { code: 'internal'; message: string; details: Record<string, never> }
}

type FlatBot = FlatSettings['bots'][number]

/**
 * Per-bot keys a save may CHANGE. `id` is deliberately absent (Codex batch-2
 * B3): it is the immutable identity a stored bot is merged back by, so the
 * editor must echo it unchanged and can never move one bot's settings onto
 * another. Host-only keys (`statePath`/`inboundDir`/`feishuCliPath`) are not
 * in `FlatSettings` at all — they never enter the settings layer and are
 * re-overlaid from the entry config by `unflatten()`.
 */
const EDITABLE_BOT_KEY_LIST = [
  'enabled', 'appId', 'appSecretRef', 'brand', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'defaultWorkspace', 'workspacePolicy', 'agentPreset',
  'profileFile', 'provider', 'model', 'maxLiveAgents', 'contextMode', 'contextBackend',
] as const satisfies readonly (keyof FlatBot)[]

/** `id` is accepted on the wire — as identity only, never as an edit. */
const ACCEPTED_BOT_KEYS = new Set<string>(['id', ...EDITABLE_BOT_KEY_LIST])

/**
 * The per-bot keys the browser editor is allowed to SEE. `sessionNamespace`
 * stays read-only on the wire (docs/17 §10.3): it is shown, never accepted.
 */
const CLIENT_BOT_KEY_LIST = [
  'id', ...EDITABLE_BOT_KEY_LIST,
  'progressCards', 'progressUpdateMs', 'workingReaction', 'maxInboundFileBytes',
  'maxOutboundFileBytes', 'interactiveTimeoutMs', 'enableApprovals', 'cardBodyMaxChars',
  'commandAllowlist', 'contextP2pMaxMessages', 'contextP2pMaxChars', 'contextMaxMessages',
  'contextMaxChars', 'contextTimeoutMs', 'contextIncludeBot', 'sessionNamespace',
] as const satisfies readonly (keyof FlatBot)[]

const CLIENT_BOT_KEYS = new Set<string>(CLIENT_BOT_KEY_LIST)

/** One bot as the settings editor receives it — strictly a subset of the flat bot. */
export type ClientBotConfig = Pick<FlatBot, (typeof CLIENT_BOT_KEY_LIST)[number]>

const ROOT_WIRE_KEYS = [
  'appId', 'appSecretRef', 'brand', 'onboardingManaged', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'cwd', 'workspaceRoot', 'provider', 'model', 'agentPreset',
  'progressUpdateMs', 'interactiveTimeoutMs', 'maxLiveAgents', 'commandAllowlist', 'contextMode',
  'contextBackend', 'contextP2pMaxMessages', 'contextP2pMaxChars', 'contextMaxMessages',
  'contextMaxChars', 'contextTimeoutMs', 'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy',
  'profileFile', 'maxTotalLiveAgents',
] as const satisfies readonly (keyof FlatSettings)[]

/** The whole editor snapshot as it crosses the loopback RPC to the browser. */
export interface ClientEditorSnapshot {
  revision: number
  writable: boolean
  mode: 'legacy' | 'multi'
  config: Pick<FlatSettings, (typeof ROOT_WIRE_KEYS)[number]> & { bots: ClientBotConfig[] }
}

/**
 * User-layer root fields the legacy→multi conversion clears. Audit M3: only
 * keys the flat schema actually declares belong here — `appSecret` never was
 * one (the secret lives in the credential provider), and `satisfies` now keeps
 * the list from drifting away from `FlatSettings`.
 */
const LEGACY_ROOT_FIELDS = [
  'appId', 'appSecretRef', 'brand', 'onboardingManaged', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'cwd', 'workspaceRoot', 'provider', 'model', 'agentPreset',
  'progressUpdateMs', 'interactiveTimeoutMs', 'maxLiveAgents', 'commandAllowlist', 'contextMode',
  'contextBackend', 'contextP2pMaxMessages', 'contextP2pMaxChars', 'contextMaxMessages',
  'contextMaxChars', 'contextTimeoutMs', 'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy',
  'profileFile',
] as const satisfies readonly (keyof FlatSettings)[]

/**
 * Root fields a SINGLE-bot (legacy) save may write. Deliberately excludes the
 * host-only provenance bit (`onboardingManaged`), the deprecated fixed-path
 * pair (`cwd`/`workspaceRoot`), the process-level cap (`maxTotalLiveAgents`,
 * meaningless without `bots[]`) and `bots` itself: a plain edit must never
 * convert the config shape (docs/17 §10.3, docs/18 §5 item 1).
 */
const EDITABLE_LEGACY_KEY_LIST = [
  'appId', 'appSecretRef', 'brand', 'allowedOpenIds', 'allowedChatIds', 'allowAllUsers',
  'requireMention', 'provider', 'model', 'agentPreset', 'progressUpdateMs', 'interactiveTimeoutMs',
  'maxLiveAgents', 'commandAllowlist', 'contextMode', 'contextBackend', 'contextP2pMaxMessages',
  'contextP2pMaxChars', 'contextMaxMessages', 'contextMaxChars', 'contextTimeoutMs',
  'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy', 'profileFile',
] as const satisfies readonly (keyof FlatSettings)[]

type EditableLegacyKey = (typeof EDITABLE_LEGACY_KEY_LIST)[number]

const EDITABLE_LEGACY_KEYS = new Set<string>(EDITABLE_LEGACY_KEY_LIST)

function errorResult(error: unknown): AdminResult {
  const cancelled = typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code: unknown }).code) === 'cancelled'
  if (cancelled) {
    return { ok: false, error: { code: 'cancelled', message: error instanceof Error ? error.message : String(error), details: {} } }
  }
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message: error instanceof Error ? error.message : String(error),
      details: { issues: [] },
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('payload 必须是对象')
  return value as Record<string, unknown>
}

function botIdFor(appId: string): string {
  const suffix = appId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(-24)
  return suffix === '' || !/^[a-z]/u.test(suffix) ? 'primary-bot' : suffix
}

function toLegacyBot(current: FlatSettings, entry: Config): BotConfig {
  if (current.appId.trim() === '') throw new Error('当前 legacy 配置没有 App ID，不能转换')
  return {
    id: botIdFor(current.appId),
    enabled: true,
    appId: current.appId.trim(),
    appSecretRef: current.appSecretRef.trim() || 'DSH_FEISHU_APP_SECRET',
    brand: current.brand,
    allowedOpenIds: current.allowedOpenIds.split(/[\s,]+/u).filter(Boolean),
    allowedChatIds: current.allowedChatIds.split(/[\s,]+/u).filter(Boolean),
    allowAllUsers: current.allowAllUsers,
    requireMention: current.requireMention,
    defaultWorkspace: current.defaultWorkspace,
    workspacePolicy: current.workspacePolicy,
    profileFile: current.profileFile,
    provider: current.provider,
    model: current.model,
    agentPreset: current.agentPreset,
    progressUpdateMs: current.progressUpdateMs,
    interactiveTimeoutMs: current.interactiveTimeoutMs,
    maxLiveAgents: current.maxLiveAgents,
    commandAllowlist: current.commandAllowlist.split(/[\s,]+/u).filter(Boolean),
    contextMode: current.contextMode,
    contextBackend: 'sdk',
    contextP2pMaxMessages: current.contextP2pMaxMessages,
    contextP2pMaxChars: current.contextP2pMaxChars,
    contextMaxMessages: current.contextMaxMessages,
    contextMaxChars: current.contextMaxChars,
    contextTimeoutMs: current.contextTimeoutMs,
    contextIncludeBot: current.contextIncludeBot,
    progressCards: entry.progressCards,
    workingReaction: entry.workingReaction,
    maxInboundFileBytes: entry.maxInboundFileBytes,
    maxOutboundFileBytes: entry.maxOutboundFileBytes,
    enableApprovals: entry.enableApprovals,
    cardBodyMaxChars: entry.cardBodyMaxChars,
    sessionNamespace: 'legacy',
    // Host-only paths are NOT copied into the settings layer: `unflatten()`
    // re-overlays the entry ROOT statePath/inboundDir/feishuCliPath onto the
    // bot stamped `sessionNamespace: 'legacy'` — this one — so the converted
    // bot keeps reading the very same state file without ever publishing the
    // path to the browser.
  }
}

export class FeishuAdminService {
  constructor(
    private readonly ctx: Context,
    private readonly settings: SettingsScope<FlatSettings>,
    private readonly manager: FeishuBotManager,
    private readonly entry: Config,
  ) {}

  private descriptor() {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(item => String(item.ns) === String(SETTINGS_NAMESPACE))
    if (descriptor === undefined) throw new Error('feishu-remote settings descriptor 不可用')
    return descriptor
  }

  private snapshot(): ClientEditorSnapshot {
    const descriptor = this.descriptor()
    const current = this.settings.get()
    const config = {} as ClientEditorSnapshot['config']
    for (const key of ROOT_WIRE_KEYS) {
      (config as Record<string, unknown>)[key] = structuredClone(current[key])
    }
    // Host-only keys are filtered OUT here, not merely omitted from the type:
    // the browser must never receive statePath/inboundDir/feishuCliPath.
    config.bots = current.bots.map(bot => Object.fromEntries(
      Object.entries(bot).filter(([key]) => CLIENT_BOT_KEYS.has(key)),
    ) as ClientBotConfig)
    return {
      revision: descriptor.revision,
      writable: this.ctx.settings.writable,
      mode: current.bots.length > 0 ? 'multi' : 'legacy',
      config,
    }
  }

  private normalizeSavedBots(raw: unknown): BotConfig[] {
    if (!Array.isArray(raw)) throw new Error('bots 必须是数组')
    // Identity is the stored `id` and NOTHING else (Codex batch-2 B3). An
    // appId fallback would let a payload that swaps two bots' ids carry one
    // bot's stored fields over to the other; appId stays a duplicate check
    // only (validateMultiBotConfig).
    const stored = new Map(this.settings.get().bots.map(bot => [bot.id, bot]))
    const normalized = raw.map((value, index) => {
      const input = record(value)
      for (const key of Object.keys(input)) {
        if (!ACCEPTED_BOT_KEYS.has(key)) throw new Error(`bots[] 包含不可编辑字段 ${key}`)
      }
      if (typeof input.id !== 'string' || input.id.trim() === '') {
        throw new Error(`bots[${index}] 缺少 id：id 是机器人的固定身份，保存时必须原样回传现有 id（新机器人请给一个未使用的 id）。`)
      }
      const id = input.id
      const previous = stored.get(id)
      // Spreading the stored bot carries forward every field the editor never
      // sends (progressCards, file limits, …). Host-only keys are not stored
      // here at all any more; a stale one left by an older build is dropped.
      const base: BotConfig = previous === undefined
        ? { id, appId: '', appSecretRef: '', sessionNamespace: 'app' }
        : { ...structuredClone(previous), id }
      for (const key of HOST_ONLY_BOT_KEYS) delete (base as unknown as Record<string, unknown>)[key]
      for (const key of EDITABLE_BOT_KEY_LIST) {
        if (Object.hasOwn(input, key)) (base as unknown as Record<string, unknown>)[key] = structuredClone(input[key])
      }
      base.sessionNamespace = previous?.sessionNamespace ?? 'app'
      base.contextBackend = base.contextBackend === 'cli' ? 'sdk' : base.contextBackend
      return base
    })
    // Checked on the NORMALIZED list, so no payload shape — an empty array, or
    // every remaining bot deleted while the rest are merely disabled — can
    // strand the config at zero bots and silently fall back to legacy root
    // fields (docs/18 §3.2, §5 item 2).
    if (normalized.length === 0 && this.settings.get().bots.length > 0) {
      throw new Error('不能移除最后一个机器人：如果暂时不用，请把它停用（enabled=false），而不是从列表中删除。')
    }
    validateMultiBotConfig(normalized)
    return normalized
  }

  /**
   * Whitelist + schema-check one single-bot root edit. Ranges and unions are
   * validated by re-resolving the WHOLE flat value through `flatSchema`, so
   * the accepted bounds can never drift from the registered schema.
   */
  private normalizeLegacyPatch(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('config 必须是对象')
    const input = raw as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
      if (!EDITABLE_LEGACY_KEYS.has(key)) throw new Error(`config 包含不可编辑字段 ${key}`)
      patch[key] = structuredClone(input[key])
    }
    if (Object.keys(patch).length === 0) throw new Error('config 至少要包含一个可修改的字段')
    let resolved: FlatSettings
    try {
      resolved = flatSchema(structuredClone({ ...this.settings.get(), ...patch }))
    } catch (error) {
      throw new Error(`配置校验失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (resolved.workspacePolicy === 'locked' && resolved.defaultWorkspace.trim() === '') {
      throw new Error('锁定工作区时必须填写默认工作区')
    }
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(patch)) {
      normalized[key] = structuredClone((resolved as unknown as Record<string, unknown>)[key as EditableLegacyKey])
    }
    return normalized
  }

  private async validateCredentials(bots: readonly BotConfig[]): Promise<void> {
    for (const bot of bots) {
      if (bot.enabled === false) continue
      const resolved = await this.ctx.credentials.resolve(credentialRef(bot.appSecretRef))
      if ((resolved?.value ?? '').trim() === '') {
        throw new Error(`bot ${bot.id} 的 credential ref ${bot.appSecretRef} 尚未配置`)
      }
    }
  }

  async handleRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AdminResult | undefined> {
    if (signal.aborted) return errorResult(Object.assign(new Error('request cancelled'), { code: 'cancelled' }))
    try {
      switch (endpoint) {
        case 'settings/editor-snapshot':
          return { ok: true, value: this.snapshot() }
        case 'bots/status':
          return { ok: true, value: { bots: this.manager.status() } }
        case 'settings/convert-legacy': {
          const descriptor = this.descriptor()
          const current = this.settings.get()
          if (current.bots.length > 0) throw new Error('当前已经是多机器人配置')
          const bot = toLegacyBot(current, this.entry)
          validateMultiBotConfig([bot])
          await this.validateCredentials([bot])
          await this.ctx.settings.mutate(SETTINGS_NAMESPACE, [
            { op: 'set', path: ['bots'], value: [bot] },
            { op: 'set', path: ['maxTotalLiveAgents'], value: 0 },
            ...LEGACY_ROOT_FIELDS.map(path => ({ op: 'unset' as const, path: [path] })),
          ], descriptor.revision)
          return { ok: true, value: this.snapshot() }
        }
        case 'settings/save-legacy': {
          const body = record(payload)
          const revision = body.revision
          if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('revision 必须是非负整数')
          // A plain edit must NEVER change the config shape: converting is the
          // explicit `settings/convert-legacy` step (docs/17 §10.3).
          if (this.settings.get().bots.length > 0) {
            throw new Error('当前已经是多机器人配置，不能按单机器人方式保存；请在机器人列表中修改后保存。')
          }
          const patch = this.normalizeLegacyPatch(body.config)
          if (Object.hasOwn(patch, 'appSecretRef')) {
            const ref = String(patch.appSecretRef).trim()
            if (ref === '') throw new Error('App Secret 凭据引用不能为空')
            const resolved = await this.ctx.credentials.resolve(credentialRef(ref))
            if ((resolved?.value ?? '').trim() === '') throw new Error(`credential ref ${ref} 尚未配置`)
          }
          await this.ctx.settings.mutate(
            SETTINGS_NAMESPACE,
            Object.entries(patch).map(([key, value]) => ({ op: 'set' as const, path: [key], value })),
            Number(revision),
          )
          return { ok: true, value: this.snapshot() }
        }
        case 'settings/save-bots': {
          const body = record(payload)
          // A plain edit must NEVER change the config shape. Converting a
          // single-bot (legacy) config is the explicit `settings/convert-legacy`
          // step; without this check a save-bots payload would silently create
          // `bots[]` out of a legacy config (Codex batch-2 B2, docs/17 §10.3).
          if (this.settings.get().bots.length === 0) {
            throw new Error('当前是单机器人（legacy）配置，不能按机器人列表保存；请先执行「转换为多机器人配置」。')
          }
          const revision = body.revision
          if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('revision 必须是非负整数')
          const max = body.maxTotalLiveAgents
          if (!Number.isSafeInteger(max) || Number(max) < 0) throw new Error('maxTotalLiveAgents 必须是非负整数')
          const bots = this.normalizeSavedBots(body.bots)
          await this.validateCredentials(bots)
          await this.ctx.settings.mutate(SETTINGS_NAMESPACE, [
            { op: 'set', path: ['bots'], value: bots },
            { op: 'set', path: ['maxTotalLiveAgents'], value: Number(max) },
          ], Number(revision))
          return { ok: true, value: this.snapshot() }
        }
        default:
          return undefined
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error
        && String((error as { code: unknown }).code) === 'SETTINGS_CONFLICT') {
        return {
          ok: false,
          error: {
            code: 'bad-request',
            message: '设置已被其他操作更新；已获取最新版本，请检查当前编辑后重试。',
            details: { issues: [], latest: this.snapshot() },
          },
        }
      }
      return errorResult(error)
    }
  }
}
