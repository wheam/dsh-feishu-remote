import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { FeishuRemoteBridge } from './bridge.js'
import {
  BotConfigError,
  resolveBotRuntimeConfig,
  resolveRuntimeConfig,
  validateMultiBotRootInvariants,
  type BotConfig,
  type Config,
} from './config.js'
import { createMockChannel } from './mock.js'
import { ProfileLoader, safeProfileError } from './profile.js'
import { bounded, redactSecrets } from './security.js'
import { resolveExistingWorkspacePath } from './workspace.js'
import type {
  BotRuntimeStatus,
  BotStatusReasonCode,
  ResolvedConfig,
  ResolvedWorkspaceDefault,
} from './types.js'

interface BotSlot {
  id: string
  appId?: string
  generation: number
  fingerprint: string
  enabled: boolean
  status: BotRuntimeStatus['status']
  /** RAW failure text — host logs only, never forwarded to the browser. */
  error?: string
  reasonCode?: BotStatusReasonCode
  detail?: string
  config?: ResolvedConfig
  bridge?: FeishuRemoteBridge
  lastConnectedAt?: number
}

/** One classified failure: a stable code, a safe sentence, and the raw text. */
export interface BotFailure {
  reasonCode: BotStatusReasonCode
  detail: string
  raw: string
}

/**
 * Fixed, browser-safe sentence per reason code. These are deliberately
 * CONSTANT: a rendered failure must never interpolate an absolute path, a
 * credential value or an upstream error body (Codex batch-3 B1).
 */
const REASON_DETAIL: Record<BotStatusReasonCode, string> = {
  disabled: '已停用',
  credential_missing: 'App Secret 凭据尚未配置或为空',
  duplicate_bot_id: '机器人标识与另一个机器人重复',
  duplicate_app_id: '与另一个机器人使用了同一个飞书应用',
  // The session state file and the inbox directory are HOST-ONLY: they exist
  // only in cordis.patch.yml, so the sentence has to send the admin there —
  // the GUI has no such field to fix. The field NAMES are deliberately not
  // spelled out: `bots/status` must stay free of host topology vocabulary.
  duplicate_state_path: '与另一个机器人共用同一份会话状态文件，请在 cordis.patch.yml 中为它单独配置',
  duplicate_inbound_dir: '与另一个机器人共用同一个接收目录，请在 cordis.patch.yml 中为它单独配置',
  duplicate_session_namespace: '只能有一个机器人继续使用原有会话身份',
  invalid_bot_id: '机器人标识不合法',
  workspace_unavailable: '默认工作区不可用',
  profile_unreadable: '角色文件无法读取',
  preset_unavailable: 'Agent 预设不可用',
  config_invalid: '配置不完整或不合法',
  connect_failed: '飞书长连接启动失败',
  rate_limited: '被飞书限流，稍后会自动重试',
  unknown: '出现未知错误',
}

const PATH_LIKE = /(?:~|[A-Za-z]:)?[/\\][^\s'"`，。；：)\]}]*/gu

/**
 * Bounded, secret-free, PATH-free text safe to hand to the browser. Anything
 * that looks like a filesystem path collapses to `…`: host topology (state
 * files, inbox directories, profile locations, the Feishu CLI binary) is not
 * the browser's business, and `bots/status` used to leak exactly that.
 */
export function safeStatusText(value: unknown, max = 200): string {
  const raw = value instanceof Error ? value.message : String(value ?? '')
  return bounded(redactSecrets(raw).replace(PATH_LIKE, '…').trim(), max)
}

function inferReasonCode(raw: string): BotStatusReasonCode {
  if (/missing app secret|credential|凭据/iu.test(raw)) return 'credential_missing'
  if (/\b429\b|rate.?limit|too many requests|限流/iu.test(raw)) return 'rate_limited'
  if (/profile/iu.test(raw)) return 'profile_unreadable'
  if (/workspace|工作区/iu.test(raw)) return 'workspace_unavailable'
  if (/preset|预设/iu.test(raw)) return 'preset_unavailable'
  if (/connect|连接|websocket|socket|network|timeout|超时|ECONN|ETIMEDOUT|ENOTFOUND/iu.test(raw)) {
    return 'connect_failed'
  }
  return 'unknown'
}

/** Map any thrown value onto a stable code plus a browser-safe sentence. */
export function classifyBotFailure(error: unknown): BotFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const reasonCode = error instanceof BotConfigError ? error.code : inferReasonCode(raw)
  return {
    reasonCode,
    // Only the unclassified branch may echo (sanitized) upstream text.
    detail: reasonCode === 'unknown' ? safeStatusText(raw) || REASON_DETAIL.unknown : REASON_DETAIL[reasonCode],
    raw,
  }
}

