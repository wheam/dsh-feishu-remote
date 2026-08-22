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
import { readBufferWithLimit, redactSecrets } from './security.js'

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
      // The bridge must SEE all group messages: active topics accept follow-ups
      // without another mention, while ordinary groups retain unmentioned
      // messages only as history and require an explicit @ for every task.
      requireMention: false,
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
    // History backfill seam (docs/13 F1/F10): one page, newest first. Business
    // errors THROW here — the context provider treats them as fail-open.
    listMessages: async (params) => {
      const response = await channel.rawClient.im.v1.message.list({
        params: {
          container_id_type: params.containerIdType,
          container_id: params.containerId,
          sort_type: 'ByCreateTimeDesc',
          page_size: 50,
          ...(params.pageToken === undefined ? {} : { page_token: params.pageToken }),
          with_sender_name: true,
        },
      })
      if (response.code !== 0) {
        throw new Error(`im.v1.message.list 失败：code=${response.code} msg=${redactSecrets(response.msg ?? '')}`)
      }
      const data = response.data
      return {
        items: Array.isArray(data?.items) ? data.items as Array<Record<string, unknown>> : [],
        hasMore: data?.has_more === true,
        ...(typeof data?.page_token === 'string' && data.page_token !== '' ? { pageToken: data.page_token } : {}),
      }
    },
    // Thread-root back-fill seam (docs/13 F3 + docs/15 F-05).
    getMessage: async (messageId) => {
      const response = await channel.rawClient.im.v1.message.get({
        path: { message_id: messageId },
        params: { with_sender_name: true },
      })
      if (response.code !== 0) {
        throw new Error(`im.v1.message.get 失败：code=${response.code} msg=${redactSecrets(response.msg ?? '')}`)
      }
      const items = response.data?.items
      return Array.isArray(items) && items.length > 0
        ? items[0] as Record<string, unknown>
        : undefined
    },
    getChatInfo: chatId => channel.getChatInfo(chatId),
    getChatMode: chatId => channel.getChatMode(chatId),
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
