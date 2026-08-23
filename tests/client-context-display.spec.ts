import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

function loadClientExports(
  requireModule: (name: string) => unknown = () => ({}),
  sandboxConsole: unknown = console,
): Record<string, unknown> {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  let loaded: Record<string, unknown> | undefined
  const sandbox = {
    console: sandboxConsole,
    window: {
      __ModuleLoader__: {
        load: (definition: { factory: (require: (name: string) => unknown) => Record<string, unknown> }) => {
          loaded = definition.factory(requireModule)
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

describe('multi-bot editor serialization', () => {
  const serialize = loadClientExports().serializeBotDraft as (bot: Record<string, unknown>) => Record<string, unknown>

  it('keeps list editing as raw text and splits it only at the save boundary', () => {
    expect(serialize({
      id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A',
      allowedOpenIds: 'ou_a, ou_b ', allowedChatIds: 'oc_a\noc_b',
      statePath: '/host-only',
    })).toEqual({
      id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A',
      allowedOpenIds: ['ou_a', 'ou_b'], allowedChatIds: ['oc_a', 'oc_b'],
    })
  })
})

describe('multi-bot editor presentation', () => {
  const present = loadClientExports().botPresentation as (
    bot: Record<string, unknown>,
    index: number,
    status: Record<string, unknown> | undefined,
  ) => Record<string, unknown>

  it('uses a human name, masks the App ID, and translates runtime status', () => {
    expect(present(
      { id: 'cli-aa00a7baf7f8dbe8', appId: 'cli_aa00a7baf7f8dbe8', appSecretRef: 'REF', sessionNamespace: 'legacy' },
      0,
      { connected: true, liveAgents: 0, status: 'connected' },
    )).toEqual({
      name: '主机器人',
      appLabel: 'App ID：cli_…f8dbe8',
      statusLabel: '已连接',
      statusTone: 'ok',
      detail: '连接正常 · 当前运行 0 个任务',
    })
  })

  it('explains disabled and disconnected bots without raw runtime jargon', () => {
    expect(present({ enabled: false, appId: '' }, 1, undefined)).toMatchObject({
      name: '新机器人', statusLabel: '已停用', detail: '这个机器人当前已停用。',
    })
    expect(present({ enabled: true, appId: 'cli_short', appSecretRef: 'REF' }, 1, { connected: false, status: 'disabled', liveAgents: 0 })).toMatchObject({
      name: '机器人 2', appLabel: 'App ID：cli_short', statusLabel: '未连接',
    })
  })

  it('uses the real connected bot name while retaining its list role', () => {
    expect(present(
      { appId: 'cli_aa00abefea385be9', appSecretRef: 'REF', sessionNamespace: 'app' },
      1,
      { connected: true, liveAgents: 0, status: 'connected', botName: 'DSH Remote · Mini' },
    )).toMatchObject({
      name: 'DSH Remote · Mini',
      appLabel: '机器人 2 · App ID：cli_…385be9',
      statusLabel: '已连接',
    })
  })

  it('uses theme tokens so labels remain readable in light and dark themes', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('color:var(--dsw-alias-label-primary)!important')
    expect(source).not.toContain('color:#f2f6ff!important')
  })
})

describe('PersonalAgent onboarding presentation', () => {
  it('separates choosing an existing bot from creating a new bot', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('props.onboardingStart("select", props.multiAdd ? "new-bot" : "legacy")')
    expect(source).toContain('"onboarding.select": "选择并绑定已有机器人"')
    expect(source).toContain('"onboarding.create": "创建并绑定新机器人"')
    expect(source).toContain('"onboarding.createAnother": "创建新机器人并替换"')
    expect(source).toContain('选择你已经创建的机器人')
  })

  it('makes QR onboarding the primary multi-bot add flow and keeps manual setup advanced', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('children: "添加机器人"')
    expect(source).toContain('children: "手动配置与高级设置"')
    expect(source).toContain('"onboarding.manualAdd": "手动配置（高级）"')
    expect(source).toContain('onboardingStart: (mode, destination = "legacy")')
  })

  it('hides legacy migration and advanced fields behind user-facing actions', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('const converted = await props.convertLegacy()')
    expect(source).toContain('children: managingLegacy ? "收起" : "更换或修复"')
    expect(source).toContain('添加机器人不会替换当前机器人')
    expect(source).not.toContain('转换为多机器人配置')
    expect(source).not.toContain('再创建一个新机器人')
  })

  it('auto-dismisses a completed add flow and keeps technical fields collapsed', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('onboardingStatus.phase !== "ready"')
    expect(source).toContain('void props.refreshBots?.()')
    expect(source).toContain('setAddingBot(false)')
    expect(source).toContain('title: "常用设置"')
    expect(source).toContain('title: "访问控制"')
    expect(source).toContain('title: "角色与模型"')
    expect(source).toContain('title: "连接与高级配置"')
  })
})

