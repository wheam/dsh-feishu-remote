/**
 * Contract tests for the bridge against a hand-rolled fake of the rc.6
 * services (agents / sessionPersistence / agentPresets / workspaceRegistry /
 * approval waterfall / session events) and a fake Feishu channel. The real
 * API shapes were verified against the installed dsh 0.1.0-rc.6 sources
 * (see docs/05 and docs/08).
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuRemoteBridge, terminalOutcome } from '../src/bridge.js'
import { sessionPrefix } from '../src/identity.js'
import { resolveConfig, type Config } from '../src/config.js'
import type { ContextMessage, FeishuContextProvider } from '../src/context.js'
import { OutboundScheduler } from '../src/scheduler.js'
import type { LarkChannelLike } from '../src/types.js'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'

// ---------------------------------------------------------------- fakes

interface Listener {
  fn: (...args: never[]) => unknown
  prepend: boolean
}

class FakeCtx {
  readonly listeners = new Map<string, Listener[]>()
  readonly services = new Map<string, unknown>()
  readonly logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }
  agents!: FakeAgents
  agentDefaultModel = { currentSelection: () => ({ provider: 'deepseek', model: 'v4-pro' }) }
  credentials = { resolve: async () => ({ value: 'secret' }) }

  on(name: string, fn: (...args: never[]) => unknown, options?: { prepend?: boolean }): () => void {
    const entry: Listener = { fn, prepend: options?.prepend === true }
    const list = this.listeners.get(name) ?? []
    if (entry.prepend) list.unshift(entry)
    else list.push(entry)
    this.listeners.set(name, list)
    return () => {
      const index = list.indexOf(entry)
      if (index >= 0) list.splice(index, 1)
    }
  }

  get(name: string): unknown {
    return this.services.get(name)
  }

  async emit(name: string, ...args: never[]): Promise<void> {
    for (const { fn } of [...(this.listeners.get(name) ?? [])]) await fn(...args)
  }
}

class FakeAgent {
  status: 'idle' | 'running' = 'idle'
  readonly followups: unknown[] = []
  readonly steers: unknown[] = []
  readonly cancels: Array<{ cause: unknown; options?: unknown }> = []
  /** Authoritative inbox state (rc.6 Inbox.hasPending) — switch guards read it. */
  inbox = { hasPending: false }
  disposed = false
  readonly session: { header: SessionHeader; id: string; events: never[] }

  constructor(
    readonly id: string,
    readonly meta?: Record<string, unknown>,
  ) {
    this.session = {
      header: {
        version: 0,
        id: SessionId(id),
        createdAt: Date.now(),
        ...(meta?.cwd === undefined ? {} : { cwd: String(meta.cwd) }),
      },
      id,
      events: [],
    }
  }

  followup(message: unknown): void {
    this.followups.push(message)
    this.status = 'running'
  }

  steer(message: unknown): void {
    this.steers.push(message)
  }

  cancel(cause: unknown, options?: unknown): void {
    this.cancels.push({ cause, options })
    this.status = 'idle'
  }
}

interface CreateRecord { options: { sessionId?: string; resumeSessionId?: string; meta?: Record<string, unknown>; agentOptions?: unknown; setup?: unknown } }

class FakeAgents {
  readonly live = new Map<string, FakeAgent>()
  readonly created: CreateRecord[] = []
  readonly resumed: CreateRecord[] = []
  private createErrors: Error[] = []
  private resumeErrors: Error[] = []
  /** When set, create()/resume() wait on this gate before producing a handle. */
  gateCreate: Promise<void> | undefined

  failNextCreate(error: Error): void { this.createErrors.push(error) }
  failNextResume(error: Error): void { this.resumeErrors.push(error) }

  private makeAgent(id: string, meta?: Record<string, unknown>): { agent: FakeAgent; dispose: () => Promise<void> } {
    const agent = new FakeAgent(id, meta)
    this.live.set(id, agent)
    return {
      agent,
      dispose: async () => {
        agent.disposed = true
        this.live.delete(id)
      },
    }
  }

  async create(options: CreateRecord['options']): Promise<{ agent: FakeAgent; dispose: () => Promise<void> }> {
    if (this.gateCreate !== undefined) await this.gateCreate
    const error = this.createErrors.shift()
    if (error !== undefined) throw error
    const record: CreateRecord = { options }
    this.created.push(record)
    return this.makeAgent(String(options.sessionId), options.meta)
  }

  async resume(options: CreateRecord['options']): Promise<{ agent: FakeAgent; dispose: () => Promise<void> }> {
    const error = this.resumeErrors.shift()
    if (error !== undefined) throw error
    const record: CreateRecord = { options }
    this.resumed.push(record)
    return this.makeAgent(String(options.resumeSessionId))
  }

  get(id: unknown): FakeAgent | undefined {
    return this.live.get(String(id))
  }
}

class FakePersistence {
  headers: SessionHeader[] = []
  private inspections = new Map<string, { meta: SessionHeader; events: SessionEvent[] }>()

  async list(): Promise<SessionHeader[]> { return [...this.headers] }
  async inspect(id: SessionId): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    const cached = this.inspections.get(String(id))
    if (cached !== undefined) return cached
    const meta = this.headers.find(header => String(header.id) === String(id))
    if (meta === undefined) throw new Error(`no inspection for ${String(id)}`)
    return { meta, events: [] }
  }
  remember(id: string, events: SessionEvent[] = []): void {
    const header = this.headers.find(item => String(item.id) === id)
    if (header !== undefined) this.inspections.set(id, { meta: header, events })
  }
}

class FakeChannel implements LarkChannelLike {
  readonly handlers = new Map<string, Array<(payload: never) => void | Promise<void>>>()
  readonly sent: Array<{ to: string; input: Record<string, unknown>; options?: unknown; messageId: string }> = []
  readonly patched: Array<{ messageId: string; card: Record<string, unknown> }> = []
  status: { state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'; reconnectAttempts: number } = { state: 'idle', reconnectAttempts: 0 }
  connectCalls = 0
  botIdentity = { openId: 'ou_bot', name: 'test-bot' }
  /** History backfill seam fixtures (docs/13 §6). */
  historyItems: Array<Record<string, unknown>> = []
  historyPages: Array<Array<Record<string, unknown>>> = []
  historyError?: Error
  readonly listed: Array<{ containerIdType: string; containerId: string; pageToken?: string }> = []

  async connect(): Promise<void> {
    this.connectCalls += 1
    this.status = { state: 'connected', reconnectAttempts: 0 }
  }

  async disconnect(): Promise<void> {
    this.status = { state: 'idle', reconnectAttempts: 0 }
  }

  getConnectionStatus() { return this.status }

  on(name: string, handler: (payload: never) => void | Promise<void>): () => void {
    const list = this.handlers.get(name) ?? []
    list.push(handler)
    this.handlers.set(name, list)
    return () => undefined
  }

  emit(name: string, payload: never): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) void handler(payload)
  }

  /** When set, CARD sends wait on this gate (markdown replies pass through). */
  cardGate?: Promise<void>
  /** When set, updateCard calls wait on this gate (round-12 F2 bypass test). */
  patchGate?: Promise<void>
  /** Queued errors thrown by updateCard (one per call). */
  readonly patchErrors: Error[] = []
  /** Working-reaction（敲键盘）recording. */
  readonly reactionsAdded: Array<{ messageId: string; emojiType: string }> = []
  readonly reactionsRemoved: Array<{ messageId: string; emojiType: string }> = []

  async send(to: string, input: unknown, options?: unknown): Promise<{ messageId: string }> {
    const record = input as Record<string, unknown>
    if (this.cardGate !== undefined && record.card !== undefined) {
      await this.cardGate
    }
    const messageId = `om_sent_${this.sent.length + 1}`
    this.sent.push({ to, input: record, options, messageId })
    return { messageId }
  }

  async addReaction(messageId: string, emojiType: string): Promise<string> {
    this.reactionsAdded.push({ messageId, emojiType })
    return `reaction_${this.reactionsAdded.length}`
  }

  async removeReactionByEmoji(messageId: string, emojiType: string): Promise<boolean> {
    this.reactionsRemoved.push({ messageId, emojiType })
    return true
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    if (this.patchGate !== undefined) await this.patchGate
    const error = this.patchErrors.shift()
    if (error !== undefined) throw error
    this.patched.push({ messageId, card: card as Record<string, unknown> })
  }

  async listMessages(params: { containerIdType: string; containerId: string; pageToken?: string }): Promise<{ items: Array<Record<string, unknown>>; hasMore: boolean; pageToken?: string }> {
    this.listed.push(params)
    if (this.historyError !== undefined) throw this.historyError
    const page = this.historyPages.shift()
    if (page !== undefined) {
      return { items: page, hasMore: this.historyPages.length > 0, pageToken: this.historyPages.length > 0 ? `token_${this.listed.length}` : undefined }
    }
    return { items: this.historyItems, hasMore: false }
  }

  readonly getMessageCalls: string[] = []
  rootMessageItem?: Record<string, unknown>
  downloadGate?: Promise<Buffer>

  async getMessage(messageId: string): Promise<Record<string, unknown> | undefined> {
    this.getMessageCalls.push(messageId)
    return this.rootMessageItem
  }

  async downloadMessageResource(): Promise<Buffer> {
    if (this.downloadGate !== undefined) return this.downloadGate
    throw new Error('no downloads in tests')
  }
}

// ---------------------------------------------------------------- helpers

let messageSeq = 0
let eventSeq = 0
const workspaces: string[] = []
const stateRoots: string[] = []
const bridges: FeishuRemoteBridge[] = []

afterEach(async () => {
  // Stop producers before removing temp roots. Context-watermark and topic-
  // activation writes are intentionally asynchronous in production; deleting
  // their directory first makes macOS rm race a late atomic rename (ENOTEMPTY).
  await Promise.allSettled(bridges.splice(0).map(bridge => bridge.stop()))
  await Promise.all([
    ...workspaces.splice(0).map(root => rm(root, { recursive: true, force: true })),
    ...stateRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  ])
})

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-ws-'))
  workspaces.push(root)
  return root
}

async function tempState(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-state-'))
  stateRoots.push(root)
  return join(root, 'state.json')
}

