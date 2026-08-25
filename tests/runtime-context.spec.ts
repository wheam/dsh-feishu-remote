import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import { describe, expect, it } from 'vitest'
import { composeFeishuRuntimeContext } from '../src/runtime-context.js'

function inbound(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_current',
    chatId: 'oc_team',
    chatType: 'group',
    senderId: 'ou_alice',
    senderName: undefined,
    content: '请看引用内容',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: Date.parse('2026-08-25T12:00:00Z'),
    ...overrides,
  }
}

describe('Feishu runtime context', () => {
  it('projects the current group/topic, actor, message relations and exact replied document', () => {
    const frame = JSON.parse(composeFeishuRuntimeContext({
      brand: 'feishu',
      botId: 'general',
      botName: '项目助手',
      conversationKind: 'topic',
      message: inbound({
        threadId: 'omt_topic',
        rootId: 'om_root',
        replyToMessageId: 'om_doc',
        mentions: [{ key: '@_user_1', openId: 'ou_bob', name: 'Bob', isBot: false }],
        resources: [{ type: 'file', fileKey: 'file_current', fileName: '补充.xlsx' }],
      }),
      senderName: 'Alice',
      chat: { name: 'Curio 作战室', description: '项目讨论', memberCount: 18 },
      reply: {
        status: 'loaded',
        message: {
          messageId: 'om_doc',
          senderName: 'Bob',
          senderId: 'ou_bob',
          isOwnBot: false,
          isBotApp: false,
          msgType: 'post',
          deleted: false,
          text: '请参考 [季度规划](https://example.feishu.cn/docx/doc_123)',
          createdAtMs: Date.parse('2026-08-25T11:55:00Z'),
        },
      },
      maxReplyChars: 10_000,
    })) as Record<string, any>

    expect(frame.type).toBe('feishu-runtime-context')
    expect(frame.bot).toEqual({ id: 'general', name: '项目助手' })
    expect(frame.conversation).toMatchObject({
      platform: 'Feishu', kind: 'topic', chatId: 'oc_team', name: 'Curio 作战室',
      description: '项目讨论', memberCount: 18, threadId: 'omt_topic', rootMessageId: 'om_root',
    })
    expect(frame.currentMessage).toMatchObject({
      messageId: 'om_current', messageType: 'text', replyToMessageId: 'om_doc',
      sender: { openId: 'ou_alice', name: 'Alice' },
      mentions: [{ openId: 'ou_bob', name: 'Bob' }],
      resources: [{ type: 'file', fileKey: 'file_current', fileName: '补充.xlsx' }],
    })
    expect(frame.reply).toMatchObject({
      messageId: 'om_doc', status: 'loaded', messageType: 'post',
      sender: { openId: 'ou_bob', name: 'Bob' },
    })
    expect(frame.reply.content).toContain('[季度规划](https://example.feishu.cn/docx/doc_123)')
  })

  it('keeps exact ids while making an unavailable reply explicit and redacting metadata secrets', () => {
    const frame = JSON.parse(composeFeishuRuntimeContext({
      brand: 'lark',
      botId: 'legacy',
      conversationKind: 'group',
      message: inbound({ rootId: 'om_chain_root', replyToMessageId: 'om_missing' }),
      chat: { name: 'Launch room', description: 'token=should-not-leak' },
      reply: { status: 'unavailable' },
      maxReplyChars: 1_000,
    })) as Record<string, any>

    expect(frame.conversation).toMatchObject({ platform: 'Lark', kind: 'group', chatId: 'oc_team', name: 'Launch room' })
    expect(frame.conversation.description).toContain('[REDACTED]')
    expect(frame.currentMessage.replyRootMessageId).toBe('om_chain_root')
    expect(frame.reply).toEqual({ messageId: 'om_missing', status: 'unavailable' })
  })
})
