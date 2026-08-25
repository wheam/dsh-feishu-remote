import { describe, expect, it } from 'vitest'
import { BotConfigError, ConfigSchema, resolveBotRuntimeConfig, resolveConfig, validateMultiBotConfig } from '../src/config.js'

const BASE = {
  appId: 'cli_test',
  appSecret: 'secret-value',
  cwd: '/tmp/workspace',
  workspaceRoot: '/tmp/workspace',
}

describe('resolveConfig (Workspace Registry routing, open sender access)', () => {
  it('resolves required fields with defaults', () => {
    const config = resolveConfig(BASE)
    expect(config.appId).toBe('cli_test')
    expect(config.cwd).toBe('/tmp/workspace')
    expect(config.workspaceRoot).toBe('/tmp/workspace')
    expect(config.allowedOpenIds).toEqual([])
    expect(config.allowAllUsers).toBe(true)
    expect(config.requireMention).toBe(true)
    expect(config.progressUpdateMs).toBe(600)
    expect(config.workingReaction).toBe(true)
    expect(config.interactiveTimeoutMs).toBe(10 * 60 * 1000)
    expect(config.cardBodyMaxChars).toBe(12000)
    expect(config.contextP2pMaxMessages).toBe(80)
    expect(config.contextP2pMaxChars).toBe(50000)
    expect(config.contextMaxMessages).toBe(150)
    expect(config.contextMaxChars).toBe(100000)
    expect(config.statePath).toMatch(/feishu-remote[\\/]cli_test\.json$/u)
  })

  it('fails closed on a missing app credential pair', () => {
    expect(() => resolveConfig({ ...BASE, appId: '' })).toThrow('missing app id')
    expect(() => resolveConfig({ ...BASE, appSecret: '', appSecretRef: 'DSH_FEISHU_APP_SECRET' }))
      .toThrow('missing app secret')
  })

  it('allows no legacy cwd pair but rejects a half-configured pair', () => {
    expect(resolveConfig({ ...BASE, cwd: undefined, workspaceRoot: undefined })).toMatchObject({ cwd: '', workspaceRoot: '' })
    expect(() => resolveConfig({ ...BASE, cwd: undefined, workspaceRoot: '/x' })).toThrow('configured together')
    expect(() => resolveConfig({ ...BASE, cwd: '/x', workspaceRoot: undefined })).toThrow('configured together')
  })

  it('rejects a cwd escaping the workspace root', () => {
    expect(() => resolveConfig({ ...BASE, cwd: '/tmp/workspace', workspaceRoot: '/tmp/workspace/sub' }))
      .toThrow('cwd must be inside workspaceRoot')
  })

  it('ignores retired user allowlists while retaining the optional group restriction', () => {
    const config = resolveConfig(
      { ...BASE, allowedOpenIds: ['ou_1'], allowAllUsers: false, allowedChatIds: ['oc_1'] },
      {
        DSH_FEISHU_ALLOWED_OPEN_IDS: 'ou_2,ou_3',
        DSH_FEISHU_ALLOW_ALL_USERS: '0',
        DSH_FEISHU_ALLOWED_CHAT_IDS: 'oc_2',
      },
    )
    expect(config.allowedOpenIds).toEqual([])
    expect(config.allowAllUsers).toBe(true)
    expect(config.allowedChatIds).toEqual(['oc_1', 'oc_2'])
  })

  it('reads credentials through the environment reference', () => {
    const config = resolveConfig(
      { ...BASE, appId: undefined, appSecret: undefined },
      { DSH_FEISHU_APP_ID: 'cli_env', DSH_FEISHU_APP_SECRET: 'env-secret' },
    )
    expect(config.appId).toBe('cli_env')
    expect(config.appSecret).toBe('env-secret')
  })

  it('does not let the legacy default env secret shadow a custom credential ref', () => {
    expect(() => resolveConfig(
      { ...BASE, appSecret: '', appSecretRef: 'DSH_FEISHU_APP_SECRET_NEW' },
      { DSH_FEISHU_APP_SECRET: 'old-default-secret' },
    )).toThrow('missing app secret')
  })

  it('normalizes the native command allowlist', () => {
    const config = resolveConfig({ ...BASE, commandAllowlist: ['  status ', 'sessions', 'status'] })
    expect(config.commandAllowlist).toEqual(['status', 'sessions'])
  })

  it('accepts maxLiveAgents 0 (unlimited) — the schema must not reject its own default', () => {
    const config = resolveConfig(BASE)
    expect(config.maxLiveAgents).toBe(0)
    expect(resolveConfig({ ...BASE, maxLiveAgents: 4 }).maxLiveAgents).toBe(4)
  })

  it('ConfigSchema validates its own defaults (regression: min(1) rejected the 0 default)', () => {
    const resolved = ConfigSchema({})
    expect(resolved.maxLiveAgents).toBe(0)
    expect(resolved.progressUpdateMs).toBe(600)
    expect(resolved.interactiveTimeoutMs).toBe(10 * 60 * 1000)
    expect(resolved.contextP2pMaxMessages).toBe(80)
    expect(resolved.contextP2pMaxChars).toBe(50000)
    expect(resolved.bots).toEqual([])
    expect(resolved.maxTotalLiveAgents).toBe(0)
  })

  it('validates multi-bot root identity and namespace invariants', () => {
    expect(() => validateMultiBotConfig([
      { id: 'bot-a', appId: 'cli_same', appSecretRef: 'REF_A' },
      { id: 'bot-b', appId: 'cli_same', appSecretRef: 'REF_B' },
    ])).toThrow('duplicate appId')
    expect(() => validateMultiBotConfig([
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', sessionNamespace: 'legacy' },
      { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', sessionNamespace: 'legacy' },
    ])).toThrow('at most one')
    expect(() => validateMultiBotConfig([
      { id: 'Bad ID', appId: 'cli_a', appSecretRef: 'REF_A' },
    ])).toThrow('invalid bot id')
  })

  it('does not inherit shared legacy environment fallbacks in bots[]', async () => {
    const ctx = { credentials: { resolve: async () => ({ value: 'bot-secret' }) } }
    const resolved = await resolveBotRuntimeConfig(ctx as never, {
      id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', allowedOpenIds: [], contextBackend: 'auto',
    }, {
      DSH_FEISHU_APP_ID: 'cli_wrong',
      DSH_FEISHU_APP_SECRET: 'wrong-secret',
      DSH_FEISHU_ALLOW_ALL_USERS: '1',
      DSH_FEISHU_ALLOWED_OPEN_IDS: 'ou_wrong',
      DSH_FEISHU_CLI_PATH: '/wrong/cli',
    })
    expect(resolved).toMatchObject({
      botId: 'bot-a', appId: 'cli_a', appSecret: 'bot-secret',
      contextBackend: 'sdk', feishuCliPath: '', multiBot: true,
    })
    expect(resolved.allowedOpenIds).toEqual([])
    expect(resolved.allowAllUsers).toBe(true)
  })

  /**
   * Codex batch-3 B1: a duplicate host path must be reported by CODE, never by
   * echoing the resolved absolute path — that message travels to `bots/status`.
   */
  it('reports duplicate host paths with a stable code and no absolute path', () => {
    const duplicate = (key: 'statePath' | 'inboundDir', code: string) => {
      let thrown: unknown
      try {
        validateMultiBotConfig([
          { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', [key]: '/tmp/dsh-feishu-dup/shared' },
          { id: 'bot-b', appId: 'cli_b', appSecretRef: 'REF_B', [key]: '/tmp/dsh-feishu-dup/shared' },
        ])
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BotConfigError)
      expect((thrown as BotConfigError).code).toBe(code)
      expect((thrown as Error).message).toContain('bot-b')
      expect((thrown as Error).message).not.toContain('/tmp')
    }
    duplicate('statePath', 'duplicate_state_path')
    duplicate('inboundDir', 'duplicate_inbound_dir')
  })

  it('tags every root invariant failure with its stable code', () => {
    const codeOf = (bots: Parameters<typeof validateMultiBotConfig>[0]) => {
      try {
        validateMultiBotConfig(bots)
        return undefined
      } catch (error) {
        return error instanceof BotConfigError ? error.code : 'not-structured'
      }
    }
    expect(codeOf([
      { id: 'bot-a', appId: 'cli_same', appSecretRef: 'REF_A' },
      { id: 'bot-b', appId: 'cli_same', appSecretRef: 'REF_B' },
    ])).toBe('duplicate_app_id')
    expect(codeOf([
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A' },
      { id: 'bot-a', appId: 'cli_b', appSecretRef: 'REF_B' },
    ])).toBe('duplicate_bot_id')
    expect(codeOf([{ id: 'Bad ID', appId: 'cli_a', appSecretRef: 'REF_A' }])).toBe('invalid_bot_id')
    expect(codeOf([
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', workspacePolicy: 'locked' },
    ])).toBe('workspace_unavailable')
  })

  it('requires a default Workspace for locked policy and forbids CLI in bots[]', () => {
    expect(() => validateMultiBotConfig([
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', workspacePolicy: 'locked' },
    ])).toThrow('requires defaultWorkspace')
    expect(() => validateMultiBotConfig([
      { id: 'bot-a', appId: 'cli_a', appSecretRef: 'REF_A', contextBackend: 'cli' },
    ])).toThrow('requires contextBackend=sdk')
  })
})