function message(
  content: string,
  overrides: Partial<{
    chatId: string
    chatType: 'p2p' | 'group'
    senderId: string
    threadId: string
    rootId: string
    mentionedBot: boolean
  }> = {},
) {
  return {
    messageId: `om_in_${++messageSeq}`,
    chatId: overrides.chatId ?? 'oc_p2p',
    chatType: (overrides.chatType ?? 'p2p') as 'p2p' | 'group',
    senderId: overrides.senderId ?? 'ou_1',
    content,
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: overrides.mentionedBot ?? true,
    createTime: Date.now(),
    ...(overrides.threadId === undefined ? {} : { threadId: overrides.threadId }),
    ...(overrides.rootId === undefined ? {} : { rootId: overrides.rootId }),
  }
}

function sessionEvent(type: SessionEvent['type'], data: SessionEvent['data'], sessionId: string): SessionEvent {
  return { type, seq: ++eventSeq, time: Date.now(), data } as SessionEvent
}

async function waitFor(condition: () => boolean, label = 'condition', timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

interface Harness {
  bridge: FeishuRemoteBridge
  ctx: FakeCtx
  agents: FakeAgents
  persistence: FakePersistence
  channel: FakeChannel
  scheduler: OutboundScheduler
  config: ReturnType<typeof resolveConfig>
  workspace: string
  statePath: string
  emitSessionEvent: (sessionId: string, type: SessionEvent['type'], data: SessionEvent['data']) => Promise<void>
  emitClaim: (sessionId: string, messageId: unknown, turn: number) => Promise<void>
  emitMessage: (content: string, overrides?: Parameters<typeof message>[1]) => Promise<void>
  emitCardAction: (value: unknown, operatorOpenId?: string, chatId?: string, messageId?: string) => Promise<void>
}

async function makeHarness(
  configOverrides: Partial<Config> = {},
  bridgeOptions: { contextProvider?: FeishuContextProvider } = {},
): Promise<Harness> {
  const workspace = await tempWorkspace()
  const statePath = await tempState()
  const config = resolveConfig({
    appId: 'cli_test',
    appSecret: 'secret',
    cwd: workspace,
    workspaceRoot: workspace,
    statePath,
    allowedOpenIds: ['ou_1'],
    allowedChatIds: ['oc_grp'],
    progressUpdateMs: 2,
    interactiveTimeoutMs: 5_000,
    // Default OFF so existing tests never spawn/fetch history; context
    // describe blocks re-enable it (docs/13 §6).
    contextMode: 'off',
    ...configOverrides,
  })
  const ctx = new FakeCtx()
  const agents = new FakeAgents()
  ctx.agents = agents
  ctx.services.set('agents', agents)
  const persistence = new FakePersistence()
  ctx.services.set('sessionPersistence', persistence)
  ctx.services.set('workspaceRegistry', { archivedSessionIds: [] })
  const mountOrder: string[] = []
  const presets = {
    resolve: vi.fn(async (id?: string) => ({ id: id ?? 'standard' })),
    mount: vi.fn(async () => { mountOrder.push('mount'); return { id: 'standard' } }),
  }
  ctx.services.set('agentPresets', presets)
  const channel = new FakeChannel()
  const scheduler = new OutboundScheduler({ minIntervalMs: 0, backoffBaseMs: 2, backoffMaxMs: 20 })
  const bridge = new FeishuRemoteBridge(ctx, config, {
    channelFactory: () => channel,
    scheduler,
    channelPollMs: 10,
    reconnectBaseMs: 5,
    teardownProducerMs: 40,
    ...bridgeOptions,
  })
  await bridge.start()
  bridges.push(bridge)
  await waitFor(() => channel.connectCalls >= 1, 'first channel connect')

  const emitSessionEvent = async (sessionId: string, type: SessionEvent['type'], data: SessionEvent['data']): Promise<void> => {
    await ctx.emit('session/event', { id: sessionId, header: { id: SessionId(sessionId) } } as never, sessionEvent(type, data, sessionId) as never)
  }
  const emitMessage = async (content: string, overrides?: Parameters<typeof message>[1]): Promise<void> => {
    channel.emit('message', message(content, overrides) as never)
  }
  const emitClaim = async (sessionId: string, messageId: unknown, turn: number): Promise<void> => {
    await ctx.emit('agent/inbox/claimed', {
      agent: { id: SessionId(sessionId) },
      message: { id: messageId },
      turn,
    } as never)
  }
  const emitCardAction = async (value: unknown, operatorOpenId = 'ou_1', chatId = 'oc_p2p', messageId = 'om_card'): Promise<void> => {
    channel.emit('cardAction', {
      messageId,
      chatId,
      operator: { openId: operatorOpenId },
      action: { value, tag: 'button' },
    } as never)
  }

  return {
    bridge, ctx, agents, persistence, channel, scheduler, config, workspace, statePath,
    emitSessionEvent, emitClaim, emitMessage, emitCardAction,
  }
}

function approvalRequest(agentId: string, toolName = 'bash', overrides: Record<string, unknown> = {}) {
  return {
    agent: { id: SessionId(agentId) },
    toolName,
    reason: 'needs confirmation',
    ...overrides,
  }
}

function firstAnswerer(h: Harness) {
  const list = h.ctx.listeners.get('approval/request')
  return list?.[0]?.fn
}

function approvalCardMessageId(h: Harness, token: string): string | undefined {
  for (const item of h.channel.sent) {
    const card = (item.input as { card?: unknown }).card as { body?: { elements?: Array<Record<string, unknown>> } } | undefined
    for (const row of card?.body?.elements ?? []) {
      for (const column of (row.elements ?? row.columns ?? []) as Array<Record<string, unknown>>) {
        for (const element of (column.elements ?? []) as Array<Record<string, unknown>>) {
          for (const behavior of (element.behaviors ?? []) as Array<Record<string, unknown>>) {
            const value = behavior.value as { token?: unknown } | undefined
            if (typeof value?.token === 'string' && value.token === token) {
              return (item as { messageId?: string }).messageId
            }
          }
        }
      }
    }
  }
  return undefined
}

function approvalTokenFromChannel(h: Harness): string | undefined {
  // Scan ALL sends: the progress card also carries input.card, and only the
  // approval card embeds a token in its button values.
  for (const item of h.channel.sent) {
    const card = (item.input as { card?: unknown }).card as { body?: { elements?: Array<Record<string, unknown>> } } | undefined
    for (const row of card?.body?.elements ?? []) {
      for (const column of (row.elements ?? row.columns ?? []) as Array<Record<string, unknown>>) {
        for (const element of (column.elements ?? []) as Array<Record<string, unknown>>) {
          for (const behavior of (element.behaviors ?? []) as Array<Record<string, unknown>>) {
            const value = behavior.value as { token?: unknown } | undefined
            if (typeof value?.token === 'string') return value.token
          }
        }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------- tests

describe('bridge lifecycle and answerer ordering', () => {
  it('registers the approval answerer with prepend ahead of later answerers', async () => {
    const h = await makeHarness()
    h.ctx.on('approval/request', async () => 'rejected' as never, { prepend: false })
    const list = h.ctx.listeners.get('approval/request')!
    expect(list).toHaveLength(2)
    expect(list[0]!.prepend).toBe(true)
  })

  it('apply-style start is non-fatal: a failing channel connect never rejects start()', async () => {
    const h = await makeHarness()
    expect(h.bridge).toBeDefined()
    expect(h.channel.connectCalls).toBeGreaterThanOrEqual(1)
  })

  it('aborts a pending attachment download when the bridge stops', async () => {
    const h = await makeHarness()
    h.channel.downloadGate = new Promise<Buffer>(() => undefined)
    const wrapped = Reflect.get(h.bridge, 'channel') as LarkChannelLike
    const download = wrapped.downloadMessageResource('om_1', 'file_1', 'file', 1024)

    await h.bridge.stop()

    await expect(download).rejects.toThrow('飞书通道已关闭')
  })
})

describe('sender allowlist and optional group restriction', () => {
  it('rejects unauthorized open_ids without any session work', async () => {
    const h = await makeHarness()
    await h.emitMessage('hello', { senderId: 'ou_stranger' })
    await waitFor(() => h.ctx.logger.warn.mock.calls.some(call => String(call[0]).includes('未授权飞书用户')))
    expect(h.agents.created).toHaveLength(0)
    expect(h.channel.sent).toHaveLength(0)
    expect(h.ctx.logger.warn.mock.calls.some(call => String(call[1]).includes('ou_stranger'))).toBe(true)
  })

  it('allows any group by default when allowedChatIds is empty', async () => {
    const h = await makeHarness({ allowedChatIds: [] })
    await h.emitMessage('hi', { chatId: 'oc_other_group', chatType: 'group', threadId: 'omt_1' })
    await waitFor(() => h.agents.created.length === 1)
    expect(h.channel.sent.some(item => String(item.input.markdown).includes('限定群列表'))).toBe(false)
  })

  it('rejects groups outside a non-empty allowedChatIds restriction', async () => {
    const h = await makeHarness()
    await h.emitMessage('hi', { chatId: 'oc_other_group', chatType: 'group', threadId: 'omt_1' })
    await waitFor(() => h.channel.sent.length > 0)
    expect(String(h.channel.sent[0]!.input.markdown)).toContain('限定群列表')
    expect(h.agents.created).toHaveLength(0)
  })

  it('rejects group non-thread messages with the thread hint', async () => {
    const h = await makeHarness()
    await h.emitMessage('hi', { chatId: 'oc_grp', chatType: 'group' })
    await waitFor(() => h.channel.sent.length > 0)
    expect(String(h.channel.sent[0]!.input.markdown)).toContain('话题内')
    expect(h.agents.created).toHaveLength(0)
  })

  it('silently ignores unmentioned group traffic outside a topic', async () => {
    const h = await makeHarness()
    await h.emitMessage('普通群消息', { chatId: 'oc_grp', chatType: 'group', mentionedBot: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.channel.sent).toHaveLength(0)
    expect(h.agents.created).toHaveLength(0)
  })
})

describe('sticky topic activation', () => {
  it('ignores pre-activation replies, then routes unmentioned follow-ups only inside the activated topic', async () => {
    const h = await makeHarness()
    const topic = { chatId: 'oc_grp', chatType: 'group' as const, threadId: 'omt_sticky', rootId: 'om_root_sticky' }

    await h.emitMessage('首次 @ 前的资料', { ...topic, mentionedBot: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.agents.created).toHaveLength(0)

    await h.emitMessage('开始处理', { ...topic, mentionedBot: true })
    await waitFor(() => h.agents.created.length === 1)
    const agent = h.agents.live.values().next().value as FakeAgent
    await waitFor(() => agent.followups.length === 1)

    await h.emitMessage('无需再次 @ 的补充', { ...topic, mentionedBot: false })
    await waitFor(() => agent.followups.length === 2)
    expect(h.agents.created).toHaveLength(1)

    await h.emitMessage('另一个话题不能串入', {
      chatId: 'oc_grp', chatType: 'group', threadId: 'omt_other', rootId: 'om_root_other', mentionedBot: false,
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.agents.created).toHaveLength(1)
    expect(agent.followups).toHaveLength(2)
  })

  it('uses the existing full-window context backfill on the first @mention', async () => {
    const provider = new FakeContextProvider()
    provider.next = [historyMessage({ messageId: 'om_before_mention', text: '首次 @ 之前的话题资料' })]
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    const topic = { chatId: 'oc_grp', chatType: 'group' as const, threadId: 'omt_context', rootId: 'om_root_context' }

    await h.emitMessage('此前未 @ 的消息', { ...topic, mentionedBot: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(provider.calls).toHaveLength(0)

    await h.emitMessage('请结合前文处理', { ...topic, mentionedBot: true })
    await waitFor(() => provider.calls.length === 1)
    expect(provider.calls[0]!.watermark).toBeUndefined()
    await waitFor(() => h.agents.created.length === 1)
    const agent = h.agents.live.values().next().value as FakeAgent
    await waitFor(() => agent.followups.length === 1)
    const content = followupContent(agent, 0)
    expect(String((content[0] as { text?: unknown }).text)).toContain('首次 @ 之前的话题资料')
  })

  it('persists activation across bridge restarts', async () => {
    const first = await makeHarness()
    const topic = { chatId: 'oc_grp', chatType: 'group' as const, threadId: 'omt_restart', rootId: 'om_root_restart' }
    await first.emitMessage('首次激活', { ...topic, mentionedBot: true })
    await waitFor(() => first.agents.created.length === 1)
    await first.bridge.stop()

    const restarted = await makeHarness({ statePath: first.statePath })
    await restarted.emitMessage('重启后无需再次 @', { ...topic, mentionedBot: false })
    await waitFor(() => restarted.agents.created.length === 1)
  })

  it('retroactively recognizes a topic session created before activation state existed', async () => {
    const h = await makeHarness()
    const key = 'group:oc_grp:thread:omt_legacy'
    const prefix = sessionPrefix(key)
    const legacy: SessionHeader = {
      version: 0,
      id: SessionId(`${prefix}-legacy`),
      createdAt: 1,
      cwd: h.workspace,
    }
    h.persistence.headers = [legacy]
    h.persistence.remember(String(legacy.id))

    await h.emitMessage('旧话题也无需重新 @', {
      chatId: 'oc_grp', chatType: 'group', threadId: 'omt_legacy', rootId: 'om_root_legacy', mentionedBot: false,
    })
    await waitFor(() => h.agents.resumed.length === 1)
    expect(h.agents.resumed[0]!.options.resumeSessionId).toBe(legacy.id)
  })

  it('processes unmentioned topics immediately when requireMention is disabled', async () => {
    const h = await makeHarness({ requireMention: false })
    await h.emitMessage('无需首次 @', {
      chatId: 'oc_grp', chatType: 'group', threadId: 'omt_open', rootId: 'om_root_open', mentionedBot: false,
    })
    await waitFor(() => h.agents.created.length === 1)
  })
})

describe('session creation and mapping', () => {
  it('creates a feishu-prefixed session with preset meta and cwd, and follows up as a user message', async () => {
    const h = await makeHarness()
    await h.emitMessage('hello world')
    await waitFor(() => h.agents.created.length === 1)
    const created = h.agents.created[0]!.options
    expect(created.sessionId).toMatch(/^feishu-[a-f0-9]{24}-/u)
    expect(created.meta).toMatchObject({ cwd: h.config.cwd, agentPreset: 'standard' })
    expect(created.agentOptions).toEqual({ provider: 'deepseek', model: 'v4-pro' })
    const agent = h.agents.live.get(String(created.sessionId))!
    expect(agent.followups).toHaveLength(1)
    const followup = agent.followups[0] as { source?: { kind?: string }; content?: unknown }
    expect(followup.source?.kind).toBe('user')
  })

  it('does not quote private-chat task cards, but keeps group cards in their thread', async () => {
    const privateHarness = await makeHarness()
    await privateHarness.emitMessage('private task')
    await waitFor(() => privateHarness.agents.created.length === 1)
    const privateSessionId = privateHarness.agents.created[0]!.options.sessionId!
    const privateAgent = privateHarness.agents.live.get(privateSessionId)!
    const privateMessage = privateAgent.followups.at(-1) as { id?: unknown }
    await privateHarness.emitSessionEvent(privateSessionId, 'turn/start', { turn: 1 })
    await privateHarness.emitClaim(privateSessionId, privateMessage.id, 1)
    await privateHarness.emitSessionEvent(privateSessionId, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', text: 'working' },
    })
    await waitFor(() => privateHarness.channel.sent.some(item => item.input.card !== undefined))
    const privateCard = privateHarness.channel.sent.find(item => item.input.card !== undefined)!
    expect(privateCard.options).toEqual({})

    const threadHarness = await makeHarness()
    await threadHarness.emitMessage('thread task', {
      chatId: 'oc_grp',
      chatType: 'group',
      threadId: 'omt_2',
      rootId: 'om_root_2',
    })
    const inboundId = `om_in_${messageSeq}`
    await waitFor(() => threadHarness.agents.created.length === 1)
    const threadSessionId = threadHarness.agents.created[0]!.options.sessionId!
    const threadAgent = threadHarness.agents.live.get(threadSessionId)!
    const threadMessage = threadAgent.followups.at(-1) as { id?: unknown }
    await threadHarness.emitSessionEvent(threadSessionId, 'turn/start', { turn: 1 })
    await threadHarness.emitClaim(threadSessionId, threadMessage.id, 1)
    await threadHarness.emitSessionEvent(threadSessionId, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', text: 'working' },
    })
    await waitFor(() => threadHarness.channel.sent.some(item => item.input.card !== undefined))
    const threadCard = threadHarness.channel.sent.find(item => item.input.card !== undefined)!
    expect(threadCard.options).toEqual({ replyTo: inboundId, replyInThread: true })
  })

  it('keeps runtime-generated follow-up turns in the originating Feishu topic', async () => {
    const h = await makeHarness()
    await h.emitMessage('让 subagent 在后台处理', {
      chatId: 'oc_grp',
      chatType: 'group',
      threadId: 'omt_background',
      rootId: 'om_root_background',
    })
    const inboundId = `om_in_${messageSeq}`
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    const feishuMessage = agent.followups.at(-1) as { id?: unknown }

    // The Feishu-triggered turn starts the continuable child and ends.
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, feishuMessage.id, 1)
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '后台任务已启动。' }] },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.filter(item => item.input.card !== undefined).length === 1)

    // A subagent settlement notice wakes the parent without a Feishu claim.
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 2 })
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 2,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '后台任务已经完成。' }] },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.filter(item => item.input.card !== undefined).length === 2)

    const completedCard = h.channel.sent.filter(item => item.input.card !== undefined).at(-1)!
    expect(completedCard.options).toEqual({ replyTo: inboundId, replyInThread: true })
    expect(JSON.stringify(completedCard.input.card)).toContain('后台任务已经完成。')
  })

  it('reuses the live session per origin; separate threads get separate sessions', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    await h.emitMessage('second')
    await waitFor(() => (h.agents.live.values().next().value as FakeAgent | undefined)?.followups.length === 2)
    expect(h.agents.created).toHaveLength(1)

    await h.emitMessage('in thread 2', { chatId: 'oc_grp', chatType: 'group', threadId: 'omt_2' })
    await waitFor(() => h.agents.created.length === 2)
    expect(h.agents.created[1]!.options.sessionId).not.toBe(h.agents.created[0]!.options.sessionId)
    await waitFor(() => h.agents.live.size === 2)
  })

  it('restores the newest active persisted session of the prefix (resume path), skipping archived ones', async () => {
    const h = await makeHarness()
    const prefix = sessionPrefix('p2p:oc_p2p')
    const older: SessionHeader = { version: 0, id: SessionId(`${prefix}-a`), createdAt: 1, cwd: h.workspace }
    const newer: SessionHeader = { version: 0, id: SessionId(`${prefix}-b`), createdAt: 2, cwd: h.workspace }
    h.persistence.headers = [older, newer]
    h.persistence.remember(String(older.id))
    h.persistence.remember(String(newer.id))

    await h.emitMessage('resume me')
    await waitFor(() => h.agents.resumed.length === 1)
    expect(String(h.agents.resumed[0]!.options.resumeSessionId)).toBe(`${prefix}-b`)

    // Archived latest → falls back to the older one.
    const h2 = await makeHarness()
    h2.persistence.headers = [
      { ...older, cwd: h2.workspace },
      { ...newer, cwd: h2.workspace },
    ]
    h2.persistence.remember(String(older.id))
    h2.persistence.remember(String(newer.id))
    ;(h2.ctx.services.get('workspaceRegistry') as { archivedSessionIds: unknown[] }).archivedSessionIds = [SessionId(`${prefix}-b`)]
    await h2.emitMessage('resume me')
    await waitFor(() => h2.agents.resumed.length === 1)
    expect(String(h2.agents.resumed[0]!.options.resumeSessionId)).toBe(`${prefix}-a`)
  })

  it('refuses to resume a session whose cwd drifted from the configuration', async () => {
    const h = await makeHarness()
    const prefix = sessionPrefix('p2p:oc_p2p')
    h.persistence.headers = [{ version: 0, id: SessionId(`${prefix}-a`), createdAt: 1, cwd: '/somewhere/else' }]
    h.persistence.remember(`${prefix}-a`)
    await h.emitMessage('hi')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('cwd 漂移防护')))
    expect(h.agents.created).toHaveLength(0)
    expect(h.agents.resumed).toHaveLength(0)
  })
})

