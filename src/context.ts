/**
 * Feishu context backfill (docs/13): fetch thread/chat history through the
 * official `lark-cli` (primary) or the bundled node-sdk (fallback), apply the
 * positional causal-cutoff + incremental-window semantics (F6), and render an
 * untrusted JSON-framed transcript block for prepending to the user message
 * (F2/F8).
 *
 * Implementation review (docs/15) drove these key corrections:
 * - CLI `create_time` is LOCAL MINUTE precision (`2006-01-02 15:04`), so the
 *   window is sliced POSITIONALLY against the descending result order, never
 *   by wall-clock comparison (F-01).
 * - Budgets count only RENDERABLE messages; a single oversized newest line is
 *   force-truncated instead of dropped so the watermark always advances
 *   (F-02/F-03).
 * - `meta.pagination.complete` is validated strictly (F-04); thread roots are
 *   back-filled via `+messages-mget` / `im.v1.message.get` (F-05).
 * - CLI resolution goes through `createRequire` (pnpm layouts), `auto` mode
 *   downgrades to the SDK at runtime on CLI failure, and the child process is
 *   spawned with a KILL handle + minimal whitelisted env (F-06/F-07/F-09).
 * - The fetch gate rejects waiters when the circuit opens (F-10); SDK pages
 *   race against timeout/lifetime signals (F-07); post content unwraps locale
 *   wrappers like `{zh_cn:{...}}` (F-11).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LarkMessageListParams, LarkMessageListResult, ResolvedConfig } from './types.js'
import type { TurnContextStats } from './types.js'
import { bounded, redactSecrets } from './security.js'

export type ContextBackendKind = 'cli' | 'sdk'

export interface ContextWatermark {
  messageId: string
  createdAtMs: number
}

export interface ContextMessage {
  messageId: string
  senderName: string
  senderId: string
  /** OUR bot, identified ONLY by open_bot_id alignment (docs/13 F7/F-08). */
  isOwnBot: boolean
  /** Any app sender (other bots keep their real names). */
  isBotApp: boolean
  msgType: string
  deleted: boolean
  text: string
  createdAtMs: number
}

export interface FetchSpec {
  origin: 'p2p' | 'thread'
  chatId: string
  threadId?: string
  /** Thread root message id — back-filled via mget/get when absent (docs/13 F3/F-05). */
  rootMessageId?: string
  triggerMessageId: string
  triggerCreatedAtMs: number
  watermark?: ContextWatermark
  maxMessages: number
  maxChars: number
  timeoutMs: number
  botOpenId?: string
  /** Bridge lifetime signal: aborts fetches on teardown (docs/13 F5/F-07). */
  signal?: AbortSignal
}

export interface FeishuContextProvider {
  readonly kind: ContextBackendKind
  fetchHistory(spec: FetchSpec): Promise<ContextMessage[]>
}

export interface ContextInjection {
  /** JSON-framed transcript block (stringified); undefined = nothing to inject. */
  block?: string
  stats?: TurnContextStats
  /** Watermark to persist after a successful injection (last injected message). */
  watermark?: ContextWatermark
}

export interface RenderedLine {
  messageId: string
  createdAtMs: number
  time: string
  name: string
  shortId: string
  text: string
}

/** Fixed first-version constants (docs/13 §4: not configurable). */
export const CONTEXT_MAX_CONCURRENCY = 2
export const CONTEXT_CIRCUIT_FAILURES = 3
export const CONTEXT_CIRCUIT_COOLDOWN_MS = 5 * 60_000
export const CLI_MAX_BUFFER = 16 * 1024 * 1024
export const CLI_PAGE_SIZE = 50
export const CLI_STDERR_CAP = 32 * 1024
export const SDK_MAX_PAGES = 64
export const CONTEXT_FRAME_TYPE = 'feishu-context'

interface Logger {
  warn?: (message: string, ...args: unknown[]) => void
  info?: (message: string, ...args: unknown[]) => void
  error?: (message: string, ...args: unknown[]) => void
}

// ---------------------------------------------------------------- exec gate

/** Circuit-open error: distinct so callers can avoid logging it as a fetch failure. */
export class CircuitOpenError extends Error {
  constructor() {
    super('上下文拉取已熔断')
    this.name = 'CircuitOpenError'
  }
}

