/**
 * Configuration. Workspace selection is owned by DSH's Workspace Registry;
 * legacy `cwd` / `workspaceRoot` values are accepted only for upgrade
 * compatibility and outbound-path policy, never as a new Feishu origin's
 * implicit project. Credentials resolve through the Harness credential
 * provider (`.credentials.yaml` is the single secret source); the sender
 * allowlist is fail-closed: empty `allowedOpenIds` rejects everyone unless
 * `allowAllUsers: true` is explicit. Group scope is open by default; a
 * non-empty `allowedChatIds` optionally narrows the bot to selected groups.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import type { LarkBrand, ResolvedConfig, SessionNamespace, WorkspacePolicy } from './types.js'
import { canonicalPath, isInside, parseBooleanEnv, parseCsv } from './security.js'

export interface LegacySingleBotConfig {
  appId?: string
  appSecret?: string
  appSecretRef?: string
  brand?: LarkBrand
  statePath?: string
  allowedOpenIds?: string[]
  /** Optional group restriction. Empty means every group the bot joins. */
  allowedChatIds?: string[]
  allowAllUsers?: boolean
  /** Require the first message in each topic to @mention; ordinary groups always require every @. */
  requireMention?: boolean
  provider?: string
  model?: string
  cwd?: string
  workspaceRoot?: string
  inboundDir?: string
  progressCards?: boolean
  progressUpdateMs?: number
  /** 飞书回合认领时给用户消息加「敲键盘」reaction、回合结束移除（装饰性，失败静默）。 */
  workingReaction?: boolean
  maxInboundFileBytes?: number
  maxOutboundFileBytes?: number
  interactiveTimeoutMs?: number
  enableApprovals?: boolean
  cardBodyMaxChars?: number
  agentPreset?: string
  maxLiveAgents?: number
  commandAllowlist?: string[]
  contextMode?: 'off' | 'auto'
  contextBackend?: 'auto' | 'cli' | 'sdk'
  feishuCliPath?: string
  /** 私聊额外上限；实际值还会受 contextMaxMessages 全局上限约束。 */
  contextP2pMaxMessages?: number
  /** 私聊额外字符上限；实际值还会受 contextMaxChars 全局上限约束。 */
  contextP2pMaxChars?: number
  contextMaxMessages?: number
  contextMaxChars?: number
  contextTimeoutMs?: number
  contextIncludeBot?: boolean
  defaultWorkspace?: string
  workspacePolicy?: WorkspacePolicy
  profileFile?: string
}

export interface BotConfig extends Omit<LegacySingleBotConfig, 'appSecret' | 'cwd' | 'workspaceRoot'> {
  id: string
  enabled?: boolean
  appId: string
  appSecretRef: string
  sessionNamespace?: SessionNamespace
}

export interface Config extends LegacySingleBotConfig {
  bots?: BotConfig[]
  maxTotalLiveAgents?: number
}

const BotSchema: Schema<BotConfig> = Schema.object({
  id: Schema.string().default(''),
  enabled: Schema.boolean().default(true),
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default(''),
  brand: Schema.union(['feishu', 'lark', 'larkoffice'] as const).default('feishu'),
  statePath: Schema.string().default(''),
  inboundDir: Schema.string().default(''),
  allowedOpenIds: Schema.array(Schema.string()).default([]),
  allowedChatIds: Schema.array(Schema.string()).default([]),
  allowAllUsers: Schema.boolean().default(false),
  requireMention: Schema.boolean().default(true),
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
  agentPreset: Schema.string().default(''),
  maxLiveAgents: Schema.number().step(1).min(0).default(0),
  commandAllowlist: Schema.array(Schema.string()).default([]),
  contextMode: Schema.union(['off', 'auto'] as const).default('auto'),
  contextBackend: Schema.union(['auto', 'cli', 'sdk'] as const).default('auto'),
  feishuCliPath: Schema.string().default(''),
  contextP2pMaxMessages: Schema.number().step(1).min(1).max(500).default(80),
  contextP2pMaxChars: Schema.number().step(1).min(1000).max(500000).default(50000),
  contextMaxMessages: Schema.number().step(1).min(1).max(500).default(150),
  contextMaxChars: Schema.number().step(1).min(1000).max(500000).default(100000),
  contextTimeoutMs: Schema.number().step(1).min(1000).max(60000).default(10000),
  contextIncludeBot: Schema.boolean().default(true),
  defaultWorkspace: Schema.string().default(''),
  workspacePolicy: Schema.union(['default', 'locked'] as const).default('default'),
  profileFile: Schema.string().default(''),
  sessionNamespace: Schema.union(['legacy', 'app'] as const).default('app'),
})

