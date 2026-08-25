import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { validateMultiBotConfig, type BotConfig, type Config } from './config.js'
import { safeStatusText, type FeishuBotManager } from './bots.js'
import {
  HOST_ONLY_BOT_KEYS,
  SETTINGS_NAMESPACE,
  flatSchema,
  type FlatSettings,
  type SettingsGuard,
  type SettingsGuiState,
} from './settings.js'
import type { BotRuntimeStatus, BotStatusReasonCode } from './types.js'

export const ADMIN_RPC_CHANNEL = '/dsh-feishu-remote'

/**
 * Stable failure codes the browser maps to its own copy (docs/16 §5): the
 * client renders `code`, never the raw `message`. `message` is secondary
 * text and is scrubbed of absolute paths before it leaves the host.
 */
export type AdminErrorCode =
  | 'bad_request'
  | 'conflict'
  | 'read_only'
  | 'legacy_mode'
  | 'multi_mode'
  | 'unknown_bot_id'
  | 'last_bot'
  | 'validation'
  | 'credential_missing'
  | 'settings_unsafe'
  | 'cancelled'
  | 'internal'

/** One structured failure as the browser finally reads it. */
export interface PluginRpcIssue {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * The failure body both plugin services return.
 *
 * WHY THE DOUBLE SHAPE. `ctx.connection.rpc.handle()` serializes whatever the
 * handler returns, but the BROWSER re-parses the response with the Host's own
 * zod schema (`@deepseek-ai/dsh-host-apiproxy` RpcResult):
 *
 *   - the failure branch REQUIRES `error`, and `error.code` must be one of the
 *     Host's closed `RpcErrorCode` values — a bare `{ ok:false, code, … }`
 *     makes `connection.rpc.call()` THROW a ZodError instead of resolving;
 *   - unknown keys are STRIPPED, including inside `error.details` — which is
 *     why the old `details.latest` never actually reached the browser;
 *   - the single free-form slot is `bad-request`'s `details.issues`, typed
 *     `z.custom()`, whose elements survive parsing untouched.
 *
 * So the stable plugin code travels twice: flat (`result.code`, for host-side
 * callers and tests) and inside `error.details.issues[0]`, which is the copy
 * that survives the browser parse. `error.message` is the same path-free
 * secondary text, so even a client that reads nothing but the envelope shows
 * a sensible sentence.
 */
export interface PluginRpcFailure<Code extends string = string> {
  ok: false
  code: Code
  message: string
  details?: Record<string, unknown>
  error: {
    code: 'bad-request'
    message: string
    // Typed `never[]` so the object stays assignable to the Host's
    // `RpcError` (`issues: ZodIssue[]`); it really holds one PluginRpcIssue.
    details: { issues: never[] }
  }
}

/** Build the dual-carrier failure body. */
export function pluginRpcFailure<Code extends string>(
  code: Code,
  message: string,
  details?: Record<string, unknown>,
): PluginRpcFailure<Code> {
  const issue: PluginRpcIssue = { code, message, ...(details === undefined ? {} : { details }) }
  return {
    ok: false,
    code,
    message,
    ...(details === undefined ? {} : { details }),
    error: { code: 'bad-request', message, details: { issues: [issue] as unknown as never[] } },
  }
}

export type AdminResult = { ok: true; value: unknown } | PluginRpcFailure<AdminErrorCode>

/** A rejection that already knows its stable wire code. */
class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AdminError'
  }
}

/**
 * One bot exactly as `bots/status` sends it (Codex batch-3 B1).
 *
 * Deliberately absent: the raw `error` text, `appId`, and `profile.path` —
 * all three could carry host topology (an absolute statePath/inboundDir once
 * rode the duplicate-path error message straight into the browser). The
 * client gets a stable `reasonCode` plus a short, path-free `detail`.
 */
export interface ClientBotStatus {
  id: string
  enabled: boolean
  status: 'starting' | 'connected' | 'degraded' | 'disabled' | 'stopping'
  connected: boolean
  terminalFailure: boolean
  botName?: string
  liveAgents: number
  provisionalAgents: number
  lastConnectedAt?: number
  reasonCode?: BotStatusReasonCode
  detail?: string
}