/** Global concurrency + circuit breaker for context fetches (docs/13 F1/F11/F-10). */
export class ContextFetchGate {
  private active = 0
  private readonly waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private consecutiveFailures = 0
  private circuitOpenUntil = 0

  /** Injectable clock (tests fake the cooldown; production = Date.now). */
  constructor(private readonly now: () => number = Date.now) {}

  isOpen(now?: number): boolean {
    return (now ?? this.now()) < this.circuitOpenUntil
  }

  circuitOpenedAt(now?: number): number | undefined {
    const at = now ?? this.now()
    return this.circuitOpenUntil > at ? this.circuitOpenUntil : undefined
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    // Admission: check BEFORE queueing AND after acquiring a slot — waiters
    // queued before the circuit opened must not execute (docs/15 F-10).
    if (this.isOpen()) throw new CircuitOpenError()
    await this.acquire()
    if (this.isOpen()) {
      this.release()
      throw new CircuitOpenError()
    }
    try {
      const result = await work()
      this.consecutiveFailures = 0
      return result
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error
      this.consecutiveFailures += 1
      if (this.consecutiveFailures >= CONTEXT_CIRCUIT_FAILURES) this.openCircuit()
      throw error
    } finally {
      this.release()
    }
  }

  private openCircuit(): void {
    this.circuitOpenUntil = this.now() + CONTEXT_CIRCUIT_COOLDOWN_MS
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) waiter.reject(new CircuitOpenError())
  }

  private acquire(): Promise<void> {
    if (this.active < CONTEXT_MAX_CONCURRENCY) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next !== undefined) next.resolve()
    else this.active -= 1
  }
}

// ---------------------------------------------------------------- spawn CLI

/** Env whitelist + the three CLI variables (docs/13 F-09: minimal env, no process.env spread). */
const ENV_WHITELIST = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL', 'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY']

function cliEnv(base: NodeJS.ProcessEnv, appId: string, appSecret: string, extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_WHITELIST) {
    const value = base[key]
    if (value !== undefined) env[key] = value
  }
  env.LARKSUITE_CLI_APP_ID = appId
  env.LARKSUITE_CLI_APP_SECRET = appSecret
  env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER = '1'
  env.LARKSUITE_CLI_NO_SKILLS_NOTIFIER = '1'
  // Test seam: extra is appended LAST and never rides into production callers.
  if (extra !== undefined) Object.assign(env, extra)
  return env
}

function spawnCli(
  argv: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBytes: number; signal?: AbortSignal; stdin?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = argv[0]
    if (file === undefined) {
      reject(new Error('dsh-feishu-remote: lark-cli 解析结果无效（空 argv）'))
      return
    }
    const child = spawn(file, argv.slice(1), { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error('dsh-feishu-remote: lark-cli 拉取超时')))
    }, options.timeoutMs)
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(() => reject(new Error('dsh-feishu-remote: 插件已停止，lark-cli 拉取中止')))
    }
    const finish = (done: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      done()
    }
    if (options.stdin !== undefined) {
      child.stdin.on('error', () => undefined) // EPIPE on early exit: the process's exit code decides
      child.stdin.write(options.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (Buffer.byteLength(stdout, 'utf8') > options.maxBytes) {
        child.kill('SIGKILL')
        finish(() => reject(new Error('dsh-feishu-remote: lark-cli 输出超过 maxBuffer 上限')))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stderr, 'utf8') > CLI_STDERR_CAP) stderr = stderr.slice(-CLI_STDERR_CAP)
    })
    child.on('error', error => {
      finish(() => reject(new Error(`dsh-feishu-remote: lark-cli 启动失败（ENOENT/损坏 → 自动降级 SDK）：${error.message}`)))
    })
    child.on('close', code => {
      finish(() => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`dsh-feishu-remote: lark-cli 退出码 ${code}：${redactSecrets(bounded(stderr, 300))}`))
      })
    })
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------- CLI resolution

export interface CliExecutable {
  argv: string[]
  via: 'configured' | 'wrapper' | 'native' | 'path'
}

/** Locate the plugin's own module directory (lib/ or src/ → repo root). */
export function pluginRoot(moduleUrl: string): string {
  return dirname(dirname(fileURLToPath(moduleUrl)))
}

