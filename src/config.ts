/**
 * Configuration — single-project schema. `cwd` and `workspaceRoot` are
 * REQUIRED (docs/05 §5.4): a remote executor must never operate on an
 * accidental process cwd. Credentials resolve through the Harness credential
 * provider (`.credentials.yaml` is the single secret source); allowlists are
 * fail-closed: empty `allowedOpenIds` rejects everyone unless
 * `allowAllUsers: true` is explicit, and empty `allowedChatIds` refuses all
 * group chats.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import type { CardPreset, LarkBrand, ResolvedConfig } from './types.js'
import { canonicalPath, isInside, parseBooleanEnv, parseCsv } from './security.js'

export interface Config {
  appId?: string
  appSecret?: string
  appSecretRef?: string
  brand?: LarkBrand
  statePath?: string
  allowedOpenIds?: string[]
  allowedChatIds?: string[]
  allowAllUsers?: boolean
  requireMention?: boolean
  provider?: string
  model?: string
  cwd?: string
  workspaceRoot?: string
  inboundDir?: string
  progressCards?: boolean
  progressUpdateMs?: number
  maxInboundFileBytes?: number
  maxOutboundFileBytes?: number
  interactiveTimeoutMs?: number
  enableApprovals?: boolean
  cardBodyMaxChars?: number
  cardPreset?: CardPreset
  agentPreset?: string
  maxLiveAgents?: number
  commandAllowlist?: string[]
}

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
  progressUpdateMs: Schema.number().step(1).min(250).default(1000),
  maxInboundFileBytes: Schema.number().step(1).min(1).default(20 * 1024 * 1024),
  maxOutboundFileBytes: Schema.number().step(1).min(1).default(30 * 1024 * 1024),
  interactiveTimeoutMs: Schema.number().step(1).min(1000).default(10 * 60 * 1000),
  enableApprovals: Schema.boolean().default(true),
  cardBodyMaxChars: Schema.number().step(1).min(1000).max(28000).default(12000),
  cardPreset: Schema.union(['compact', 'standard', 'developer'] as const).default('standard'),
  agentPreset: Schema.string().default(''),
  maxLiveAgents: Schema.number().step(1).min(0).default(0),
  commandAllowlist: Schema.array(Schema.string()).default([]),
})

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

/**
 * Resolve schema-normalized config with environment-only secrets and
 * allowlists. Throws on a missing app credential pair, on missing
 * cwd/workspaceRoot, and on paths escaping the workspace root.
 */
export function resolveConfig(config: Config, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const appId = (config.appId || env.DSH_FEISHU_APP_ID || '').trim()
  const appSecretRef = (config.appSecretRef || 'DSH_FEISHU_APP_SECRET').trim()
  const appSecret = (config.appSecret || env[appSecretRef] || env.DSH_FEISHU_APP_SECRET || '').trim()
  if (appId === '') throw new Error('dsh-feishu-remote: missing app id (set DSH_FEISHU_APP_ID or appId)')
  if (appSecretRef === '') throw new Error('dsh-feishu-remote: appSecretRef cannot be empty')
  credentialRef(appSecretRef)
  if (appSecret === '') throw new Error(`dsh-feishu-remote: missing app secret (set credential ${appSecretRef})`)

  const dshHome = resolve(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const statePath = resolve(config.statePath || join(dshHome, 'feishu-remote', `${appId}.json`))

  if ((config.cwd ?? '').trim() === '') {
    throw new Error('dsh-feishu-remote: cwd is required (absolute path the agent works in)')
  }
  if ((config.workspaceRoot ?? '').trim() === '') {
    throw new Error('dsh-feishu-remote: workspaceRoot is required (absolute path that bounds file access)')
  }
  // Canonicalize (symlink-resolved) so containment checks cannot be fooled by
  // a symlinked component (Codex P1-8).
  const cwd = canonicalPath(resolve(config.cwd!))
  const workspaceRoot = canonicalPath(resolve(config.workspaceRoot!))
  const inboundDir = resolve(cwd, config.inboundDir || '.dsh-feishu-remote/inbox')
  if (!isInside(workspaceRoot, cwd)) {
    throw new Error('dsh-feishu-remote: cwd must be inside workspaceRoot')
  }
  if (!isInside(workspaceRoot, inboundDir)) {
    throw new Error('dsh-feishu-remote: inboundDir must be inside workspaceRoot')
  }
  const provider = config.provider?.trim()
  const model = config.model?.trim()
  const agentPreset = config.agentPreset?.trim()

  const allowAllUsers = Boolean(config.allowAllUsers) || parseBooleanEnv(env.DSH_FEISHU_ALLOW_ALL_USERS)
  const allowedOpenIds = unique([
    ...(config.allowedOpenIds ?? []),
    ...parseCsv(env.DSH_FEISHU_ALLOWED_OPEN_IDS),
  ])
  const allowedChatIds = unique([
    ...(config.allowedChatIds ?? []),
    ...parseCsv(env.DSH_FEISHU_ALLOWED_CHAT_IDS),
  ])
  if (allowAllUsers && !parseBooleanEnv(env.DSH_FEISHU_ALLOW_ALL_USERS) && !config.allowAllUsers) {
    throw new Error('dsh-feishu-remote: allowAllUsers must be set explicitly in config or DSH_FEISHU_ALLOW_ALL_USERS')
  }

  return {
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
    progressUpdateMs: config.progressUpdateMs ?? 1000,
    maxInboundFileBytes: config.maxInboundFileBytes ?? 20 * 1024 * 1024,
    maxOutboundFileBytes: config.maxOutboundFileBytes ?? 30 * 1024 * 1024,
    interactiveTimeoutMs: config.interactiveTimeoutMs ?? 10 * 60 * 1000,
    enableApprovals: config.enableApprovals ?? true,
    cardBodyMaxChars: config.cardBodyMaxChars ?? 12000,
    cardPreset: config.cardPreset ?? 'standard',
    ...(agentPreset === undefined || agentPreset === '' ? {} : { agentPreset }),
    maxLiveAgents: config.maxLiveAgents ?? 0,
    commandAllowlist: unique(config.commandAllowlist ?? []),
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
  const directSecret = (config.appSecret || env[appSecretRef] || env.DSH_FEISHU_APP_SECRET || '').trim()
  const resolvedSecret = directSecret === ''
    ? (await ctx.credentials.resolve(credentialRef(appSecretRef)))?.value ?? ''
    : directSecret
  return resolveConfig({ ...config, appSecret: resolvedSecret, appSecretRef }, env)
}
