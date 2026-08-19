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
import type { CardPreset } from './types.js'

export const SETTINGS_NAMESPACE = settingsNamespace('feishu-remote')

export const flatSchema = Schema.object({
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default('DSH_FEISHU_APP_SECRET'),
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
  cardPreset: Schema.union(['compact', 'standard', 'developer'] as const).default('standard'),
  maxLiveAgents: Schema.number().step(1).min(0).default(0),
  commandAllowlist: Schema.string().default(''),
})

export interface FlatSettings {
  appId: string
  appSecretRef: string
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
  cardPreset: 'compact' | 'standard' | 'developer'
  maxLiveAgents: number
  commandAllowlist: string
}

function splitIds(text: string | undefined): string[] {
  if (text === undefined || text === '') return []
  return text.split(/[\s,]+/u).map(part => part.trim()).filter(Boolean)
}

export function flatten(config: Config): FlatSettings {
  return {
    appId: config.appId ?? '',
    appSecretRef: config.appSecretRef ?? 'DSH_FEISHU_APP_SECRET',
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
    cardPreset: config.cardPreset ?? 'standard',
    maxLiveAgents: config.maxLiveAgents ?? 0,
    commandAllowlist: (config.commandAllowlist ?? []).join(', '),
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
    appId: value.appId ?? '',
    appSecretRef: value.appSecretRef?.trim() || 'DSH_FEISHU_APP_SECRET',
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
    cardPreset: (value.cardPreset ?? 'standard') as CardPreset,
    maxLiveAgents: value.maxLiveAgents ?? 0,
    commandAllowlist: splitIds(value.commandAllowlist),
  }
}
