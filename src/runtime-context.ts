/**
 * Turn-scoped Feishu metadata that the model cannot infer from message text.
 *
 * This is intentionally a small allowlisted projection, not the raw event:
 * chat identity/mode, actor, message/thread/reply relations, mentions and
 * resource descriptors. An explicitly replied-to message is fetched by id
 * and embedded as untrusted context so old document links remain resolvable.
 */
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { ContextMessage } from './context.js'
import { bounded, redactSecrets } from './security.js'
import type { LarkBrand } from './types.js'

export const RUNTIME_CONTEXT_FRAME_TYPE = 'feishu-runtime-context'

export interface FeishuRuntimeChatMetadata {
  name?: string
  description?: string
  memberCount?: number
}

export interface FeishuReplyLookup {
  status: 'loaded' | 'not_found' | 'unavailable'
  message?: ContextMessage
}

export interface FeishuRuntimeContextInput {
  brand: LarkBrand
  botId: string
  botName?: string
  conversationKind: 'private' | 'group' | 'topic'
  message: NormalizedMessage
  senderName?: string
  chat?: FeishuRuntimeChatMetadata
  reply?: FeishuReplyLookup
  maxReplyChars: number
}

function clean(value: string | undefined, max: number): string | undefined {
  const text = value?.trim()
  return text === undefined || text === '' ? undefined : bounded(redactSecrets(text), max)
}

function isoTime(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  return new Date(value).toISOString()
}

function fallbackChatName(input: FeishuRuntimeContextInput): string {
  if (input.conversationKind === 'private') {
    return `与${clean(input.senderName, 200) ?? '飞书用户'}的私聊`
  }
  return input.conversationKind === 'topic' ? '飞书话题群' : '飞书群聊'
}

/** Build the JSON frame placed immediately before the visible user prompt. */
export function composeFeishuRuntimeContext(input: FeishuRuntimeContextInput): string {
  const { message } = input
  const chatName = clean(input.chat?.name, 300) ?? fallbackChatName(input)
  const description = clean(input.chat?.description, 2_000)
  const senderName = clean(input.senderName ?? message.senderName, 200)
  const mentions = message.mentions.slice(0, 50).map(mention => ({
    ...(clean(mention.name, 200) === undefined ? {} : { name: clean(mention.name, 200) }),
    ...(mention.openId === undefined || mention.openId === '' ? {} : { openId: mention.openId }),
    ...(mention.isBot === true ? { isBot: true } : {}),
  }))
  const resources = message.resources.slice(0, 50).map(resource => ({
    type: resource.type,
    fileKey: resource.fileKey,
    ...(clean(resource.fileName, 300) === undefined ? {} : { fileName: clean(resource.fileName, 300) }),
    ...(resource.durationMs === undefined ? {} : { durationMs: resource.durationMs }),
  }))
  const conversation = {
    platform: input.brand === 'feishu' ? 'Feishu' : 'Lark',
    kind: input.conversationKind,
    chatId: message.chatId,
    name: chatName,
    ...(description === undefined ? {} : { description }),
    ...(input.chat?.memberCount === undefined ? {} : { memberCount: input.chat.memberCount }),
    ...(input.conversationKind !== 'topic' || message.threadId === undefined ? {} : { threadId: message.threadId }),
    ...(input.conversationKind !== 'topic' || message.rootId === undefined ? {} : { rootMessageId: message.rootId }),
  }
  const currentMessage = {
    messageId: message.messageId,
    messageType: message.rawContentType,
    ...(isoTime(message.createTime) === undefined ? {} : { sentAt: isoTime(message.createTime) }),
    sender: {
      openId: message.senderId,
      ...(senderName === undefined ? {} : { name: senderName }),
    },
    invocation: {
      botMentioned: message.mentionedBot,
      mentionAll: message.mentionAll,
    },
    ...(mentions.length === 0 ? {} : { mentions }),
    ...(resources.length === 0 ? {} : { resources }),
    ...(input.conversationKind === 'topic' || message.rootId === undefined
      ? {}
      : { replyRootMessageId: message.rootId }),
    ...(message.replyToMessageId === undefined ? {} : { replyToMessageId: message.replyToMessageId }),
  }
  let reply: Record<string, unknown> | undefined
  if (message.replyToMessageId !== undefined) {
    const lookup = input.reply ?? { status: 'unavailable' as const }
    const referenced = lookup.message
    const fullText = referenced === undefined ? undefined : redactSecrets(referenced.text)
    const replyText = fullText === undefined ? undefined : bounded(fullText, input.maxReplyChars)
    reply = {
      messageId: message.replyToMessageId,
      status: lookup.status,
      ...(referenced === undefined ? {} : {
        messageType: referenced.msgType,
        ...(isoTime(referenced.createdAtMs) === undefined ? {} : { sentAt: isoTime(referenced.createdAtMs) }),
        sender: {
          openId: referenced.senderId,
          ...(clean(referenced.senderName, 200) === undefined ? {} : { name: clean(referenced.senderName, 200) }),
        },
        deleted: referenced.deleted,
        ...(replyText === undefined || replyText === '' ? {} : { content: replyText }),
        ...(fullText !== undefined && replyText !== fullText ? { contentTruncated: true } : {}),
      }),
    }
  }
  return JSON.stringify({
    type: RUNTIME_CONTEXT_FRAME_TYPE,
    bot: {
      id: input.botId,
      ...(clean(input.botName, 200) === undefined ? {} : { name: clean(input.botName, 200) }),
    },
    conversation,
    currentMessage,
    ...(reply === undefined ? {} : { reply }),
  })
}

/** Display name carried by `im.v1.message.get(..., with_sender_name=true)`. */
export function senderNameFromSdkMessage(item: Record<string, unknown> | undefined): string | undefined {
  if (item === undefined) return undefined
  const sender = typeof item.sender === 'object' && item.sender !== null && !Array.isArray(item.sender)
    ? item.sender as Record<string, unknown>
    : undefined
  const i18n = typeof sender?.sender_i18n_names === 'object' && sender.sender_i18n_names !== null
    ? sender.sender_i18n_names as Record<string, unknown>
    : undefined
  for (const value of [sender?.sender_name, i18n?.zh_cn, i18n?.en_us, i18n?.ja_jp, item.sender_name, item.senderName]) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}
