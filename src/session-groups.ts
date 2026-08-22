/** Feishu provider for the generic dsh-session-groups sidecar service. */
import { createHash } from 'node:crypto'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { SessionGroupDescriptor, SessionGroupId } from 'dsh-session-groups'
import type { LarkChannelLike } from './types.js'

type GroupLookupChannel = Pick<LarkChannelLike, 'getMessage' | 'getChatInfo'>
const GROUP_METADATA_TIMEOUT_MS = 2_000

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function rawSenderName(raw: Record<string, unknown> | undefined): string | undefined {
  if (raw === undefined) return undefined
  const sender = record(raw.sender)
  const i18n = record(sender?.sender_i18n_names)
  return text(sender?.sender_name)
    ?? text(i18n?.zh_cn)
    ?? text(i18n?.en_us)
    ?? text(i18n?.ja_jp)
    // Compatibility with alternate seams and older SDK fixtures.
    ?? text(raw.sender_name)
    ?? text(raw.senderName)
    ?? text(raw.name)
}

async function lookupWithin<T>(operation: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => { resolve(undefined) }, GROUP_METADATA_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([operation.catch(() => undefined), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Stable opaque group identity: channel ids never leak into the browser sidecar. */
export function feishuSessionGroupId(chatId: string): SessionGroupId {
  const digest = createHash('sha256').update(chatId).digest('hex').slice(0, 24)
  return `feishu-${digest}` as SessionGroupId
}

export function feishuSessionGroupIdForBot(
  namespace: 'legacy' | 'app',
  appId: string,
  chatId: string,
): SessionGroupId {
  if (namespace === 'legacy') return feishuSessionGroupId(chatId)
  const digest = createHash('sha256').update(`app:${appId}\0${chatId}`).digest('hex').slice(0, 24)
  return `feishu-${digest}` as SessionGroupId
}

/**
 * Resolve one provider descriptor. Metadata lookup is deliberately fail-open:
 * grouping must never indefinitely delay or prevent Session creation.
 */
export async function resolveFeishuSessionGroup(
  message: Pick<NormalizedMessage, 'chatId' | 'chatType' | 'messageId' | 'senderId' | 'senderName'>,
  channel: GroupLookupChannel,
  groupKind: 'group' | 'topic' = 'topic',
  fallbackTitle?: string,
  identity?: { namespace: 'legacy' | 'app'; appId: string; botId: string },
): Promise<SessionGroupDescriptor> {
  let title: string
  let kind: 'private' | 'group' | 'topic'
  if (message.chatType === 'p2p') {
    let participant = text(message.senderName)
    if (participant === undefined) {
      participant = rawSenderName(await lookupWithin(
        Promise.resolve().then(() => channel.getMessage(message.messageId)),
      ))
    }
    title = `与${participant ?? '飞书用户'}的私聊`
    kind = 'private'
  } else {
    let chatName: string | undefined
    if (channel.getChatInfo !== undefined) {
      chatName = text((await lookupWithin(
        Promise.resolve().then(() => channel.getChatInfo!(message.chatId)),
      ))?.name)
    }
    title = chatName ?? fallbackTitle ?? (groupKind === 'topic' ? '飞书话题群' : '飞书群聊')
    kind = groupKind
  }
  const legacy = identity === undefined || identity.namespace === 'legacy'
  const scopedTitle = legacy || title.endsWith(` · ${identity.botId}`) ? title : `${title} · ${identity.botId}`
  return Object.freeze({
    id: legacy ? feishuSessionGroupId(message.chatId) : feishuSessionGroupIdForBot('app', identity.appId, message.chatId),
    title: scopedTitle,
    source: 'feishu',
    kind,
  })
}
