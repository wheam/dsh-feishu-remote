/**
 * Web GUI settings card support (P1, docs/05 §1.2/§3): a FLAT schema under the
 * `feishu-remote` settings namespace — the browser settings API writes scalar
 * fields only. The host flattens the nested `Config` into this shape and
 * unflattens user edits back into the bridge config.
 *
 * Credential semantics (docs/05 §1.2, triple-review #17): the card stores only
 * the credential REFERENCE (`appSecretRef`); the secret value itself never
 * rides through settings — `.credentials.yaml` is the single secret source
 * and the host resolves it via `ctx.credentials.resolve(ref)`. `appSecret` is
 * therefore never produced by `flatten()`, never read by `unflatten()`, and a
 * stale one left in the user layer by an older build is purged at startup
 * (see {@link settingsPurgePlan}).
 *
 * Host-only keys (Codex batch-2 B1): `statePath`, `inboundDir` and
 * `feishuCliPath` are trusted-admin YAML settings — an arbitrary executable
 * path is equivalent to local code execution, and on-disk state locations are
 * host topology. They are NOT part of `FlatSettings` at all, so they cannot
 * reach the browser through the standard settings descriptor (`base`,
 * `value`, `user` all come from this shape). They live only in the raw
 * registration `Config` and are re-overlaid host-side by `unflatten()`.
 *
 * RETAINED user-layer paths (Codex batch-4 BLOCKER-2): a pre-f774159 install
 * may hold the ONLY copy of a bot's `statePath`/`inboundDir`/`feishuCliPath`
 * in the settings user layer. {@link settingsPurgePlan} refuses to delete
 * such a value, and `unflatten()` therefore has to USE it: the entry config
 * stays authoritative wherever it provides a value, and the retained user
 * value fills the gap where it does not. Without that the purge's `retained`
 * promise was a lie — the bot silently moved to the default state file.
 */
import Schema from '@deepseek-ai/schemastery'
import type { BotConfig, Config } from './config.js'

/** Stable settings key; dsh-settings 0.1.5 no longer exports the old branding helper. */
export const SETTINGS_NAMESPACE = 'feishu-remote' as const

/**
 * Per-bot keys that must never enter the settings layer in either direction.
 * The host re-overlays them from the registration `Config` in `unflatten()`.
 */
export const HOST_ONLY_BOT_KEYS = ['statePath', 'inboundDir', 'feishuCliPath'] as const
export type HostOnlyBotKey = (typeof HOST_ONLY_BOT_KEYS)[number]

/**
 * Keys an older build may have persisted into the settings USER layer and
 * that must never survive there: the host-only paths plus the secret value.
 * `appSecret` is ALWAYS purged; the paths are purged only when the trusted
 * entry config already provides the same value (see {@link settingsPurgePlan}).
 */
export const FORBIDDEN_SETTINGS_KEYS = ['appSecret', ...HOST_ONLY_BOT_KEYS] as const
export type ForbiddenSettingsKey = (typeof FORBIDDEN_SETTINGS_KEYS)[number]

const FORBIDDEN_ROOT_KEYS = FORBIDDEN_SETTINGS_KEYS

/**
 * Whether the browser settings GUI may be used at all (Codex batch-3 B2).
 *
 * `safe: false` means a host-only key or a stale secret is still reachable
 * through the settings descriptor the browser receives, so the GUI fails
 * closed: it shows the reason and refuses to edit. The BRIDGE is never
 * blocked by this — a dirty user layer degrades the GUI, not the channel.
 */
export interface SettingsGuiState {
  safe: boolean
  reason?: 'purge_failed' | 'read_only_dirty' | 'user_layer_dirty'
}

/**
 * A DYNAMIC gate (Codex batch-4 MAJOR-2). The GUI safety verdict used to be
 * computed once at startup and cached in two services, so an admin who
 * cleaned `cordis.patch.yml` / the settings file stayed locked out until the
 * next restart, and onboarding — which never saw the cached value — wrote
 * straight past the gate. Every editor-snapshot, every `settings/gui-state`
 * read and every mutating RPC (admin AND onboarding start/commit) calls this
 * instead; the implementation re-scans the live settings descriptor, which is
 * an in-memory read.
 */
export type SettingsGuard = () => SettingsGuiState

