/**
 * Web GUI settings card support (P1, docs/05 §1.2/§3): a FLAT schema under the
 * `feishu-remote` settings namespace — the browser settings API writes scalar
 * fields only. The host flattens the nested `Config` into this shape and
 * unflattens user edits back into the bridge config.
 *
 * Credential semantics (docs/05 §1.2, triple-review #17): the card stores only
 * the credential REFERENCE (`appSecretRef`); the secret value itself never
 * rides through settings — `.credentials.yaml` is the single secret source
 * and the host resolves it via `ctx.credentials.resolve(ref)`.
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type { Config } from './config.js'

export const SETTINGS_NAMESPACE = settingsNamespace('feishu-remote')

export const flatSchema: Schema<FlatSettings> = Schema.object({
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default('DSH_FEISHU_APP_SECRET'),
  brand: Schema.union(['feishu', 'lark', 'larkoffice'] as const).default('feishu'),
  // Host-only provenance bit. It never carries a secret and is deliberately
  // omitted from the hand-edited field list in src/client.js.
  onboardingManaged: Schema.boolean().default(false),
  allowedOpenIds: Schema.string().default(''),
  allowedChatIds: Schema.string().default(''),
  allowAllUsers: Schema.boolean().default(false),
  requireMention: Schema.boolean().default(true),
  cwd: Schema.string().default(''),
  workspaceRoot: Schema.string().default(''),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  agentPreset: Schema.string().default(''),
  progressUpdateMs: Schema.number().step(1).min(250).default(600),
  interactiveTimeoutMs: Schema.number().step(1).min(1000).default(10 * 60 * 1000),
  maxLiveAgents: Schema.number().step(1).min(0).default(0),
  commandAllowlist: Schema.string().default(''),
  contextMode: Schema.union(['off', 'auto'] as const).default('auto'),
  contextBackend: Schema.union(['auto', 'cli', 'sdk'] as const).default('auto'),
  // NOTE (docs/15 F-09): feishuCliPath is deliberately NOT in the GUI schema —
  // an arbitrary executable path is equivalent to local code execution and
  // stays a trusted-admin setting (cordis.patch.yml / DSH_FEISHU_CLI_PATH).
  contextP2pMaxMessages: Schema.number().step(1).min(1).max(500).default(80),
  contextP2pMaxChars: Schema.number().step(1).min(1000).max(500000).default(50000),
  contextMaxMessages: Schema.number().step(1).min(1).max(500).default(150),
  contextMaxChars: Schema.number().step(1).min(1000).max(500000).default(100000),
  contextTimeoutMs: Schema.number().step(1).min(1000).max(60000).default(10000),
  contextIncludeBot: Schema.boolean().default(true),
  defaultWorkspace: Schema.string().default(''),
  workspacePolicy: Schema.union(['default', 'locked'] as const).default('default'),
  profileFile: Schema.string().default(''),
  maxTotalLiveAgents: Schema.number().step(1).min(0).default(0),
  bots: Schema.array(Schema.object({
    id: Schema.string().default(''),
    enabled: Schema.boolean().default(true),
    appId: Schema.string().default(''),
    appSecretRef: Schema.string().default(''),
    brand: Schema.union(['feishu', 'lark', 'larkoffice'] as const).default('feishu'),
    statePath: Schema.string().default(''),
    inboundDir: Schema.string().default(''),
    feishuCliPath: Schema.string().default(''),
    allowedOpenIds: Schema.array(Schema.string()).default([]),
    allowedChatIds: Schema.array(Schema.string()).default([]),
    allowAllUsers: Schema.boolean().default(false),
    requireMention: Schema.boolean().default(true),
    defaultWorkspace: Schema.string().default(''),
    workspacePolicy: Schema.union(['default', 'locked'] as const).default('default'),
    agentPreset: Schema.string().default(''),
    profileFile: Schema.string().default(''),
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
    progressCards: Schema.boolean().default(true),
    progressUpdateMs: Schema.number().step(1).min(250).default(600),
    workingReaction: Schema.boolean().default(true),
    maxInboundFileBytes: Schema.number().step(1).min(1).default(20 * 1024 * 1024),
    maxOutboundFileBytes: Schema.number().step(1).min(1).default(30 * 1024 * 1024),
    interactiveTimeoutMs: Schema.number().step(1).min(1000).default(10 * 60 * 1000),
    enableApprovals: Schema.boolean().default(true),
    cardBodyMaxChars: Schema.number().step(1).min(1000).max(28000).default(12000),
    maxLiveAgents: Schema.number().step(1).min(0).default(0),
    commandAllowlist: Schema.array(Schema.string()).default([]),
    contextMode: Schema.union(['off', 'auto'] as const).default('auto'),
    contextBackend: Schema.union(['auto', 'cli', 'sdk'] as const).default('auto'),
    contextP2pMaxMessages: Schema.number().step(1).min(1).max(500).default(80),
    contextP2pMaxChars: Schema.number().step(1).min(1000).max(500000).default(50000),
    contextMaxMessages: Schema.number().step(1).min(1).max(500).default(150),
    contextMaxChars: Schema.number().step(1).min(1000).max(500000).default(100000),
    contextTimeoutMs: Schema.number().step(1).min(1000).max(60000).default(10000),
    contextIncludeBot: Schema.boolean().default(true),
    sessionNamespace: Schema.union(['legacy', 'app'] as const).default('app'),
  })).default([]),
})

export interface FlatSettings {
  appId: string
  appSecretRef: string
  brand: 'feishu' | 'lark' | 'larkoffice'
  onboardingManaged: boolean
  allowedOpenIds: string
  allowedChatIds: string
  allowAllUsers: boolean
  requireMention: boolean
  cwd: string
  workspaceRoot: string
  provider: string
  model: string
  agentPreset: string
  progressUpdateMs: number
  interactiveTimeoutMs: number
  maxLiveAgents: number
  commandAllowlist: string
  contextMode: 'off' | 'auto'
  contextBackend: 'auto' | 'cli' | 'sdk'
  contextP2pMaxMessages: number
  contextP2pMaxChars: number
  contextMaxMessages: number
  contextMaxChars: number
  contextTimeoutMs: number
  contextIncludeBot: boolean
  defaultWorkspace: string
  workspacePolicy: 'default' | 'locked'
  profileFile: string
  maxTotalLiveAgents: number
  bots: Array<{
    id: string
    enabled: boolean
    appId: string
    appSecretRef: string
    brand: 'feishu' | 'lark' | 'larkoffice'
    statePath: string
    inboundDir: string
    feishuCliPath: string
    allowedOpenIds: string[]
    allowedChatIds: string[]
    allowAllUsers: boolean
    requireMention: boolean
    defaultWorkspace: string
    workspacePolicy: 'default' | 'locked'
    agentPreset: string
    profileFile: string
    provider: string
    model: string
    progressCards: boolean
    progressUpdateMs: number
    workingReaction: boolean
    maxInboundFileBytes: number
    maxOutboundFileBytes: number
    interactiveTimeoutMs: number
    enableApprovals: boolean
    cardBodyMaxChars: number
    maxLiveAgents: number
    commandAllowlist: string[]
    contextMode: 'off' | 'auto'
    contextBackend: 'auto' | 'cli' | 'sdk'
    contextP2pMaxMessages: number
    contextP2pMaxChars: number
    contextMaxMessages: number
    contextMaxChars: number
    contextTimeoutMs: number
    contextIncludeBot: boolean
    sessionNamespace: 'legacy' | 'app'
  }>
}

function splitIds(text: string | undefined): string[] {
  if (text === undefined || text === '') return []
  return text.split(/[\s,]+/u).map(part => part.trim()).filter(Boolean)
}

function flattenBots(bots: Config['bots']): FlatSettings['bots'] {
  return (bots ?? []).map(bot => ({
    id: bot.id,
    enabled: bot.enabled ?? true,
    appId: bot.appId,
    appSecretRef: bot.appSecretRef,
    brand: bot.brand ?? 'feishu',
    statePath: bot.statePath ?? '',
    inboundDir: bot.inboundDir ?? '',
    feishuCliPath: bot.feishuCliPath ?? '',
    allowedOpenIds: [...(bot.allowedOpenIds ?? [])],
    allowedChatIds: [...(bot.allowedChatIds ?? [])],
    allowAllUsers: bot.allowAllUsers ?? false,
    requireMention: bot.requireMention ?? true,
    defaultWorkspace: bot.defaultWorkspace ?? '',
    workspacePolicy: bot.workspacePolicy ?? 'default',
    agentPreset: bot.agentPreset ?? '',
    profileFile: bot.profileFile ?? '',
    provider: bot.provider ?? '',
    model: bot.model ?? '',
    progressCards: bot.progressCards ?? true,
    progressUpdateMs: bot.progressUpdateMs ?? 600,
    workingReaction: bot.workingReaction ?? true,
    maxInboundFileBytes: bot.maxInboundFileBytes ?? 20 * 1024 * 1024,
    maxOutboundFileBytes: bot.maxOutboundFileBytes ?? 30 * 1024 * 1024,
    interactiveTimeoutMs: bot.interactiveTimeoutMs ?? 10 * 60 * 1000,
    enableApprovals: bot.enableApprovals ?? true,
    cardBodyMaxChars: bot.cardBodyMaxChars ?? 12000,
    maxLiveAgents: bot.maxLiveAgents ?? 0,
    commandAllowlist: [...(bot.commandAllowlist ?? [])],
    contextMode: bot.contextMode ?? 'auto',
    contextBackend: bot.contextBackend ?? 'auto',
    contextP2pMaxMessages: bot.contextP2pMaxMessages ?? 80,
    contextP2pMaxChars: bot.contextP2pMaxChars ?? 50000,
    contextMaxMessages: bot.contextMaxMessages ?? 150,
    contextMaxChars: bot.contextMaxChars ?? 100000,
    contextTimeoutMs: bot.contextTimeoutMs ?? 10000,
    contextIncludeBot: bot.contextIncludeBot ?? true,
    sessionNamespace: bot.sessionNamespace ?? 'app',
  }))
}

export function flatten(config: Config): FlatSettings {
  return {
    appId: config.appId ?? '',
    appSecretRef: config.appSecretRef ?? 'DSH_FEISHU_APP_SECRET',
    brand: config.brand ?? 'feishu',
    onboardingManaged: false,
    allowedOpenIds: (config.allowedOpenIds ?? []).join(', '),
    allowedChatIds: (config.allowedChatIds ?? []).join(', '),
    allowAllUsers: config.allowAllUsers ?? false,
    requireMention: config.requireMention ?? true,
    cwd: config.cwd ?? '',
    workspaceRoot: config.workspaceRoot ?? '',
    provider: config.provider ?? '',
    model: config.model ?? '',
    agentPreset: config.agentPreset ?? '',
    progressUpdateMs: config.progressUpdateMs ?? 600,
    interactiveTimeoutMs: config.interactiveTimeoutMs ?? 10 * 60 * 1000,
    maxLiveAgents: config.maxLiveAgents ?? 0,
    commandAllowlist: (config.commandAllowlist ?? []).join(', '),
    contextMode: config.contextMode ?? 'auto',
    contextBackend: config.contextBackend ?? 'auto',
    contextP2pMaxMessages: config.contextP2pMaxMessages ?? 80,
    contextP2pMaxChars: config.contextP2pMaxChars ?? 50000,
    contextMaxMessages: config.contextMaxMessages ?? 150,
    contextMaxChars: config.contextMaxChars ?? 100000,
    contextTimeoutMs: config.contextTimeoutMs ?? 10000,
    contextIncludeBot: config.contextIncludeBot ?? true,
    defaultWorkspace: config.defaultWorkspace ?? '',
    workspacePolicy: config.workspacePolicy ?? 'default',
    profileFile: config.profileFile ?? '',
    maxTotalLiveAgents: config.maxTotalLiveAgents ?? 0,
    bots: flattenBots(config.bots),
  }
}

/**
 * Flat user layer + patch.yml entry → the nested bridge config. The secret
 * value never comes from settings: `appSecret` keeps the entry/env value and
 * `appSecretRef` is the only credential field the card can edit.
 */
