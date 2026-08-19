/**
 * Feishu long-connection channel — the official SDK wrapped behind
 * `LarkChannelLike` (interface isolation, replaceable by the protobuf
 * fallback). Key deltas from the reference implementation (docs/05 §1.3):
 *
 * - `safety.chatQueue.enabled: false` — the SDK queue keys on chatId and
 *   mergeBatch inherits the last message's rootId/threadId, so same-group
 *   two-thread bursts could cross threads (Codex F4). Disabling it also
 *   disables batching; the plugin runs its own per-originKey FIFO instead.
 * - The SDK has no terminalError EVENT: WSClient surfaces giving up through
 *   `getConnectionStatus().state === 'failed'`; the bridge polls that.
 * - Callbacks must return within ~3s: the bridge only authenticates and
 *   enqueues inside the handler (docs/05 §1.3).
 */
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
} from '@larksuiteoapi/node-sdk'
import type { LarkChannelLike, ResolvedConfig } from './types.js'
import { readBufferWithLimit } from './security.js'

export const DEFAULT_CHANNEL_FACTORY = (config: ResolvedConfig): LarkChannelLike => {
  const channel = createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    source: 'dsh-feishu-remote',
    domain: config.brand === 'lark' ? Domain.Lark : Domain.Feishu,
    loggerLevel: LoggerLevel.warn,
    handshakeTimeoutMs: 15_000,
    policy: {
      dmMode: 'open',
      requireMention: config.requireMention,
      respondToMentionAll: false,
    },
    safety: {
      // The SDK chatQueue batches per chatId and can cross threads — OFF
      // (docs/05 §1.3); dedup/stale checks stay active.
      chatQueue: { enabled: false },
      dedup: { ttl: 24 * 60 * 60 * 1000, maxEntries: 20_000 },
      staleMessageWindowMs: 10 * 60 * 1000,
      batch: {
        text: { delayMs: 0, longDelayMs: 0, longThresholdChars: 0, maxMessages: 1, maxChars: 0 },
        media: { delayMs: 0, maxItems: 0 },
      },
    },
    outbound: {
      allowedFileDirs: [config.workspaceRoot],
      ssrfGuard: true,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      textChunkLimit: 4000,
    },
  })
  return {
    get botIdentity() { return channel.botIdentity },
    connect: () => channel.connect(),
    disconnect: async () => {
      channel.rawWsClient?.close({})
      await channel.disconnect()
    },
    getConnectionStatus: () => channel.getConnectionStatus(),
    on: (name, handler) => channel.on(name, handler),
    send: (to, input, options) => channel.send(to, input, options),
    updateCard: (messageId, card) => channel.updateCard(messageId, card),
    addReaction: (messageId, emojiType) => channel.addReaction(messageId, emojiType),
    removeReactionByEmoji: (messageId, emojiType) => channel.removeReactionByEmoji(messageId, emojiType),
    downloadMessageResource: async (messageId, fileKey, type, maxBytes) => {
      const response = await channel.rawClient.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      })
      return readBufferWithLimit(response.getReadableStream(), maxBytes)
    },
  }
}

export { LarkChannel }
export type { LarkChannelLike }