describe('/new pending protocol (no live session)', () => {
  it('marks pending and only the NEXT plain message creates a fresh session', async () => {
    const h = await makeHarness()
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.length > 0)
    expect(String(h.channel.sent.at(-1)!.input.markdown)).toContain('下一条普通消息')

    // First plain message: fresh create, not resume.
    h.persistence.headers = [{ version: 0, id: SessionId('feishu-old-1'), createdAt: 5, cwd: h.workspace }]
    await h.emitMessage('after new')
    await waitFor(() => h.agents.created.length === 1)
    expect(h.agents.resumed).toHaveLength(0)

    // Marker consumed: a later message stays on the same session.
    await h.emitMessage('more')
    await waitFor(() => (h.agents.live.values().next().value as FakeAgent | undefined)?.followups.length === 2)
    expect(h.agents.created).toHaveLength(1)
  })
})

describe('/resume atomic switch', () => {
  it('probes the target first, swaps on success, and keeps the old session on failure', async () => {
    const h = await makeHarness()
    await h.emitMessage('hello')
    await waitFor(() => h.agents.created.length === 1)
    const oldId = h.agents.created[0]!.options.sessionId!
    const target: SessionHeader = { version: 0, id: SessionId(`${oldId}-target`), createdAt: 9, cwd: h.workspace }
    h.persistence.headers = [target]
    h.persistence.remember(String(target.id))
    // Complete the turn so the switch guard passes (idle + no queued claims).
    const firstAgent = h.agents.live.get(String(oldId))!
    const firstMessage = firstAgent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(oldId, 'turn/start', { turn: 1 })
    await h.emitClaim(oldId, firstMessage!.id, 1)
    await h.emitSessionEvent(oldId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    firstAgent.status = 'idle'

    // Success path: probe (resume) first, then dispose the old handle.
    const oldAgent = h.agents.live.get(String(oldId))!
    await h.emitMessage(`/resume ${String(target.id)}`)
    await waitFor(() => h.agents.resumed.length === 1)
    expect(h.agents.live.get(String(target.id))).toBeDefined()
    expect(oldAgent.disposed).toBe(true)

    // Failure path: resume probe fails → old session retained.
    const h2 = await makeHarness()
    await h2.emitMessage('hello')
    await waitFor(() => h2.agents.created.length === 1)
    const oldId2 = h2.agents.created[0]!.options.sessionId!
    h2.persistence.headers = [{ version: 0, id: SessionId(`${oldId2}-target`), createdAt: 9, cwd: h2.workspace }]
    h2.persistence.remember(`${oldId2}-target`)
    h2.agents.failNextResume(new Error('probe exploded'))
    await h2.emitMessage(`/resume ${oldId2}-target`)
    await waitFor(() => h2.channel.sent.some(item => String(item.input.markdown).includes('恢复失败')))
    expect(h2.agents.live.get(String(oldId2))?.disposed).toBe(false)
  })

  it('rejects sessions outside the current prefix', async () => {
    const h = await makeHarness()
    await h.emitMessage('hello')
    await waitFor(() => h.agents.created.length === 1)
    await h.emitMessage('/resume other-prefix-1')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('找不到属于当前飞书话题')))
  })
})

