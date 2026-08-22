import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { FEISHU_REMOTE_SOURCE, separateFeishuContextMessages } from '../src/context-message.js'

const frame = JSON.stringify({
  type: 'feishu-context',
  count: 1,
  fullWindow: true,
  omitted: 0,
  messages: [{ t: '23:43', n: '张奇', s: '…67f6', x: '测试编号 Q7-4821' }],
})

describe('Feishu context transcript projection', () => {
  it('atomically separates tagged history from the visible user prompt', () => {
    const queued = createUserMessage({
      content: [{ type: 'text', text: frame }, { type: 'text', text: '负责人是谁？' }],
      source: FEISHU_REMOTE_SOURCE,
    })

    const [context, prompt] = separateFeishuContextMessages([queued])

    expect(context).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: frame }],
      source: {
        kind: 'plugin',
        plugin: 'dsh-feishu-remote',
        form: 'notice',
        summary: '飞书聊天历史 / Feishu history',
      },
    })
    expect(prompt).toMatchObject({
      id: queued.id,
      role: 'user',
      content: [{ type: 'text', text: '负责人是谁？' }],
      source: FEISHU_REMOTE_SOURCE,
    })
  })

  it('does not rewrite untagged GUI messages that happen to resemble a frame', () => {
    const gui = createUserMessage({
      content: [{ type: 'text', text: frame }, { type: 'text', text: '保留原样' }],
      source: { kind: 'user' },
    })
    expect(separateFeishuContextMessages([gui])).toEqual([gui])
  })

  it('fails closed on a malformed tagged frame', () => {
    const malformed = createUserMessage({
      content: [{ type: 'text', text: '{"type":"feishu-context"' }, { type: 'text', text: '保留原样' }],
      source: FEISHU_REMOTE_SOURCE,
    })
    expect(separateFeishuContextMessages([malformed])).toEqual([malformed])
  })
})