/**
 * Resolution order (docs/13 §3.2 + docs/15 F-06): configured path/env →
 * node-resolver wrapper (createRequire works across pnpm layouts, and run.js
 * auto-downloads a missing binary) → node-resolver native → plugin-root direct
 * path → PATH scan. Returns undefined when nothing is available.
 */
export function resolveCliExecutable(
  config: Pick<ResolvedConfig, 'feishuCliPath'>,
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): CliExecutable | undefined {
  const configured = (config.feishuCliPath || env.DSH_FEISHU_CLI_PATH || '').trim()
  if (configured !== '') return { argv: [configured], via: 'configured' }
  const binName = `lark-cli${process.platform === 'win32' ? '.exe' : ''}`
  // 1) Node's own resolution: correct for repo dev AND registry/profile
  //    installs where @larksuite/cli lives in the consumer's virtual store.
  try {
    const nodeRequire = createRequire(moduleUrl)
    const packagePath = nodeRequire.resolve('@larksuite/cli/package.json')
    const packageDir = dirname(packagePath)
    const wrapper = join(packageDir, 'scripts', 'run.js')
    if (existsSync(wrapper)) return { argv: [process.execPath, wrapper], via: 'wrapper' }
    const native = join(packageDir, 'bin', binName)
    if (existsSync(native)) return { argv: [native], via: 'native' }
  } catch {
    // package not resolvable — fall through to the direct path
  }
  // 2) Direct path under the plugin root (source checkout layout).
  const cliDir = join(pluginRoot(moduleUrl), 'node_modules', '@larksuite', 'cli')
  const directWrapper = join(cliDir, 'scripts', 'run.js')
  if (existsSync(directWrapper)) return { argv: [process.execPath, directWrapper], via: 'wrapper' }
  const directNative = join(cliDir, 'bin', binName)
  if (existsSync(directNative)) return { argv: [directNative], via: 'native' }
  // 3) PATH scan.
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, binName)
    if (existsSync(candidate)) return { argv: [candidate], via: 'path' }
  }
  return undefined
}

// ---------------------------------------------------------------- CLI bootstrap

export interface CliBootstrapOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark' | 'larkoffice'
  timeoutMs: number
  /** Test seam only (docs/15 F-09): merged into the child env, never production. */
  env?: NodeJS.ProcessEnv
  logger?: Logger
}

/**
 * One-time lark-cli configuration bootstrap (docs/15 §集成缺口): v1.0.88 only
 * mints bot tokens from LOCAL config (`config.json` with a plain/file/keychain
 * secret ref) — env credentials alone fail with `token_missing` (verified on
 * a real tenant, 2026-08-20). Probe `config show`; when our appId is not the
 * configured one, run `config init --app-id … --app-secret-stdin` (secret via
 * stdin, never argv/env exposure beyond the CLI's own storage) and re-probe.
 * Any failure returns false — the caller taints the CLI and falls back to SDK.
 */