describe('turn ledger and approval routing', () => {
  async function startFeishuTurn(h: Harness, turn = 1): Promise<{ sessionId: string; turn: number }> {
    await h.emitMessage('do the thing')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    // The real loop emits turn/start BEFORE Inbox.claim: emit turn/start, then
    // the claim that attributes the turn to OUR queued message (exact ledger).
    await waitFor(() => agent.followups.length >= 1, 'followup queued')
    const claimed = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn })
    if (claimed?.id !== undefined) {
      await h.emitClaim(sessionId, claimed.id, turn)
    }
    return { sessionId, turn }
  }

  it('claims approvals only for Feishu-originated turns; GUI turns pass through to next()', async () => {
    const h = await makeHarness()
    const sessionId = (await startFeishuTurn(h)).sessionId
    const answerer = firstAnswerer(h)!

    let outcome: unknown
    let nextCalled = false
    const request = approvalRequest(sessionId)
    const promise = answerer(request, async () => { nextCalled = true; return 'rejected' }).then((value: unknown) => { outcome = value })
    await waitFor(() => h.channel.sent.some(item => (item.input as { card?: unknown }).card !== undefined))
    expect(nextCalled).toBe(false)

    // Settle through the text fallback.
    await h.emitMessage('/approve')
    await promise
    expect(outcome).toBe('allowed-once')

    // GUI turn on the same session → answerer lets the waterfall continue.
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 2 })
    let nextCalledForGui = false
    const guiOutcome = await answerer(
      approvalRequest(sessionId, 'fs'),
      async () => { nextCalledForGui = true; return 'rejected' },
    )
    expect(nextCalledForGui).toBe(true)
    expect(guiOutcome).toBe('rejected')
  })

  it('settles through every path: text, card button, abort, timeout, stop, channel terminal failure', async () => {
    // text /reject
    const h1 = await makeHarness()
    const sid1 = (await startFeishuTurn(h1)).sessionId
    const answerer1 = firstAnswerer(h1)!
    let outcome1: unknown
    const p1 = answerer1(approvalRequest(sid1), async () => 'rejected').then((value: unknown) => { outcome1 = value })
    await waitFor(() => approvalTokenFromChannel(h1) !== undefined)
    await h1.emitMessage('/reject')
    await p1
    expect(outcome1).toBe('rejected')

    // card button allow
    const h2 = await makeHarness()
    const sid2 = (await startFeishuTurn(h2)).sessionId
    const answerer2 = firstAnswerer(h2)!
    let outcome2: unknown
    const p2 = answerer2(approvalRequest(sid2), async () => 'rejected').then((value: unknown) => { outcome2 = value })
    await waitFor(() => approvalTokenFromChannel(h2) !== undefined)
    const token = approvalTokenFromChannel(h2)!
    await h2.emitCardAction(
      { bridge: 'dsh-feishu-remote', action: 'approval', token, decision: 'allow' },
      'ou_1',
      'oc_p2p',
      approvalCardMessageId(h2, token),
    )
    await p2
    expect(outcome2).toBe('allowed-once')

    // signal abort → cancelled
    const h3 = await makeHarness()
    const sid3 = (await startFeishuTurn(h3)).sessionId
    const answerer3 = firstAnswerer(h3)!
    const controller = new AbortController()
    let outcome3: unknown
    const p3 = answerer3(approvalRequest(sid3, 'bash', { signal: controller.signal }), async () => 'rejected').then((value: unknown) => { outcome3 = value })
    await waitFor(() => approvalTokenFromChannel(h3) !== undefined)
    controller.abort()
    await p3
    expect(outcome3).toBe('cancelled')

    // timeout → unavailable
    const h4 = await makeHarness()
    const sid4 = (await startFeishuTurn(h4)).sessionId
    h4.config.interactiveTimeoutMs = 50
    const answerer4 = firstAnswerer(h4)!
    let outcome4: unknown
    const p4 = answerer4(approvalRequest(sid4), async () => 'rejected').then((value: unknown) => { outcome4 = value })
    await p4
    expect(outcome4).toBe('unavailable')

    // bridge stop → unavailable
    const h5 = await makeHarness()
    const sid5 = (await startFeishuTurn(h5)).sessionId
    const answerer5 = firstAnswerer(h5)!
    let outcome5: unknown
    const p5 = answerer5(approvalRequest(sid5), async () => 'rejected').then((value: unknown) => { outcome5 = value })
    await waitFor(() => approvalTokenFromChannel(h5) !== undefined)
    await h5.bridge.stop()
    await p5
    expect(outcome5).toBe('unavailable')

    // channel terminal failure → unavailable + channel rebuild
    const h6 = await makeHarness()
    const sid6 = (await startFeishuTurn(h6)).sessionId
    const answerer6 = firstAnswerer(h6)!
    let outcome6: unknown
    const p6 = answerer6(approvalRequest(sid6), async () => 'rejected').then((value: unknown) => { outcome6 = value })
    await waitFor(() => approvalTokenFromChannel(h6) !== undefined)
    const connectsBefore = h6.channel.connectCalls
    h6.channel.status = { state: 'failed', reconnectAttempts: 999 }
    await p6
    expect(outcome6).toBe('unavailable')
    await waitFor(() => h6.channel.connectCalls > connectsBefore, 'channel rebuild')
  })
})

