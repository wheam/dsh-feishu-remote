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

export type CardPreset = 'compact' | 'standard' | 'developer'
export type LarkBrand = 'feishu' | 'lark' | 'larkoffice'

/** Runtime configuration after environment fallbacks and path normalization (single project). */
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
  cwd: string
  workspaceRoot: string
  inboundDir: string
  progressCards: boolean
  progressUpdateMs: number
  maxInboundFileBytes: number
  maxOutboundFileBytes: number
  interactiveTimeoutMs: number
  enableApprovals: boolean
  cardBodyMaxChars: number
  cardPreset: CardPreset
  agentPreset?: string
  maxLiveAgents: number
  commandAllowlist: string[]
}

export interface ToolProgress {
  callId: string
  name: string
  summary: string
  startedAt: number
  finishedAt?: number
  failed?: boolean
}

export interface TurnStepText {
  turn: number
  step: number
  chunks: string
  final?: string
}

export interface TurnProgress {
  turn: number
  startedAt: number
  prompt: string
  visibleText: string
  /** Per-step chunk/final buffers; the complete `assistant/message` REPLACES the step's chunks (dedup fix). */
  steps: TurnStepText[]
  tools: ToolProgress[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  progressMessageId?: string
  terminal: boolean
  outcome?: 'completed' | 'cancelled' | 'blocked' | 'error'
  outcomeDetail?: string
  truncated?: boolean
  cardFallbackAttempted?: boolean
  /** Immutable reply context for THIS turn's cards (captured once, survives route mutation). */
  reply?: { replyTo?: string; replyInThread: boolean }
  /** Per-turn card-op chain: the initial send and its patches are strictly serialized. */
  sendChain?: Promise<unknown>
}

export type BridgeAction =
  | { bridge: 'dsh-feishu-remote'; action: 'stop' | 'new' | 'status' | 'view'; sessionId: string }
  | { bridge: 'dsh-feishu-remote'; action: 'approval'; token: string; decision: 'allow' | 'reject' }

export type ChannelFactory = (config: ResolvedConfig) => LarkChannelLike

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
