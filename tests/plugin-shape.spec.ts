import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.js'

function fakeSettings() {
  const listeners = new Set<() => void>()
  return {
    register: () => ({
      get: () => ({}),
      watch: (callback: () => void) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    }),
  }
}

describe('dsh-feishu-remote loader contract', () => {
  it('declares the official Harness bundle metadata with exact 0.1.1-rc.2 pins', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
      keywords?: string[]
      peerDependencies?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.keywords).toContain('dsh-plugin')
    // Locked, not ranged (docs/05 §7: 精确版本，不用 ^).
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-agent']).toBe('0.1.1-rc.2')
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-user-approval']).toBe('0.1.1-rc.2')
    expect(manifest.devDependencies?.qrcode).toBe('1.5.4')
    expect(manifest.dependencies?.qrcode).toBeUndefined()
    const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(bundlePatch).toContain('name: dsh-feishu-remote')
    expect(bundlePatch).toContain('disabled: false')
  })

  it('keeps the keyed settings slot contract used by 0.1.1-rc.2', () => {
    const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(client).toContain('name: "settings.plugin.item"')
    expect(client).toContain('key: SETTINGS_NS')
    expect(client).toContain('connection.isLoopback === false')
    expect(client).toContain('key: "onboarding"')
    expect(client).not.toContain('selectField("brand", ["feishu", "lark", "larkoffice"])')
    expect(client).not.toContain('id: "dsh-feishu-remote",\n\t\t\t\torder: 60')
  })

  it('exposes the cordis namespace export shape', () => {
    expect('default' in plugin).toBe(false)
    expect(plugin.name).toBe('dsh-feishu-remote')
    expect(plugin.inject).toEqual([
      'agents',
      'agentDefaultModel',
      'credentials',
      'tools',
      'systemPrompt',
      'agentPresets',
      'connection',
      'sessionPersistence',
      'approval',
      'userQuestions',
      'workspaceRegistry',
      'settings',
    ])
    expect(plugin.Config).toBeDefined()
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply() never rejects, even with unusable config', async () => {
    const warnings: unknown[][] = []
    const ctx = {
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
      credentials: { resolve: async () => undefined },
      settings: fakeSettings(),
      effect: () => () => undefined,
    }
    // No credentials resolvable → resolveRuntimeConfig throws → apply swallows it.
    await expect((plugin.apply as (ctx: never, config: never) => Promise<void>)(
      ctx as never,
      { appId: 'cli_x', cwd: '/tmp', workspaceRoot: '/tmp' } as never,
    )).resolves.toBeUndefined()
    expect(warnings.some(args => String(args[0]).includes('配置无效'))).toBe(true)
  })

  it('apply() hot-reloads through the settings watcher and stops the old bridge', async () => {
    const watchCallbacks: Array<() => void> = []
    // mock appId keeps the test off the network; tmp state path keeps it off ~/.dsh.
    const pluginConfig = { appId: 'mock', appSecret: 's', cwd: '/tmp', workspaceRoot: '/tmp', statePath: '/tmp/dsh-feishu-plugin-shape-state.json' }
    const ctx = {
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      credentials: { resolve: async () => ({ value: 'secret' }) },
      settings: {
        register: () => ({
          get: () => ({}),
          watch: (callback: () => void) => {
            watchCallbacks.push(callback)
            return () => undefined
          },
        }),
      },
      // cordis effects run their setup function immediately.
      effect: (setup: () => void) => {
        setup()
        return () => undefined
      },
      listeners: new Map(),
      services: new Map(),
      agents: {
        create: async () => ({ agent: { id: 'x', status: 'idle', session: { header: {} }, followup: () => undefined, cancel: () => undefined, steer: () => undefined }, dispose: async () => undefined }),
        resume: async () => ({ agent: { id: 'x', status: 'idle', session: { header: {} }, followup: () => undefined, cancel: () => undefined, steer: () => undefined }, dispose: async () => undefined }),
        get: () => undefined,
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      on: () => () => undefined,
      get: () => undefined,
    }
    await (plugin.apply as (ctx: never, config: never) => Promise<void>)(
      ctx as never,
      pluginConfig as never,
    )
    expect(watchCallbacks).toHaveLength(1)
    // A watcher firing re-syncs without throwing (bridge stop is awaited).
    await expect(Promise.resolve().then(() => watchCallbacks[0]!())).resolves.toBeUndefined()
  })
})