describe('progress aggregation', () => {
  it('replaces step chunks with the full assistant message (no helhello duplication)', async () => {
    const h = await makeHarness()
    await h.emitMessage('say hello')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hel' } })
    // Let the throttled progress card land (a SEND), so the terminal card is a PATCH.
    await new Promise(resolve => setTimeout(resolve, 30))
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      usage: { inputTokens: 3, outputTokens: 5, cacheReadTokens: 0 },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.patched.length > 0)
    const lastCard = JSON.stringify(h.channel.patched.at(-1)!.card)
    expect(lastCard).toContain('hello')
    expect(lastCard).not.toContain('helhello')
    expect(lastCard).toContain('✅ 完成')
  })

  it('replaces tool-bearing progress with the final assistant summary at turn end', async () => {
    const h = await makeHarness()
    await h.emitMessage('fix it')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先检查代码和运行测试。' },
          { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"pnpm test"}' },
        ],
      },
    } as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 2,
      message: { role: 'assistant', content: [{ type: 'text', text: '修改完成，测试已经通过。' }] },
    })
    // DSH may append an empty assistant message that exists only to carry usage.
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 2,
      message: { role: 'assistant', content: [] },
      usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0 },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.patched.length > 0)
    const terminal = JSON.stringify(h.channel.patched.at(-1)!.card)
    expect(terminal).toContain('✅ 完成')
    expect(terminal).toContain('修改完成，测试已经通过。')
    expect(terminal).not.toContain('我先检查代码和运行测试。')
    expect(terminal).not.toContain('pnpm test')
    expect(terminal).not.toContain('bash')
  })

  it('uses the non-empty final summary when progress cards are disabled', async () => {
    const h = await makeHarness({ progressCards: false })
    await h.emitMessage('fix it quietly')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '先执行检查。' },
          { type: 'tool-call', id: 'call_2', name: 'bash', arguments: '{}' },
        ],
      },
    } as never)
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 2,
      message: { role: 'assistant', content: [{ type: 'text', text: '处理完成。' }] },
    })
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1,
      step: 2,
      message: { role: 'assistant', content: [] },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('处理完成。')))
    const result = h.channel.sent.find(item => String(item.input.markdown).includes('处理完成。'))!
    expect(result.input.markdown).toBe('处理完成。')
    expect(String(result.input.markdown)).not.toContain('先执行检查。')
  })

  it('keeps the latest non-empty partial text for a cancelled turn', async () => {
    const h = await makeHarness()
    await h.emitMessage('start then cancel')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', text: '已完成到一半。' },
    })
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    await h.emitSessionEvent(sessionId, 'turn/end', {
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    } as never)
    await waitFor(() => h.channel.patched.length > 0)
    const terminal = JSON.stringify(h.channel.patched.at(-1)!.card)
    expect(terminal).toContain('⏹️ 已停止')
    expect(terminal).toContain('已完成到一半。')
  })

  it('uses ordinary patches for live and terminal cards', async () => {
    const h = await makeHarness()
    await h.emitMessage('stream')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'live' } })
    // The first card lands as a regular mutable SEND while the turn runs.
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    const live = h.channel.sent.find(item => item.input.card !== undefined)!
    expect((live.input.card as { config: Record<string, unknown> }).config).not.toHaveProperty('streaming_mode')
    // The terminal update patches that same card and replaces the progress.
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.patched.length > 0)
    const terminal = h.channel.patched.at(-1)!
    expect(terminal.messageId).toBe(live.messageId)
    expect((terminal.card as { config: Record<string, unknown> }).config).not.toHaveProperty('streaming_mode')
  })

  it('patches live updates and the terminal result on the same message', async () => {
    const h = await makeHarness()
    await h.emitMessage('stream')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'first' } })
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    const live = h.channel.sent.find(item => item.input.card !== undefined)!
    const messageId = live.messageId
    expect((live.input.card as { config: Record<string, unknown> }).config).not.toHaveProperty('streaming_mode')
    // More output → a live PATCH on the SAME message.
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: ' more' } })
    await waitFor(() => h.channel.patched.length > 0)
    const livePatch = h.channel.patched.at(-1)!
    expect(livePatch.messageId).toBe(messageId)
    expect((livePatch.card as { config: Record<string, unknown> }).config).not.toHaveProperty('streaming_mode')
    // Terminal result patches that same card.
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.patched.length > 1)
    const terminal = h.channel.patched.at(-1)!
    expect(terminal.messageId).toBe(messageId)
    expect((terminal.card as { config: Record<string, unknown> }).config).not.toHaveProperty('streaming_mode')
  })

  it('drops stale queued progress work after turn/end and explains legacy /view actions', async () => {
    const h = await makeHarness()
    await h.emitMessage('stream')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    // Hold the initial live-card SEND open so the turn can end while it is in flight.
    let release!: () => void
    h.channel.cardGate = new Promise<void>(resolve => { release = resolve })
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'live' } })
    await waitFor(() => h.scheduler.pendingCount > 0, 'live send dispatched')
    // One more progress tick while the chain is busy: let its timer fire so
    // the upsert is CHAINED behind the blocked send, then the turn ends.
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: ' x' } })
    await new Promise(resolve => setTimeout(resolve, 15))
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    release()
    await waitFor(() => h.channel.patched.length > 0)
    // Exactly one live SEND; the queued progress update was dropped, so the
    // FIRST patch is already the terminal one.
    expect(h.channel.sent.filter(item => item.input.card !== undefined)).toHaveLength(1)
    expect(h.channel.patched).toHaveLength(1)
    expect(JSON.stringify(h.channel.patched[0]!.card)).toContain('✅ 完成')
    // Old already-sent /view buttons stay parseable and receive a clear deprecation reply.
    await h.emitCardAction({ bridge: 'dsh-feishu-remote', action: 'view', sessionId })
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('极简视图')))
  })

  it('enqueues the terminal patch while a stale progress patch is mid-flight (Round 12 F2 bypass)', async () => {
    const h = await makeHarness()
    await h.emitMessage('stream')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'live' } })
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    // Hold the next live PATCH in flight (dispatched but not settled).
    let release!: () => void
    h.channel.patchGate = new Promise<void>(resolve => { release = resolve })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: ' x' } })
    // Let the throttled upsert enqueue AND the scheduler dispatch it (the
    // dispatch then blocks on patchGate) — a settled in-flight patch cannot
    // be coalesced away, so the terminal patch must queue alongside it.
    await new Promise(resolve => setTimeout(resolve, 60))
    await waitFor(() => h.scheduler.pendingCount >= 1, 'stale patch in flight')
    // Turn ends while the stale patch is mid-flight: the terminal patch must
    // be enqueued immediately (chain bypass) instead of waiting behind it.
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.scheduler.pendingCount >= 2, 'terminal patch enqueued despite stale patch in flight')
    release()
    await waitFor(() => h.channel.patched.length === 2)
    // Per-messageId scheduler ordering: stale progress first, terminal result last.
    expect(JSON.stringify(h.channel.patched[0]!.card)).toContain('正在处理')
    expect(JSON.stringify(h.channel.patched[1]!.card)).toContain('✅ 完成')
    expect(h.channel.patched[1]!.messageId).toBe(h.channel.patched[0]!.messageId)
  })

  it('re-sends the terminal card when a CHAINED terminal patch fails permanently (final verify P1, no self-wait)', async () => {
    const h = await makeHarness()
    await h.emitMessage('stream')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    // Hold the initial live-card SEND in flight so the terminal card is
    // CHAINED behind it (the bypass needs a settled messageId).
    let release!: () => void
    h.channel.cardGate = new Promise<void>(resolve => { release = resolve })
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'live' } })
    await waitFor(() => h.scheduler.pendingCount > 0, 'initial send in flight')
    // The chained terminal PATCH will fail permanently (230031: 超 14 天).
    h.channel.patchErrors.push({
      cause: { response: { status: 400, data: { code: 230031 }, message: 'too late' } },
    } as never)
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    release()
    // Fallback = a fresh TERMINAL card SEND. If the
    // fallback re-chained behind itself, this would deadlock and never land.
    await waitFor(() => h.channel.sent.filter(item => item.input.card !== undefined).length >= 2, 'fresh terminal card after chained-patch permanent failure')
    const cards = h.channel.sent.filter(item => item.input.card !== undefined)
    expect(JSON.stringify(cards.at(-1)!.input.card)).toContain('✅ 完成')
  })

  it('drops replayed events by the seq watermark', async () => {
    const h = await makeHarness()
    await h.emitMessage('hello')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } })
    // Let the throttled progress patch settle first.
    await new Promise(resolve => setTimeout(resolve, 40))
    const before = h.channel.patched.length
    // Replay the exact same event (same seq) — must be ignored.
    eventSeq -= 1
    const list = h.ctx.listeners.get('session/event')!
    await list[0]!.fn({ id: sessionId } as never, sessionEvent('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'y' } }, sessionId) as never)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(h.channel.patched.length).toBe(before)
  })
})

describe('working reaction (敲键盘)', () => {
  it('adds the typing reaction to the triggering message when a feishu turn is claimed, removes at turn/end', async () => {
    const h = await makeHarness()
    await h.emitMessage('run')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const inboundId = `om_in_${messageSeq}`
    const agent = h.agents.live.get(sessionId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, msg!.id, 1)
    await waitFor(() => h.channel.reactionsAdded.length === 1)
    expect(h.channel.reactionsAdded[0]).toEqual({ messageId: inboundId, emojiType: 'Typing' })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.reactionsRemoved.length === 1)
    expect(h.channel.reactionsRemoved[0]).toEqual({ messageId: inboundId, emojiType: 'Typing' })
  })

  it('does not react to GUI turns or when workingReaction is disabled', async () => {
    const h = await makeHarness()
    await h.emitMessage('run')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    // GUI turn: no claim → no reaction.
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.channel.reactionsAdded).toHaveLength(0)

    const h2 = await makeHarness({ workingReaction: false })
    await h2.emitMessage('run')
    await waitFor(() => h2.agents.created.length === 1)
    const sessionId2 = h2.agents.created[0]!.options.sessionId!
    const agent2 = h2.agents.live.get(sessionId2)!
    const msg2 = agent2.followups.at(-1) as { id?: unknown }
    await h2.emitSessionEvent(sessionId2, 'turn/start', { turn: 1 })
    await h2.emitClaim(sessionId2, msg2!.id, 1)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h2.channel.reactionsAdded).toHaveLength(0)
  })
})

describe('commands', () => {
  it('documents command-based task control and deprecates /view clearly', async () => {
    const h = await makeHarness()
    await h.emitMessage('/help')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('只有审批卡保留')))
    const help = String(h.channel.sent.at(-1)!.input.markdown)
    expect(help).toContain('/stop')
    expect(help).not.toContain('/view compact')
    expect(help).not.toContain('按钮可直接处理审批、停止任务和新建会话')

    await h.emitMessage('/view developer')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('/view` 已停用')))
    expect(h.agents.created).toHaveLength(0)
  })

  it('/stop cancels only the current turn and keeps the inbox', async () => {
    const h = await makeHarness()
    await h.emitMessage('run')
    await waitFor(() => h.agents.created.length === 1)
    const agent = h.agents.live.values().next().value as FakeAgent
    agent.status = 'running'
    await h.emitMessage('/stop')
    await waitFor(() => agent.cancels.length === 1)
    expect(agent.cancels[0]!.cause).toEqual({ kind: 'user' })
    expect(agent.cancels[0]!.options).toEqual({ keepInbox: true })
  })

  it('/steer feeds the current step instead of queuing a new turn', async () => {
    const h = await makeHarness()
    await h.emitMessage('run')
    await waitFor(() => h.agents.created.length === 1)
    await h.emitMessage('/steer use port 8080')
    await waitFor(() => (h.agents.live.values().next().value as FakeAgent).steers.length === 1)
    expect((h.agents.live.values().next().value as FakeAgent).followups).toHaveLength(1)
  })

  it('rejects unknown native commands and passes only allowlisted ones through', async () => {
    const h = await makeHarness()
    await h.emitMessage('/frobnicate')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('未知命令')))
    expect(h.agents.created).toHaveLength(0)

    const h2 = await makeHarness({ commandAllowlist: ['frobnicate'] })
    const executed: string[] = []
    h2.ctx.services.set('commands', {
      list: () => [],
      execute: async (_agent: unknown, line: string) => {
        executed.push(line)
        return { result: { kind: 'success', text: '✅ ok' } }
      },
    })
    await h2.emitMessage('/frobnicate now')
    await waitFor(() => executed.length === 1)
    expect(h2.channel.sent.at(-1)!.input.markdown).toBe('✅ ok')
  })

  it('/status reports the session and connection state', async () => {
    const h = await makeHarness()
    await h.emitMessage('/status')
    await waitFor(() => h.agents.created.length === 1)
    await waitFor(() => h.channel.sent.some(item => (item.input as { card?: unknown }).card !== undefined))
  })
})

