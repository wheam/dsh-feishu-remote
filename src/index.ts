/**
 * dsh-feishu-remote — Feishu remote control for the running DeepSeek
 * Harness, embedded in the `dsh web` profile (docs/03 D1, docs/05 §3).
 *
 * `apply()` performs synchronous registration and a credential resolution
 * ONLY — it never rejects: a dead Feishu channel must never take down the
 * web profile (D1). The channel connect loop runs as a background effect
 * with its own retry/rebuild state machine. The Web GUI settings card
 * hot-reloads the bridge on config changes (P1, im-hub mechanism).
 *
 * Reload serialization (Codex P1-7 + review #2 finding 4): ONE mutex
 * serializes the whole resolve→stop→start commit; a generation check runs
 * again BEFORE touching the current bridge in both success and failure
 * paths, so a stale reload can never stop a newer bridge.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { FeishuAdminService } from './admin.js'
import { FeishuBotManager } from './bots.js'
import { ConfigSchema } from './config.js'
import type { Config as BridgeConfig } from './config.js'
import {
  ONBOARDING_RPC_CHANNEL,
  PersonalAgentOnboardingService,
  type BridgeHealth,
} from './onboarding.js'
import {
  SETTINGS_NAMESPACE,
  findForbiddenSettingsKeys,
  flatSchema,
  flatten,
  settingsPurgePlan,
  unflatten,
  type FlatSettings,
  type SettingsGuiState,
} from './settings.js'

export * from './bridge.js'
export * from './admin.js'
export * from './bots.js'
export * from './cards.js'
export * from './channel.js'
export {
  ConfigSchema,
  resolveBotRuntimeConfig,
  resolveConfig,
  resolveRuntimeConfig,
  validateMultiBotConfig,
  validateMultiBotRootInvariants,
} from './config.js'
export type Config = BridgeConfig
export * from './context.js'
export * from './identity.js'
export * from './mock.js'
export * from './onboarding.js'
export * from './profile.js'
export * from './scheduler.js'
export * from './security.js'
export * from './session-groups.js'
export * from './settings.js'
export * from './state.js'
export type * from './types.js'

export const name = 'dsh-feishu-remote'

/**
 * Required injections (docs/05 §3): web-profile core services plus the
 * session-layer services the bridge drives directly. If any is absent the
 * loader skips this plugin — the channel stays disabled (fail-closed).
 */
export const inject = [
  'agents',
  'agentDefaultModel',
  'credentials',
  'tools',
  'systemPrompt',
  'agentPresets',
  'connection',
  'sessionPersistence',
  'approval',
  'userQuestions',
  'workspaceRegistry',
  'settings',
]

export const Config = ConfigSchema

function settingsDescriptor(ctx: Context): { revision: number; base?: unknown; value?: unknown; user?: unknown } | undefined {
  if (typeof ctx.settings?.describe !== 'function') return undefined
  return ctx.settings.describe({ redactSecrets: true })
    .find(item => String(item.ns) === String(SETTINGS_NAMESPACE)) as never
}

/**
 * Drop the stale secret value and the REDUNDANT host-only keys from the
 * persisted settings user layer, then VERIFY the result (Codex batch-3 B2).
 *
 * Three things changed against the previous best-effort version:
 *
 * 1. A read-only provider or a failed write no longer passes silently: the
 *    returned {@link SettingsGuiState} tells the GUI to fail closed, because
 *    the descriptor the browser receives still carries the offending keys.
 * 2. An ACK is not proof — the descriptor is re-read and re-scanned.
 * 3. A host-only path the trusted entry config does NOT declare is KEPT, not
 *    deleted (audit M1): on a pre-f774159 install it is the only copy of that
 *    bot's state-file location. The operator is told to move it into
 *    cordis.patch.yml, and until then the GUI stays fail-closed.
 *
 * The bridge is never blocked by any of this. Exported for tests; safe to
 * call repeatedly — it writes only when the layer actually carries a key it
 * is allowed to remove.
 */
