import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { FeishuRemoteBridge } from './bridge.js'
import {
  resolveBotRuntimeConfig,
  resolveRuntimeConfig,
  validateMultiBotRootInvariants,
  type BotConfig,
  type Config,
} from './config.js'
import { createMockChannel } from './mock.js'
import { ProfileLoader, safeProfileError } from './profile.js'
import { resolveExistingWorkspacePath } from './workspace.js'
import type { BotRuntimeStatus, ResolvedConfig, ResolvedWorkspaceDefault } from './types.js'

interface BotSlot {
  id: string
  appId?: string
  generation: number
  fingerprint: string
  enabled: boolean
  status: BotRuntimeStatus['status']
  error?: string
  config?: ResolvedConfig
  bridge?: FeishuRemoteBridge
  lastConnectedAt?: number
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
      await this.disableAllForRootError(config, message(error), generation)
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
        await this.disableSlot(definition.id, definition.appId, 'disabled', generation)
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
        this.ctx.logger?.warn?.(
          'dsh-feishu-remote [bot:%s]: 配置无效，通道保持禁用（fail-closed）：%s',
          definition.id,
          message(error),
        )
        await this.disableSlot(definition.id, definition.appId, message(error), generation)
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

  private async disableSlot(id: string, appId: string | undefined, error: string, generation: number): Promise<void> {
    const previous = this.slots.get(id)
    await previous?.bridge?.stop().catch(() => undefined)
    if (generation !== this.reconcileGeneration || this.closed) return
    this.slots.set(id, {
      id,
      generation: (previous?.generation ?? 0) + 1,
      fingerprint: '',
      enabled: error === 'disabled' ? false : true,
      status: 'disabled',
      ...(error === 'disabled' ? {} : { error }),
      ...(appId === undefined ? {} : { appId }),
    })
  }

  private async disableAllForRootError(config: Config, error: string, generation: number): Promise<void> {
    this.ctx.logger?.warn?.('dsh-feishu-remote: 配置无效，所有冲突机器人保持禁用（fail-closed）：%s', error)
    const ids = (config.bots?.length ?? 0) > 0 ? config.bots!.map(bot => bot.id || '<invalid>') : ['legacy']
    await Promise.all([...this.slots.values()].map(slot => slot.bridge?.stop().catch(() => undefined)))
    if (generation !== this.reconcileGeneration || this.closed) return
    this.slots.clear()
    for (const id of new Set(ids)) {
      this.slots.set(id, { id, generation: 1, fingerprint: '', enabled: true, status: 'disabled', error })
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
      return {
        id: slot.id,
        ...((slot.config?.appId ?? slot.appId) === undefined ? {} : { appId: slot.config?.appId ?? slot.appId }),
        enabled: slot.enabled,
        status: slot.error !== undefined
          ? 'disabled'
          : health?.terminalFailure || runtimeError !== undefined
            ? 'degraded'
            : health?.connected ? 'connected' : slot.status,
        ...(slot.error === undefined && runtimeError === undefined ? {} : { error: slot.error ?? runtimeError }),
        connected: health?.connected ?? false,
        terminalFailure: health?.terminalFailure ?? false,
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