export async function ensureCliConfigured(
  executable: CliExecutable,
  options: CliBootstrapOptions,
): Promise<boolean> {
  const env = cliEnv(process.env, options.appId, options.appSecret, options.env)
  const spawn = (args: string[], stdin?: string) => spawnCli([...executable.argv, ...args], {
    env,
    timeoutMs: options.timeoutMs,
    maxBytes: 64 * 1024,
    ...(stdin === undefined ? {} : { stdin }),
  })
  const probe = async (): Promise<string | undefined> => {
    const stdout = await spawn(['config', 'show'])
    try {
      const parsed = JSON.parse(stdout) as { appId?: unknown; ok?: unknown; error?: { subtype?: unknown } }
      if (typeof parsed.appId === 'string') return parsed.appId
      if (parsed.ok === false && (parsed.error as { subtype?: unknown })?.subtype === 'not_configured') return undefined
    } catch {
      // unparseable probe output → treat as not configured below
    }
    throw new Error(`config show 输出无法识别：${bounded(stdout.trim(), 200)}`)
  }
  try {
    const configured = await probe()
    if (configured === options.appId) return true
    if (configured !== undefined) {
      options.logger?.warn?.(
        'dsh-feishu-remote: lark-cli 已配置其他应用（%s），将重新初始化为当前应用 %s',
        configured, options.appId,
      )
    }
  } catch (error) {
    options.logger?.warn?.('dsh-feishu-remote: lark-cli 配置探测失败，尝试自动初始化：%s', error instanceof Error ? error.message : String(error))
  }
  try {
    await spawn([
      'config', 'init', '--app-id', options.appId, '--app-secret-stdin', '--brand',
      options.brand === 'feishu' ? 'feishu' : 'lark',
    ], options.appSecret)
    const configured = await probe()
    return configured === options.appId
  } catch (error) {
    options.logger?.warn?.(
      'dsh-feishu-remote: lark-cli 自动配置失败（自动降级 SDK）：%s',
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

// ---------------------------------------------------------------- normalization

/** Placeholders for non-text message types (docs/13 §3.3); identical for both backends. */
const TYPE_PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  file: '[文件]',
  audio: '[语音]',
  video: '[视频]',
  media: '[媒体]',
  sticker: '[表情]',
  interactive: '[卡片消息]',
  share_chat: '[聊天记录]',
  share_user: '[名片分享]',
  merge_forward: '[合并转发]',
  system: '',
  deleted: '',
}

function textFor(msgType: string, content: unknown): string {
  if (msgType === 'system' || msgType === 'deleted') return ''
  const placeholder = TYPE_PLACEHOLDERS[msgType]
  if (placeholder !== undefined) return placeholder
  return typeof content === 'string' ? content : ''
}

export function isRenderable(item: ContextMessage): boolean {
  return !item.deleted && item.msgType !== 'system' && item.text !== ''
}

/** Parse the CLI's local "YYYY-MM-DD HH:mm" (docs/13 §1.1 + docs/15 F-01: MINUTE precision). */
function parseCliTime(value: unknown, what: string): number {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-feishu-remote: CLI 消息缺少有效 create_time（${what}）`)
  }
  const parsed = Date.parse(`${value.trim().replace(' ', 'T')}:00`)
  if (!Number.isFinite(parsed)) {
    throw new Error(`dsh-feishu-remote: CLI create_time 无法解析（${what}）：${value}`)
  }
  return parsed
}

function parseSdkTime(value: unknown, what: string): number {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-feishu-remote: SDK 消息缺少有效 create_time（${what}）`)
  }
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`dsh-feishu-remote: SDK create_time 无法解析（${what}）：${value}`)
  }
  return parsed
}

interface RawSender {
  id?: unknown
  name?: unknown
  sender_name?: unknown
  sender_type?: unknown
  open_bot_id?: unknown
}

/**
 * Sender classification (docs/13 F7 + docs/15 F-08): OUR bot ONLY via
 * open_bot_id alignment; other apps are bots but keep their real names.
 */
function senderOf(raw: RawSender | undefined, botOpenId: string | undefined): { id: string; name: string; isOwnBot: boolean; isBotApp: boolean } {
  const id = typeof raw?.id === 'string' ? raw.id : ''
  const rawName = typeof raw?.name === 'string' && raw.name.trim() !== '' ? raw.name : raw?.sender_name
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : ''
  const isOwnBot = botOpenId !== undefined && botOpenId !== '' && raw?.open_bot_id === botOpenId
  const isBotApp = raw?.sender_type === 'app'
  return { id, name, isOwnBot, isBotApp }
}

/** Recursively collect text from SDK post content; unwraps locale wrappers like {zh_cn:{...}} (docs/15 F-11). */
const LOCALE_KEY = /^(zh_cn|en_us|ja_jp|zh_hk|zh_tw|ko_kr)$/iu

function extractPostText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) extractPostText(item, out)
  } else if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    let consumed = false
    for (const [key, item] of entries) {
      if (key === 'text' || key === 'content' || key === 'title' || key === 'elements') {
        extractPostText(item, out)
        consumed = true
      } else if (LOCALE_KEY.test(key) && typeof item === 'object' && item !== null) {
        extractPostText(item, out)
        consumed = true
      }
    }
    if (!consumed && entries.length === 1) extractPostText(entries[0]![1], out)
  }
  return out
}