export function unflatten(flat: Partial<FlatSettings> | undefined, entry: Config): Config {
  const value = flat ?? {}
  return {
    ...entry,
    // A successful QR bind moves the secret source to the credential provider.
    // Do not let a legacy inline patch secret shadow that newly selected ref.
    appSecret: value.onboardingManaged === true ? '' : entry.appSecret,
    appId: value.appId ?? '',
    appSecretRef: value.appSecretRef?.trim() || 'DSH_FEISHU_APP_SECRET',
    brand: value.brand ?? 'feishu',
    allowedOpenIds: splitIds(value.allowedOpenIds),
    allowedChatIds: splitIds(value.allowedChatIds),
    allowAllUsers: value.allowAllUsers ?? false,
    requireMention: value.requireMention ?? true,
    cwd: value.cwd ?? '',
    workspaceRoot: value.workspaceRoot ?? '',
    provider: value.provider ?? '',
    model: value.model ?? '',
    agentPreset: value.agentPreset ?? '',
    progressUpdateMs: value.progressUpdateMs ?? 600,
    interactiveTimeoutMs: value.interactiveTimeoutMs ?? 10 * 60 * 1000,
    maxLiveAgents: value.maxLiveAgents ?? 0,
    commandAllowlist: splitIds(value.commandAllowlist),
    contextMode: value.contextMode ?? 'auto',
    contextBackend: value.contextBackend ?? 'auto',
    contextP2pMaxMessages: value.contextP2pMaxMessages ?? 80,
    contextP2pMaxChars: value.contextP2pMaxChars ?? 50000,
    contextMaxMessages: value.contextMaxMessages ?? 150,
    contextMaxChars: value.contextMaxChars ?? 100000,
    contextTimeoutMs: value.contextTimeoutMs ?? 10000,
    contextIncludeBot: value.contextIncludeBot ?? true,
    defaultWorkspace: value.defaultWorkspace ?? '',
    workspacePolicy: value.workspacePolicy ?? 'default',
    profileFile: value.profileFile ?? '',
    maxTotalLiveAgents: value.maxTotalLiveAgents ?? 0,
    bots: structuredClone(value.bots ?? []),
  }
}