describe('volume budget and oversized output', () => {
  it('archives oversized replies to the workspace and sends the file', async () => {
    const h = await makeHarness()
    await h.emitMessage('big')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const big = 'x'.repeat(h.config.cardBodyMaxChars + 100)
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: big }] },
    })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.some(item => (item.input as { file?: unknown }).file !== undefined))
    const archiveDir = join(h.workspace, '.dsh-feishu-remote')
    await waitFor(async () => (await readdir(archiveDir)).length > 0, 'archive file')
    const files = await readdir(archiveDir)
    expect(files.some(name => name.includes(sessionId))).toBe(true)
  })
})

describe('preset setup and ask-user blocking', () => {
  it('mounts the preset before restricting ask-user tools in session setup', async () => {
    const h = await makeHarness()
    const order: string[] = []
    const agentCtx = {
      tools: { restrict: (filter: unknown) => { order.push(`restrict:${JSON.stringify(filter)}`) } },
      systemPrompt: { section: () => undefined },
    }
    await (h.bridge as unknown as { setupAgent: (agentCtx: never, presetId?: string) => Promise<void> }).setupAgent(agentCtx as never, 'standard')
    const presets = h.ctx.services.get('agentPresets') as { mount: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> }
    expect(presets.mount).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['restrict:{"deny":["ask_user_question","exit_plan_mode"]}'])
  })
})

describe('maxLiveAgents', () => {
  it('rejects new origins at the live-agent cap with an actionable message', async () => {
    const h = await makeHarness({ maxLiveAgents: 1 })
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    await h.emitMessage('second origin', { chatId: 'oc_grp', chatType: 'group', threadId: 'omt_cap' })
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('上限')))
    expect(h.agents.created).toHaveLength(1)
  })
})

describe('turn ledger exact attribution (Codex P0-1 regression)', () => {
  it('keeps a GUI turn GUI even while a Feishu message is still queued', async () => {
    const h = await makeHarness()
    await h.emitMessage('feishu later') // our message sits in pendingClaims
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const answerer = firstAnswerer(h)!

    // The GUI opens turn 1 first (turn/start precedes the claim of any message).
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    let nextCalled = false
    const guiOutcome = await answerer(approvalRequest(sessionId), async () => {
      nextCalled = true
      return 'rejected'
    })
    expect(nextCalled).toBe(true)
    expect(guiOutcome).toBe('rejected')

    // Turn 2 claims OUR message → feishu.
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    const agent = h.agents.live.get(sessionId)!
    const claimed = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 2 })
    await h.emitClaim(sessionId, claimed!.id, 2)
    let outcome: unknown
    const promise = answerer(approvalRequest(sessionId), async () => 'rejected').then((value: unknown) => { outcome = value })
    await waitFor(() => approvalTokenFromChannel(h) !== undefined)
    await h.emitMessage('/approve')
    await promise
    expect(outcome).toBe('allowed-once')
  })

  it('rejects an approval callback carrying the wrong card messageId', async () => {
    const h = await makeHarness()
    await h.emitMessage('do the thing')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1, 'followup queued')
    const claimed = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, claimed!.id, 1)
    const answerer = firstAnswerer(h)!
    let outcome: unknown
    const promise = answerer(approvalRequest(sessionId), async () => 'rejected').then((value: unknown) => { outcome = value })
    await waitFor(() => approvalTokenFromChannel(h) !== undefined)
    const token = approvalTokenFromChannel(h)!
    await h.emitCardAction(
      { bridge: 'dsh-feishu-remote', action: 'approval', token, decision: 'allow' },
      'ou_1',
      'oc_p2p',
      'om_wrong_message',
    )
    // Still pending — settle through the text fallback.
    await h.emitMessage('/approve')
    await promise
    expect(outcome).toBe('allowed-once')
  })
})

describe('switch guards (Codex review #2 F2/F5)', () => {
  it('refuses /new rotation while a turn is running', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const agent = h.agents.live.values().next().value as FakeAgent
    agent.status = 'running' // turn in flight
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))
    await h.emitMessage('second')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('仍在运行')))
    expect(h.agents.created).toHaveLength(1) // no rotation happened
  })

  it('refuses /new rotation while our messages are still queued', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const agent = h.agents.live.values().next().value as FakeAgent
    agent.status = 'idle' // idle, but the message was never claimed
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))
    await h.emitMessage('second')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('排队中')))
    expect(h.agents.created).toHaveLength(1)
  })

  it('allows replacement at the maxLiveAgents cap', async () => {
    const h = await makeHarness({ maxLiveAgents: 1 })
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const firstId = h.agents.created[0]!.options.sessionId!
    const firstAgent = h.agents.live.get(firstId)!
    const firstMessage = firstAgent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(firstId, 'turn/start', { turn: 1 })
    await h.emitClaim(firstId, firstMessage!.id, 1)
    await h.emitSessionEvent(firstId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    firstAgent.status = 'idle'
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))
    await h.emitMessage('second')
    await waitFor(() => h.agents.created.length === 2)
    expect(firstAgent.disposed).toBe(true)
  })
})

describe('/new with a live session (Codex P1-2 regression)', () => {
  it('rotates to a fresh session on the next plain message and consumes the marker', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const firstId = h.agents.created[0]!.options.sessionId!
    const firstAgent = h.agents.live.get(firstId)!
    // Complete the turn so the switch guard passes (idle + no queued claims).
    const firstMessage = firstAgent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(firstId, 'turn/start', { turn: 1 })
    await h.emitClaim(firstId, firstMessage!.id, 1)
    await h.emitSessionEvent(firstId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    firstAgent.status = 'idle'

    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))

    await h.emitMessage('second')
    await waitFor(() => h.agents.created.length === 2)
    expect(firstAgent.disposed).toBe(true)
    const newId = h.agents.created[1]!.options.sessionId!
    expect(h.agents.live.get(newId)!.followups).toHaveLength(1)

    // Marker consumed: later messages stay on the new session.
    await h.emitMessage('third')
    await waitFor(() => h.agents.live.get(newId)!.followups.length === 2)
    expect(h.agents.created).toHaveLength(2)
  })
})

describe('single terminal card (Codex P1-4 regression)', () => {
  it('emits exactly one terminal card for a turn with no output events', async () => {
    const h = await makeHarness()
    await h.emitMessage('do the thing')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const claimed = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, claimed!.id, 1)
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.some(item => (item.input as { card?: unknown }).card !== undefined))
    await new Promise(resolve => setTimeout(resolve, 30))
    const cards = h.channel.sent.filter(item => (item.input as { card?: unknown }).card !== undefined)
    expect(cards).toHaveLength(1)
    expect(JSON.stringify(cards[0]!.input)).toContain('✅ 完成')
  })
})

describe('switch guards — authoritative inbox (Codex review #3 F1)', () => {
  it('refuses switches while GUI/injected work sits in the agent inbox', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, msg!.id, 1)
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    agent.status = 'idle'
    agent.inbox.hasPending = true // GUI/injected context we cannot see
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))
    await h.emitMessage('second')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('排队中')))
    expect(h.agents.created).toHaveLength(1)
  })

  it('cleans ledger entries for discarded messages so switches can proceed', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    agent.status = 'idle'
    await h.emitMessage('/new')
    await waitFor(() => h.channel.sent.some(item => String(item.input.markdown).includes('下一条普通消息')))
    // The queued message gets discarded (never claimed) — ledger must follow.
    await h.ctx.emit('agent/inbox/discarded', { agent: { id: SessionId(sessionId) }, message: { id: msg!.id } } as never)
    await h.emitMessage('second')
    await waitFor(() => h.agents.created.length === 2)
    expect(agent.disposed).toBe(true)
  })
})

describe('stop drains in-flight creation (Codex review #3 F2)', () => {
  it('disposes a probe that resolves after stop() began', async () => {
    const h = await makeHarness()
    let releaseCreate: () => void = () => undefined
    h.agents.gateCreate = new Promise<void>((resolve) => { releaseCreate = resolve })
    await h.emitMessage('hello')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(h.agents.live.size).toBe(0) // still blocked in create
    const stopping = h.bridge.stop()
    releaseCreate()
    await stopping
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(h.agents.live.size).toBe(0) // no leaked live agent
    expect(h.agents.created).toHaveLength(1)
  })
})

describe('finalizer quiescence across switches (Codex review #4 F1)', () => {
  it('waits for an in-flight turn finalizer before /resume swaps the session', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const oldId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(oldId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(oldId, 'turn/start', { turn: 1 })
    await h.emitClaim(oldId, msg!.id, 1)
    await h.emitSessionEvent(oldId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 20)) // let the real finalizer finish
    agent.status = 'idle'
    // Simulate a second, slow finalizer (e.g. a turn that ended while idle):
    let releaseFinalize: () => void = () => undefined
    const entries = Reflect.get(h.bridge, 'sessions') as Map<string, { pendingFinalize?: Promise<void> }>
    entries.get('p2p:oc_p2p')!.pendingFinalize = new Promise<void>((resolve) => { releaseFinalize = resolve })

    const target: SessionHeader = { version: 0, id: SessionId(`${oldId}-target`), createdAt: 9, cwd: h.workspace }
    h.persistence.headers = [target]
    h.persistence.remember(String(target.id))
    await h.emitMessage(`/resume ${String(target.id)}`)
    await new Promise(resolve => setTimeout(resolve, 40))
    // The probe ran, but the SWAP must wait on the finalizer: the old handle
    // is still owned (its disposal is the swap's commit marker).
    expect(agent.disposed).toBe(false)

    releaseFinalize()
    await waitFor(() => agent.disposed === true, 'resume after finalizer drained')
  })
})

