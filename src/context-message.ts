/**
 * Transcript-safe representation of one Feishu turn with history backfill.
 *
 * The bridge queues one tagged message so inbox claim attribution remains
 * exact. At the pre-step boundary, the tagged message is split atomically into
 * a plugin context row and the ordinary user prompt. Both pieces therefore
 * reach the same model request while the Web transcript can present them with
 * their correct roles.
 */
import { createUserMessage, freezeMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { CONTEXT_FRAME_TYPE } from './context.js'

export const FEISHU_REMOTE_SOURCE = {
  kind: 'user',
  transport: 'dsh-feishu-remote',
} as const

const CONTEXT_SOURCE = {
  kind: 'plugin',
  plugin: 'dsh-feishu-remote',
  form: 'notice',
  summary: '飞书聊天历史 / Feishu history',
} as const

function isTaggedFeishuMessage(message: UserMessage): boolean {
  const source = message.source as { kind?: unknown; transport?: unknown }
  return source.kind === 'user' && source.transport === FEISHU_REMOTE_SOURCE.transport
}

function isFeishuContextFrame(text: string): boolean {
  if (!text.startsWith(`{"type":"${CONTEXT_FRAME_TYPE}"`)) return false
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object'
      && value !== null
      && (value as { type?: unknown }).type === CONTEXT_FRAME_TYPE
  } catch {
    return false
  }
}

/**
 * Split bridge-tagged context envelopes after their inbox claim.
 *
 * Untagged GUI messages and malformed envelopes pass through unchanged. The
 * prompt keeps its original id so the bridge turn ledger remains correlated
 * with the preceding `agent/inbox/claimed` event.
 */
export function separateFeishuContextMessages(messages: UserMessage[]): UserMessage[] {
  return messages.flatMap(message => {
    if (!isTaggedFeishuMessage(message)) return [message]
    const [context, ...prompt] = message.content
    if (context?.type !== 'text' || prompt.length === 0 || !isFeishuContextFrame(context.text)) return [message]
    return [
      createUserMessage({ content: [context], source: CONTEXT_SOURCE }),
      freezeMessage({ ...message, content: prompt }),
    ]
  })
}