export interface BotManagerOptions {
  bridgeFactory?: (
    ctx: Context,
    config: ResolvedConfig,
    options: ConstructorParameters<typeof FeishuRemoteBridge>[2],
  ) => FeishuRemoteBridge
  profileLoader?: ProfileLoader
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fingerprint(config: ResolvedConfig): string {
  const { appSecret, ...publicConfig } = config
  return createHash('sha256')
    .update(JSON.stringify(publicConfig))
    .update('\0')
    .update(createHash('sha256').update(appSecret).digest())
    .digest('hex')
}

export class FeishuBotManager {
  private readonly slots = new Map<string, BotSlot>()
  private readonly profileLoader: ProfileLoader
  private readonly bridgeFactory: NonNullable<BotManagerOptions['bridgeFactory']>
  private reconcileGeneration = 0
  private reconcileTail: Promise<void> = Promise.resolve()
  private closed = false
  private totalAgentReservations = 0
  private maxTotalLiveAgents = 0
  private readonly stoppingBridges = new Set<FeishuRemoteBridge>()

  constructor(private readonly ctx: Context, options: BotManagerOptions = {}) {
    this.profileLoader = options.profileLoader ?? new ProfileLoader()
    this.bridgeFactory = options.bridgeFactory ?? ((bridgeCtx, config, bridgeOptions) => new FeishuRemoteBridge(
      bridgeCtx,
      config,
      config.appId === 'mock'
        ? {
            ...bridgeOptions,
            channelFactory: () => createMockChannel({ logger: {
              info: (text, ...args) => bridgeCtx.logger?.info?.(text, ...args),
              warn: (text, ...args) => bridgeCtx.logger?.warn?.(text, ...args),
            } }),
          }
        : bridgeOptions,
    ))
  }

  async reconcile(config: Config): Promise<void> {
    const snapshot = structuredClone(config)
    const task = this.reconcileTail.then(() => this.reconcileNow(snapshot))
    this.reconcileTail = task.catch(() => undefined)
    return task
  }

  private async reconcileNow(config: Config): Promise<void> {
    const generation = ++this.reconcileGeneration
    if (this.closed) return
    const multi = (config.bots?.length ?? 0) > 0
    this.maxTotalLiveAgents = multi ? config.maxTotalLiveAgents ?? 0 : 0
    let definitions: Array<{ id: string; appId?: string; enabled: boolean; resolve: () => Promise<ResolvedConfig> }>
    try {
      if (multi) {
        validateMultiBotRootInvariants(config.bots!)
        definitions = config.bots!.map((bot, index) => ({
          id: bot.id || `invalid-${index + 1}`,
          appId: bot.appId,
          enabled: bot.enabled !== false,
          resolve: () => resolveBotRuntimeConfig(this.ctx, bot),
        }))
      } else {
        definitions = [{
          id: 'legacy',
          appId: config.appId,
          enabled: true,
          resolve: () => resolveRuntimeConfig(this.ctx, config),
        }]
      }
    } catch (error) {
      await this.disableAllForRootError(config, classifyBotFailure(error), generation)
      return
    }

    const wanted = new Set(definitions.map(item => item.id))
    await Promise.all([...this.slots.entries()].filter(([id]) => !wanted.has(id)).map(async ([id, slot]) => {
      slot.status = 'stopping'
      await slot.bridge?.stop().catch(() => undefined)
      if (generation === this.reconcileGeneration) this.slots.delete(id)
    }))

    await Promise.all(definitions.map(async definition => {
      if (generation !== this.reconcileGeneration || this.closed) return
      if (!definition.enabled) {
        await this.disableSlot(definition.id, definition.appId, undefined, generation)
        return
      }
      try {
        let resolved = await definition.resolve()
        const defaultWorkspace = await this.resolveDefaultWorkspace(resolved.defaultWorkspaceSelector)
        if (resolved.workspacePolicy === 'locked' && defaultWorkspace === undefined) {
          throw new Error('locked workspace requires a valid defaultWorkspace')
        }
        if (resolved.profileFile !== undefined) {
          try {
            await this.profileLoader.load(resolved.profileFile)
          } catch (error) {
            throw new Error(safeProfileError(error, resolved.profileFile))
          }
        }
        const presets = this.ctx.get('agentPresets')
        if (presets !== undefined) await presets.resolve(resolved.agentPreset ?? undefined)
        resolved = { ...resolved, ...(defaultWorkspace === undefined ? {} : { defaultWorkspace }) }
        const nextFingerprint = fingerprint(resolved)
        const current = this.slots.get(definition.id)
        if (current?.bridge !== undefined && current.fingerprint === nextFingerprint) return
        await this.replaceSlot(definition.id, resolved, nextFingerprint, generation)
      } catch (error) {
        const failure = classifyBotFailure(error)
        // The RAW text (which may name absolute paths) goes to the host log
        // ONLY; the browser sees `failure.reasonCode` / `failure.detail`.
        this.ctx.logger?.warn?.(
          'dsh-feishu-remote [bot:%s]: 配置无效，通道保持禁用（fail-closed）[%s]：%s',
          definition.id,
          failure.reasonCode,
          failure.raw,
        )
        await this.disableSlot(definition.id, definition.appId, failure, generation)
      }
    }))
  }