describe('delivery-failure audit (Codex review #5 F3)', () => {
  it('persists permanent delivery failures and surfaces them in /status', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    // Force a permanent patch failure: 230031 (超14天) is never retried.
    h.channel.patchErrors.push({
      cause: { response: { status: 400, data: { code: 230031 }, message: 'too late' } },
    } as never)
    const agent = h.agents.live.get(sessionId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, msg!.id, 1)
    await new Promise(resolve => setTimeout(resolve, 25)) // first card sent
    await h.emitSessionEvent(sessionId, 'assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    })
    // Let the progress card land first so the terminal update is a PATCH.
    await waitFor(() => h.channel.sent.some(item => (item.input as { card?: unknown }).card !== undefined))
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The permanent failure was audited (state snapshot re-read each poll).
    const stateStore = (h.bridge as never as { state: { snapshot(): { deliveryFailures: Array<{ sessionId: string }> } } }).state
    await waitFor(() => stateStore.snapshot().deliveryFailures.length >= 1, 'audit record')
    expect(stateStore.snapshot().deliveryFailures[0]!.sessionId).toBe(sessionId)
    // The patch-permanent fallback sent a fresh terminal card.
    await waitFor(() => h.channel.sent.filter(item => (item.input as { card?: unknown }).card !== undefined).length >= 2, 'fresh terminal card fallback')
    // /status surfaces the count.
    await h.emitMessage('/status')
    await waitFor(() => h.channel.sent.some(item => JSON.stringify(item.input).includes('送达失败')))
  })
})

