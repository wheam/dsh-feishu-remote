import { describe, expect, it } from 'vitest'
import { flatSchema, flatten, unflatten } from '../src/settings.js'

describe('settings namespace (flat ↔ nested)', () => {
  it('flattens the bridge config into the scalar-only shape', () => {
    const flat = flatten({
      appId: 'cli_1',
      allowedOpenIds: ['ou_1', 'ou_2'],
      allowedChatIds: [],
      allowAllUsers: false,
      cwd: '/tmp/work',
      workspaceRoot: '/tmp/work',
      commandAllowlist: ['status'],
    })
    expect(flat.appId).toBe('cli_1')
    expect(flat.allowedOpenIds).toBe('ou_1, ou_2')
    expect(flat.allowedChatIds).toBe('')
    expect(flat.appSecretRef).toBe('DSH_FEISHU_APP_SECRET')
    expect(flat.brand).toBe('feishu')
    expect(flat.onboardingManaged).toBe(false)
    expect(flat.contextP2pMaxMessages).toBe(80)
    expect(flat.contextP2pMaxChars).toBe(50000)
    expect('appSecret' in flat).toBe(false)
  })

  it('never carries the secret VALUE through the settings layer (credential ref only)', () => {
    const flat = flatten({ appId: 'cli_1', appSecret: 'super-secret' })
    expect(JSON.stringify(flat)).not.toContain('super-secret')
    const config = unflatten({ appSecretRef: 'MY_REF' }, { appSecret: 'super-secret' })
    expect(config.appSecretRef).toBe('MY_REF')
    expect(config.appSecret).toBe('super-secret') // entry value preserved, never written by settings
  })

  it('drops a legacy inline secret after QR onboarding selects a provider ref', () => {
    const config = unflatten({
      appId: 'cli_new',
      appSecretRef: 'DSH_FEISHU_APP_SECRET_NEW',
      onboardingManaged: true,
      brand: 'lark',
    }, { appSecret: 'legacy-secret', brand: 'feishu' })
    expect(config.appSecret).toBe('')
    expect(config.brand).toBe('lark')
  })

  it('round-trips through unflatten, keeping entry fields GUI does not expose', () => {
    const entry = { appSecretRef: 'DSH_FEISHU_APP_SECRET', brand: 'feishu' as const }
    const flat = flatten({
      appId: 'cli_1',
      allowedOpenIds: ['ou_1'],
      allowedChatIds: ['oc_1'],
      cwd: '/tmp/work',
      workspaceRoot: '/tmp/work',
      progressUpdateMs: 500,
    })
    const config = unflatten(flat, entry)
    expect(config.appId).toBe('cli_1')
    expect(config.allowedOpenIds).toEqual(['ou_1'])
    expect(config.allowedChatIds).toEqual(['oc_1'])
    expect(config.progressUpdateMs).toBe(500)
    expect(config.appSecretRef).toBe('DSH_FEISHU_APP_SECRET')
    expect(config.brand).toBe('feishu')
    expect(config.contextP2pMaxMessages).toBe(80)
    expect(config.contextP2pMaxChars).toBe(50000)
  })

  it('parses empty list strings as empty arrays', () => {
    const config = unflatten(flatten({}), {})
    expect(config.allowedOpenIds).toEqual([])
    expect(config.allowedChatIds).toEqual([])
    expect(config.commandAllowlist).toEqual([])
  })

  it('exposes only the credential reference, not a secret field', () => {
    const json = JSON.stringify(flatSchema.toJSON?.() ?? flatSchema)
    expect(json).toContain('appSecretRef')
    expect(json).not.toContain('"appSecret"')
  })
})