describe('settings slot registration isolation', () => {
  type SlotOptions = Record<string, unknown>

  function runApply(throwingSlot: string | undefined) {
    const registered: SlotOptions[] = []
    const errors: string[] = []
    const sandboxConsole = {
      ...console,
      error: (...args: unknown[]) => { errors.push(args.map(String).join(' ')) },
    }
    // Only createSnapshotStore is reached during apply(); react is never rendered here.
    const requireModule = (name: string) => name === '@deepseek-ai/dsh-client-runtime/client'
      ? {
          createSnapshotStore: (initial: unknown) => {
            let value = initial
            return { get: () => value, set: (next: unknown) => { value = next }, subscribe: () => () => undefined }
          },
        }
      : {}
    const apply = loadClientExports(requireModule, sandboxConsole).apply as (ctx: unknown) => void
    const scope = {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', writable: true, value: {}, base: {}, user: {}, secrets: [] }),
      set: async () => undefined,
      unset: async () => undefined,
    }
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: { register: () => undefined, bind: () => (key: string) => key },
      settingsScope: { bind: () => scope },
      // isLoopback:false keeps both controllers' mount() off their polling timers.
      connection: { isLoopback: false, rpc: { call: async () => ({ ok: false, error: { message: 'offline' } }) } },
      slots: {
        inject: (name: string, register: () => unknown) => {
          if (name === throwingSlot) throw new Error(`slot "${name}" is unavailable`)
          return register()
        },
        register: (options: SlotOptions) => { registered.push(options); return () => undefined },
      },
    }
    apply(ctx)
    return { registered, errors, names: registered.map(options => options.name) }
  }

  it('registers both settings slots with their required keyed/list identifiers', () => {
    const { registered, names, errors } = runApply(undefined)
    expect(names).toEqual(['settings.plugin.item', 'settings.section'])
    // rc.7+ keyed slot contract (docs/11): the plugin item must carry options.key.
    expect(registered[0]).toMatchObject({ name: 'settings.plugin.item', key: 'feishu-remote' })
    expect(registered[1]).toMatchObject({ name: 'settings.section', id: 'feishu-remote', order: 18 })
    expect(errors).toEqual([])
  })

  it('still registers settings.section when the plugin item slot throws', () => {
    const { names, errors } = runApply('settings.plugin.item')
    expect(names).toEqual(['settings.section'])
    expect(errors.some(line => line.includes('settings.plugin.item'))).toBe(true)
  })

  it('still registers settings.plugin.item when the section slot throws', () => {
    const { names, errors } = runApply('settings.section')
    expect(names).toEqual(['settings.plugin.item'])
    expect(errors.some(line => line.includes('settings.section'))).toBe(true)
  })

  it('uses a short nav label for the section so the 800px dialog does not truncate it', () => {
    const { registered } = runApply(undefined)
    const label = registered[1]!.label as () => string
    expect(label()).toBe('settings.navLabel')
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain('"settings.navLabel": "飞书遥控"')
    expect(source).toContain('"settings.navLabel": "Feishu Remote"')
    // The in-page heading keeps the long title.
    expect(source).toContain('children: t("settings.title")')
  })
})