export async function purgeForbiddenSettingsKeys(
  ctx: Context,
  entry: BridgeConfig = {},
): Promise<SettingsGuiState> {
  const writable = ctx.settings?.writable === true
  let purgeFailed = false
  try {
    const descriptor = settingsDescriptor(ctx)
    if (descriptor === undefined) return { safe: false, reason: 'purge_failed' }
    const plan = settingsPurgePlan(descriptor.user, entry)
    for (const item of plan.retained) {
      ctx.logger?.warn?.(
        'dsh-feishu-remote: 设置用户层仍保留主机专属字段 %s（%s），未自动删除以免丢失该值。'
        + '请把它写进 cordis.patch.yml 后再从设置里删除；在此之前设置界面将保持只读。',
        item.key,
        item.scope,
      )
    }
    if (writable && plan.ops.length > 0) {
      try {
        await ctx.settings.mutate(SETTINGS_NAMESPACE, plan.ops, descriptor.revision)
        ctx.logger?.info?.('dsh-feishu-remote: 已从设置用户层清除可安全清除的主机专属字段与遗留 appSecret')
      } catch (error) {
        purgeFailed = true
        ctx.logger?.warn?.(
          'dsh-feishu-remote: 清除设置用户层的主机专属字段失败（不影响运行，设置界面将保持只读）：%s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  } catch (error) {
    ctx.logger?.warn?.(
      'dsh-feishu-remote: 检查设置用户层失败（不影响运行，设置界面将保持只读）：%s',
      error instanceof Error ? error.message : String(error),
    )
    return { safe: false, reason: 'purge_failed' }
  }

  // Verification pass: only a clean descriptor may unlock the GUI.
  let offending: string[]
  try {
    const descriptor = settingsDescriptor(ctx)
    if (descriptor === undefined) return { safe: false, reason: 'purge_failed' }
    offending = [...new Set([
      ...findForbiddenSettingsKeys(descriptor.base),
      ...findForbiddenSettingsKeys(descriptor.value),
      ...findForbiddenSettingsKeys(descriptor.user),
    ])]
  } catch {
    return { safe: false, reason: 'purge_failed' }
  }
  if (offending.length === 0) return { safe: true }
  ctx.logger?.warn?.(
    'dsh-feishu-remote: 设置层仍包含主机专属字段 %s，设置界面将保持只读（fail-closed）',
    offending.join('、'),
  )
  return {
    safe: false,
    reason: purgeFailed ? 'purge_failed' : writable ? 'user_layer_dirty' : 'read_only_dirty',
  }
}

export async function apply(ctx: Context, config: BridgeConfig): Promise<void> {
  const manager = new FeishuBotManager(ctx)
  let generation = 0
  let closed = false
  let commitTail: Promise<void> = Promise.resolve()

  // Plugin unload drains queued reconciles and then every bot bridge.
  ctx.effect(() => () => {
    closed = true
    return commitTail.then(() => manager.stop())
  }, 'dsh-feishu-remote.lifecycle')

  // Settings-card source of truth: entry config as `base`, GUI user layer on top.
  let settings: SettingsScope<FlatSettings>
  try {
    settings = ctx.settings.register(SETTINGS_NAMESPACE, flatSchema, { base: flatten(config) })
  } catch (error) {
    ctx.logger?.warn?.(
      'dsh-feishu-remote: settings namespace 注册失败，继续使用插件 entry 配置：%s',
      error instanceof Error ? error.message : String(error),
    )
    await manager.reconcile(config).catch(reconcileError => {
      ctx.logger?.warn?.(
        'dsh-feishu-remote: entry 配置启动失败（fail-closed）：%s',
        reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
      )
    })
    return
  }

  /**
   * One-shot migration: an older build persisted the host-only paths (and
   * possibly a raw `appSecret`) into the settings USER layer, and the standard
   * settings descriptor ships that layer — plus the value it resolves into —
   * straight to the browser. Purge them once at startup. Best-effort: a
   * read-only provider or a racing write must never take the plugin down.
   */
  const guiState = await purgeForbiddenSettingsKeys(ctx, config)

  /**
   * One commit. The generation is allocated by sync() BEFORE the mutex
   * await: a change queued behind a slow commit bumps `generation` and
   * invalidates it as soon as it reaches its next check (review #3 F5).
   */
  const commit = async (gen: number): Promise<void> => {
    if (closed || gen !== generation) return
    try {
      await manager.reconcile(unflatten(settings.get() ?? {}, config))
    } catch (error) {
      ctx.logger?.warn?.(
        'dsh-feishu-remote: manager reconcile 失败（已隔离）：%s',
        error instanceof Error ? error.message : String(error),
      )
      return
    }
  }

  /** One mutex serializes every resolve→stop→start commit, incl. the initial sync. */
  const sync = (): Promise<void> => {
    const gen = ++generation
    const run = commitTail.then(() => commit(gen))
    commitTail = run.then(() => undefined, () => undefined)
    return run
  }

  ctx.effect(() => settings.watch(() => sync()), 'dsh-feishu-remote settings watcher')
  ctx.effect(() => ctx.on('credentials/reference-updated', ref => {
    const effective = unflatten(settings.get() ?? {}, config)
    const activeRefs = (effective.bots?.length ?? 0) > 0
      ? effective.bots!.filter(bot => bot.enabled !== false).map(bot => bot.appSecretRef)
      : [effective.appSecretRef ?? 'DSH_FEISHU_APP_SECRET']
    if (activeRefs.includes(String(ref))) void sync()
  }), 'dsh-feishu-remote credential watcher')

  const waitForBridge = async (appId: string, signal?: AbortSignal): Promise<BridgeHealth> => {
    // Explicitly enqueue a sync as well as relying on the settings watcher.
    // The generation fence makes a watcher race harmless and guarantees that
    // the retry endpoint can rebuild an unchanged configuration.
    await sync()
    const assertNotAborted = (): void => {
      if (signal?.aborted === true) throw Object.assign(new Error('onboarding cancelled'), { code: 'abort' })
    }
    const pollDelay = (): Promise<void> => new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(Object.assign(new Error('onboarding cancelled'), { code: 'abort' }))
        return
      }
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(Object.assign(new Error('onboarding cancelled'), { code: 'abort' }))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, 250)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    assertNotAborted()
    const deadline = Date.now() + 30_000
    while (!closed && Date.now() < deadline) {
      assertNotAborted()
      const health = manager.healthForApp(appId)
      if (health?.appId === appId && health.connected) return health
      if (health?.appId === appId && health.terminalFailure) {
        throw Object.assign(new Error('bridge terminal failure'), { code: 'connection_failed' })
      }
      await pollDelay()
    }
    throw Object.assign(new Error('bridge connection timeout'), { code: 'connection_timeout' })
  }

  const onboarding = new PersonalAgentOnboardingService(ctx, settings, {
    getBridgeHealth: appId => manager.healthForApp(appId),
    waitForBridge,
  })
  const admin = new FeishuAdminService(ctx, settings, manager, config, guiState)
  ctx.effect(() => () => onboarding.stop(), 'dsh-feishu-remote onboarding lifecycle')
  try {
    ctx.connection.rpc.handle(
      ONBOARDING_RPC_CHANNEL,
      async (endpoint, payload, signal) => (
        await admin.handleRpc(endpoint, payload, signal)
        ?? onboarding.handleRpc(endpoint, payload, signal)
      ),
      { authority: 'loopback' },
    )
  } catch (error) {
    ctx.logger?.warn?.(
      'dsh-feishu-remote: onboarding RPC 注册失败（手工配置仍可用）：%s',
      error instanceof Error ? error.message : String(error),
    )
  }
  await sync()
}