export const flatSchema: Schema<FlatSettings> = Schema.object({
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default('DSH_FEISHU_APP_SECRET'),
  brand: Schema.union(['feishu', 'lark', 'larkoffice'] as const).default('feishu'),
  // Host-only provenance bit. It never carries a secret and is deliberately
  // omitted from the hand-edited field list in src/client.js.
  onboardingManaged: Schema.boolean().default(false),
  // Retired user-allowlist fields stay hidden in the schema only so settings
  // written by older versions can be loaded and migrated without an error.
  allowedOpenIds: Schema.string().default('').hidden().deprecated(),
  allowedChatIds: Schema.string().default(''),
  allowAllUsers: Schema.boolean().default(true).hidden().deprecated(),
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
  // NOTE (docs/15 F-09, docs/17 §10.2, Codex batch-2 B1): statePath,
  // inboundDir and feishuCliPath are deliberately NOT in the GUI schema —
  // neither at the root NOR inside `bots[]` — AND not in `FlatSettings`, so
  // `flatten()` never puts them into the registration `base` either. The
  // settings schema resolves non-strictly, so anything that reaches the flat
  // value also reaches the browser through the standard settings descriptor;
  // the only safe place for a host-only key is outside this shape. Values
  // configured in cordis.patch.yml still reach the bridge: `unflatten()`
  // re-overlays them from the raw entry `Config` (see tests/settings.spec.ts).
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
    // statePath / inboundDir / feishuCliPath: see the NOTE above — host-only,
    // never in the GUI schema and never in FlatSettings.
    allowedOpenIds: Schema.array(Schema.string()).default([]).hidden().deprecated(),
    allowedChatIds: Schema.array(Schema.string()).default([]),
    allowAllUsers: Schema.boolean().default(true).hidden().deprecated(),
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
    // statePath / inboundDir / feishuCliPath are deliberately absent: they are
    // host-only and would otherwise ride the registration `base` to the browser.
    allowedOpenIds: [],
    allowedChatIds: [...(bot.allowedChatIds ?? [])],
    allowAllUsers: true,
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
    allowedOpenIds: '',
    allowedChatIds: (config.allowedChatIds ?? []).join(', '),
    allowAllUsers: true,
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

type HostOnlyBotFields = Partial<Pick<BotConfig, HostOnlyBotKey>>

/** Non-empty host-only fields of one trusted-admin config node. */
function hostOnlyFields(source: HostOnlyBotFields): HostOnlyBotFields {
  const picked: Record<string, string> = {}
  for (const key of HOST_ONLY_BOT_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') picked[key] = value
  }
  return picked as HostOnlyBotFields
}

/** One settings bot as far as the legacy-continuation lookup is concerned. */
interface BotIdentityLike {
  id?: unknown
  appId?: unknown
  sessionNamespace?: unknown
}

/** A node that may carry the root Feishu app identity (flat value or user layer). */
interface RootIdentityLike {
  appId?: unknown
}

/**
 * The app identity the ROOT host-only paths belong to (Codex audit, root
 * attribution #2). The settings value is authoritative for `appId` —
 * `unflatten()` projects `value.appId`, not `entry.appId` — so a rebound
 * install whose entry still names the OLD app must not lend the retained root
 * path back to that obsolete app. The entry value is only the fallback for
 * callers that see a partial user layer (the purge planner).
 */
function effectiveRootAppId(root: RootIdentityLike | undefined, entry: Config): string {
  const fromValue = typeof root?.appId === 'string' ? root.appId.trim() : ''
  return fromValue !== '' ? fromValue : (entry.appId ?? '').trim()
}

function indicesWhere(bots: readonly BotIdentityLike[], match: (bot: BotIdentityLike) => boolean): number[] {
  const found: number[] = []
  bots.forEach((bot, index) => { if (match(bot)) found.push(index) })
  return found
}

/**
 * Index of the ONE settings bot that continues the legacy (root-level)
 * identity, or -1.
 *
 * A config converted to multi-bot in the GUI lends its ROOT host-only paths to
 * exactly one bot, in this order (Codex audit, root attribution #1/#2):
 *   1. the bot stamped `sessionNamespace: 'legacy'` (what
 *      `settings/convert-legacy` writes) when exactly one carries the marker.
 *      This holds REGARDLESS of `entry.bots`: once the entry has been rewritten
 *      to multi-bot shape the marked bot is still the same Feishu app, and the
 *      retained user-layer root path may be the only copy of its state file
 *      location that exists;
 *   2. failing that, the bot carrying the EFFECTIVE root appId (see
 *      {@link effectiveRootAppId}) — never the stale entry app when the
 *      settings value has moved on;
 *   3. failing that, nobody. Ambiguity (two legacy markers, two bots on the
 *      same appId — both rejected by `validateMultiBotConfig`) also lends to
 *      nobody rather than to a guess.
 *
 * Shared by the runtime projection and the purge planner so the two can never
 * disagree about who owns a root path.
 */
function legacyContinuationIndex(
  bots: readonly BotIdentityLike[],
  entry: Config,
  root?: RootIdentityLike,
): number {
  const marked = indicesWhere(bots, bot => bot.sessionNamespace === 'legacy')
  if (marked.length > 0) return marked.length === 1 ? marked[0]! : -1
  const rootAppId = effectiveRootAppId(root, entry)
  if (rootAppId === '') return -1
  const matched = indicesWhere(bots, bot => typeof bot.appId === 'string' && bot.appId.trim() === rootAppId)
  return matched.length === 1 ? matched[0]! : -1
}

/**
 * Re-attach the host-only per-bot keys the settings layer never carries.
 *
 * `id` is the immutable identity of a bot, so a `bots[]` entry declared in
 * cordis.patch.yml lends its host-only paths to the settings bot with the
 * SAME id; a legacy-shaped entry lends its ROOT paths to the legacy
 * continuation bot (see {@link legacyContinuationIndex}).
 *
 * Precedence per key, highest first (Codex batch-4 BLOCKER-2):
 *   1. the entry `bots[]` entry with the same id — trusted admin YAML;
 *   2. the entry ROOT value, for the legacy continuation bot only;
 *   3. the RETAINED user-layer value on that bot;
 *   4. the RETAINED user-layer ROOT value, again for the continuation bot.
 *
 * 3 and 4 exist because {@link settingsPurgePlan} deliberately does not delete
 * a user-layer path the entry knows nothing about: it is the only copy of
 * that bot's on-disk state location. The settings layer is still never
 * AUTHORITATIVE — any value the entry provides wins — and the GUI stays
 * fail-closed for as long as such a value is there, so no browser write can
 * introduce one.
 */
function overlayHostOnlyBots(
  bots: FlatSettings['bots'],
  entry: Config,
  root: Partial<FlatSettings>,
): BotConfig[] {
  const entryBots = new Map((entry.bots ?? []).map(bot => [bot.id, bot]))
  // A multi-bot ENTRY declares each bot's paths itself, so its root paths are
  // inert. The RETAINED user-layer root is different: it may be the only copy
  // of the continuation bot's state location, so it is lent whatever shape the
  // entry has now (Codex audit, root attribution #1).
  const legacyEntryRoot = entryBots.size === 0 ? hostOnlyFields(entry) : {}
  const legacyUserRoot = hostOnlyFields(root as HostOnlyBotFields)
  const legacyIndex = legacyContinuationIndex(bots, entry, root)
  return bots.map((bot, index) => {
    const carried = structuredClone(bot) as Record<string, unknown>
    // Canonicalize retired user-access fields during every settings → config
    // projection. Runtime does not consume them, and a future write should
    // never resurrect the old fail-closed meaning.
    carried.allowedOpenIds = []
    carried.allowAllUsers = true
    // What a stale user layer still carries — kept only as the LAST fallback.
    const retainedBot = hostOnlyFields(carried as HostOnlyBotFields)
    for (const key of FORBIDDEN_ROOT_KEYS) delete carried[key]
    const declared = entryBots.get(bot.id)
    const overlay = declared !== undefined
      ? hostOnlyFields(declared)
      : index === legacyIndex ? legacyEntryRoot : {}
    const retained = index === legacyIndex
      ? { ...legacyUserRoot, ...retainedBot }
      : retainedBot
    return { ...carried, ...retained, ...overlay } as unknown as BotConfig
  })
}

export type SettingsPurgeOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

export interface SettingsPurgePlan {
  /** Ops that remove what is safe to remove. Empty = nothing to write. */
  ops: SettingsPurgeOp[]
  /**
   * Host-only values the purge deliberately did NOT delete because the
   * trusted entry config does not carry them (audit M1). Deleting these would
   * silently move a pre-f774159 install's state file or inbox: the operator
   * has to copy them into cordis.patch.yml first. Until then `unflatten()`
   * keeps projecting them onto the runtime config (batch-4 BLOCKER-2) and the
   * GUI stays fail-closed.
   */
  retained: Array<{ scope: string; key: HostOnlyBotKey; }>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Decide, for ONE host-only key on one node, whether purging it is lossless.
 *
 * Lossless when the user layer holds nothing meaningful, or when the trusted
 * entry config provides a value for that key AT ALL (Codex batch-4 MAJOR-1).
 * The entry is authoritative: `unflatten()` overlays the entry value over the
 * user one, so a DIFFERING user value is already dead weight — keeping it
 * only locked the GUI forever after the ordinary "admin moved the path in
 * cordis.patch.yml" edit. A value is retained only when the entry knows
 * nothing about that key, where it really is the only copy that exists.
 */
function purgeIsLossless(userValue: unknown, entryValue: string | undefined): boolean {
  if (!nonEmptyString(userValue)) return true
  return nonEmptyString(entryValue)
}

/**
 * Plan the purge of keys an older build wrote into the settings USER layer:
 * the secret value and the host-only paths, at the root and inside every
 * `bots[]` entry. Empty ops when there is nothing to purge — the caller must
 * not spend a revision bump on a no-op write.
 *
 * This matters beyond hygiene: the standard settings descriptor ships the raw
 * `user` section and the resolved `value` to the browser, and the flat schema
 * resolves non-strictly, so an undeclared leftover key would survive both.
 *
 * `appSecret` is always removed (the credential provider is the only secret
 * source). A host-only PATH is removed only when it is redundant with the
 * entry config — see {@link purgeIsLossless} and `retained`.
 */
export function settingsPurgePlan(user: unknown, entry: Config = {}): SettingsPurgePlan {
  const plan: SettingsPurgePlan = { ops: [], retained: [] }
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return plan
  const section = user as Record<string, unknown>
  const entryBots = new Map((entry.bots ?? []).map(bot => [bot.id, bot]))

  if (Object.hasOwn(section, 'appSecret')) plan.ops.push({ op: 'unset', path: ['appSecret'] })
  for (const key of HOST_ONLY_BOT_KEYS) {
    if (!Object.hasOwn(section, key)) continue
    if (purgeIsLossless(section[key], entry[key])) plan.ops.push({ op: 'unset', path: [key] })
    else plan.retained.push({ scope: 'root', key })
  }

  const bots = section.bots
  if (!Array.isArray(bots)) return plan
  // A legacy entry (no bots[]) lends its ROOT host-only paths to exactly ONE
  // settings bot, exactly as overlayHostOnlyBots() does — lending them to
  // every bot would purge a path the runtime projection then fails to restore.
  const identities: BotIdentityLike[] = bots.map(bot => (
    typeof bot === 'object' && bot !== null && !Array.isArray(bot) ? bot as BotIdentityLike : {}
  ))
  const legacyIndex = legacyContinuationIndex(identities, entry, section)
  const entryRoot: HostOnlyBotFields = entryBots.size === 0 ? entry : {}
  let dirty = false
  const cleaned = bots.map((bot, index) => {
    if (typeof bot !== 'object' || bot === null || Array.isArray(bot)) return bot
    const value = bot as Record<string, unknown>
    const id = typeof value.id === 'string' ? value.id : ''
    const declared = entryBots.get(id) ?? (index === legacyIndex ? entryRoot : {})
    const kept: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === 'appSecret') {
        dirty = true
        continue
      }
      if ((HOST_ONLY_BOT_KEYS as readonly string[]).includes(key)) {
        const hostKey = key as HostOnlyBotKey
        if (purgeIsLossless(item, declared[hostKey])) {
          dirty = true
          continue
        }
        plan.retained.push({ scope: `bots.${id || '?'}`, key: hostKey })
      }
      kept[key] = item
    }
    return kept
  })
  if (dirty) plan.ops.push({ op: 'set', path: ['bots'], value: cleaned })
  return plan
}

/**
 * Every forbidden key name still reachable in one settings layer (`base`,
 * `value` or `user`), at any depth. The GUI fail-closed check (Codex batch-3
 * B2) re-reads the descriptor through this after the purge: an ACK is not
 * proof, only a clean descriptor is.
 */
export function findForbiddenSettingsKeys(layer: unknown): string[] {
  const found = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((FORBIDDEN_SETTINGS_KEYS as readonly string[]).includes(key)) found.add(key)
      visit(value)
    }
  }
  visit(layer)
  return [...found].sort()
}

