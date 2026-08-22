import { describe, expect, it, vi } from 'vitest'
import { feishuSessionGroupId, feishuSessionGroupIdForBot, resolveFeishuSessionGroup } from '../src/session-groups.js'

describe('Feishu session-group provider', () => {
  it('keeps legacy ids byte-compatible and isolates app-scoped group ids', () => {
    expect(feishuSessionGroupIdForBot('legacy', 'cli_a', 'oc_same')).toBe(feishuSessionGroupId('oc_same'))
    expect(feishuSessionGroupIdForBot('app', 'cli_a', 'oc_same')).not.toBe(feishuSessionGroupIdForBot('app', 'cli_b', 'oc_same'))
  })

  it('adds one readable bot suffix without changing app-scoped identity on refresh', async () => {
    const identity = { namespace: 'app' as const, appId: 'cli_a', botId: 'bot-a' }
    const channel = { getMessage: vi.fn(), getChatInfo: vi.fn(async () => ({ chatId: 'oc_same', name: 'Team', chatType: 'group' as const })) }
    const first = await resolveFeishuSessionGroup({
      chatId: 'oc_same', chatType: 'group', messageId: 'om_1', senderId: 'ou_1', senderName: 'Alice',
    }, channel, 'group', undefined, identity)
    const fallback = await resolveFeishuSessionGroup({
      chatId: 'oc_same', chatType: 'group', messageId: 'om_2', senderId: 'ou_1', senderName: 'Alice',
    }, { getMessage: vi.fn() }, 'group', first.title, identity)
    expect(first.title).toBe('Team · bot-a')
    expect(fallback.title).toBe('Team · bot-a')
    expect(fallback.id).toBe(first.id)
  })
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