/** Project the host-side runtime status onto the browser-safe DTO. */
export function toClientBotStatus(status: BotRuntimeStatus): ClientBotStatus {
  return {
    id: status.id,
    enabled: status.enabled,
    status: status.status,
    connected: status.connected,
    terminalFailure: status.terminalFailure,
    ...(status.botName === undefined ? {} : { botName: status.botName }),
    liveAgents: status.liveAgents,
    provisionalAgents: status.provisionalAgents,
    ...(status.lastConnectedAt === undefined ? {} : { lastConnectedAt: status.lastConnectedAt }),
    ...(status.reasonCode === undefined ? {} : { reasonCode: status.reasonCode }),
    ...(status.detail === undefined ? {} : { detail: safeStatusText(status.detail) }),
  }
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
  'enabled', 'appId', 'appSecretRef', 'brand', 'allowedChatIds', 'requireMention',
  'defaultWorkspace', 'workspacePolicy', 'agentPreset',
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
  'appId', 'appSecretRef', 'brand', 'onboardingManaged', 'allowedChatIds', 'requireMention',
  'cwd', 'workspaceRoot', 'provider', 'model', 'agentPreset',
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
  /**
   * False when the settings layers still carry a host-only key or a stale
   * secret (Codex batch-3 B2): the GUI must then fail closed and refuse to
   * edit. Mirrors `settings/gui-state`, inlined so the client needs one call.
   */
  guiSafe: boolean
  guiReason?: SettingsGuiState['reason']
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
  'appId', 'appSecretRef', 'brand', 'allowedChatIds', 'requireMention', 'provider', 'model',
  'agentPreset', 'progressUpdateMs', 'interactiveTimeoutMs',
  'maxLiveAgents', 'commandAllowlist', 'contextMode', 'contextBackend', 'contextP2pMaxMessages',
  'contextP2pMaxChars', 'contextMaxMessages', 'contextMaxChars', 'contextTimeoutMs',
  'contextIncludeBot', 'defaultWorkspace', 'workspacePolicy', 'profileFile',
] as const satisfies readonly (keyof FlatSettings)[]

type EditableLegacyKey = (typeof EDITABLE_LEGACY_KEY_LIST)[number]

const EDITABLE_LEGACY_KEYS = new Set<string>(EDITABLE_LEGACY_KEY_LIST)

function errorResult(error: unknown): AdminResult {
  // The message is secondary text only, and is scrubbed so a schema error that
  // echoed a configured path can never reach the browser.
  if (error instanceof AdminError) {
    return pluginRpcFailure(error.code, safeStatusText(error.message), error.details)
  }
  const cancelled = typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code: unknown }).code) === 'cancelled'
  return pluginRpcFailure<AdminErrorCode>(
    cancelled ? 'cancelled' : 'internal',
    safeStatusText(error instanceof Error ? error.message : String(error)),
  )
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdminError('bad_request', 'payload 必须是对象')
  }
  return value as Record<string, unknown>
}

function botIdFor(appId: string): string {
  const suffix = appId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(-24)
  return suffix === '' || !/^[a-z]/u.test(suffix) ? 'primary-bot' : suffix
}