export const ConfigSchema: Schema<Config> = Schema.object({
  appId: Schema.string().default(''),
  appSecret: Schema.string().role('secret').default(''),
  appSecretRef: Schema.string().role('credential-ref').default('DSH_FEISHU_APP_SECRET'),
  brand: Schema.union(['feishu', 'lark', 'larkoffice'] as const).default('feishu'),
  statePath: Schema.string().default(''),
  allowedOpenIds: Schema.array(Schema.string()).default([]),
  allowedChatIds: Schema.array(Schema.string()).default([]),
  allowAllUsers: Schema.boolean().default(false),
  requireMention: Schema.boolean().default(true),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  cwd: Schema.string().default(''),
  workspaceRoot: Schema.string().default(''),
  inboundDir: Schema.string().default(''),
  progressCards: Schema.boolean().default(true),
  progressUpdateMs: Schema.number().step(1).min(250).default(600),
  workingReaction: Schema.boolean().default(true),
  maxInboundFileBytes: Schema.number().step(1).min(1).default(20 * 1024 * 1024),
  maxOutboundFileBytes: Schema.number().step(1).min(1).default(30 * 1024 * 1024),
  interactiveTimeoutMs: Schema.number().step(1).min(1000).default(10 * 60 * 1000),
  enableApprovals: Schema.boolean().default(true),
  cardBodyMaxChars: Schema.number().step(1).min(1000).max(28000).default(12000),
  agentPreset: Schema.string().default(''),
  maxLiveAgents: Schema.number().step(1).min(0).default(0),
  commandAllowlist: Schema.array(Schema.string()).default([]),
  contextMode: Schema.union(['off', 'auto'] as const).default('auto'),
  contextBackend: Schema.union(['auto', 'cli', 'sdk'] as const).default('auto'),
  feishuCliPath: Schema.string().default(''),
  contextP2pMaxMessages: Schema.number().step(1).min(1).max(500).default(80),
  contextP2pMaxChars: Schema.number().step(1).min(1000).max(500000).default(50000),
  contextMaxMessages: Schema.number().step(1).min(1).max(500).default(150),
  contextMaxChars: Schema.number().step(1).min(1000).max(500000).default(100000),
  contextTimeoutMs: Schema.number().step(1).min(1000).max(60000).default(10000),
  contextIncludeBot: Schema.boolean().default(true),
  defaultWorkspace: Schema.string().default(''),
  workspacePolicy: Schema.union(['default', 'locked'] as const).default('default'),
  profileFile: Schema.string().default(''),
  bots: Schema.array(BotSchema).default([]),
  maxTotalLiveAgents: Schema.number().step(1).min(0).default(0),
})

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

/**
 * Resolve schema-normalized config with environment-only secrets and
 * allowlists. The legacy cwd/workspaceRoot pair may be absent; when supplied,
 * both must be present and retain the old containment invariant.
 */