describe('no resurrection after teardown deadline (Codex review #7 F1)', () => {
  it('never commits a probe into a stopped bridge once the producer wait expired', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const oldId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(oldId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(oldId, 'turn/start', { turn: 1 })
    await h.emitClaim(oldId, msg!.id, 1)
    await h.emitSessionEvent(oldId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.status = 'idle'
    // A finalizer that outlives teardown's producer wait.
    let releaseFinalize: () => void = () => undefined
    const entries = Reflect.get(h.bridge, 'sessions') as Map<string, { pendingFinalize?: Promise<void> }>
    entries.get('p2p:oc_p2p')!.pendingFinalize = new Promise<void>((resolve) => { releaseFinalize = resolve })

    const target: SessionHeader = { version: 0, id: SessionId(`${oldId}-target`), createdAt: 9, cwd: h.workspace }
    h.persistence.headers = [target]
    h.persistence.remember(String(target.id))
    await h.emitMessage(`/resume ${String(target.id)}`)
    await new Promise(resolve => setTimeout(resolve, 20)) // probe done, quiescence pending

    await h.bridge.stop() // producer wait expires; handles disposed
    releaseFinalize()
    await new Promise(resolve => setTimeout(resolve, 30))
    // The probe must have been disposed, not committed into the stopped bridge:
    // stop() disposed the old handle, the cancelled probe disposed itself.
    expect(h.agents.live.size).toBe(0)
    expect(h.agents.live.get(String(target.id))).toBeUndefined()
  })
})

describe('provisional probe teardown (Codex review #8 F1)', () => {
  it('disposes a probe waiting on a never-settling finalizer when the bridge stops', async () => {
    const h = await makeHarness()
    await h.emitMessage('first')
    await waitFor(() => h.agents.created.length === 1)
    const oldId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(oldId)!
    const msg = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(oldId, 'turn/start', { turn: 1 })
    await h.emitClaim(oldId, msg!.id, 1)
    await h.emitSessionEvent(oldId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.status = 'idle'
    const entries = Reflect.get(h.bridge, 'sessions') as Map<string, { pendingFinalize?: Promise<void> }>
    entries.get('p2p:oc_p2p')!.pendingFinalize = new Promise<void>(() => undefined) // never settles

    const target: SessionHeader = { version: 0, id: SessionId(`${oldId}-target`), createdAt: 9, cwd: h.workspace }
    h.persistence.headers = [target]
    h.persistence.remember(String(target.id))
    await h.emitMessage(`/resume ${String(target.id)}`)
    await waitFor(() => h.agents.resumed.length === 1, 'probe created')

    await h.bridge.stop() // producer wait expires; provisional probe must be drained
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.agents.live.size).toBe(0)
    expect(h.agents.live.get(String(target.id))).toBeUndefined()
  })
})

describe('already-aborted approval signal (Codex review #9 F3)', () => {
  it('settles cancelled immediately without sending a card', async () => {
    const h = await makeHarness()
    await h.emitMessage('do the thing')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const claimed = agent.followups.at(-1) as { id?: unknown }
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitClaim(sessionId, claimed!.id, 1)

    const controller = new AbortController()
    controller.abort()
    const answerer = firstAnswerer(h)!
    let outcome: unknown
    await answerer(approvalRequest(sessionId, 'bash', { signal: controller.signal }), async () => 'rejected')
      .then((value: unknown) => { outcome = value })
    expect(outcome).toBe('cancelled')
    // No approval card was ever sent for it.
    expect(approvalTokenFromChannel(h)).toBeUndefined()
  })
})

describe('terminalOutcome mapping', () => {
  it('maps all six raw turn-end kinds', () => {
    expect(terminalOutcome({ kind: 'completed' } as never).outcome).toBe('completed')
    expect(terminalOutcome({ kind: 'aborted', reason: { kind: 'user' } } as never).outcome).toBe('cancelled')
    expect(terminalOutcome({ kind: 'blocked' } as never).outcome).toBe('blocked')
    expect(terminalOutcome({ kind: 'max-tokens' } as never).outcome).toBe('blocked')
    expect(terminalOutcome({ kind: 'error', error: new Error('boom') } as never).outcome).toBe('error')
    expect(terminalOutcome({ kind: 'interrupted' } as never).outcome).toBe('error')
    expect(terminalOutcome({ kind: 'mystery' } as never).outcome).toBe('error')
  })
})

// ---------------------------------------------------------------- context backfill (docs/13)

function historyMessage(overrides: Partial<ContextMessage> = {}): ContextMessage {
  return {
    messageId: 'om_hist_1',
    senderName: '小明',
    senderId: 'ou_1234567890',
    isOwnBot: false,
    isBotApp: false,
    msgType: 'text',
    deleted: false,
    text: '之前聊过的内容',
    createdAtMs: Date.now() - 60_000,
    ...overrides,
  }
}

class FakeContextProvider implements FeishuContextProvider {
  readonly kind = 'cli' as const
  readonly calls: Array<Parameters<FeishuContextProvider['fetchHistory']>[0]> = []
  next: ContextMessage[] | Error = []

  async fetchHistory(spec: Parameters<FeishuContextProvider['fetchHistory']>[0]): Promise<ContextMessage[]> {
    this.calls.push(spec)
    if (this.next instanceof Error) throw this.next
    return [...this.next]
  }
}

function followupContent(agent: { followups: Array<{ content: Array<{ type: string; text: string }>; id: string }> }, index = 0) {
  return agent.followups[index]!.content
}

/** Fake CLI for the docs/15 bootstrap integration test: config show/init + one im list envelope. */
const BOOTSTRAP_CLI_FIXTURE = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const fixtureDir = dirname(fileURLToPath(import.meta.url))
const statePath = join(fixtureDir, 'state.json')
const logPath = join(fixtureDir, 'calls.jsonl')
const argv = process.argv.slice(2)
appendFileSync(logPath, JSON.stringify({ argv, configured: existsSync(statePath) }) + '\\n')
if (argv[0] === 'config' && argv[1] === 'show') {
  if (existsSync(statePath)) { process.stdout.write(JSON.stringify({ appId: readFileSync(statePath, 'utf8').trim(), appSecret: '****', brand: 'feishu', profile: 'x' })); process.exit(0) }
  process.stdout.write(JSON.stringify({ ok: false, error: { type: 'config', subtype: 'not_configured' } })); process.exit(0)
} else if (argv[0] === 'config' && argv[1] === 'init') {
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', () => undefined)
  process.stdin.on('end', () => {
    // Widen the cold-start window so two different origins deterministically
    // exercise the shared bootstrap promise instead of racing config init.
    setTimeout(() => {
      writeFileSync(statePath, argv[argv.indexOf('--app-id') + 1])
      process.exit(0)
    }, 150)
  })
  process.stdin.resume()
} else if (argv[0] === 'im' && (argv[1] === '+chat-messages-list' || argv[1] === '+threads-messages-list')) {
  if (!existsSync(statePath)) { process.stderr.write('token_missing'); process.exit(3) }
  process.stdout.write(JSON.stringify({
    ok: true,
    data: { messages: [ { message_id: 'om_b1', msg_type: 'text', content: 'cli 引导后内容', sender: { id: 'ou_a', name: '小明', sender_type: 'user' }, create_time: '2026-08-19 10:00', deleted: false, updated: false } ] },
    meta: { count: 1, pagination: { complete: true } },
  }))
  process.exit(0)
} else {
  process.exit(1)
}
`

describe('context backfill (docs/13)', () => {
  it('prepends a JSON-framed context block and attributes stats to the exact turn', async () => {
    const provider = new FakeContextProvider()
    provider.next = [historyMessage({ messageId: 'om_h1' })]
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('接着干')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const content = followupContent(agent)
    expect(content.length).toBe(2)
    expect(content[0]!.type).toBe('text')
    const frame = JSON.parse(content[0]!.text) as { type: string; count: number; messages: Array<{ n: string }> }
    expect(frame.type).toBe('feishu-context')
    expect(frame.count).toBe(1)
    expect(frame.messages[0]!.n).toBe('小明')
    expect(content[1]!.text).toBe('接着干')
    // Stats remain available internally but ordinary turn cards stay concise.
    await h.emitClaim(sessionId, agent.followups[0]!.id, 1)
    await h.emitSessionEvent(sessionId, 'turn/start', { turn: 1 })
    await h.emitSessionEvent(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    const card = h.channel.sent.find(item => item.input.card !== undefined)!
    expect(JSON.stringify(card.input.card)).not.toContain('飞书上下文')
  })

  it('injects incrementally: the second message carries the watermark and injects nothing new', async () => {
    const provider = new FakeContextProvider()
    const stamp = Date.now() - 60_000
    provider.next = [historyMessage({ messageId: 'om_h1', createdAtMs: stamp })]
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('第一问')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    expect(provider.calls[0]!.watermark).toBeUndefined()
    await h.emitMessage('第二问')
    await waitFor(() => agent.followups.length === 2)
    expect(provider.calls[1]!.watermark).toEqual({ messageId: 'om_h1', createdAtMs: stamp })
    // Window empty after the watermark → NO context block on the second turn.
    expect(followupContent(agent, 1).length).toBe(1)
    // Watermark persisted to the owner-only state file (docs/13 F6).
    let persisted = false
    const deadline = Date.now() + 1_000
    while (!persisted && Date.now() < deadline) {
      try {
        const raw = JSON.parse(await readFile(h.statePath, 'utf8')) as { contextWatermarks?: Record<string, { messageId: string }> }
        persisted = raw.contextWatermarks?.[sessionId]?.messageId === 'om_h1'
      } catch {
        // state file not written yet
      }
      if (!persisted) await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(persisted).toBe(true)
  })

  it('control commands fetch ZERO history', async () => {
    const provider = new FakeContextProvider()
    provider.next = [historyMessage()]
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('/status')
    await waitFor(() => h.channel.sent.length > 0)
    await h.emitMessage('/stop')
    await waitFor(() => h.channel.sent.length > 1)
    expect(provider.calls.length).toBe(0)
  })

  it('fails open: provider errors never block the message', async () => {
    const provider = new FakeContextProvider()
    provider.next = new Error('boom')
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('继续干')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    expect(followupContent(agent).length).toBe(1)
    expect(followupContent(agent)[0]!.text).toBe('继续干')
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('上下文拉取失败'), expect.anything())
  })

  it('causal cutoff: messages newer than the trigger are dropped', async () => {
    const provider = new FakeContextProvider()
    provider.next = [
      historyMessage({ messageId: 'om_old' }),
      historyMessage({ messageId: 'om_future', createdAtMs: Date.now() + 30_000 }),
    ]
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('问')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const frame = JSON.parse(followupContent(agent)[0]!.text) as { messages: Array<Record<string, unknown>> }
    expect(frame.messages.length).toBe(1)
  })

  it('uses a tighter private-chat window while preserving the larger thread window', async () => {
    const privateProvider = new FakeContextProvider()
    const privateHarness = await makeHarness({ contextMode: 'auto' }, { contextProvider: privateProvider })
    await privateHarness.emitMessage('私聊问题')
    await waitFor(() => privateProvider.calls.length === 1)
    expect(privateProvider.calls[0]!.maxMessages).toBe(80)
    expect(privateProvider.calls[0]!.maxChars).toBe(50_000)

    const threadProvider = new FakeContextProvider()
    const threadHarness = await makeHarness({ contextMode: 'auto' }, { contextProvider: threadProvider })
    await threadHarness.emitMessage('话题问题', {
      chatType: 'group', chatId: 'oc_grp', threadId: 'omt_limits', rootId: 'om_root_limits',
    })
    await waitFor(() => threadProvider.calls.length === 1)
    expect(threadProvider.calls[0]!.maxMessages).toBe(150)
    expect(threadProvider.calls[0]!.maxChars).toBe(100_000)
  })

  it('lets the global context ceiling tighten the private-chat window', async () => {
    const provider = new FakeContextProvider()
    const h = await makeHarness({
      contextMode: 'auto', contextMaxMessages: 40, contextMaxChars: 20_000,
    }, { contextProvider: provider })
    await h.emitMessage('私聊问题')
    await waitFor(() => provider.calls.length === 1)
    expect(provider.calls[0]!.maxMessages).toBe(40)
    expect(provider.calls[0]!.maxChars).toBe(20_000)
  })

  it('sdk backend drives the channel seam (p2p chat container)', async () => {
    const h = await makeHarness({ contextMode: 'auto', contextBackend: 'sdk' })
    h.channel.historyItems = [{
      message_id: 'om_s1',
      msg_type: 'text',
      body: { content: JSON.stringify({ text: 'sdk 历史' }) },
      sender: { id: 'ou_9', sender_type: 'user', sender_name: '老王' },
      create_time: String(Date.now() - 1_000),
      deleted: false,
    }]
    await h.emitMessage('问')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const frame = JSON.parse(followupContent(agent)[0]!.text) as { messages: Array<{ n: string; x: string }> }
    expect(frame.messages[0]!.x).toContain('sdk 历史')
    expect(frame.messages[0]!.n).toBe('老王')
    expect(h.channel.listed[0]!.containerIdType).toBe('chat')
    expect(h.channel.listed[0]!.containerId).toBe('oc_p2p')
  })

  it('sdk backend uses the thread container for group threads', async () => {
    const h = await makeHarness({ contextMode: 'auto', contextBackend: 'sdk' })
    await h.emitMessage('话题内提问', { chatType: 'group', chatId: 'oc_grp', threadId: 'omt_1', rootId: 'om_root_1' })
    await waitFor(() => h.agents.created.length === 1)
    await waitFor(() => h.channel.listed.length > 0)
    expect(h.channel.listed[0]!.containerIdType).toBe('thread')
    expect(h.channel.listed[0]!.containerId).toBe('omt_1')
    // Thread-root back-fill request (docs/15 F-05) fired through the seam.
    await waitFor(() => h.channel.getMessageCalls.includes('om_root_1'))
  })

  it('status card reports the context backend line', async () => {
    const provider = new FakeContextProvider()
    const h = await makeHarness({ contextMode: 'auto' }, { contextProvider: provider })
    await h.emitMessage('/status')
    await waitFor(() => h.channel.sent.some(item => item.input.card !== undefined))
    const card = h.channel.sent.find(item => item.input.card !== undefined)!
    expect(JSON.stringify(card.input.card)).toContain('飞书上下文')
  })

  it('auto mode downgrades to the SDK after a runtime CLI failure (docs/15 F-06)', async () => {
    // A configured-but-missing binary: CLI resolution succeeds, the spawn
    // fails with ENOENT, and `auto` must taint the CLI and retry via SDK.
    const h = await makeHarness({ contextMode: 'auto', contextBackend: 'auto', feishuCliPath: '/nonexistent/lark-cli' })
    h.channel.historyItems = [{
      message_id: 'om_s1',
      msg_type: 'text',
      body: { content: JSON.stringify({ text: 'sdk 兜底内容' }) },
      sender: { id: 'ou_9', sender_type: 'user', sender_name: '老王' },
      create_time: String(Date.now() - 1_000),
      deleted: false,
    }]
    await h.emitMessage('问')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1)
    const frame = JSON.parse(followupContent(agent)[0]!.text) as { messages: Array<{ x: string }> }
    expect(frame.messages[0]!.x).toContain('sdk 兜底内容')
    expect(h.channel.listed.length).toBe(1)
    expect(h.ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('降级 SDK'))
    // The second message reuses the SDK directly (no second CLI attempt).
    await h.emitMessage('再问')
    await waitFor(() => agent.followups.length === 2)
    expect(h.channel.listed.length).toBe(2)
  })

  it('bootstraps the CLI config once and serves context through the CLI path', async () => {
    // A fake CLI via feishuCliPath: not configured → config init (stdin
    // secret) → im list envelope. Verifies the docs/15 bootstrap wiring
    // end-to-end without real credentials.
    const root = await tempWorkspace()
    const script = join(root, 'fake-cli.mjs')
    await writeFile(script, BOOTSTRAP_CLI_FIXTURE, { mode: 0o755 })
    const h = await makeHarness({ contextMode: 'auto', contextBackend: 'auto', feishuCliPath: script })
    await h.emitMessage('问')
    await waitFor(() => h.agents.created.length === 1)
    const sessionId = h.agents.created[0]!.options.sessionId!
    const agent = h.agents.live.get(sessionId)!
    await waitFor(() => agent.followups.length === 1, 'CLI bootstrap followup', 3_000)
    const frame = JSON.parse(followupContent(agent)[0]!.text) as { messages: Array<{ x: string }> }
    expect(frame.messages[0]!.x).toContain('cli 引导后内容')
    // SDK seam was never touched; the CLI was the serving backend.
    expect(h.channel.listed.length).toBe(0)
    expect(h.ctx.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('降级 SDK'))
  })

  it('shares an in-flight CLI bootstrap across concurrent private and thread origins', async () => {
    const root = await tempWorkspace()
    const script = join(root, 'fake-cli.mjs')
    const log = join(root, 'calls.jsonl')
    await writeFile(script, BOOTSTRAP_CLI_FIXTURE, { mode: 0o755 })
    const h = await makeHarness({ contextMode: 'auto', contextBackend: 'auto', feishuCliPath: script })

    // Different origins bypass each other's FIFO queue and therefore reach
    // ensureCliReady concurrently on a cold bridge.
    await h.emitMessage('私聊并发问题')
    await h.emitMessage('话题并发问题', { chatType: 'group', chatId: 'oc_grp', threadId: 'omt_race' })

    await waitFor(() => h.agents.created.length === 2, 'two concurrent context sessions', 4_000)
    await waitFor(
      () => [...h.agents.live.values()].every(agent => agent.followups.length === 1),
      'both CLI-backed followups',
      4_000,
    )
    for (const agent of h.agents.live.values()) {
      const frame = JSON.parse(followupContent(agent)[0]!.text) as { messages: Array<{ x: string }> }
      expect(frame.messages[0]!.x).toContain('cli 引导后内容')
    }
    expect(h.channel.listed).toHaveLength(0) // neither origin fell back to SDK
    expect(h.ctx.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('降级 SDK'))

    const calls = (await readFile(log, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as { argv: string[]; configured: boolean })
    expect(calls.filter(call => call.argv[0] === 'config' && call.argv[1] === 'init')).toHaveLength(1)
    expect(calls.filter(call => call.argv[0] === 'im')).toHaveLength(2)
    expect(calls.filter(call => call.argv[0] === 'im').every(call => call.configured)).toBe(true)
  })
})