  private async resolveDefaultWorkspace(selector: string | undefined): Promise<ResolvedWorkspaceDefault | undefined> {
    if (selector === undefined || selector.trim() === '') return undefined
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) throw new Error('DSH Workspace Registry 当前不可用')
    let workspace = registry.get(WorkspaceId(selector.trim()))
    if (workspace === undefined) {
      const path = await resolveExistingWorkspacePath(selector)
      workspace = await registry.resolveByPath(path) ?? await registry.create(path)
    }
    if (await workspace.status() !== 'ok') throw new Error(`default Workspace directory is unavailable: ${workspace.title}`)
    return { id: String(workspace.id), path: workspace.path, title: workspace.title }
  }

  private async replaceSlot(id: string, config: ResolvedConfig, nextFingerprint: string, generation: number): Promise<void> {
    const previous = this.slots.get(id)
    const slot: BotSlot = {
      id,
      appId: config.appId,
      generation: (previous?.generation ?? 0) + 1,
      fingerprint: nextFingerprint,
      enabled: true,
      status: 'starting',
      config,
    }
    this.slots.set(id, slot)
    if (previous?.bridge !== undefined) {
      previous.status = 'stopping'
      this.stoppingBridges.add(previous.bridge)
      try {
        await previous.bridge.stop().catch(error => {
          this.ctx.logger?.warn?.('dsh-feishu-remote [bot:%s]: stop failed: %s', id, message(error))
        })
      } finally {
        this.stoppingBridges.delete(previous.bridge)
      }
    }
    if (generation !== this.reconcileGeneration || this.closed || this.slots.get(id) !== slot) return
    const bridge = this.bridgeFactory(this.ctx, config, {
      profileLoader: this.profileLoader,
      reserveGlobalAgent: options => this.reserveGlobalAgent(id, options),
      globalAgentStatus: () => this.capacityStatus(),
    })
    slot.bridge = bridge
    await bridge.start()
    if (generation !== this.reconcileGeneration || this.closed || this.slots.get(id) !== slot) {
      await bridge.stop().catch(() => undefined)
      return
    }
    slot.status = 'starting'
  }

  /** `failure === undefined` means the operator turned this bot off. */
  private async disableSlot(
    id: string,
    appId: string | undefined,
    failure: BotFailure | undefined,
    generation: number,
  ): Promise<void> {
    const previous = this.slots.get(id)
    await previous?.bridge?.stop().catch(() => undefined)
    if (generation !== this.reconcileGeneration || this.closed) return
    this.slots.set(id, {
      id,
      generation: (previous?.generation ?? 0) + 1,
      fingerprint: '',
      enabled: failure !== undefined,
      status: 'disabled',
      ...(failure === undefined
        ? { reasonCode: 'disabled' as const, detail: REASON_DETAIL.disabled }
        : { error: failure.raw, reasonCode: failure.reasonCode, detail: failure.detail }),
      ...(appId === undefined ? {} : { appId }),
    })
  }

  private async disableAllForRootError(config: Config, failure: BotFailure, generation: number): Promise<void> {
    this.ctx.logger?.warn?.(
      'dsh-feishu-remote: 配置无效，所有冲突机器人保持禁用（fail-closed）[%s]：%s',
      failure.reasonCode,
      failure.raw,
    )
    const ids = (config.bots?.length ?? 0) > 0 ? config.bots!.map(bot => bot.id || '<invalid>') : ['legacy']
    await Promise.all([...this.slots.values()].map(slot => slot.bridge?.stop().catch(() => undefined)))
    if (generation !== this.reconcileGeneration || this.closed) return
    this.slots.clear()
    for (const id of new Set(ids)) {
      this.slots.set(id, {
        id,
        generation: 1,
        fingerprint: '',
        enabled: true,
        status: 'disabled',
        error: failure.raw,
        reasonCode: failure.reasonCode,
        detail: failure.detail,
      })
    }
  }