function normalizeSdkItem(item: Record<string, unknown>, index: number, botOpenId: string | undefined): ContextMessage {
  const messageId = item.message_id
  const msgType = item.msg_type
  if (typeof messageId !== 'string' || messageId === '' || typeof msgType !== 'string') {
    throw new Error(`dsh-feishu-remote: SDK 消息字段缺失（第 ${index} 条）`)
  }
  const sender = senderOf(item.sender as RawSender | undefined, botOpenId)
  let content = ''
  const bodyContent = (item.body as { content?: unknown } | undefined)?.content
  if (typeof bodyContent === 'string' && bodyContent !== '') {
    try {
      const parsed = JSON.parse(bodyContent) as unknown
      if (msgType === 'text' && typeof parsed === 'object' && parsed !== null) {
        const text = (parsed as { text?: unknown }).text
        content = typeof text === 'string' ? text : ''
      } else if (msgType === 'post') {
        content = extractPostText(parsed).join(' ')
      } else {
        content = typeof parsed === 'string' ? parsed : ''
      }
    } catch {
      content = ''
    }
  }
  return {
    messageId,
    senderName: sender.name,
    senderId: sender.id,
    isOwnBot: sender.isOwnBot,
    isBotApp: sender.isBotApp,
    msgType,
    deleted: item.deleted === true,
    text: textFor(msgType, content),
    createdAtMs: parseSdkTime(item.create_time, `#${messageId}`),
  }
}

function normalizeCliItem(item: Record<string, unknown>, index: number, botOpenId: string | undefined): ContextMessage {
  const messageId = item.message_id
  const msgType = item.msg_type
  if (typeof messageId !== 'string' || messageId === '' || typeof msgType !== 'string') {
    throw new Error(`dsh-feishu-remote: lark-cli 消息字段缺失（第 ${index} 条）`)
  }
  const sender = senderOf(item.sender as RawSender | undefined, botOpenId)
  return {
    messageId,
    senderName: sender.name,
    senderId: sender.id,
    isOwnBot: sender.isOwnBot,
    isBotApp: sender.isBotApp,
    msgType,
    deleted: item.deleted === true,
    text: textFor(msgType, item.content),
    createdAtMs: parseCliTime(item.create_time, `#${messageId}`),
  }
}

function strictEnvelope(stdout: string, dataField: 'messages'): { messages: unknown[]; complete: boolean } {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch {
    throw new Error('dsh-feishu-remote: lark-cli 输出不是合法 JSON（版本漂移或输出被截断）')
  }
  const record = envelope as { ok?: unknown; error?: unknown; data?: Record<string, unknown>; meta?: { pagination?: { complete?: unknown } } }
  if (record.ok !== true) {
    const detail = redactSecrets(
      typeof record.error === 'object' && record.error !== null
        ? String((record.error as { message?: unknown }).message ?? '')
        : '',
    )
    throw new Error(`dsh-feishu-remote: lark-cli 调用失败（ok != true）：${detail}`)
  }
  const messages = record.data?.[dataField]
  if (!Array.isArray(messages)) {
    throw new Error(`dsh-feishu-remote: lark-cli 响应缺少 data.${dataField}（schema 漂移）`)
  }
  // docs/13 §3.2 + docs/15 F-04: `meta.pagination.complete` is REQUIRED.
  const complete = record.meta?.pagination?.complete
  if (typeof complete !== 'boolean') {
    throw new Error('dsh-feishu-remote: lark-cli 响应缺少 meta.pagination.complete（schema 漂移）')
  }
  return { messages, complete }
}

// ---------------------------------------------------------------- providers

/** Primary backend: the official Feishu CLI, driven headlessly via minimal env credentials. */
export class LarkCliProvider implements FeishuContextProvider {
  readonly kind = 'cli' as const
  private readonly executable: CliExecutable | undefined

  constructor(
    private readonly config: Pick<ResolvedConfig, 'appId' | 'appSecret' | 'feishuCliPath'>,
    options: {
      executable?: CliExecutable
      env?: NodeJS.ProcessEnv
      moduleUrl?: string
      logger?: Logger
    } = {},
  ) {
    this.executable = options.executable ?? resolveCliExecutable(config, options.env ?? process.env, options.moduleUrl ?? import.meta.url)
    // Production: `process.env` (whitelisted) only. Tests inject fixture vars
    // through options.env, merged unwhitelisted into the child env.
    this.baseEnv = process.env
    this.extraEnv = options.env
    this.logger = options.logger
  }

  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly extraEnv: NodeJS.ProcessEnv | undefined
  private readonly logger?: Logger

