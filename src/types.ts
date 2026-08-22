import type {
  CardActionEvent,
  EventMap,
  LarkChannel,
  NormalizedMessage,
  ReactionEvent,
  SendInput,
  SendOptions,
  SendResult,
  WSConnectionStatus,
} from '@larksuiteoapi/node-sdk'

export type LarkBrand = 'feishu' | 'lark' | 'larkoffice'

/** Runtime configuration after environment fallbacks and legacy-path normalization. */
export interface ResolvedConfig {
  appId: string
  appSecret: string
  appSecretRef: string
  brand: LarkBrand
  statePath: string
  allowedOpenIds: string[]
  allowedChatIds: string[]
  allowAllUsers: boolean
  requireMention: boolean
  provider?: string
  model?: string
  /** Deprecated fixed-workspace pair; never selected for a new Feishu origin. */
  cwd: string
  /** Retained only as the SDK's legacy outbound file-path allow root. */
  workspaceRoot: string
  inboundDir: string
  progressCards: boolean
  progressUpdateMs: number
  workingReaction: boolean
  maxInboundFileBytes: number
  maxOutboundFileBytes: number
  interactiveTimeoutMs: number
  enableApprovals: boolean
  cardBodyMaxChars: number
  agentPreset?: string
  maxLiveAgents: number
  commandAllowlist: string[]
  contextMode: 'off' | 'auto'
  contextBackend: 'auto' | 'cli' | 'sdk'
  feishuCliPath: string
  contextP2pMaxMessages: number
  contextP2pMaxChars: number
  contextMaxMessages: number
  contextMaxChars: number
  contextTimeoutMs: number
  contextIncludeBot: boolean
}

/** Per-turn context-backfill stats (docs/13 F10: exact turn attribution). */
export interface TurnContextStats {
  backend: 'cli' | 'sdk'
  count: number
  chars: number
  truncated: boolean
  fullWindow: boolean
}

export interface TurnStepText {
  turn: number
  step: number
  chunks: string
  final?: string
  /** True when this assistant step requested tools, so its text is progress commentary rather than the final answer. */
  hasToolCalls?: boolean
}

export interface TurnProgress {
  turn: number
  startedAt: number
  prompt: string
  visibleText: string
  /** Per-step chunk/final buffers; the complete `assistant/message` REPLACES the step's chunks (dedup fix). */
  steps: TurnStepText[]
  /** Terminal user-facing answer selected from the last non-tool assistant step. */
  terminalText?: string
  progressMessageId?: string
  terminal: boolean
  outcome?: 'completed' | 'cancelled' | 'blocked' | 'error'
  outcomeDetail?: string
  truncated?: boolean
  cardFallbackAttempted?: boolean
  /** Immutable reply context for THIS turn's cards (captured once, survives route mutation). */
  reply?: { replyTo?: string; replyInThread: boolean }
  /** Feishu context backfill stats for THIS turn (docs/13 F10), copied at claim time. */
  contextStats?: TurnContextStats
  /** Feishu message this turn's "working" reaction (敲键盘) was added to — removed at turn/end. */
  workingReaction?: { messageId: string }
  /** Per-turn card-op chain: the initial send and its patches are strictly serialized. */
  sendChain?: Promise<unknown>
}

export type BridgeAction =
  | { bridge: 'dsh-feishu-remote'; action: 'stop' | 'new' | 'status' | 'view'; sessionId: string }
  | { bridge: 'dsh-feishu-remote'; action: 'approval'; token: string; decision: 'allow' | 'reject' }
  | { bridge: 'dsh-feishu-remote'; action: 'workspace-select'; token: string; workspaceId: string }
  | { bridge: 'dsh-feishu-remote'; action: 'workspace-new'; token: string }
  | { bridge: 'dsh-feishu-remote'; action: 'workspace-path'; token: string }
  | { bridge: 'dsh-feishu-remote'; action: 'workspace-parent'; token: string; parentId: string }

export type ChannelFactory = (config: ResolvedConfig) => LarkChannelLike

export interface LarkMessageListParams {
  containerIdType: 'chat' | 'thread'
  containerId: string
  pageToken?: string
}

/** Raw `GET /im/v1/messages` page (SDK shape); business errors throw in the seam. */
export interface LarkMessageListResult {
  items: Array<Record<string, unknown>>
  hasMore: boolean
  pageToken?: string
}

/**
 * Narrow seam around the official SDK, allowing deterministic bridge tests.
 * Outbound calls go through the application-level scheduler in the bridge,
 * but the seam keeps the SDK surface minimal and replaceable.
 */
export interface LarkChannelLike {
  readonly botIdentity?: LarkChannel['botIdentity']
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Snapshot of the WebSocket lifecycle; `state: 'failed'` = terminal error (SDK stopped reconnecting). */
  getConnectionStatus(): WSConnectionStatus | undefined
  on<K extends keyof EventMap>(name: K, handler: EventMap[K]): () => void
  send(to: string, input: SendInput, options?: SendOptions): Promise<SendResult>
  updateCard(messageId: string, card: object): Promise<void>
  /** Add a reaction to a message; resolves the Feishu `reaction_id`. */
  addReaction(messageId: string, emojiType: string): Promise<string>
  /** Remove the BOT's own reaction matching `emojiType` on the message (true = removed). */
  removeReactionByEmoji(messageId: string, emojiType: string): Promise<boolean>
  /** History backfill seam (docs/13 F1/F10): one page of `GET /im/v1/messages`, newest first. */
  listMessages(params: LarkMessageListParams): Promise<LarkMessageListResult>
  /** One message by id (docs/13 F3: thread-root back-fill); undefined = not found. */
  getMessage(messageId: string): Promise<Record<string, unknown> | undefined>
  /** Chat metadata used for provider-owned UI labels; optional for test/fallback channels. */
  getChatInfo?(chatId: string): Promise<{
    chatId: string
    name?: string
    chatType: 'p2p' | 'group' | 'topic'
  }>
  /** Authoritative Feishu chat mode; callers cache this because it rarely changes. */
  getChatMode?(chatId: string): Promise<'p2p' | 'group' | 'topic'>
  downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
    maxBytes: number,
  ): Promise<Buffer>
}

export interface InboundEvent {
  message: NormalizedMessage
  reaction?: ReactionEvent
  cardAction?: CardActionEvent
}
