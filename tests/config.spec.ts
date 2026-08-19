import { describe, expect, it } from 'vitest'
import { ConfigSchema, resolveConfig } from '../src/config.js'

const BASE = {
  appId: 'cli_test',
  appSecret: 'secret-value',
  cwd: '/tmp/workspace',
  workspaceRoot: '/tmp/workspace',
}

describe('resolveConfig (single project, fail-closed)', () => {
  it('resolves required fields with defaults', () => {
    const config = resolveConfig(BASE)
    expect(config.appId).toBe('cli_test')
    expect(config.cwd).toBe('/tmp/workspace')
    expect(config.workspaceRoot).toBe('/tmp/workspace')
    expect(config.allowAllUsers).toBe(false)
    expect(config.requireMention).toBe(true)
    expect(config.progressUpdateMs).toBe(600)
    expect(config.workingReaction).toBe(true)
    expect(config.interactiveTimeoutMs).toBe(10 * 60 * 1000)
    expect(config.cardBodyMaxChars).toBe(12000)
    expect(config.statePath).toMatch(/feishu-remote[\\/]cli_test\.json$/u)
  })

  it('fails closed on a missing app credential pair', () => {
    expect(() => resolveConfig({ ...BASE, appId: '' })).toThrow('missing app id')
    expect(() => resolveConfig({ ...BASE, appSecret: '', appSecretRef: 'DSH_FEISHU_APP_SECRET' }))
      .toThrow('missing app secret')
  })

  it('requires cwd and workspaceRoot explicitly', () => {
    expect(() => resolveConfig({ ...BASE, cwd: undefined, workspaceRoot: '/x' })).toThrow('cwd is required')
    expect(() => resolveConfig({ ...BASE, cwd: '/x', workspaceRoot: undefined })).toThrow('workspaceRoot is required')
  })

  it('rejects a cwd escaping the workspace root', () => {
    expect(() => resolveConfig({ ...BASE, cwd: '/tmp/workspace', workspaceRoot: '/tmp/workspace/sub' }))
      .toThrow('cwd must be inside workspaceRoot')
  })

  it('merges allowlists from config and environment', () => {
    const config = resolveConfig(
      { ...BASE, allowedOpenIds: ['ou_1'], allowedChatIds: ['oc_1'] },
      { DSH_FEISHU_ALLOWED_OPEN_IDS: 'ou_2,ou_3', DSH_FEISHU_ALLOWED_CHAT_IDS: 'oc_2' },
    )
    expect(config.allowedOpenIds).toEqual(['ou_1', 'ou_2', 'ou_3'])
    expect(config.allowedChatIds).toEqual(['oc_1', 'oc_2'])
  })

  it('keeps allowAllUsers false unless explicitly enabled', () => {
    const config = resolveConfig(BASE)
    expect(config.allowAllUsers).toBe(false)
    expect(resolveConfig({ ...BASE, allowAllUsers: true }).allowAllUsers).toBe(true)
    expect(resolveConfig(BASE, { DSH_FEISHU_ALLOW_ALL_USERS: '1' }).allowAllUsers).toBe(true)
  })

  it('reads credentials through the environment reference', () => {
    const config = resolveConfig(
      { ...BASE, appId: undefined, appSecret: undefined },
      { DSH_FEISHU_APP_ID: 'cli_env', DSH_FEISHU_APP_SECRET: 'env-secret' },
    )
    expect(config.appId).toBe('cli_env')
    expect(config.appSecret).toBe('env-secret')
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
  })
})