/**
 * Flat user layer + patch.yml entry → the nested bridge config. The secret
 * value never comes from settings: `appSecret` keeps the entry/env value and
 * `appSecretRef` is the only credential field the card can edit. The host-only
 * per-bot paths are likewise re-attached from `entry`, never from the flat value.
 */
export function unflatten(flat: Partial<FlatSettings> | undefined, entry: Config): Config {
  const value = flat ?? {}
  // Root host-only paths: the entry wins key by key, a RETAINED user-layer
  // value fills the gap (Codex batch-4 BLOCKER-2). Spreading `entry` alone
  // would drop the retained value of a legacy install the entry never
  // declared, moving its state file to the default location.
  const rootHostOnly: HostOnlyBotFields = {
    ...hostOnlyFields(value as HostOnlyBotFields),
    ...hostOnlyFields(entry),
  }
  return {
    ...entry,
    ...rootHostOnly,
    // A successful QR bind moves the secret source to the credential provider.
    // Do not let a legacy inline patch secret shadow that newly selected ref.
    appSecret: value.onboardingManaged === true ? '' : entry.appSecret,
    appId: value.appId ?? '',
    appSecretRef: value.appSecretRef?.trim() || 'DSH_FEISHU_APP_SECRET',
    brand: value.brand ?? 'feishu',
    allowedOpenIds: [],
    allowedChatIds: splitIds(value.allowedChatIds),
    allowAllUsers: true,
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
    bots: overlayHostOnlyBots(value.bots ?? [], entry, value),
  }
}