function toLegacyBot(current: FlatSettings, entry: Config): BotConfig {
  if (current.appId.trim() === '') throw new AdminError('validation', '当前配置还没有 App ID，无法转换为机器人列表。')
  return {
    id: botIdFor(current.appId),
    enabled: true,
    appId: current.appId.trim(),
    appSecretRef: current.appSecretRef.trim() || 'DSH_FEISHU_APP_SECRET',
    brand: current.brand,
    allowedOpenIds: [],
    allowedChatIds: current.allowedChatIds.split(/[\s,]+/u).filter(Boolean),
    allowAllUsers: true,
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
    /**
     * The GUI safety gate (Codex batch-3 B2), re-evaluated on every request
     * (batch-4 MAJOR-2). `safe: false` means a host-only key or a stale
     * secret still sits in a layer the browser receives, so the GUI must fail
     * closed — and so must every write here: a `bots[]` rewrite would
     * otherwise silently drop a legitimate user-layer statePath along with
     * it. Because the guard re-scans the live descriptor instead of reading a
     * value cached at startup, cleaning the offending field unlocks the GUI
     * on the next request, with no restart.
     */
    private readonly guiGuard: SettingsGuard = () => ({ safe: true }),
  ) {}

  private descriptor() {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(item => String(item.ns) === String(SETTINGS_NAMESPACE))
    if (descriptor === undefined) throw new AdminError('internal', '设置命名空间当前不可用，请稍后重试。')
    return descriptor
  }

  /** Every mutating endpoint goes through these two fail-closed gates. */
  private assertWritable(): void {
    if (this.ctx.settings.writable === false) {
      throw new AdminError('read_only', '当前部署的设置存储为只读，无法保存修改。')
    }
    const gui = this.guiStateValue()
    if (!gui.safe) {
      throw new AdminError(
        'settings_unsafe',
        '设置存储中仍有需要人工处理的主机专属字段，暂时不能在界面上修改配置。',
        gui.reason === undefined ? undefined : { reason: gui.reason },
      )
    }
  }

  private snapshot(): ClientEditorSnapshot {
    const descriptor = this.descriptor()
    const gui = this.guiStateValue()
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
      // Always an explicit boolean: the client contract keys its fail-closed
      // banner off `guiSafe === false`, never off a missing field.
      guiSafe: gui.safe,
      ...(gui.reason === undefined ? {} : { guiReason: gui.reason }),
      config,
    }
  }

  private normalizeSavedBots(raw: unknown): BotConfig[] {
    if (!Array.isArray(raw)) throw new AdminError('bad_request', 'bots 必须是数组')
    // Identity is the stored `id` and NOTHING else (Codex batch-2 B3). An
    // appId fallback would let a payload that swaps two bots' ids carry one
    // bot's stored fields over to the other; appId stays a duplicate check
    // only (validateMultiBotConfig).
    const stored = new Map(this.settings.get().bots.map(bot => [bot.id, bot]))
    const normalized = raw.map((value, index) => {
      const input = record(value)
      for (const key of Object.keys(input)) {
        if (!ACCEPTED_BOT_KEYS.has(key)) throw new AdminError('bad_request', `bots[] 包含不可编辑字段 ${key}`)
      }
      if (typeof input.id !== 'string' || input.id.trim() === '') {
        throw new AdminError('bad_request', `bots[${index}] 缺少 id：id 是机器人的固定身份，保存时必须原样回传。`)
      }
      const id = input.id
      const previous = stored.get(id)
      // `id` is IMMUTABLE and a save can never mint one (Codex batch-3 B3):
      // accepting an unknown id turned delete-then-resubmit into a silent
      // rename, and would strand the bot's stored fields. New bots come from
      // onboarding only, which appends to `bots[]` itself.
      if (previous === undefined) {
        throw new AdminError('unknown_bot_id', `机器人 ${id} 不在当前列表里；请刷新后重试。`, { botId: id })
      }
      // Spreading the stored bot carries forward every field the editor never
      // sends (progressCards, file limits, …). Host-only keys are not stored
      // here at all any more; a stale one left by an older build is dropped.
      const base: BotConfig = { ...structuredClone(previous), id }
      for (const key of HOST_ONLY_BOT_KEYS) delete (base as unknown as Record<string, unknown>)[key]
      for (const key of EDITABLE_BOT_KEY_LIST) {
        if (Object.hasOwn(input, key)) (base as unknown as Record<string, unknown>)[key] = structuredClone(input[key])
      }
      base.allowedOpenIds = []
      base.allowAllUsers = true
      base.sessionNamespace = previous.sessionNamespace ?? 'app'
      base.contextBackend = base.contextBackend === 'cli' ? 'sdk' : base.contextBackend
      return base
    })
    // Checked on the NORMALIZED list, so no payload shape — an empty array, or
    // every remaining bot deleted while the rest are merely disabled — can
    // strand the config at zero bots and silently fall back to legacy root
    // fields (docs/18 §3.2, §5 item 2).
    if (normalized.length === 0 && this.settings.get().bots.length > 0) {
      throw new AdminError('last_bot', '不能移除最后一个机器人：如果暂时不用，请把它停用，而不是从列表中删除。')
    }
    try {
      validateMultiBotConfig(normalized)
    } catch (error) {
      throw new AdminError('validation', `机器人配置校验失败：${error instanceof Error ? error.message : String(error)}`)
    }
    return normalized
  }

  /**
   * Allow-key + schema-check one single-bot root edit. Ranges and unions are
   * validated by re-resolving the WHOLE flat value through `flatSchema`, so
   * the accepted bounds can never drift from the registered schema.
   */
  private normalizeLegacyPatch(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new AdminError('bad_request', 'config 必须是对象')
    }
    const input = raw as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
      if (!EDITABLE_LEGACY_KEYS.has(key)) throw new AdminError('bad_request', `config 包含不可编辑字段 ${key}`)
      patch[key] = structuredClone(input[key])
    }
    if (Object.keys(patch).length === 0) throw new AdminError('bad_request', 'config 至少要包含一个可修改的字段')
    let resolved: FlatSettings
    try {
      resolved = flatSchema(structuredClone({ ...this.settings.get(), ...patch }))
    } catch (error) {
      throw new AdminError('validation', `配置校验失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (resolved.workspacePolicy === 'locked' && resolved.defaultWorkspace.trim() === '') {
      throw new AdminError('validation', '锁定工作区时必须填写默认工作区')
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
        throw new AdminError(
          'credential_missing',
          `机器人 ${bot.id} 的凭据 ${bot.appSecretRef} 尚未配置`,
          { botId: bot.id, credentialRef: bot.appSecretRef },
        )
      }
    }
  }

  async handleRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AdminResult | undefined> {
    if (signal.aborted) return errorResult(Object.assign(new Error('request cancelled'), { code: 'cancelled' }))
    try {
      switch (endpoint) {
        case 'settings/editor-snapshot':
          return { ok: true, value: this.snapshot() }
        case 'settings/gui-state':
          return { ok: true, value: this.guiStateValue() }
        case 'bots/status':
          // The browser-safe projection — never `manager.status()` itself,
          // which carries raw error text, appId and the profile path.
          return { ok: true, value: { bots: this.manager.status().map(toClientBotStatus) } }
        case 'settings/convert-legacy': {
          this.assertWritable()
          const descriptor = this.descriptor()
          const current = this.settings.get()
          if (current.bots.length > 0) throw new AdminError('multi_mode', '当前已经是机器人列表配置。')
          const bot = toLegacyBot(current, this.entry)
          try {
            validateMultiBotConfig([bot])
          } catch (error) {
            throw new AdminError('validation', `机器人配置校验失败：${error instanceof Error ? error.message : String(error)}`)
          }
          await this.validateCredentials([bot])
          await this.ctx.settings.mutate(SETTINGS_NAMESPACE, [
            { op: 'set', path: ['bots'], value: [bot] },
            { op: 'set', path: ['maxTotalLiveAgents'], value: 0 },
            ...LEGACY_ROOT_FIELDS.map(path => ({ op: 'unset' as const, path: [path] })),
          ], descriptor.revision)
          return { ok: true, value: this.snapshot() }
        }
        case 'settings/save-legacy': {
          this.assertWritable()
          const body = record(payload)
          const revision = body.revision
          if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
            throw new AdminError('bad_request', 'revision 必须是非负整数')
          }
          // A plain edit must NEVER change the config shape: converting is the
          // explicit `settings/convert-legacy` step (docs/17 §10.3).
          if (this.settings.get().bots.length > 0) {
            throw new AdminError('multi_mode', '当前是机器人列表配置，请在机器人列表中修改后保存。')
          }
          const patch = this.normalizeLegacyPatch(body.config)
          if (Object.hasOwn(patch, 'appSecretRef')) {
            const ref = String(patch.appSecretRef).trim()
            if (ref === '') throw new AdminError('validation', 'App Secret 凭据引用不能为空')
            const resolved = await this.ctx.credentials.resolve(credentialRef(ref))
            if ((resolved?.value ?? '').trim() === '') {
              throw new AdminError('credential_missing', `凭据 ${ref} 尚未配置`, { credentialRef: ref })
            }
          }
          await this.ctx.settings.mutate(
            SETTINGS_NAMESPACE,
            Object.entries(patch).map(([key, value]) => ({ op: 'set' as const, path: [key], value })),
            Number(revision),
          )
          return { ok: true, value: this.snapshot() }
        }
        case 'settings/save-bots': {
          this.assertWritable()
          const body = record(payload)
          // A plain edit must NEVER change the config shape. Converting a
          // single-bot config is the explicit `settings/convert-legacy` step;
          // without this check a save-bots payload would silently create
          // `bots[]` out of a single-bot config (Codex batch-2 B2, docs/17 §10.3).
          if (this.settings.get().bots.length === 0) {
            throw new AdminError('legacy_mode', '当前是单机器人配置，请先转换为多机器人配置后再保存机器人列表。')
          }
          const revision = body.revision
          if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
            throw new AdminError('bad_request', 'revision 必须是非负整数')
          }
          const max = body.maxTotalLiveAgents
          if (!Number.isSafeInteger(max) || Number(max) < 0) {
            throw new AdminError('bad_request', 'maxTotalLiveAgents 必须是非负整数')
          }
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
        return pluginRpcFailure<AdminErrorCode>(
          'conflict',
          '设置已被其他操作更新；已获取最新版本，请检查当前编辑后重试。',
          { latest: this.snapshot() },
        )
      }
      return errorResult(error)
    }
  }

  /**
   * Exposed as `settings/gui-state`; also inlined into the editor snapshot and
   * consulted before every mutating endpoint. Re-scans on each call, so the
   * three can never disagree and a cleaned layer unlocks without a restart.
   */
  private guiStateValue(): SettingsGuiState {
    const state = this.guiGuard()
    return state.reason === undefined ? { safe: state.safe } : { safe: state.safe, reason: state.reason }
  }
}