  async fetchHistory(spec: FetchSpec): Promise<ContextMessage[]> {
    const executable = this.executable
    if (executable === undefined) {
      throw new Error('dsh-feishu-remote: lark-cli 未安装（node_modules/@larksuite/cli、PATH、feishuCliPath 均未找到）')
    }
    const target = spec.maxMessages + 1
    const pageLimit = Math.max(1, Math.ceil(target / CLI_PAGE_SIZE))
    const listArgs = spec.origin === 'thread'
      ? ['im', '+threads-messages-list', '--thread', spec.threadId ?? '', '--order', 'desc', '--page-size', String(CLI_PAGE_SIZE), '--page-all', '--page-limit', String(pageLimit), '--no-reactions', '--as', 'bot', '--format', 'json']
      : ['im', '+chat-messages-list', '--chat-id', spec.chatId, '--order', 'desc', '--page-size', String(CLI_PAGE_SIZE), '--page-all', '--page-limit', String(pageLimit), '--no-reactions', '--as', 'bot', '--format', 'json']
    const env = cliEnv(this.baseEnv, this.config.appId, this.config.appSecret, this.extraEnv)
    const stdout = await spawnCli([...executable.argv, ...listArgs], { env, timeoutMs: spec.timeoutMs, maxBytes: CLI_MAX_BUFFER, signal: spec.signal })
    const { messages: rawMessages, complete } = strictEnvelope(stdout, 'messages')
    if (!complete) {
      this.logger?.warn?.('dsh-feishu-remote: 上下文拉取被 page-limit 截断（未耗尽历史）')
    }
    // Strict adapter: any malformed entry aborts the whole injection (fail-open).
    const messages = rawMessages.map((item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error(`dsh-feishu-remote: lark-cli 消息条目无效（第 ${index} 条）`)
      }
      return normalizeCliItem(item as Record<string, unknown>, index, spec.botOpenId)
    })
    // docs/13 F3 + docs/15 F-05: back-fill the thread root when the thread
    // container did not include it (fail-open on mget errors).
    if (spec.origin === 'thread' && spec.rootMessageId !== undefined && spec.rootMessageId !== ''
      && !messages.some(item => item.messageId === spec.rootMessageId)) {
      try {
        const mgetStdout = await spawnCli([
          ...executable.argv,
          'im', '+messages-mget', '--message-ids', spec.rootMessageId, '--no-reactions', '--as', 'bot', '--format', 'json',
        ], { env, timeoutMs: spec.timeoutMs, maxBytes: CLI_MAX_BUFFER, signal: spec.signal })
        const mget = strictEnvelope(mgetStdout, 'messages')
        if (mget.messages.length > 0) {
          const root = normalizeCliItem(mget.messages[0] as Record<string, unknown>, 0, spec.botOpenId)
          messages.push(root) // root is the OLDEST: append at the desc tail
        }
      } catch (error) {
        this.logger?.warn?.('dsh-feishu-remote: 话题根消息补取失败（fail-open）：%s', error instanceof Error ? error.message : String(error))
      }
    }
    return messages
  }
}

/** Fallback backend: pages through the channel seam; races timeout/lifetime (docs/13 F1 + docs/15 F-07). */
export class SdkProvider implements FeishuContextProvider {
  readonly kind = 'sdk' as const

  constructor(
    private readonly listMessages: (params: LarkMessageListParams) => Promise<LarkMessageListResult>,
    private readonly getMessage?: (messageId: string) => Promise<Record<string, unknown> | undefined>,
    private readonly logger?: Logger,
  ) {}

