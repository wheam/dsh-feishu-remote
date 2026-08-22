import { describe, expect, it, vi } from 'vitest'
import { feishuSessionGroupId, resolveFeishuSessionGroup } from '../src/session-groups.js'

describe('Feishu session-group provider', () => {
  it('groups a private chat by participant and stable chat identity', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_private',
      chatType: 'p2p',
      messageId: 'om_1',
      senderId: 'ou_alice',
      senderName: 'Alice',
    }, {
      getMessage: vi.fn(),
    })

    expect(group).toEqual({
      id: feishuSessionGroupId('oc_private'),
      title: '与Alice的私聊',
      source: 'feishu',
      kind: 'private',
    })
  })

  it('groups every thread in a topic chat under the chat name', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_topic',
      chatType: 'group',
      messageId: 'om_2',
      senderId: 'ou_bob',
      senderName: 'Bob',
    }, {
      getMessage: vi.fn(),
      getChatInfo: vi.fn(async () => ({ chatId: 'oc_topic', chatType: 'group', name: 'Curio 作战室' })),
    })

    expect(group.title).toBe('Curio 作战室')
    expect(group.kind).toBe('topic')
    expect(group.id).toBe(feishuSessionGroupId('oc_topic'))
  })

  it('labels an ordinary group distinctly while keeping the same chat-owned id', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_group',
      chatType: 'group',
      messageId: 'om_ordinary',
      senderId: 'ou_bob',
      senderName: 'Bob',
    }, {
      getMessage: vi.fn(),
      getChatInfo: vi.fn(async () => ({ chatId: 'oc_group', chatType: 'group', name: '项目讨论群' })),
    }, 'group')

    expect(group).toEqual({
      id: feishuSessionGroupId('oc_group'),
      title: '项目讨论群',
      source: 'feishu',
      kind: 'group',
    })
  })

  it('reads the nested sender name returned by im.v1.message.get', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_private',
      chatType: 'p2p',
      messageId: 'om_3',
      senderId: 'ou_alice',
    }, {
      getMessage: vi.fn(async () => ({
        sender: { sender_name: '爱丽丝' },
      })),
    })

    expect(group.title).toBe('与爱丽丝的私聊')
  })

  it('falls back without blocking when Feishu metadata APIs fail', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_topic',
      chatType: 'group',
      messageId: 'om_3',
      senderId: 'ou_bob',
    }, {
      getMessage: vi.fn(),
      getChatInfo: vi.fn(async () => { throw new Error('permission denied') }),
    })

    expect(group.title).toBe('飞书话题群')
  })

  it('retains the last known title when a metadata refresh fails', async () => {
    const group = await resolveFeishuSessionGroup({
      chatId: 'oc_topic',
      chatType: 'group',
      messageId: 'om_4',
      senderId: 'ou_bob',
    }, {
      getMessage: vi.fn(),
      getChatInfo: vi.fn(async () => { throw new Error('temporary outage') }),
    }, 'topic', '旧作战室')

    expect(group).toEqual({
      id: feishuSessionGroupId('oc_topic'),
      title: '旧作战室',
      source: 'feishu',
      kind: 'topic',
    })
  })
})