  reserveGlobalAgent(botId: string, options: { replacing: boolean }): { release(): void } {
    const liveTotal = this.liveAgentTotal()
    const adjustment = options.replacing ? 1 : 0
    if (this.maxTotalLiveAgents > 0 && liveTotal + this.totalAgentReservations - adjustment >= this.maxTotalLiveAgents) {
      throw new Error(`全部飞书机器人 live agent 数量已达上限 ${this.maxTotalLiveAgents}`)
    }
    this.totalAgentReservations += 1
    let released = false
    return { release: () => {
      if (released) return
      released = true
      this.totalAgentReservations -= 1
      if (this.totalAgentReservations < 0) {
        this.totalAgentReservations = 0
        this.ctx.logger?.error?.('dsh-feishu-remote [bot:%s]: global capacity lease underflow', botId)
      }
    } }
  }

  capacityStatus(): { live: number; provisional: number; max: number } {
    return {
      live: this.liveAgentTotal(),
      provisional: this.totalAgentReservations,
      max: this.maxTotalLiveAgents,
    }
  }

  status(): BotRuntimeStatus[] {
    return [...this.slots.values()].map(slot => {
      const health = slot.bridge?.health()
      const runtimeError = slot.bridge?.runtimeError()
      if (health?.connected && slot.lastConnectedAt === undefined) slot.lastConnectedAt = Date.now()
      const profile = slot.bridge?.profileStatus()
      const runtimeFailure = slot.error !== undefined
        ? { reasonCode: slot.reasonCode ?? 'unknown', detail: slot.detail ?? REASON_DETAIL.unknown, raw: slot.error }
        : runtimeError !== undefined
          ? classifyBotFailure(runtimeError)
          : health?.terminalFailure === true
            ? { reasonCode: 'connect_failed' as const, detail: REASON_DETAIL.connect_failed, raw: 'terminal failure' }
            : undefined
      return {
        id: slot.id,
        ...((slot.config?.appId ?? slot.appId) === undefined ? {} : { appId: slot.config?.appId ?? slot.appId }),
        enabled: slot.enabled,
        status: slot.error !== undefined
          ? 'disabled'
          : health?.terminalFailure || runtimeError !== undefined
            ? 'degraded'
            : health?.connected ? 'connected' : slot.status,
        ...(runtimeFailure === undefined ? {} : { error: runtimeFailure.raw }),
        ...(runtimeFailure === undefined
          ? (slot.reasonCode === undefined ? {} : { reasonCode: slot.reasonCode, detail: slot.detail })
          : { reasonCode: runtimeFailure.reasonCode, detail: runtimeFailure.detail }),
        connected: health?.connected ?? false,
        terminalFailure: health?.terminalFailure ?? false,
        ...(health?.botName === undefined ? {} : { botName: health.botName }),
        liveAgents: slot.bridge?.liveAgentCount() ?? 0,
        provisionalAgents: slot.bridge?.provisionalAgentCount() ?? 0,
        ...(slot.lastConnectedAt === undefined ? {} : { lastConnectedAt: slot.lastConnectedAt }),
        ...(profile === undefined ? {} : { profile: {
          path: profile.path,
          digest: profile.digest,
          bytes: profile.bytes,
          loadedAt: profile.loadedAt,
        } }),
      }
    })
  }

  healthForApp(appId?: string) {
    const slot = appId === undefined
      ? [...this.slots.values()].find(item => item.bridge !== undefined)
      : [...this.slots.values()].find(item => item.config?.appId === appId)
    return slot?.bridge?.health()
  }

  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.reconcileGeneration += 1
    const settling = this.reconcileTail
    // Stop any bridge already published by an in-flight reconcile first: a
    // pathological start() may need stop() to unblock. Then await the serial
    // reconcile tail and drain once more in case it published just before the
    // closed/generation fence.
    await Promise.allSettled([...this.slots.values()].map(slot => slot.bridge?.stop()))
    await settling
    await Promise.allSettled([...this.slots.values()].map(slot => slot.bridge?.stop()))
    this.slots.clear()
  }

  private liveAgentTotal(): number {
    const counted = new Set<FeishuRemoteBridge>()
    let total = 0
    for (const slot of this.slots.values()) {
      if (slot.bridge === undefined || counted.has(slot.bridge)) continue
      counted.add(slot.bridge)
      total += slot.bridge.liveAgentCount()
    }
    for (const bridge of this.stoppingBridges) {
      if (counted.has(bridge)) continue
      counted.add(bridge)
      total += bridge.liveAgentCount()
    }
    return total
  }
}