  async fetchHistory(spec: FetchSpec): Promise<ContextMessage[]> {
    const containerIdType = spec.origin === 'thread' ? 'thread' : 'chat'
    const containerId = spec.origin === 'thread' ? spec.threadId ?? '' : spec.chatId
    if (containerId === '') throw new Error('dsh-feishu-remote: thread 容器缺少 threadId/rootId')
    const target = spec.maxMessages + 1
    const deadline = Date.now() + spec.timeoutMs
    const collected: ContextMessage[] = []
    let pageToken: string | undefined
    let guard = 0
    for (;;) {
      if (guard >= SDK_MAX_PAGES) throw new Error('dsh-feishu-remote: SDK 历史翻页过多（异常 page_token）')
      guard += 1
      const result = await this.raceCall(spec, deadline, () => this.listMessages({ containerIdType, containerId, pageToken }))
      const items = Array.isArray(result.items) ? result.items : []
      for (const item of items) {
        collected.push(normalizeSdkItem(item as Record<string, unknown>, collected.length, spec.botOpenId))
      }
      const next = typeof result.pageToken === 'string' && result.pageToken !== '' ? result.pageToken : undefined
      if (result.hasMore !== true || next === undefined || next === pageToken) break
      pageToken = next
      if (collected.length >= target) break
    }
    // docs/13 F3 + docs/15 F-05: back-fill the thread root (fail-open).
    if (spec.origin === 'thread' && spec.rootMessageId !== undefined && spec.rootMessageId !== ''
      && this.getMessage !== undefined
      && !collected.some(item => item.messageId === spec.rootMessageId)) {
      try {
        const root = await this.raceCall(spec, deadline, () => this.getMessage!(spec.rootMessageId!))
        if (root !== undefined) collected.push(normalizeSdkItem(root, collected.length, spec.botOpenId))
      } catch (error) {
        this.logger?.warn?.('dsh-feishu-remote: 话题根消息补取失败（fail-open）：%s', error instanceof Error ? error.message : String(error))
      }
    }
    return collected
  }

