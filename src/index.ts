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
import { FeishuRemoteBridge } from './bridge.js'
import { ConfigSchema, resolveRuntimeConfig } from './config.js'
import type { Config as BridgeConfig } from './config.js'
import { createMockChannel } from './mock.js'
import { SETTINGS_NAMESPACE, flatSchema, flatten, unflatten } from './settings.js'

export * from './bridge.js'
export * from './cards.js'
export * from './channel.js'
export { ConfigSchema, resolveConfig, resolveRuntimeConfig } from './config.js'
export type Config = BridgeConfig
export * from './identity.js'
export * from './mock.js'
export * from './scheduler.js'
export * from './security.js'
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
  'sessionPersistence',
  'approval',
  'userQuestions',
  'workspaceRegistry',
  'settings',
]

export const Config = ConfigSchema

export async function apply(ctx: Context, config: BridgeConfig): Promise<void> {
  let bridge: FeishuRemoteBridge | undefined
  let generation = 0
  let closed = false
  let commitTail: Promise<void> = Promise.resolve()

  const makeBridge = (resolved: Awaited<ReturnType<typeof resolveRuntimeConfig>>): FeishuRemoteBridge => {
    const useMock = resolved.appId === 'mock'
    if (useMock) {
      ctx.logger?.warn?.('dsh-feishu-remote: 使用 mock 通道（仅文本链路，无真实飞书连接）')
    }
    return new FeishuRemoteBridge(
      ctx,
      resolved,
      useMock ? { channelFactory: () => createMockChannel({ logger: {
        info: (message, ...args) => ctx.logger?.info?.(message, ...args),
        warn: (message, ...args) => ctx.logger?.warn?.(message, ...args),
      } }) } : {},
    )
  }

  // Plugin unload stops the CURRENT bridge and drains every queued commit.
  ctx.effect(() => () => {
    closed = true
    return commitTail.then(() => bridge?.stop())
  }, 'dsh-feishu-remote.lifecycle')

  // Settings-card source of truth: entry config as `base`, GUI user layer on top.
  const settings = ctx.settings.register(SETTINGS_NAMESPACE, flatSchema, {
    base: flatten(config),
  })

  /**
   * One commit. The generation is allocated by sync() BEFORE the mutex
   * await: a change queued behind a slow commit bumps `generation` and
   * invalidates it as soon as it reaches its next check (review #3 F5).
   */
  const commit = async (gen: number): Promise<void> => {
    if (closed || gen !== generation) return
    let resolved: Awaited<ReturnType<typeof resolveRuntimeConfig>> | undefined
    try {
      resolved = await resolveRuntimeConfig(ctx, unflatten(settings.get() ?? {}, config))
    } catch (error) {
      // Recheck the generation BEFORE touching the current bridge: a newer
      // reload may already own it (review #2 finding 4).
      if (closed || gen !== generation) return
      await bridge?.stop()
      bridge = undefined
      ctx.logger?.warn?.(
        'dsh-feishu-remote: 配置无效，通道保持禁用（fail-closed）：%s',
        error instanceof Error ? error.message : String(error),
      )
      return
    }
    if (closed || gen !== generation) return
    const next = makeBridge(resolved)
    await bridge?.stop()
    if (closed || gen !== generation) {
      await next.stop()
      return
    }
    bridge = next
    await next.start().catch(error => {
      ctx.logger?.error?.('dsh-feishu-remote: 通道启动失败：%s', error instanceof Error ? error.message : String(error))
    })
    // A generation change may have arrived DURING start(): retire the stale
    // bridge immediately (review #4 finding 4).
    if (closed || gen !== generation) {
      await next.stop()
      bridge = undefined
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
  await sync()
}