export function resolveConfig(config: Config, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const appId = (config.appId || env.DSH_FEISHU_APP_ID || '').trim()
  const appSecretRef = (config.appSecretRef || 'DSH_FEISHU_APP_SECRET').trim()
  const defaultSecret = appSecretRef === 'DSH_FEISHU_APP_SECRET' ? env.DSH_FEISHU_APP_SECRET : undefined
  const appSecret = (config.appSecret || env[appSecretRef] || defaultSecret || '').trim()
  if (appId === '') throw new Error('dsh-feishu-remote: missing app id (set DSH_FEISHU_APP_ID or appId)')
  if (appSecretRef === '') throw new Error('dsh-feishu-remote: appSecretRef cannot be empty')
  credentialRef(appSecretRef)
  if (appSecret === '') throw new Error(`dsh-feishu-remote: missing app secret (set credential ${appSecretRef})`)

  const dshHome = resolve(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const statePath = resolve(config.statePath || join(dshHome, 'feishu-remote', `${appId}.json`))

  const rawCwd = (config.cwd ?? '').trim()
  const rawWorkspaceRoot = (config.workspaceRoot ?? '').trim()
  if ((rawCwd === '') !== (rawWorkspaceRoot === '')) {
    throw new Error('dsh-feishu-remote: legacy cwd and workspaceRoot must be configured together')
  }
  // Canonicalize (symlink-resolved) so the retained legacy outbound boundary
  // cannot be fooled by a symlinked component.
  const cwd = rawCwd === '' ? '' : canonicalPath(resolve(rawCwd))
  const workspaceRoot = rawWorkspaceRoot === '' ? '' : canonicalPath(resolve(rawWorkspaceRoot))
  if (workspaceRoot !== '' && !isInside(workspaceRoot, cwd)) {
    throw new Error('dsh-feishu-remote: cwd must be inside workspaceRoot')
  }
  const inboundDir = resolve(config.inboundDir || join(dshHome, 'feishu-remote', 'inbox'))
  const provider = config.provider?.trim()
  const model = config.model?.trim()
  const agentPreset = config.agentPreset?.trim()
  const defaultWorkspaceSelector = (config.defaultWorkspace ?? '').trim()
  const workspacePolicy = config.workspacePolicy ?? 'default'
  if (workspacePolicy === 'locked' && defaultWorkspaceSelector === '') {
    throw new Error('dsh-feishu-remote: locked workspace requires defaultWorkspace')
  }

  const allowAllUsers = Boolean(config.allowAllUsers) || parseBooleanEnv(env.DSH_FEISHU_ALLOW_ALL_USERS)
  const allowedOpenIds = unique([
    ...(config.allowedOpenIds ?? []),
    ...parseCsv(env.DSH_FEISHU_ALLOWED_OPEN_IDS),
  ])
  const allowedChatIds = unique([
    ...(config.allowedChatIds ?? []),
    ...parseCsv(env.DSH_FEISHU_ALLOWED_CHAT_IDS),
  ])

  return {
    botId: 'legacy',
    appId,
    appSecret,
    appSecretRef,
    brand: config.brand ?? 'feishu',
    statePath,
    allowedOpenIds,
    allowedChatIds,
    allowAllUsers,
    requireMention: config.requireMention ?? true,
    ...(provider === undefined || provider === '' ? {} : { provider }),
    ...(model === undefined || model === '' ? {} : { model }),
    cwd,
    workspaceRoot,
    inboundDir,
    progressCards: config.progressCards ?? true,
    progressUpdateMs: config.progressUpdateMs ?? 600,
    workingReaction: config.workingReaction ?? true,
    maxInboundFileBytes: config.maxInboundFileBytes ?? 20 * 1024 * 1024,
    maxOutboundFileBytes: config.maxOutboundFileBytes ?? 30 * 1024 * 1024,
    interactiveTimeoutMs: config.interactiveTimeoutMs ?? 10 * 60 * 1000,
    enableApprovals: config.enableApprovals ?? true,
    cardBodyMaxChars: config.cardBodyMaxChars ?? 12000,
    ...(agentPreset === undefined || agentPreset === '' ? {} : { agentPreset }),
    maxLiveAgents: config.maxLiveAgents ?? 0,
    commandAllowlist: unique(config.commandAllowlist ?? []),
    contextMode: config.contextMode ?? 'auto',
    contextBackend: config.contextBackend ?? 'auto',
    feishuCliPath: (config.feishuCliPath ?? env.DSH_FEISHU_CLI_PATH ?? '').trim(),
    contextP2pMaxMessages: config.contextP2pMaxMessages ?? 80,
    contextP2pMaxChars: config.contextP2pMaxChars ?? 50000,
    contextMaxMessages: config.contextMaxMessages ?? 150,
    contextMaxChars: config.contextMaxChars ?? 100000,
    contextTimeoutMs: config.contextTimeoutMs ?? 10000,
    contextIncludeBot: config.contextIncludeBot ?? true,
    sessionNamespace: 'legacy',
    workspacePolicy,
    ...(defaultWorkspaceSelector === '' ? {} : { defaultWorkspaceSelector }),
    ...((config.profileFile ?? '').trim() === '' ? {} : { profileFile: config.profileFile!.trim() }),
    multiBot: false,
  }
}

function validateBotShape(bot: BotConfig): void {
  if (!/^[a-z][a-z0-9-]{0,47}$/u.test(bot.id)) {
    throw new Error(`dsh-feishu-remote: invalid bot id ${JSON.stringify(bot.id)}`)
  }
  if (bot.appId.trim() === '') throw new Error(`dsh-feishu-remote [bot:${bot.id}]: appId cannot be empty`)
  if (bot.appSecretRef.trim() === '') throw new Error(`dsh-feishu-remote [bot:${bot.id}]: appSecretRef cannot be empty`)
  credentialRef(bot.appSecretRef.trim())
  if ((bot.workspacePolicy ?? 'default') === 'locked' && (bot.defaultWorkspace ?? '').trim() === '') {
    throw new Error(`dsh-feishu-remote [bot:${bot.id}]: locked workspace requires defaultWorkspace`)
  }
  if ((bot.contextBackend ?? 'auto') === 'cli') {
    throw new Error(`dsh-feishu-remote [bot:${bot.id}]: multi-bot mode requires contextBackend=sdk`)
  }
}

/** Root-level invariants that must be checked before any bot is started. */
export function validateMultiBotConfig(bots: readonly BotConfig[]): void {
  validateMultiBotRootInvariants(bots)
  for (const bot of bots) validateBotShape(bot)
}

/** Cross-bot conflicts are root failures; individual shape errors stay isolated. */
export function validateMultiBotRootInvariants(bots: readonly BotConfig[]): void {
  const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const ids = new Set<string>()
  const appIds = new Set<string>()
  const statePaths = new Set<string>()
  const inboundDirs = new Set<string>()
  let legacy = 0
  for (const bot of bots) {
    if (ids.has(bot.id)) throw new Error(`dsh-feishu-remote: duplicate bot id ${bot.id}`)
    ids.add(bot.id)
    const appId = bot.appId.trim()
    if (appIds.has(appId)) throw new Error(`dsh-feishu-remote: duplicate appId ${appId}`)
    appIds.add(appId)
    if ((bot.sessionNamespace ?? 'app') === 'legacy' && ++legacy > 1) {
      throw new Error('dsh-feishu-remote: at most one bot may use the legacy session namespace')
    }
    const statePath = canonicalPath(resolve(bot.statePath || join(dshHome, 'feishu-remote', `${appId}.json`)))
    if (statePaths.has(statePath)) throw new Error(`dsh-feishu-remote: duplicate statePath ${statePath}`)
    statePaths.add(statePath)
    const inboundDir = canonicalPath(resolve(bot.inboundDir || join(dshHome, 'feishu-remote', 'inbox', appId)))
    if (inboundDirs.has(inboundDir)) throw new Error(`dsh-feishu-remote: duplicate inboundDir ${inboundDir}`)
    inboundDirs.add(inboundDir)
  }
}

/** Resolve one bots[] element without any shared legacy environment fallback. */
export async function resolveBotRuntimeConfig(
  ctx: Context,
  bot: BotConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedConfig> {
  validateBotShape(bot)
  const ref = bot.appSecretRef.trim()
  const direct = (env[ref] ?? '').trim()
  const appSecret = direct === '' ? (await ctx.credentials.resolve(credentialRef(ref)))?.value ?? '' : direct
  if (appSecret.trim() === '') throw new Error(`dsh-feishu-remote [bot:${bot.id}]: missing app secret for credential ${ref}`)
  const dshHome = resolve(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const resolved = resolveConfig({
    ...bot,
    appSecret,
    cwd: undefined,
    workspaceRoot: undefined,
    statePath: bot.statePath || join(dshHome, 'feishu-remote', `${bot.appId.trim()}.json`),
    inboundDir: bot.inboundDir || join(dshHome, 'feishu-remote', 'inbox', bot.appId.trim()),
    contextBackend: 'sdk',
  }, {})
  return {
    ...resolved,
    botId: bot.id,
    appId: bot.appId.trim(),
    appSecretRef: ref,
    allowedOpenIds: unique(bot.allowedOpenIds ?? []),
    allowedChatIds: unique(bot.allowedChatIds ?? []),
    allowAllUsers: bot.allowAllUsers ?? false,
    feishuCliPath: (bot.feishuCliPath ?? '').trim(),
    sessionNamespace: bot.sessionNamespace ?? 'app',
    workspacePolicy: bot.workspacePolicy ?? 'default',
    ...((bot.profileFile ?? '').trim() === '' ? { profileFile: undefined } : { profileFile: bot.profileFile!.trim() }),
    multiBot: true,
  }
}

/**
 * Resolve a credential reference through the Harness credential provider
 * before booting the channel (`.credentials.yaml` is the single secret
 * source; the GUI only stores the reference).
 */
export async function resolveRuntimeConfig(
  ctx: Context,
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedConfig> {
  const appSecretRef = (config.appSecretRef || 'DSH_FEISHU_APP_SECRET').trim()
  credentialRef(appSecretRef)
  const defaultSecret = appSecretRef === 'DSH_FEISHU_APP_SECRET' ? env.DSH_FEISHU_APP_SECRET : undefined
  const directSecret = (config.appSecret || env[appSecretRef] || defaultSecret || '').trim()
  const resolvedSecret = directSecret === ''
    ? (await ctx.credentials.resolve(credentialRef(appSecretRef)))?.value ?? ''
    : directSecret
  return resolveConfig({ ...config, appSecret: resolvedSecret, appSecretRef }, env)
}
