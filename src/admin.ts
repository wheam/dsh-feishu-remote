import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { validateMultiBotConfig, type BotConfig, type Config } from './config.js'
import type { FeishuBotManager } from './bots.js'
import { SETTINGS_NAMESPACE, type FlatSettings } from './settings.js'

export const ADMIN_RPC_CHANNEL = '/dsh-feishu-remote'

type AdminResult = { ok: true; value: unknown } | {
  ok: false
  error:
    | { code: 'bad-request'; message: string; details: { issues: []; latest?: unknown } }
    | { code: 'cancelled'; message: string; details: Record<string, never> }
    | { code: 'internal'; message: string; details: Record<string, never> }
}

const EDITABLE_BOT_KEYS = new Set([
  'id', 'enabled', 'appId', 'appSecretRef', 'brand', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'defaultWorkspace', 'workspacePolicy', 'agentPreset',
  'profileFile', 'provider', 'model', 'maxLiveAgents', 'contextMode', 'contextBackend',
])

const BOT_WIRE_KEYS = new Set([
  ...EDITABLE_BOT_KEYS,
  'statePath', 'inboundDir', 'feishuCliPath', 'progressCards', 'progressUpdateMs',
  'workingReaction', 'maxInboundFileBytes', 'maxOutboundFileBytes', 'interactiveTimeoutMs',
  'enableApprovals', 'cardBodyMaxChars', 'commandAllowlist', 'contextP2pMaxMessages',
  'contextP2pMaxChars', 'contextMaxMessages', 'contextMaxChars', 'contextTimeoutMs',
  'contextIncludeBot', 'sessionNamespace',
])

const ROOT_WIRE_KEYS = [
  'appId', 'appSecretRef', 'brand', 'onboardingManaged', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'cwd', 'workspaceRoot', 'provider', 'model', 'agentPreset',
  'progressUpdateMs', 'interactiveTimeoutMs', 'maxLiveAgents', 'commandAllowlist', 'contextMode',
  'contextBackend', 'contextP2pMaxMessages', 'contextP2pMaxChars', 'contextMaxMessages',
  'contextMaxChars', 'contextTimeoutMs', 'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy',
  'profileFile', 'maxTotalLiveAgents',
] as const satisfies readonly (keyof FlatSettings)[]

const LEGACY_ROOT_FIELDS = [
  'appId', 'appSecret', 'appSecretRef', 'brand', 'onboardingManaged', 'allowedOpenIds', 'allowedChatIds',
  'allowAllUsers', 'requireMention', 'cwd', 'workspaceRoot', 'provider', 'model', 'agentPreset',
  'progressUpdateMs', 'interactiveTimeoutMs', 'maxLiveAgents', 'commandAllowlist', 'contextMode',
  'contextBackend', 'contextP2pMaxMessages', 'contextP2pMaxChars', 'contextMaxMessages',
  'contextMaxChars', 'contextTimeoutMs', 'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy',
  'profileFile',
] as const

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
    ...(entry.statePath === undefined ? {} : { statePath: entry.statePath }),
    ...(entry.inboundDir === undefined ? {} : { inboundDir: entry.inboundDir }),
    ...(entry.feishuCliPath === undefined ? {} : { feishuCliPath: entry.feishuCliPath }),
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

  private snapshot() {
    const descriptor = this.descriptor()
    const current = this.settings.get()
    const config: Record<string, unknown> = {}
    for (const key of ROOT_WIRE_KEYS) config[key] = structuredClone(current[key])
    config.bots = current.bots.map(bot => Object.fromEntries(
      Object.entries(bot).filter(([key]) => BOT_WIRE_KEYS.has(key)),
    ))
    return {
      revision: descriptor.revision,
      writable: this.ctx.settings.writable,
      mode: current.bots.length > 0 ? 'multi' : 'legacy',
      config,
    }
  }

  private normalizeSavedBots(raw: unknown): BotConfig[] {
    if (!Array.isArray(raw)) throw new Error('bots 必须是数组')
    if (raw.length === 0 && this.settings.get().bots.length > 0) {
      throw new Error('多机器人模式至少保留一个 bot；如需停用全部机器人，请逐个设置 enabled=false')
    }
    const current = new Map(this.settings.get().bots.map(bot => [bot.id, bot]))
    const currentByApp = new Map(this.settings.get().bots.map(bot => [bot.appId, bot]))
    const normalized = raw.map(value => {
      const input = record(value)
      for (const key of Object.keys(input)) {
        if (!EDITABLE_BOT_KEYS.has(key)) throw new Error(`bots[] 包含不可编辑字段 ${key}`)
      }
      const id = typeof input.id === 'string' ? input.id : ''
      const appId = typeof input.appId === 'string' ? input.appId : ''
      const previous = current.get(id) ?? currentByApp.get(appId)
      const base: BotConfig = previous === undefined
        ? { id, appId: '', appSecretRef: '', sessionNamespace: 'app' }
        : { ...previous }
      for (const key of EDITABLE_BOT_KEYS) {
        if (Object.hasOwn(input, key)) (base as unknown as Record<string, unknown>)[key] = structuredClone(input[key])
      }
      base.sessionNamespace = previous?.sessionNamespace ?? 'app'
      base.contextBackend = base.contextBackend === 'cli' ? 'sdk' : base.contextBackend
      return base
    })
    validateMultiBotConfig(normalized)
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
        case 'settings/save-bots': {
          const body = record(payload)
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
