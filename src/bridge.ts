/**
 * The Feishu ⇄ Harness bridge (docs/05). Core design points implemented here:
 *
 * - embedded in the dsh web profile: `apply()` never rejects; the channel
 *   connect loop runs as a background task with retry (D1)
 * - thread ↔ session mapping with a deterministic `feishu-` prefix and
 *   session persistence as the single source of truth (D2); `/new` pending
 *   marker protocol; `/resume` atomic probe-then-swap (D2/§2.6)
 * - approval answerer registered with `{ prepend: true }`, claiming only
 *   Feishu-originated turns via the turn ledger; GUI turns fall through to
 *   the GUI answerer (D3/§2.3)
 * - per-origin control queue; `/stop` = `cancel({kind:'user'}, {keepInbox:true})`
 * - streaming via `session/event` with ~1s throttled card updates, step-level
 *   chunk/final replacement, seq watermark dedup, terminal outcome mapping (D4/§2.5)
 * - fail-closed allowlists; ask-user tools are restricted on Feishu sessions
 *   (no browser-routed questions; D5/D8/§2.4)
 * - every outbound API call flows through the application-level scheduler (D7)
 */
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset, type AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-workspace'
import type { CardActionEvent, NormalizedMessage, ReactionEvent, SendOptions } from '@larksuiteoapi/node-sdk'
import { buildApprovalCard, buildOversizeCard, buildStatusCard, buildTurnCard, parseBridgeAction } from './cards.js'
import { DEFAULT_CHANNEL_FACTORY } from './channel.js'
import { activeSessionsForPrefix, freshSessionId, latestSession, originOf, sessionPrefix, sessionsForPrefix, type Origin } from './identity.js'
import { OutboundScheduler, classifyOutboundError, type OutboundTask, type TaskResult } from './scheduler.js'
import { bounded, boundedUtf8Buffer, canonicalPath, redactSecrets, saveOversizedText } from './security.js'
import { BridgeStateStore } from './state.js'
import type {
  BridgeAction,
  CardPreset,
  ChannelFactory,
  LarkChannelLike,
  ResolvedConfig,
  TurnProgress,
  TurnStepText,
} from './types.js'

const HELP_TEXT = `## DeepSeek Harness Feishu Remote

- 直接发消息：排入当前话题会话的下一回合
- \`/steer <内容>\`：在运行中把内容送到最近一步
- \`/status\`：查看连接、模型、目录和会话状态
- \`/stop\`：停止当前回合（后续消息照常进入下一回合）
- \`/approve\` / \`/reject\`：允许或拒绝当前一次工具审批（文字兜底，必需路径）
- \`/new\`：登记新会话（下一条普通消息创建全新会话）
- \`/sessions\`：列出当前话题的历史 Session
- \`/resume <session-id>\`：恢复一个历史 Session（仅限同话题前缀）
- \`/view compact|standard|developer\`：切换卡片密度
- \`/help\`：显示本说明

飞书卡片按钮可直接处理审批、停止任务和新建会话。群聊请在每个话题内 @机器人。`

/** Ask-user tools blocked on Feishu sessions: questions must never reach the unattended browser. */
const BLOCKED_TOOLS = ['ask_user_question', 'exit_plan_mode'] as const

interface RouteContext {
  chatId: string
  chatType: 'p2p' | 'group'
  ownerOpenId: string
  replyTo?: string
  replyInThread: boolean
}

interface BridgeSession {
  readonly key: string
  readonly prefix: string
  route: RouteContext
  handle: AgentHandle
  sessionId: string
  cardPreset: CardPreset
  pendingPrompt: string
  progress?: TurnProgress
  progressTimer?: ReturnType<typeof setTimeout>
  activeTurnOrigin?: 'feishu' | 'gui'
  /** Monotonic event-seq watermark (per-session ordered dispatch → O(1) dedup). Starts at -1: seq 0 is a valid first event. */
  lastSeq: number
  /**
   * Turn ledger (exact, rc.6 `agent/inbox/claimed`): OUR queued messages not
   * yet claimed by the loop, keyed by their UserMessage id. A claim maps the
   * message to its turn, so GUI/Feishu interleaving can never misattribute
   * (docs/05 §2.1; Codex P0-1).
   */
  pendingClaims: Map<string, { replyTo?: string; replyInThread: boolean }>
  /** turn → origin and reply context, written by the claimed handler. */
  turnOrigin: Map<number, 'feishu' | 'gui'>
  turnReply: Map<number, { replyTo?: string; replyInThread: boolean }>
  /** Reply context of the currently active turn (feishu: the claimed message's; gui: thread-only). */
  activeReply?: { replyTo?: string; replyInThread: boolean }
  /** In-flight turn finalizer (terminal card + archive). Switches await it so old work never crosses a swap. */
  pendingFinalize?: Promise<void>
}

interface PendingApproval {
  token: string
  entry: BridgeSession
  /** Immutable snapshot at request time — settlement never trusts the mutable entry (Codex P1-6). */
  expectedOpenId: string
  chatId: string
  sessionId: string
  toolName: string
  reason?: string
  callId?: string
  messageId?: string
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
  resolve: (outcome: ApprovalOutcome) => void
}

interface TurnCardUpsertOptions {
  /** Explicit re-render (e.g. /view preset switch): bypasses the stale-progress guard. */
  explicit?: boolean
}

function errorMessage(error: unknown): string {
  try {
    return redactSecrets(error instanceof Error ? error.message : String(error))
  } catch {
    return '<无法呈现的错误>'
  }
}

function isCardPreset(value: string): value is CardPreset {
  return value === 'compact' || value === 'standard' || value === 'developer'
}

function nextCardPreset(current: CardPreset): CardPreset {
  if (current === 'compact') return 'standard'
  if (current === 'standard') return 'developer'
  return 'compact'
}

function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function toolSummary(argumentsText: string): string {
  const clean = redactSecrets(argumentsText)
  try {
    const parsed = JSON.parse(clean) as unknown
    if (typeof parsed !== 'object' || parsed === null) return bounded(clean, 180)
    const record = parsed as Record<string, unknown>
    const preferred = ['file_path', 'path', 'command', 'query', 'pattern', 'description', 'url']
    const values = preferred
      .filter(key => typeof record[key] === 'string')
      .map(key => `${key}: ${String(record[key])}`)
    return bounded(values.length > 0 ? values.join(' · ') : JSON.stringify(record), 180)
  } catch {
    return bounded(clean, 180)
  }
}

