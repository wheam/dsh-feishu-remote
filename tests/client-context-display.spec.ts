import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

function loadClientExports(): Record<string, unknown> {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  let loaded: Record<string, unknown> | undefined
  const sandbox = {
    console,
    window: {
      __ModuleLoader__: {
        load: (definition: { factory: (require: (name: string) => unknown) => Record<string, unknown> }) => {
          loaded = definition.factory(() => ({}))
        },
      },
    },
  }
  vm.runInNewContext(source, sandbox)
  if (loaded === undefined) throw new Error('client module did not load')
  return loaded
}

describe('legacy Feishu transcript display', () => {
  const split = loadClientExports().splitLegacyFeishuMessageText as (text: string) => string | undefined

  it('removes one valid context frame while preserving the exact user prompt', () => {
    const frame = JSON.stringify({
      type: 'feishu-context',
      count: 1,
      messages: [{ x: '带有 } 和 \\"引号\\" 的历史' }],
    })
    expect(split(`${frame}现在测试负责人是谁？`)).toBe('现在测试负责人是谁？')
  })

  it('ignores malformed, unrelated, and context-only text', () => {
    expect(split('{"type":"feishu-context"坏数据')).toBeUndefined()
    expect(split('{"type":"something-else"}用户问题')).toBeUndefined()
    expect(split('{"type":"feishu-context"}')).toBeUndefined()
    expect(split('普通用户问题')).toBeUndefined()
  })
})