  private raceCall<T>(spec: FetchSpec, deadline: number, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        reject(new Error('dsh-feishu-remote: SDK 历史拉取超时'))
        return
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('dsh-feishu-remote: SDK 历史拉取超时'))
      }, remaining)
      const onAbort = () => {
        cleanup()
        reject(new Error('dsh-feishu-remote: 插件已停止，SDK 拉取中止'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        spec.signal?.removeEventListener('abort', onAbort)
      }
      if (spec.signal?.aborted === true) onAbort()
      else spec.signal?.addEventListener('abort', onAbort, { once: true })
      work().then(value => {
        cleanup()
        resolve(value)
      }, error => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }
}

// ---------------------------------------------------------------- window & render

export interface WindowOptions {
  triggerMessageId: string
  triggerCreatedAtMs: number
  watermark?: ContextWatermark
  maxMessages: number
  includeBot: boolean
}

export interface WindowResult {
  /** RENDERABLE messages only, ascending by time (stable within a minute). */
  kept: ContextMessage[]
  /** Renderable messages dropped by the message-count budget (oldest first). */
  droppedFromHead: number
}

/**
 * Positional window (docs/15 F-01): providers return DESC lists, so the
 * trigger/watermark are located by id and the list is sliced around them —
 * wall-clock comparison is only a fallback for a missing watermark message.
 * Budgets count ONLY renderable messages (docs/15 F-02).
 */
export function applyWindow(messages: ContextMessage[], options: WindowOptions): WindowResult {
  let kept = messages
  const triggerIndex = kept.findIndex(item => item.messageId === options.triggerMessageId)
  if (triggerIndex >= 0) {
    kept = kept.slice(triggerIndex + 1) // strictly older (desc)
  } else {
    // Trigger not in the fetched pages: fall back to a time cutoff — provably
    // future messages (later minute/ms) are dropped, the trigger excluded.
    kept = kept.filter(item => item.messageId !== options.triggerMessageId && item.createdAtMs <= options.triggerCreatedAtMs)
  }
  if (options.watermark !== undefined) {
    const watermarkIndex = kept.findIndex(item => item.messageId === options.watermark!.messageId)
    if (watermarkIndex >= 0) {
      kept = kept.slice(0, watermarkIndex) // strictly newer (desc: indices < watermark)
    } else {
      // Watermark message was recalled/evicted: fall back to minute-precision
      // time (may re-inject same-minute neighbours once — safe direction).
      kept = kept.filter(item => item.createdAtMs > options.watermark!.createdAtMs)
    }
  }
  if (!options.includeBot) kept = kept.filter(item => !item.isOwnBot)
  kept = kept.filter(isRenderable)
  let droppedFromHead = 0
  if (kept.length > options.maxMessages) {
    droppedFromHead = kept.length - options.maxMessages
    kept = kept.slice(0, options.maxMessages) // newest renderable window (desc)
  }
  return { kept: [...kept].reverse(), droppedFromHead } // asc for rendering
}

function shortId(id: string): string {
  if (id === '') return 'unknown'
  return id.length > 8 ? `…${id.slice(-4)}` : id
}

function lineTime(createdAtMs: number): string {
  const date = new Date(createdAtMs)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One transcript line per message; system/deleted are skipped defensively. */
export function renderLines(messages: ContextMessage[]): RenderedLine[] {
  const lines: RenderedLine[] = []
  for (const item of messages) {
    if (!isRenderable(item)) continue
    const name = item.isOwnBot
      ? 'DeepSeek Harness'
      : (item.senderName || (item.isBotApp ? '机器人' : '未知用户'))
    lines.push({
      messageId: item.messageId,
      createdAtMs: item.createdAtMs,
      time: lineTime(item.createdAtMs),
      name,
      shortId: item.isOwnBot ? 'bot' : shortId(item.senderId),
      text: redactSecrets(item.text),
    })
  }
  return lines
}

export interface ComposeOptions {
  maxChars: number
  droppedFromHead: number
  fullWindow: boolean
  backend: ContextBackendKind
}

export interface ComposeResult extends ContextInjection {
  /** Lines actually placed in the frame (asc) — the watermark source (docs/15 F-03). */
  keptLines: RenderedLine[]
}

/**
 * JSON-framed transcript block (docs/13 F2/F8). Char budget drops the OLDEST
 * lines first; if even the single newest line exceeds the budget it is
 * FORCE-TRUNCATED instead of dropped, so the watermark can always advance
 * (docs/15 F-03).
 */
export function composeContextBlock(lines: RenderedLine[], options: ComposeOptions): ComposeResult {
  if (lines.length === 0) return { keptLines: [] }
  const fit: RenderedLine[] = []
  let chars = 0
  let charsDropped = 0
  let forceTruncated = false
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    const rendered = `[${line.time}] ${line.name}(${line.shortId})：${line.text}`
    if (chars + rendered.length <= options.maxChars) {
      fit.unshift({ ...line, text: rendered })
      chars += rendered.length
    } else {
      charsDropped += 1
    }
  }
  if (fit.length === 0) {
    const newest = lines[lines.length - 1]!
    const rendered = `[${newest.time}] ${newest.name}(${newest.shortId})：${newest.text}`
    const truncated = bounded(rendered, options.maxChars)
    fit.push({ ...newest, text: truncated })
    chars = truncated.length
    charsDropped = lines.length - 1
    forceTruncated = rendered.length > truncated.length
  }
  const dropped = options.droppedFromHead + charsDropped
  const entries = fit.map(line => ({ t: line.time, n: line.name, s: line.shortId, x: line.text }))
  const payload = {
    type: CONTEXT_FRAME_TYPE,
    count: fit.length,
    fullWindow: options.fullWindow,
    omitted: dropped,
    ...(dropped > 0 ? { omittedNote: `更早的 ${dropped} 条已省略` } : {}),
    messages: entries,
  }
  return {
    keptLines: fit,
    block: JSON.stringify(payload),
    stats: {
      backend: options.backend,
      count: fit.length,
      chars,
      truncated: dropped > 0 || forceTruncated,
      fullWindow: options.fullWindow,
    },
  }
}

/**
 * End-to-end pipeline for one inbound message: window → lines → block, plus
 * the next watermark (the last message ACTUALLY placed in the frame).
 */
export function buildContextInjection(
  messages: ContextMessage[],
  options: WindowOptions & Omit<ComposeOptions, 'droppedFromHead'>,
): ContextInjection & { watermark?: ContextWatermark } {
  const { kept, droppedFromHead } = applyWindow(messages, options)
  const lines = renderLines(kept)
  const composed = composeContextBlock(lines, { ...options, droppedFromHead })
  const lastLine = composed.keptLines.at(-1)
  const watermark = lastLine === undefined
    ? undefined
    : { messageId: lastLine.messageId, createdAtMs: lastLine.createdAtMs }
  return {
    ...(composed.block === undefined ? {} : { block: composed.block }),
    ...(composed.stats === undefined ? {} : { stats: composed.stats }),
    watermark,
  }
}