/** Raw `turn/end.reason.kind` → card outcome (docs/05 §2.5:二次映射, not a direct cancelled). */
function terminalOutcome(reason: Extract<SessionEvent, { type: 'turn/end' }>['data']['reason']): {
  outcome: 'completed' | 'cancelled' | 'blocked' | 'error'
  detail?: string
} {
  switch (reason.kind) {
    case 'completed': return { outcome: 'completed' }
    case 'aborted': return { outcome: 'cancelled', detail: `取消来源：${reason.reason.kind}` }
    case 'blocked': return { outcome: 'blocked', detail: 'Agent 未能继续当前轮次。' }
    case 'max-tokens': return { outcome: 'blocked', detail: '模型输出达到 token 上限。' }
    case 'error': return { outcome: 'error', detail: reason.error.message }
    case 'interrupted': return { outcome: 'error', detail: 'Harness 进程中断了该轮次。' }
    default: return { outcome: 'error', detail: `未知结束原因：${String((reason as { kind?: unknown }).kind)}` }
  }
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Bidirectional adapter between the official Lark Channel API and native Harness agents. */
export class FeishuRemoteBridge {
  private channel?: LarkChannelLike
  private readonly state: BridgeStateStore
  private readonly scheduler: OutboundScheduler
  private readonly sessions = new Map<string, BridgeSession>()
  private readonly creating = new Map<string, Promise<BridgeSession>>()
  private readonly agents = new Map<string, BridgeSession>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly originQueues = new Map<string, Promise<void>>()
  private disposers: Array<() => void> = []
  private connected = false
  private stopped = false
  private started = false
  private terminalFailure = false
  private connectionAbort?: AbortController
  private lifetimeAbort?: AbortController
  /** In-flight session creations/resumes, for the maxLiveAgents admission check. */
  private liveReservations = 0

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    options: {
      channelFactory?: ChannelFactory
      scheduler?: OutboundScheduler
      /** WS status poll interval (short in tests). */
      channelPollMs?: number
      /** Reconnect backoff base (short in tests; default 30s, cap 5min). */
      reconnectBaseMs?: number
      /** Bound for teardown's producer/finalizer wait (short in tests). */
      teardownProducerMs?: number
    } = {},
  ) {
    this.channelFactory = options.channelFactory ?? DEFAULT_CHANNEL_FACTORY
    this.channelPollMs = options.channelPollMs ?? 5_000
    this.reconnectBaseMs = options.reconnectBaseMs ?? 30_000
    this.teardownProducerMs = options.teardownProducerMs ?? 10_000
    this.state = new BridgeStateStore(config.statePath)
    this.state.onCorrupt.push(event => {
      ctx.logger?.warn?.('dsh-feishu-remote: 状态文件损坏，已隔离到 %s（%s），从空状态重建', event.corruptPath, event.reason)
    })
    this.scheduler = options.scheduler ?? new OutboundScheduler({ logger: {
      warn: (message, ...args) => ctx.logger?.warn?.(message, ...args),
      error: (message, ...args) => ctx.logger?.error?.(message, ...args),
      info: (message, ...args) => ctx.logger?.info?.(message, ...args),
    } })
  }

  private readonly channelFactory: ChannelFactory
  private readonly channelPollMs: number
  private readonly reconnectBaseMs: number
  private readonly teardownProducerMs: number

  // ---------------------------------------------------------------- guards

  private isGloballyAllowed(openId: string): boolean {
    return this.config.allowAllUsers || this.config.allowedOpenIds.includes(openId)
  }

  private isAuthorizedAction(entry: BridgeSession, openId: string, chatId: string): boolean {
    if (entry.route.chatId !== chatId || !this.isGloballyAllowed(openId)) return false
    return entry.route.ownerOpenId === openId
  }

  private freshHeaders(): Promise<SessionHeader[]> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return Promise.resolve([])
    return persistence.list()
  }

  private archivedIds(): ReadonlySet<string> {
    const workspace = this.ctx.get('workspaceRegistry')
    return new Set((workspace?.archivedSessionIds ?? []).map(String))
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.stopped = false
    this.lifetimeAbort = new AbortController()
    try {
      await this.state.refresh()
    } catch (error) {
      this.ctx.logger?.warn?.('dsh-feishu-remote: 状态文件初始化失败，通道禁用：%s', errorMessage(error))
      this.started = false
      return
    }
    // stop() may run while this await was pending: never register listeners
    // for a bridge that was already torn down (review #2 finding 4).
    if (this.stopped) {
      this.started = false
      return
    }

    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      this.onSessionEvent(session, event)
    }))
    // Exact turn ledger (rc.6): the loop claims one queued message per turn;
    // correlate OUR messages to their turn instead of guessing by count.
    this.disposers.push(this.ctx.on('agent/inbox/claimed', payload => {
      const entry = this.agents.get(String(payload.agent.id))
      if (entry === undefined) return
      const reply = entry.pendingClaims.get(String(payload.message.id))
      if (reply === undefined) return // a GUI-originated message
      entry.pendingClaims.delete(String(payload.message.id))
      entry.turnOrigin.set(payload.turn, 'feishu')
      entry.turnReply.set(payload.turn, reply)
      // The claim may land after turn/start; no approval/output precedes it.
      if (entry.progress !== undefined && entry.progress.turn === payload.turn) {
        entry.activeTurnOrigin = 'feishu'
        entry.activeReply = reply
        entry.progress.reply = reply
      }
    }))
    // Discarded messages can never open a turn — drop their ledger entries so
    // the switch guard's ledger view stays honest (review #3 finding 1).
    this.disposers.push(this.ctx.on('agent/inbox/discarded', payload => {
      const entry = this.agents.get(String(payload.agent.id))
      if (entry === undefined) return
      entry.pendingClaims.delete(String(payload.message.id))
    }))
    this.disposers.push(this.ctx.on('approval/request', async (request, next) => {
      if (!this.config.enableApprovals) return next()
      const entry = this.agents.get(String(request.agent.id))
      // 回合归属：只有飞书发起的回合才认领；GUI 回合放行给 GUI answerer（docs/05 §2.3）。
      if (entry === undefined || entry.activeTurnOrigin !== 'feishu') return next()
      return this.askApproval(entry, request)
    }, { prepend: true }))

    void this.connectLoop()
  }

  /**
   * Race every channel API call against the bridge LIFETIME signal: teardown
   * aborts hung SDK calls, so shutdown can reach true quiescence (review #6 F2).
   */
  private wrapChannel(raw: LarkChannelLike, signal: AbortSignal): LarkChannelLike {
    const raced = <T>(operation: () => Promise<T>): Promise<T> => {
      if (signal.aborted) return Promise.reject(new Error('飞书通道已关闭'))
      let onAbort: (() => void) | undefined
      const abortable = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('飞书通道已关闭'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      // Normalize through a microtask: a synchronous throw must not bypass
      // the listener cleanup below (review #8 finding 3); recheck the signal
      // INSIDE the normalized op so an abort queued before the microtask
      // never invokes the raw operation afterwards (review #9 finding 2).
      const run = Promise.race([Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('飞书通道已关闭')
        return operation()
      }), abortable])
      // Remove the listener once either side settles — no per-call leak
      // (review #7 finding 2).
      run.finally(() => {
        if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
      }).catch(() => undefined)
      return run
    }
    return {
      get botIdentity() { return raw.botIdentity },
      connect: () => raw.connect(),
      disconnect: () => raw.disconnect(),
      getConnectionStatus: () => raw.getConnectionStatus(),
      on: (name, handler) => raw.on(name, handler),
      send: (to, input, options) => raced(() => raw.send(to, input, options)),
      updateCard: (messageId, card) => raced(() => raw.updateCard(messageId, card)),
      downloadMessageResource: (messageId, fileKey, type, maxBytes) => raw.downloadMessageResource(messageId, fileKey, type, maxBytes),
    }
  }

  /** One bounded disconnect helper for every teardown path (review #7 finding 2). */
  private async disconnectBounded(channel: LarkChannelLike | undefined): Promise<void> {
    if (channel === undefined) return
    await Promise.race([
      channel.disconnect().catch(() => undefined),
      sleep(5_000),
    ])
  }

  /**
   * Old handles retired by a swap: the RAW disposal promise is tracked so a
   * bounded wait can never lose the handle — teardown drains the same promise
   * against its own bound (review #8 finding 2).
   */
  private readonly retiringHandles = new Map<AgentHandle, Promise<void>>()

  private retireHandle(handle: AgentHandle): void {
    const raw = handle.dispose()
    this.retiringHandles.set(handle, raw)
    void raw.catch(error => {
      this.ctx.logger?.warn?.('dsh-feishu-remote: 旧会话清理失败（不影响新会话）：%s', errorMessage(error))
    }).finally(() => {
      this.retiringHandles.delete(handle)
    })
  }

  /** Provisional probes acquired before a commit decision — teardown owns their disposal (review #8 finding 1). */
  private readonly provisionalHandles = new Set<AgentHandle>()

  private wireChannel(channel: LarkChannelLike): () => void {
    const off: Array<() => void> = []
    off.push(channel.on('message', message => {
      this.onMessage(message).catch(error => {
        this.ctx.logger?.error?.('dsh-feishu-remote: 消息处理失败：%s', errorMessage(error))
      })
    }))
    off.push(channel.on('reject', event => {
      this.ctx.logger?.warn?.(
        'dsh-feishu-remote: 已按策略拒绝飞书消息：reason=%s sender=%s chat=%s message=%s',
        event.reason, event.senderId, event.chatId, event.messageId,
      )
    }))
    off.push(channel.on('cardAction', event => {
      this.onCardAction(event).catch(error => {
        this.ctx.logger?.error?.('dsh-feishu-remote: 卡片回调处理失败：%s', errorMessage(error))
      })
    }))
    off.push(channel.on('reaction', event => this.onReaction(event)))
    off.push(channel.on('reconnecting', () => {
      this.connected = false
      this.ctx.logger?.warn?.('dsh-feishu-remote: 飞书长连接正在重连')
    }))
    off.push(channel.on('reconnected', () => {
      this.connected = true
      this.terminalFailure = false
      this.ctx.logger?.info?.('dsh-feishu-remote: 飞书长连接已恢复')
    }))
    off.push(channel.on('error', error => {
      this.ctx.logger?.error?.('dsh-feishu-remote: 飞书通道错误：%s', errorMessage(error))
    }))
    return () => {
      for (const dispose of off.reverse()) dispose()
    }
  }

  /**
   * Background connect loop with rebuild-on-terminal-failure (docs/05 §2.3 第六条).
   * Never rejects: the web profile must survive a dead Feishu channel (D1).
   * Per-connection controller vs. bridge LIFETIME controller: the backoff wait
   * must survive the retired connection's abort (Codex P1-5).
   */
  private async connectLoop(): Promise<void> {
    let attempt = 0
    while (!this.stopped) {
      const raw = this.channelFactory(this.config)
      const channel = this.wrapChannel(raw, this.lifetimeAbort?.signal ?? new AbortController().signal)
      const connectionAbort = new AbortController()
      this.connectionAbort = connectionAbort
      const unwire = this.wireChannel(channel)
      this.channel = channel
      try {
        await channel.connect()
        this.connected = true
        this.terminalFailure = false
        attempt = 0
        this.ctx.logger?.info?.('dsh-feishu-remote: 已连接飞书机器人 %s', channel.botIdentity?.name ?? 'unknown')
        await this.awaitChannel(channel, connectionAbort.signal)
      } catch (error) {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 飞书长连接失败：%s', errorMessage(error))
      } finally {
        this.connected = false
        unwire()
        if (this.channel === channel) this.channel = undefined
        connectionAbort.abort()
        await this.disconnectBounded(channel)
      }
      if (this.stopped) break
      attempt += 1
      const delay = Math.min(this.reconnectBaseMs * 2 ** Math.min(attempt - 1, 4), 5 * 60_000)
      this.ctx.logger?.warn?.('dsh-feishu-remote: %dms 后重建飞书长连接（第 %d 次）', delay, attempt)
      const lifetime = this.lifetimeAbort
      if (lifetime === undefined) break
      await sleepAbortable(delay, lifetime.signal)
    }
  }

  /** Wait until the SDK gives up (terminal failure) or the bridge stops. */
  private async awaitChannel(channel: LarkChannelLike, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await sleepAbortable(this.channelPollMs, signal)
      if (signal.aborted) return
      const status = channel.getConnectionStatus?.()
      if (status?.state === 'failed') {
        this.onChannelTerminalFailure()
        return
      }
    }
  }

  /**
   * WSClient terminal error: the SDK has stopped reconnecting (retries
   * exhausted / credential invalid). Settle every pending approval as
   * `unavailable`, flag /status red; the connect loop rebuilds the channel.
   */
  private onChannelTerminalFailure(): void {
    this.terminalFailure = true
    this.connected = false
    this.ctx.logger?.error?.('dsh-feishu-remote: 飞书长连接进入终态失效（SDK 已停止重连），结算全部待审批并重建通道')
    for (const pending of [...this.pendingApprovals.values()]) {
      this.settleApproval(pending, 'unavailable')
    }
  }

  /** Memoized teardown: concurrent callers await the SAME shutdown (review #4 F2). */
  private stopPromise?: Promise<void>

  async stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise
    const run = this.teardown().finally(() => {
      this.stopPromise = undefined
    })
    this.stopPromise = run
    return run
  }

  private async teardown(): Promise<void> {
    this.stopped = true
    this.started = false
    this.lifetimeAbort?.abort()
    this.connectionAbort?.abort()
    this.connected = false
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    for (const entry of this.sessions.values()) {
      if (entry.progressTimer !== undefined) clearTimeout(entry.progressTimer)
    }
    for (const pending of [...this.pendingApprovals.values()]) this.settleApproval(pending, 'unavailable')
    // Close the outbound gate FIRST: producers that enqueue now settle 'closed'
    // immediately instead of hanging on a dead channel (review #5 F2).
    this.scheduler.close()
    await this.scheduler.shutdown()
    // Drain in-flight control work, creations, AND detached turn finalizers
    // with a bounded wait: a never-settling producer must not hang teardown.
    await Promise.race([
      Promise.allSettled([
        ...this.originQueues.values(),
        ...this.creating.values(),
        ...[...this.sessions.values()].map(entry => entry.pendingFinalize).filter((value): value is Promise<void> => value !== undefined),
      ]),
      sleep(this.teardownProducerMs),
    ])
    // Disconnect aborts any hung channel call; then await the last dispatches.
    // Disconnect and disposal are themselves bounded: teardown must terminate
    // even against a pathological backend (review #6 finding 2).
    await this.disconnectBounded(this.channel)
    await this.scheduler.shutdown()
    const sessionHandles = [...this.sessions.values()].map(entry => entry.handle)
    this.sessions.clear()
    this.agents.clear()
    const retiring = [...this.retiringHandles.entries()]
    this.retiringHandles.clear()
    const provisional = [...this.provisionalHandles]
    this.provisionalHandles.clear()
    await Promise.allSettled([
      ...sessionHandles.map(handle => Promise.race([handle.dispose(), sleep(5_000)])),
      // Retired handles: race the SAME raw promise the retire started — a
      // bounded wait can never lose track of the underlying disposal.
      ...retiring.map(([handle, raw]) => Promise.race([raw, sleep(5_000)]).finally(() => {
        if (this.retiringHandles.get(handle) === raw) this.retiringHandles.delete(handle)
      })),
      ...provisional.map(handle => Promise.race([handle.dispose(), sleep(5_000)])),
    ])
  }

  /**
   * maxLiveAgents admission: a RESERVATION LEASE the caller holds until it
   * commits ownership (agents.set) — no reservation-to-ownership gap
   * (Codex review #3 finding 3).
   */
  private acquireReservation(replacing = false): { release(): void } {
    const replacingAdjustment = replacing ? 1 : 0
    if (this.config.maxLiveAgents > 0 && this.agents.size + this.liveReservations - replacingAdjustment >= this.config.maxLiveAgents) {
      throw new Error(`live agent 数量已达上限 ${this.config.maxLiveAgents}，请先结束其他话题的会话`)
    }
    this.liveReservations += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.liveReservations -= 1
      },
    }
  }

  /**
   * Drain every in-flight turn finalizer before a switch commits: the old
   * turn's card/archive work must never read a swapped session (review #4 F1).
   * Revalidates between finalizers because a new turn may have just ended.
   */
  /**
   * Drain finalizers, then run the COMMIT synchronously right after the final
   * switchability check — the commit callback executes in the same microtask,
   * so no event can install work between the check and the swap (review #6 F1).
   * Finalizers form a CHAIN: awaiting it covers every predecessor; identity
   * comparison detects a new finalizer appended while we waited.
   */
  private async awaitQuiescent<T>(entry: BridgeSession, what: string, commit: () => T): Promise<T> {
    let awaited = entry.pendingFinalize
    for (let guard = 0; guard < 10; guard += 1) {
      if (awaited !== undefined) await awaited
      this.assertSwitchable(entry, what)
      // A finalizer can outlive teardown's bounded producer wait: the bridge
      // may have stopped and disposed this entry meanwhile. Never commit into
      // a stopped bridge or a replaced entry (review #7 finding 1).
      if (this.stopped || this.sessions.get(entry.key) !== entry) {
        throw new Error('插件已停止或会话已被替换，切换被取消')
      }
      if (entry.pendingFinalize === awaited) return commit()
      awaited = entry.pendingFinalize
    }
    // Guard exhaustion must REJECT, never proceed unsafely (review #5 F1).
    throw new Error(`${what}：会话持续产出收尾工作，切换中止，请稍后重试`)
  }

  /**
   * Session switching is destructive: refuse while a turn is running or ANY
   * inbox work (ours or the GUI's) is pending — a switch would silently
   * discard accepted inbox work and orphan running cards (review #2 F2 +
   * review #3 F1: the inbox is the authoritative source, not just our ledger).
   */
  private assertSwitchable(entry: BridgeSession, what: string): void {
    if (entry.handle.agent.status === 'running') {
      throw new Error(`${what}：当前回合仍在运行，请先 /stop 并等待回合结束`)
    }
    if (entry.pendingClaims.size > 0 || entry.handle.agent.inbox.hasPending === true) {
      throw new Error(`${what}：话题里还有排队中的消息，请等待它们被处理后再切换`)
    }
  }

  /** Settle approvals of a session being switched away from (old cards stay valid, decisions close). */
  private settleSessionApprovals(sessionId: string): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.sessionId === sessionId) this.settleApproval(pending, 'unavailable')
    }
  }

  // ---------------------------------------------------------------- inbound

  private async onMessage(message: NormalizedMessage): Promise<void> {
    // 3-second callback budget: authenticate synchronously, enqueue the rest.
    if (this.stopped) return
    if (!this.isGloballyAllowed(message.senderId)) {
      this.ctx.logger?.warn?.(
        'dsh-feishu-remote: 已拒绝未授权飞书用户（把该 open_id 抄入 allowedOpenIds 即可自举）：sender=%s chat=%s message=%s',
        message.senderId, message.chatId, message.messageId,
      )
      return
    }
    if (message.chatType === 'group' && !this.config.allowedChatIds.includes(message.chatId)) {
      this.ctx.logger?.warn?.('dsh-feishu-remote: 已拒绝未授权群聊（fail-closed）：chat=%s sender=%s', message.chatId, message.senderId)
      void this.safeSend(message.chatId, { markdown: '该群未被授权使用本机器人（allowedChatIds fail-closed）。' }, message)
      return
    }
    const origin = originOf(message)
    if (origin.kind === 'nonthread') {
      this.ctx.logger?.warn?.('dsh-feishu-remote: 已拒绝群内非话题消息：chat=%s message=%s', message.chatId, message.messageId)
      void this.safeSend(message.chatId, { markdown: '请在话题内 @我 发送任务。' }, message)
      return
    }
    this.enqueueOrigin(origin.key, () => this.handleMessage(message, origin))
  }

  private async handleMessage(message: NormalizedMessage, origin: Extract<Origin, { kind: 'p2p' | 'thread' }>): Promise<void> {
    try {
      await this.state.refresh()
      const text = message.content.trim()
      if (text.startsWith('/')) {
        await this.handleCommand(message, text, origin)
        return
      }
      if (text === '') return
      // /new pending protocol: the marker must win over the live-session fast
      // path (Codex P1-2); rotateToFresh consumes the marker atomically.
      let entry: BridgeSession
      if (this.state.isPendingNew(origin.key) && this.sessions.has(origin.key)) {
        entry = await this.rotateToFresh(origin)
      } else {
        entry = await this.ensureSession(message, origin)
      }
      entry.route.replyTo = message.messageId
      entry.route.replyInThread = origin.kind === 'thread'
      entry.pendingPrompt = bounded(text, 700)
      const content: ContentBlock[] = [{ type: 'text', text }]
      const userMessage = createUserMessage({ content, source: { kind: 'user' } })
      entry.pendingClaims.set(String(userMessage.id), {
        replyTo: message.messageId,
        replyInThread: origin.kind === 'thread',
      })
      entry.handle.agent.followup(userMessage)
    } catch (error) {
      this.ctx.logger?.error?.('dsh-feishu-remote: 消息处理失败：%s', errorMessage(error))
      await this.safeSend(message.chatId, {
        markdown: `❌ 无法把这条消息交给 DeepSeek Harness：${bounded(errorMessage(error), 600)}`,
      }, message)
    }
  }

  /** Per-origin serial control queue (docs/05 §2.8): FIFO messages + same-lock commands/card actions. */
  private enqueueOrigin(key: string, work: () => Promise<void>): void {
    const previous = this.originQueues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work).catch(error => {
      this.ctx.logger?.error?.('dsh-feishu-remote: 控制队列任务失败（origin=%s）：%s', key, errorMessage(error))
    })
    this.originQueues.set(key, next)
    void next.then(() => {
      if (this.originQueues.get(key) === next) this.originQueues.delete(key)
    })
  }

  // ---------------------------------------------------------------- commands

  private async handleCommand(message: NormalizedMessage, line: string, origin: Extract<Origin, { kind: 'p2p' | 'thread' }>): Promise<void> {
    const [command = '', ...args] = line.trim().split(/\s+/u)
    const argument = args.join(' ').trim()
    switch (command.toLowerCase()) {
      case '/start':
      case '/help':
        await this.safeSend(message.chatId, { markdown: HELP_TEXT }, message)
        return
      case '/new': {
        await this.state.setPendingNew(origin.key, true)
        await this.safeSend(message.chatId, {
          markdown: '✅ 已登记新会话请求：**下一条普通消息**将创建全新会话。',
        }, message)
        return
      }
      case '/stop': {
        const entry = this.sessions.get(origin.key)
        if (entry === undefined || entry.handle.agent.status === 'idle') {
          await this.safeSend(message.chatId, { markdown: '当前没有运行中的任务。' }, message)
          return
        }
        entry.handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
        await this.safeSend(message.chatId, {
          markdown: '⏹️ 已停止当前回合；已确认的后续消息会照常进入下一回合。',
        }, message)
        return
      }
      case '/approve':
      case '/reject': {
        // Text fallback must match the CURRENT live session too: after a
        // switch, an old-session approval is settled unavailable, not answerable.
        const liveEntry = this.sessions.get(origin.key)
        const pending = [...this.pendingApprovals.values()].find(item => (
          item.entry.key === origin.key
          && item.expectedOpenId === message.senderId
          && item.chatId === message.chatId
          && liveEntry !== undefined
          && liveEntry.sessionId === item.sessionId
        ))
        if (pending === undefined) {
          await this.safeSend(message.chatId, { markdown: '当前飞书会话没有等待处理的工具审批。' }, message)
          return
        }
        const allowed = command.toLowerCase() === '/approve'
        this.settleApproval(pending, allowed ? 'allowed-once' : 'rejected')
        await this.safeSend(message.chatId, {
          markdown: allowed ? '✅ 已仅允许当前这一次操作。' : '⛔ 已拒绝当前这一次操作。',
        }, message)
        return
      }
      case '/status': {
        const entry = await this.ensureSession(message, origin)
        await this.sendStatus(entry, message)
        return
      }
      case '/steer': {
        if (argument === '') {
          await this.safeSend(message.chatId, { markdown: '用法：`/steer <补充或纠正内容>`' }, message)
          return
        }
        const entry = await this.ensureSession(message, origin)
        // Steer joins the CURRENT step; only when the agent is idle does steer
        // open a new turn — that turn is ours, so register it for the ledger.
        const steerMessage = createUserMessage({
          content: [{ type: 'text', text: argument }],
          source: { kind: 'user' },
        })
        if (entry.handle.agent.status === 'idle') {
          entry.pendingClaims.set(String(steerMessage.id), {
            replyTo: message.messageId,
            replyInThread: origin.kind === 'thread',
          })
        }
        entry.handle.agent.steer(steerMessage)
        await this.safeSend(message.chatId, { markdown: '🧭 已把补充内容送到 Agent 的最近一步。' }, message)
        return
      }
      case '/sessions': {
        const prefix = sessionPrefix(origin.key)
        const headers = await this.freshHeaders()
        const rows = activeSessionsForPrefix(headers, prefix, this.archivedIds()).slice(0, 8)
        const body = rows.length === 0
          ? '还没有持久化的历史会话。'
          : rows.map(header => `- \`${header.id}\` · ${new Date(header.createdAt).toLocaleString('zh-CN')}`).join('\n')
        await this.safeSend(message.chatId, { markdown: `## 历史 Session\n${body}` }, message)
        return
      }
      case '/resume': {
        await this.resumeFromCommand(message, origin, argument)
        return
      }
      case '/view': {
        const entry = await this.ensureSession(message, origin)
        if (argument === '') {
          await this.safeSend(message.chatId, {
            markdown: `当前卡片视图：\`${entry.cardPreset}\`。用法：\`/view compact|standard|developer\``,
          }, message)
          return
        }
        if (!isCardPreset(argument)) {
          await this.safeSend(message.chatId, { markdown: '视图必须是 `compact`、`standard` 或 `developer`。' }, message)
          return
        }
        entry.cardPreset = argument
        await this.state.setCardView(origin.key, argument)
        if (entry.progress !== undefined && entry.progress.progressMessageId !== undefined) {
          // Explicit re-render: /view works on a settled turn too (Round 12 F2).
          void this.upsertTurnCard(entry, entry.progress, undefined, undefined, { explicit: true })
        }
        await this.safeSend(message.chatId, { markdown: `✅ 当前 Session 已切换为 \`${argument}\` 视图。` }, message)
        return
      }
      case '/commands': {
        const body = this.config.commandAllowlist.length === 0
          ? '原生命令透传未开启（commandAllowlist 为空）。'
          : this.config.commandAllowlist.map(name => `- \`/${name}\``).join('\n')
        await this.safeSend(message.chatId, { markdown: `## 可透传的 Harness 原生命令\n${body}` }, message)
        return
      }
      default: {
        // 原生命令透传 allowlist（docs/05 §2.7, Codex R8）：未知命令默认拒绝。
        const name = command.replace(/^\//u, '').toLowerCase()
        if (!this.config.commandAllowlist.includes(name)) {
          await this.safeSend(message.chatId, {
            markdown: `未知命令 \`${command}\`。发送 \`/help\` 查看可用控制；Harness 原生命令需显式列入 \`commandAllowlist\` 才会透传。`,
          }, message)
          return
        }
        const entry = await this.ensureSession(message, origin)
        const commands = this.ctx.get('commands')
        const execution = commands === undefined
          ? undefined
          : await commands.execute(entry.handle.agent, line, new AbortController().signal)
        if (execution === undefined) {
          await this.safeSend(message.chatId, { markdown: `命令 \`${command}\` 未能执行。` }, message)
          return
        }
        const result = execution.result
        await this.safeSend(message.chatId, {
          markdown: result.text ?? (result.kind === 'success' ? '✅ 命令已执行。' : '❌ 命令执行失败。'),
        }, message)
      }
    }
  }

  private async resumeFromCommand(
    message: NormalizedMessage,
    origin: Extract<Origin, { kind: 'p2p' | 'thread' }>,
    argument: string,
  ): Promise<void> {
    if (argument === '') {
      await this.safeSend(message.chatId, { markdown: '用法：`/resume <session-id>`' }, message)
      return
    }
    try {
      const entry = await this.ensureSession(message, origin)
      const headers = await this.freshHeaders()
      const archived = this.archivedIds()
      const target = headers.find(header => String(header.id) === argument)
      if (target === undefined || !String(target.id).startsWith(`${entry.prefix}-`)) {
        await this.safeSend(message.chatId, { markdown: '找不到属于当前飞书话题的该 Session。' }, message)
        return
      }
      if (archived.has(argument)) {
        await this.safeSend(message.chatId, { markdown: '该会话已被 Web GUI 归档，不能自动续上。' }, message)
        return
      }
      if (String(target.id) === entry.sessionId) {
        await this.safeSend(message.chatId, { markdown: `当前已在会话 \`${entry.sessionId}\` 中。` }, message)
        return
      }
      if (target.cwd !== undefined && !this.cwdMatches(target.cwd)) {
        await this.safeSend(message.chatId, {
          markdown: `目标会话的工作目录与当前配置不一致，已拒绝恢复（cwd 漂移防护）。`,
        }, message)
        return
      }
      if (this.ctx.agents.get(target.id) !== undefined) {
        await this.safeSend(message.chatId, {
          markdown: '该会话已由另一个入口打开（如 Web GUI），请先在那里关闭后再恢复。',
        }, message)
        return
      }
      await this.swapToSession(entry, target)
      await this.safeSend(message.chatId, { markdown: `✅ 已恢复会话：\`${entry.sessionId}\`` }, message)
    } catch (error) {
      this.ctx.logger?.error?.('dsh-feishu-remote: /resume 失败（保留旧会话）：%s', errorMessage(error))
      await this.safeSend(message.chatId, { markdown: `❌ 恢复失败（旧会话保持不变）：${bounded(errorMessage(error), 300)}` }, message)
    }
  }

  /** Atomic /resume: probe-create the target handle FIRST, then swap, then dispose the old one. */
  private async swapToSession(entry: BridgeSession, target: SessionHeader): Promise<void> {
    this.assertSwitchable(entry, '恢复会话')
    const presets = this.ctx.get('agentPresets')
    const persistence = this.ctx.get('sessionPersistence')
    let loggedPreset: string | undefined
    if (presets !== undefined && persistence !== undefined) {
      const inspection = await persistence.inspect(target.id)
      loggedPreset = resolveSessionPreset({ header: inspection.meta, events: inspection.events })
    }
    const lease = this.acquireReservation(true)
    let freshHandle: AgentHandle | undefined
    let committed = false
    try {
      freshHandle = await this.ctx.agents.resume({
        resumeSessionId: target.id,
        agentOptions: this.modelSelection(),
        setup: agentCtx => this.setupAgent(agentCtx, loggedPreset),
      })
      this.provisionalHandles.add(freshHandle)
      if (this.stopped) throw new Error('插件已停止，恢复被取消')
      // Revalidate RIGHT BEFORE the synchronous swap: work may have arrived
      // during the probe awaits (review #3 finding 1), and any in-flight
      // finalizer must finish first (review #4 finding 1). The swap commit
      // runs in the same microtask as the final check (review #6 finding 1).
      let oldHandle: AgentHandle | undefined
      const probe = freshHandle
      await this.awaitQuiescent(entry, '恢复会话', () => {
        this.settleSessionApprovals(entry.sessionId)
        this.agents.delete(entry.sessionId)
        if (entry.progressTimer !== undefined) clearTimeout(entry.progressTimer)
        oldHandle = entry.handle
        entry.handle = probe
        entry.sessionId = String(probe.agent.id)
        entry.progress = undefined
        entry.lastSeq = -1
        entry.activeTurnOrigin = undefined
        entry.activeReply = undefined
        entry.pendingClaims.clear()
        entry.turnOrigin.clear()
        entry.turnReply.clear()
        entry.pendingFinalize = undefined
        this.agents.set(entry.sessionId, entry)
        this.provisionalHandles.delete(probe)
        committed = true
        lease.release()
      })
      // Post-commit cleanup: bounded, tracked, failure is logged not a rollback.
      oldHandle!.agent.cancel({ kind: 'user' }, { keepInbox: true })
      this.retireHandle(oldHandle!)
    } catch (error) {
      lease.release()
      if (!committed && freshHandle !== undefined && this.provisionalHandles.delete(freshHandle)) {
        await freshHandle.dispose().catch(() => undefined)
      }
      throw error
    }
  }

  /**
   * /new pending protocol with a LIVE session: probe-create the fresh handle,
   * persist marker consumption, THEN commit the in-memory swap, and dispose
   * the old one as post-commit cleanup (Codex P1-2 + review #2 finding 3).
   */
  private async rotateToFresh(origin: Extract<Origin, { kind: 'p2p' | 'thread' }>): Promise<BridgeSession> {
    const key = origin.key
    const entry = this.sessions.get(key)
    if (entry === undefined) throw new Error('rotateToFresh requires a live session')
    this.assertSwitchable(entry, '创建新会话')
    const presets = this.ctx.get('agentPresets')
    let presetId: string | undefined
    if (presets !== undefined) {
      presetId = (await presets.resolve(this.config.agentPreset ?? undefined)).id
    }
    const lease = this.acquireReservation(true)
    let freshHandle: AgentHandle | undefined
    let committed = false
    try {
      freshHandle = await this.createFreshAgent(entry.prefix, this.modelSelection(), presetId)
      this.provisionalHandles.add(freshHandle)
      if (this.stopped) throw new Error('插件已停止，创建新会话被取消')
      // Persist the marker consumption while the OLD mapping is still intact:
      // a state-write failure disposes the probe and keeps the old session.
      await this.state.setPendingNew(key, false)
      // Revalidate immediately before the synchronous swap; drain finalizers.
      let oldHandle: AgentHandle | undefined
      const probe = freshHandle
      await this.awaitQuiescent(entry, '创建新会话', () => {
        this.settleSessionApprovals(entry.sessionId)
        this.agents.delete(entry.sessionId)
        if (entry.progressTimer !== undefined) clearTimeout(entry.progressTimer)
        oldHandle = entry.handle
        entry.handle = probe
        entry.sessionId = String(probe.agent.id)
        entry.progress = undefined
        entry.pendingPrompt = '飞书任务'
        entry.lastSeq = -1
        entry.activeTurnOrigin = undefined
        entry.activeReply = undefined
        entry.pendingClaims.clear()
        entry.turnOrigin.clear()
        entry.turnReply.clear()
        entry.pendingFinalize = undefined
        this.agents.set(entry.sessionId, entry)
        this.provisionalHandles.delete(probe)
        committed = true
        lease.release()
      })
      oldHandle!.agent.cancel({ kind: 'user' }, { keepInbox: true })
      this.retireHandle(oldHandle!)
      return entry
    } catch (error) {
      lease.release()
      if (!committed && freshHandle !== undefined && this.provisionalHandles.delete(freshHandle)) {
        await freshHandle.dispose().catch(() => undefined)
      }
      // Guard/stop messages already read well — pass them through unwrapped.
      if (error instanceof Error && (error.message.startsWith('插件已停止') || error.message.startsWith('创建新会话'))) {
        throw error
      }
      throw new Error(`创建新会话失败（保留旧会话）：${errorMessage(error)}`)
    }
  }

  // ---------------------------------------------------------------- sessions

  private async ensureSession(message: NormalizedMessage, origin: Extract<Origin, { kind: 'p2p' | 'thread' }>): Promise<BridgeSession> {
    const key = origin.key
    const existing = this.sessions.get(key)
    if (existing !== undefined) return existing
    const pending = this.creating.get(key)
    if (pending !== undefined) return pending
    const creating = this.createSession(message, origin)
    this.creating.set(key, creating)
    try {
      return await creating
    } finally {
      this.creating.delete(key)
    }
  }

  private async createSession(message: NormalizedMessage, origin: Extract<Origin, { kind: 'p2p' | 'thread' }>): Promise<BridgeSession> {
    const key = origin.key
    const prefix = sessionPrefix(key)
    const headers = await this.freshHeaders()
    const archived = this.archivedIds()
    const wantFresh = this.state.isPendingNew(key)

    const presets = this.ctx.get('agentPresets')
    let presetId: string | undefined
    if (presets !== undefined) {
      presetId = (await presets.resolve(this.config.agentPreset ?? undefined)).id
    }
    const selection = this.modelSelection()
    const route: RouteContext = {
      chatId: message.chatId,
      chatType: message.chatType,
      ownerOpenId: message.senderId,
      replyTo: message.messageId,
      replyInThread: origin.kind === 'thread',
    }

    const lease = this.acquireReservation(false)
    let handle: AgentHandle | undefined
    let committed = false
    try {
      if (!wantFresh) {
        const target = latestSession(activeSessionsForPrefix(headers, prefix, archived), prefix)
        if (target !== undefined) {
          if (target.cwd !== undefined && !this.cwdMatches(target.cwd)) {
            throw new Error(`既有会话的工作目录与配置不一致（cwd 漂移防护）：${target.cwd}`)
          }
          let loggedPreset: string | undefined
          if (presets !== undefined) {
            const persistence = this.ctx.get('sessionPersistence')
            if (persistence !== undefined) {
              const inspection = await persistence.inspect(target.id)
              loggedPreset = resolveSessionPreset({ header: inspection.meta, events: inspection.events })
            }
          }
          handle = await this.ctx.agents.resume({
            resumeSessionId: target.id,
            agentOptions: selection,
            setup: agentCtx => this.setupAgent(agentCtx, loggedPreset ?? presetId),
          })
          this.provisionalHandles.add(handle)
        } else {
          handle = await this.createFreshAgent(prefix, selection, presetId)
          this.provisionalHandles.add(handle)
        }
      } else {
        // /new without a live session: probe-create FIRST, then consume the
        // marker, and dispose the probe if the marker write fails (review #2 F3).
        handle = await this.createFreshAgent(prefix, selection, presetId)
        // Register ownership IMMEDIATELY: a never-settling marker write must
        // not strand the probe outside teardown's reach (review #9 finding 1).
        // This is the ONLY registration for this branch — a duplicate add
        // after a teardown claim would resurrect a disposed handle (review #10 F1).
        this.provisionalHandles.add(handle)
        await this.state.setPendingNew(key, false)
      }
      if (this.stopped) throw new Error('插件已停止，创建会话被取消')

      const entry: BridgeSession = {
        key,
        prefix,
        route,
        handle,
        sessionId: String(handle.agent.id),
        cardPreset: this.state.cardViewFor(key) ?? this.config.cardPreset,
        pendingPrompt: '飞书任务',
        lastSeq: -1,
        pendingClaims: new Map(),
        turnOrigin: new Map(),
        turnReply: new Map(),
      }
      this.sessions.set(key, entry)
      this.agents.set(entry.sessionId, entry)
      this.provisionalHandles.delete(handle)
      committed = true
      lease.release()
      return entry
    } catch (error) {
      lease.release()
      if (!committed && handle !== undefined && this.provisionalHandles.delete(handle)) {
        await handle.dispose().catch(() => undefined)
      }
      throw error
    }
  }

  /** cwd drift guard: compare canonical paths when both exist (Codex P1-8). */
  private cwdMatches(targetCwd: string): boolean {
    if (targetCwd === this.config.cwd) return true
    return canonicalPath(targetCwd) === canonicalPath(this.config.cwd)
  }

  private async createFreshAgent(prefix: string, selection: AgentOptions, presetId?: string): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: await this.nextSessionId(prefix),
      meta: {
        cwd: this.config.cwd,
        ...(presetId === undefined ? {} : { agentPreset: presetId }),
      },
      agentOptions: selection,
      setup: agentCtx => this.setupAgent(agentCtx, presetId),
    })
  }

  /**
   * Session setup (docs/05 §2.2 preset 三契约 + §2.4 ask-user 屏蔽):
   * preset mount happens ONLY here; ask-user tools are restricted AFTER the
   * mount so the deny set covers the preset layer.
   */
  private async setupAgent(agentCtx: Context, presetId?: string): Promise<void> {
    const presets = this.ctx.get('agentPresets')
    if (presets !== undefined && presetId !== undefined) {
      await presets.mount(agentCtx, presetId)
    }
    agentCtx.tools.restrict({ deny: [...BLOCKED_TOOLS] })
    agentCtx.systemPrompt.section({
      name: 'feishu-remote',
      order: 118,
      text: 'The user is interacting through Feishu/Lark on their phone. Keep ordinary replies concise; tool results and full reasoning are shown in a card. Never include credentials or secrets in outbound content.',
    })
  }

  private modelSelection(): AgentOptions {
    const fallback = this.ctx.agentDefaultModel.currentSelection()
    return {
      provider: this.config.provider ?? fallback.provider,
      model: this.config.model ?? fallback.model,
    }
  }

  private async nextSessionId(prefix: string): Promise<SessionId> {
    const headers = await this.freshHeaders()
    const known = new Set(headers.map(header => String(header.id)))
    let now = Date.now()
    let id = freshSessionId(prefix, now)
    while (known.has(String(id))) id = freshSessionId(prefix, ++now)
    return id
  }

  // ---------------------------------------------------------------- streaming

  private onSessionEvent(session: Session, event: SessionEvent): void {
    const entry = this.agents.get(String(session.id))
    if (entry === undefined) return
    if (event.seq <= entry.lastSeq) return // watermark dedup
    entry.lastSeq = event.seq
    switch (event.type) {
      case 'turn/start': {
        // Exact ledger: the claim event may arrive AFTER turn/start (rc.6 emits
        // turn/start before Inbox.claim), so default to gui; the claimed
        // handler upgrades the origin for our messages. No approval/output
        // precedes the claim, so attribution is always settled in time.
        const origin = entry.turnOrigin.get(event.data.turn) ?? 'gui'
        entry.activeTurnOrigin = origin
        entry.activeReply = entry.turnReply.get(event.data.turn)
          ?? { replyInThread: entry.route.replyInThread }
        const progress: TurnProgress = {
          turn: event.data.turn,
          startedAt: event.time,
          prompt: entry.pendingPrompt,
          visibleText: '',
          steps: [],
          tools: [],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          terminal: false,
          reply: entry.activeReply,
        }
        entry.progress = progress
        entry.pendingPrompt = '飞书任务'
        // No immediate card: the first chunk/tool event (or the terminal card)
        // sends it, so the reply context is final by the time the card lands.
        break
      }
      case 'assistant/chunk': {
        const progress = entry.progress
        if (progress === undefined || event.data.chunk.type !== 'text-delta') break
        const step = this.stepOf(progress, event.data.turn, event.data.step)
        if (step.final === undefined) step.chunks += event.data.chunk.text
        this.refreshVisibleText(progress)
        this.scheduleProgress(entry, progress)
        break
      }
      case 'assistant/message': {
        const progress = entry.progress
        if (progress === undefined) break
        const final = assistantText(event)
        const step = this.stepOf(progress, event.data.turn, event.data.step)
        step.final = final // complete message REPLACES the chunk buffer (helhello fix)
        this.refreshVisibleText(progress)
        const usage = event.data.usage
        if (usage !== undefined) {
          progress.inputTokens += usage.inputTokens
          progress.outputTokens += usage.outputTokens
          progress.cacheReadTokens += usage.cacheReadTokens ?? 0
        }
        this.scheduleProgress(entry, progress)
        break
      }
      case 'tool/call': {
        const progress = entry.progress
        if (progress === undefined) break
        progress.tools.push({
          callId: String(event.data.callId),
          name: event.data.name,
          summary: toolSummary(event.data.arguments),
          startedAt: event.time,
        })
        this.scheduleProgress(entry, progress)
        break
      }
      case 'tool/result': {
        const progress = entry.progress
        if (progress === undefined) break
        const callId = String(event.data.message.source.callId)
        const tool = progress.tools.findLast(item => item.callId === callId)
        if (tool !== undefined) {
          tool.finishedAt = event.time
          tool.failed = event.data.error !== undefined || event.data.message.content[0]?.isError === true
        }
        this.scheduleProgress(entry, progress)
        break
      }
      case 'turn/end': {
        const progress = entry.progress
        if (progress === undefined) break
        progress.terminal = true
        entry.turnOrigin.delete(event.data.turn)
        entry.turnReply.delete(event.data.turn)
        entry.activeTurnOrigin = undefined
        entry.activeReply = undefined
        if (entry.progressTimer !== undefined) {
          clearTimeout(entry.progressTimer)
          entry.progressTimer = undefined
        }
        const terminal = terminalOutcome(event.data.reason)
        progress.outcome = terminal.outcome
        progress.outcomeDetail = terminal.detail
        // Track the finalizer as a CHAIN so switches/stop await every
        // predecessor too: the old turn's card work must never read a swapped
        // session (review #4 F1 + review #5 F1: no replaceable slot).
        const chain = (entry.pendingFinalize ?? Promise.resolve()).then(() => (
          this.finalizeTurn(entry, progress)
        )).catch(error => {
          this.ctx.logger?.error?.('dsh-feishu-remote: 发送完成卡片失败：%s', errorMessage(error))
        })
        entry.pendingFinalize = chain
        break
      }
      default:
        break
    }
  }

  private stepOf(progress: TurnProgress, turn: number, step: number): TurnStepText {
    let entry = progress.steps.find(item => item.turn === turn && item.step === step)
    if (entry === undefined) {
      entry = { turn, step, chunks: '' }
      progress.steps.push(entry)
    }
    return entry
  }

  private refreshVisibleText(progress: TurnProgress): void {
    progress.visibleText = progress.steps.map(step => step.final ?? step.chunks).join('')
  }

  /**
   * Progress-card cadence: while the turn runs every tick patches the same
   * card, which buildTurnCard renders with `streaming_mode: true` so the
   * Feishu client renders the incremental update (exact visuals verified on
   * the real tenant, docs/09 §7); the terminal card (finalizeTurn) flips it
   * to `streaming_mode: false` (docs/05 §2.5).
   */
  private scheduleProgress(entry: BridgeSession, progress: TurnProgress): void {
    if (!this.config.progressCards || progress.terminal || entry.progressTimer !== undefined) return
    entry.progressTimer = setTimeout(() => {
      entry.progressTimer = undefined
      if (!progress.terminal) {
        void this.upsertTurnCard(entry, progress).catch(error => {
          this.ctx.logger?.error?.('dsh-feishu-remote: 更新进度卡片失败：%s', errorMessage(error))
        })
      }
    }, this.config.progressUpdateMs)
  }

  private async finalizeTurn(entry: BridgeSession, progress: TurnProgress): Promise<void> {
    if (!this.config.progressCards) {
      const text = redactSecrets(progress.visibleText).trim()
      await this.enqueueSend(entry, {
        markdown: text === '' ? `Harness 任务${progress.outcome === 'completed' ? '已完成' : '已结束'}。` : text,
      }, progress.terminal, this.replyFor(entry, progress))
      return
    }
    await this.upsertTurnCard(entry, progress, progress.outcome, progress.outcomeDetail)
    const safeText = redactSecrets(progress.visibleText)
    if (safeText.length > this.config.cardBodyMaxChars) {
      await this.archiveOversizedText(entry, safeText)
    }
  }

  /** Oversized replies: full text → workspace file (Mac side) + file to Feishu (phone side). */
  private async archiveOversizedText(entry: BridgeSession, text: string): Promise<void> {
    try {
      const path = await saveOversizedText(this.config.workspaceRoot, entry.sessionId, text)
      const notice = `全文已保存到工作区文件：\`${path}\`（会话 \`${entry.sessionId}\`）`
      const payload = boundedUtf8Buffer(text, this.config.maxOutboundFileBytes)
      const result = await this.enqueueSend(entry, {
        file: { source: payload, fileName: `deepseek-harness-${entry.sessionId}.md` },
      }, false, this.replyFor(entry))
      if (result !== 'sent') {
        await this.enqueueSend(entry, { markdown: notice }, false, this.replyFor(entry))
      } else {
        await this.enqueueSend(entry, { markdown: notice }, false, undefined)
      }
    } catch (error) {
      this.ctx.logger?.error?.('dsh-feishu-remote: 全文落盘失败：%s', errorMessage(error))
    }
  }

  // ---------------------------------------------------------------- cards

  /**
   * Serialize this turn's card operations through the progress's own chain:
   * the initial send and its patches can never race (Codex P1-4).
   *
   * Stale-progress guard (Codex Round 12 F2): a progress tick queued after
   * turn/end is dead work — the terminal card is a complete snapshot that
   * supersedes it. Dropping it at the gate keeps the chain and the outbound
   * scheduler free for the terminal card instead of queueing behind it.
   *
   * Terminal PATCH also bypasses the chain entirely (Round 12 F2 复核):
   * patches for one messageId are serialized by the scheduler with monotonic
   * generations, so the terminal patch supersedes any still-queued stale
   * progress patch instead of waiting for it (its retries are generation-
   * checked and lose). The initial SEND path must stay chained — send-before-
   * patch and one-card-per-turn ordering.
   */
  private async upsertTurnCard(
    entry: BridgeSession,
    progress: TurnProgress,
    outcome?: 'completed' | 'cancelled' | 'blocked' | 'error',
    detail?: string,
    options: TurnCardUpsertOptions = {},
  ): Promise<void> {
    if (outcome === undefined && progress.terminal && options.explicit !== true) return
    const terminal = (outcome ?? progress.outcome) !== undefined
    if (terminal && progress.progressMessageId !== undefined) {
      return this.upsertTurnCardInner(entry, progress, outcome, detail, options)
    }
    const job = (progress.sendChain ?? Promise.resolve()).then(() => (
      this.upsertTurnCardInner(entry, progress, outcome, detail, options)
    ))
    progress.sendChain = job.catch(() => undefined)
    return job
  }

  private async upsertTurnCardInner(
    entry: BridgeSession,
    progress: TurnProgress,
    outcome?: 'completed' | 'cancelled' | 'blocked' | 'error',
    detail?: string,
    options: TurnCardUpsertOptions = {},
  ): Promise<void> {
    // Re-check at run time: terminal may have landed while this was chained.
    if (outcome === undefined && progress.terminal && options.explicit !== true) return
    const resolvedOutcome = outcome ?? progress.outcome
    const resolvedDetail = detail ?? progress.outcomeDetail
    const terminal = resolvedOutcome !== undefined
    // Stamp the immutable reply context once per turn (claim may have landed
    // after turn/start; this runs on the first chunk at the earliest).
    if (progress.reply === undefined) {
      progress.reply = entry.activeReply ?? { replyInThread: entry.route.replyInThread }
    }
    const { card, truncated } = this.fitCardBudget(entry, progress, resolvedOutcome, resolvedDetail)
    progress.truncated = progress.truncated === true || truncated

    const reply = progress.reply
    const sessionId = entry.sessionId
    if (progress.progressMessageId === undefined) {
      let sentMessageId: string | undefined
      const result = await this.enqueueSend(entry, { card }, terminal, reply, run => {
        sentMessageId = run.messageId
      })
      if (result === 'sent' && sentMessageId !== undefined) {
        progress.progressMessageId = sentMessageId
        // Each card gets its own fallback chance: a fresh card must not
        // inherit a consumed fallback flag from the dead one (Codex final
        // verify: stale-fallback flag must not starve the terminal fallback).
        progress.cardFallbackAttempted = false
      }
      return
    }
    const messageId = progress.progressMessageId
    const result = await this.enqueuePatch(entry, messageId, card, terminal, sessionId)
    if (result === 'permanent' && !progress.cardFallbackAttempted) {
      // patch 永久失败 → 改发新终态卡（docs/05 §1.3/§2.5）。
      // DIRECT recursion, never the public chaining method: this may be
      // running inside the sendChain, and re-chaining would self-wait
      // (P1 → P2 → P1 deadlock, Codex final verify P1). The fresh SEND
      // targets a NEW messageId, so no ordering constraint with the dead
      // card remains; the scheduler serializes outbound ops globally.
      progress.cardFallbackAttempted = true
      progress.progressMessageId = undefined
      this.ctx.logger?.warn?.('dsh-feishu-remote: 卡片 patch 永久失败，改发新终态卡（session=%s）', sessionId)
      // Render the CURRENT best state: if the turn ended while this patch was
      // in flight, the fallback must be the terminal card, not a stale live one.
      const fallbackOutcome = resolvedOutcome ?? (progress.terminal ? progress.outcome : undefined)
      await this.upsertTurnCardInner(entry, progress, fallbackOutcome, resolvedDetail)
    }
  }

  /**
   * Volume budget (docs/05 §2.5): shrink the body until the card JSON stays
   * under the 30KB patch limit (UTF-8 bytes); a card that still exceeds it
   * falls back to a minimal header+stats card (Codex P1-12 postcondition).
   */
  private fitCardBudget(
    entry: BridgeSession,
    progress: TurnProgress,
    outcome?: 'completed' | 'cancelled' | 'blocked' | 'error',
    detail?: string,
  ): { card: object; truncated: boolean } {
    const selection = this.modelSelection()
    const cwd = entry.handle.agent.session.header.cwd ?? this.config.cwd
    const base = { sessionId: entry.sessionId, cwd, model: selection.model ?? '', preset: entry.cardPreset }
    let budget = this.config.cardBodyMaxChars
    let truncated = false
    let card = buildTurnCard({
      progress,
      ...base,
      ...(outcome === undefined ? {} : { outcome }),
      ...(detail === undefined ? {} : { outcomeDetail: detail }),
      maxBodyChars: budget,
    })
    while (Buffer.byteLength(JSON.stringify(card), 'utf8') > 28_000 && budget > 1_000) {
      budget = Math.max(1_000, Math.floor(budget * 0.7))
      truncated = true
      card = buildTurnCard({
        progress,
        ...base,
        ...(outcome === undefined ? {} : { outcome }),
        ...(detail === undefined ? {} : { outcomeDetail: detail }),
        maxBodyChars: budget,
        truncated,
      })
    }
    if (Buffer.byteLength(JSON.stringify(card), 'utf8') > 28_000) {
      // Pathological dynamic fields (tool names, detail, cwd, model…) — a
      // constant-size fallback card with a guaranteed byte postcondition.
      // Running turns keep live-card semantics (Round 12 F4): streaming mode
      // + stop button, never a premature "completed" header.
      truncated = true
      card = buildOversizeCard(outcome ?? 'running', outcome === undefined, entry.sessionId)
    }
    return { card, truncated }
  }

  private replyFor(entry: BridgeSession, progress?: TurnProgress): SendOptions | undefined {
    const reply = progress?.reply
      ?? entry.activeReply
      ?? { replyTo: entry.route.replyTo, replyInThread: entry.route.replyInThread }
    return {
      ...(reply.replyTo === undefined ? {} : { replyTo: reply.replyTo }),
      ...(reply.replyInThread === true ? { replyInThread: true } : {}),
    }
  }

  private enqueueSend(
    entry: BridgeSession,
    input: Parameters<LarkChannelLike['send']>[1],
    terminal: boolean,
    options: SendOptions | undefined,
    onSent?: (result: { messageId: string }) => void,
  ): Promise<TaskResult> {
    return this.enqueueOutbound({
      kind: terminal ? 'terminal-send' : 'send',
      chatId: entry.route.chatId,
      sessionId: entry.sessionId,
      label: terminal ? '发送终态卡片' : '发送消息',
      run: async () => {
        const channel = this.requireChannel()
        const sent = await channel.send(entry.route.chatId, input, options)
        onSent?.(sent)
      },
    })
  }

  private enqueuePatch(entry: BridgeSession, messageId: string, card: object, terminal: boolean, sessionId: string): Promise<TaskResult> {
    return this.enqueueOutbound({
      kind: terminal ? 'terminal-patch' : 'patch',
      chatId: entry.route.chatId,
      messageId,
      sessionId,
      label: terminal ? '更新终态卡片' : '更新进度卡片',
      run: async () => {
        await this.requireChannel().updateCard(messageId, card)
      },
      onPermanent: error => {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 卡片 patch 永久失败（session=%s）：%s', sessionId, error.message)
      },
    })
  }

  private enqueueOutbound(task: OutboundTask): Promise<TaskResult> {
    const original = task.onPermanent
    const onPermanent = (error: Error) => {
      original?.(error)
      // Persistent audit (docs/05 §6.4): permanent failures survive restarts.
      const classification = classifyOutboundError(error).kind
      void this.state.recordDeliveryFailure({
        sessionId: task.sessionId ?? 'unknown',
        ...(task.messageId === undefined ? {} : { messageId: task.messageId }),
        classification,
        disposition: 'permanent',
        // The audit is durable: NEVER persist unredacted error text (review #6 F3).
        detail: redactSecrets(error.message),
      }).catch(stateError => {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 送达失败审计写入失败：%s', errorMessage(stateError))
      })
    }
    return this.scheduler.enqueue({ ...task, onPermanent })
  }

  private requireChannel(): LarkChannelLike {
    if (this.channel === undefined) throw new Error('飞书长连接未就绪')
    return this.channel
  }

  private async sendStatus(entry: BridgeSession, message?: NormalizedMessage): Promise<void> {
    const selection = this.modelSelection()
    const card = buildStatusCard({
      sessionId: entry.sessionId,
      status: entry.handle.agent.status,
      cwd: entry.handle.agent.session.header.cwd ?? this.config.cwd,
      provider: selection.provider ?? '',
      model: selection.model ?? '',
      connected: this.connected && !this.terminalFailure,
      pendingApprovals: [...this.pendingApprovals.values()].filter(item => item.entry === entry).length,
      failedDeliveries: this.state.snapshot().deliveryFailures.filter(item => item.sessionId === entry.sessionId).length,
      preset: entry.cardPreset,
    })
    await this.enqueueSend(entry, { card }, false, message === undefined
      ? this.replyFor(entry)
      : { replyTo: message.messageId, replyInThread: entry.route.replyInThread })
  }

  // ---------------------------------------------------------------- approvals

  private async askApproval(entry: BridgeSession, request: ApprovalRequest): Promise<ApprovalOutcome> {
    // An already-aborted signal never emits another abort event — settle
    // cancelled immediately instead of waiting out the timeout (review #9 F3).
    if (request.signal?.aborted === true) return 'cancelled'
    const token = randomUUID()
    return await new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = {
        token,
        entry,
        expectedOpenId: entry.route.ownerOpenId,
        chatId: entry.route.chatId,
        sessionId: entry.sessionId,
        toolName: request.toolName,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        ...(request.callId === undefined ? {} : { callId: String(request.callId) }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        timer: setTimeout(() => this.settleApproval(pending, 'unavailable'), this.config.interactiveTimeoutMs),
        resolve,
      }
      if (request.signal !== undefined) {
        pending.onAbort = () => this.settleApproval(pending, 'cancelled')
        request.signal.addEventListener('abort', pending.onAbort, { once: true })
      }
      this.pendingApprovals.set(token, pending)
      void this.enqueueSend(entry, {
        card: buildApprovalCard({
          token,
          toolName: request.toolName,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
          sessionId: pending.sessionId,
        }),
      }, true, this.replyFor(entry), sent => { pending.messageId = sent.messageId }).then(result => {
        if (result === 'permanent' || result === 'closed') {
          // 发卡失败 → 立即 unavailable（docs/05 §2.3 断线状态机）。
          this.settleApproval(pending, 'unavailable')
        }
      })
    })
  }

  private settleApproval(pending: PendingApproval, outcome: ApprovalOutcome): void {
    if (!this.pendingApprovals.delete(pending.token)) return
    clearTimeout(pending.timer)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    if (pending.messageId !== undefined) {
      void this.enqueuePatch(pending.entry, pending.messageId, buildApprovalCard({
        token: pending.token,
        toolName: pending.toolName,
        ...(pending.reason === undefined ? {} : { reason: pending.reason }),
        sessionId: pending.sessionId,
        settled: outcome === 'allowed-once' ? 'allowed' : outcome,
      }), true, pending.sessionId).then(result => {
        if (result === 'permanent') {
          // Terminal card update failed permanently → fall back to a fresh text notice.
          void this.enqueueSend(pending.entry, {
            markdown: outcome === 'allowed-once' ? '✅ 审批已允许（原卡片更新失败）。' : `⏹️ 审批已结算：${outcome}`,
          }, true, this.replyFor(pending.entry))
        }
      })
    }
    pending.resolve(outcome)
  }

  // ---------------------------------------------------------------- card actions / reactions

  private async onCardAction(event: CardActionEvent): Promise<void> {
    const action = parseBridgeAction(event.action.value)
    if (action === undefined) return
    if (action.action === 'approval') {
      const pending = this.pendingApprovals.get(action.token)
      if (pending === undefined) {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 卡片审批 token 无效或已结算（重复点击被 SDK 去重，文字兜底可用）')
        return
      }
      if (event.operator.openId !== pending.expectedOpenId || event.chatId !== pending.chatId) {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 拒绝越权卡片审批：operator=%s chat=%s', event.operator.openId, event.chatId)
        return
      }
      if (pending.messageId === undefined || event.messageId !== pending.messageId) {
        this.ctx.logger?.warn?.('dsh-feishu-remote: 拒绝来自其他消息的卡片审批回调：expected=%s got=%s', pending.messageId ?? '<未送达>', event.messageId)
        return
      }
      this.settleApproval(pending, action.decision === 'allow' ? 'allowed-once' : 'rejected')
      return
    }
    const entry = this.agents.get(action.sessionId)
    if (entry === undefined || !this.isAuthorizedAction(entry, event.operator.openId, event.chatId)) {
      this.ctx.logger?.warn?.('dsh-feishu-remote: 拒绝越权卡片操作：operator=%s chat=%s session=%s', event.operator.openId, event.chatId, action.sessionId)
      return
    }
    this.enqueueOrigin(entry.key, () => this.handleCardCommand(entry, action))
  }

  private async handleCardCommand(entry: BridgeSession, action: Exclude<BridgeAction, { action: 'approval' }>): Promise<void> {
    if (action.action === 'stop') {
      entry.handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
      await this.safeSend(entry.route.chatId, { markdown: '⏹️ 已发送停止请求（只取消当前回合）。' }, undefined, this.replyFor(entry))
    } else if (action.action === 'new') {
      await this.state.setPendingNew(entry.key, true)
      await this.safeSend(entry.route.chatId, { markdown: '✅ 已登记新会话请求：**下一条普通消息**将创建全新会话。' }, undefined, this.replyFor(entry))
    } else if (action.action === 'status') {
      await this.sendStatus(entry)
    } else {
      entry.cardPreset = nextCardPreset(entry.cardPreset)
      await this.state.setCardView(entry.key, entry.cardPreset)
      if (entry.progress !== undefined && entry.progress.progressMessageId !== undefined) {
        // Explicit re-render: /view works on a settled turn too (Round 12 F2).
        await this.upsertTurnCard(entry, entry.progress, undefined, undefined, { explicit: true })
      } else {
        await this.safeSend(entry.route.chatId, { markdown: `卡片视图已切换为 \`${entry.cardPreset}\`。` }, undefined, this.replyFor(entry))
      }
    }
  }

  private onReaction(event: ReactionEvent): void {
    if (event.action !== 'added' || !['CrossMark', 'STOP', 'NO'].includes(event.emojiType)) return
    const entry = [...this.sessions.values()].find(item => item.progress?.progressMessageId === event.messageId)
    if (entry === undefined) return
    if (!this.isGloballyAllowed(event.operator.openId) || entry.route.ownerOpenId !== event.operator.openId) return
    entry.handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
  }

  private async safeSend(
    chatId: string,
    input: Parameters<LarkChannelLike['send']>[1],
    message?: NormalizedMessage,
    options?: SendOptions,
  ): Promise<void> {
    const finalOptions = options ?? (message === undefined ? undefined : {
      replyTo: message.messageId,
      replyInThread: this.replyInThreadFor(message),
    })
    await this.enqueueOutbound({
      kind: 'send',
      chatId,
      label: '发送回复',
      run: async () => {
        await this.requireChannel().send(chatId, input, finalOptions)
      },
    })
  }

  private replyInThreadFor(message: NormalizedMessage): boolean {
    const origin = originOf(message)
    return origin.kind === 'thread'
  }
}

export { BLOCKED_TOOLS, HELP_TEXT, terminalOutcome }
