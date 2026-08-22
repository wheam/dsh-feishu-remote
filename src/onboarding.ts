/**
 * PersonalAgent QR onboarding (docs/16).
 *
 * The browser talks to this service only through a loopback-only Connection
 * RPC channel. registerApp() and every secret-bearing operation remain in the
 * Host process; snapshots contain only the short-lived QR URL/data image and
 * redacted app/owner identity.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  Client,
  Domain,
  LoggerLevel,
  registerApp,
  type AppAddons,
} from '@larksuiteoapi/node-sdk'
import * as QRCode from 'qrcode'
import { bounded, redactSecrets } from './security.js'
import type { FlatSettings } from './settings.js'
import type { LarkBrand } from './types.js'

export const ONBOARDING_RPC_CHANNEL = '/dsh-feishu-remote'

export const PERSONAL_AGENT_ADDONS = {
  preset: true,
  scopes: {
    tenant: [
      'im:message.p2p_msg:readonly',
      'im:message.group_at_msg:readonly',
      'im:message:send_as_bot',
      'im:message:readonly',
      'im:message.group_msg',
      'im:message.reactions:write_only',
    ],
  },
  events: {
    items: { tenant: ['im.message.receive_v1'] },
  },
  callbacks: {
    items: ['card.action.trigger'],
  },
} satisfies AppAddons

const CORE_SCOPES = [
  'im:message.p2p_msg:readonly',
  'im:message.group_at_msg:readonly',
  'im:message:send_as_bot',
] as const

const ENHANCED_SCOPES = [
  'im:message:readonly',
  'im:message.group_msg',
  'im:message.reactions:write_only',
] as const

const CORE_EVENTS = ['im.message.receive_v1'] as const
const CORE_CALLBACKS = ['card.action.trigger'] as const

export type OnboardingPhase =
  | 'idle'
  | 'starting'
  | 'qr_ready'
  | 'committing'
  | 'connecting'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type OnboardingMode = 'create' | 'select' | 'update'

export type CapabilityState = 'ok' | 'missing' | 'unknown'

export interface OnboardingCapabilities {
  core: CapabilityState
  enhanced: CapabilityState
  missingCore: string[]
  missingEnhanced: string[]
}

export interface BridgeHealth {
  appId: string
  connected: boolean
  terminalFailure: boolean
  botName?: string
  botOpenId?: string
}

export interface OnboardingStatus {
  revision: number
  phase: OnboardingPhase
  mode?: OnboardingMode
  configured: boolean
  connected: boolean
  /** A created-but-uncommitted app can be re-authorized instead of orphaned. */
  recoverableApp?: boolean
  qrUrl?: string
  qrImageDataUrl?: string
  expiresAt?: number
  providerStatus?: 'polling' | 'slow_down' | 'domain_switched'
  app?: {
    appIdSuffix: string
    ownerOpenIdSuffix?: string
    botName?: string
    brand?: LarkBrand
  }
  capabilities?: OnboardingCapabilities
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

interface OnboardingFailure {
  code: string
  message: string
  retryable: boolean
}

export interface AppProbe {
  ownerOpenId?: string
  appName?: string
  capabilities: OnboardingCapabilities
}

interface RpcSuccess<T> {
  ok: true
  value: T
}

type RpcFailure =
  | { ok: false; error: { code: 'bad-request'; message: string; details: { issues: [] } } }
  | { ok: false; error: { code: 'cancelled'; message: string; details: Record<string, never> } }
  | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }

type RpcResult<T> = RpcSuccess<T> | RpcFailure

type RegisterResult = Awaited<ReturnType<typeof registerApp>>

interface RegistrationSession {
  id: string
  mode: OnboardingMode
  targetAppId?: string
  previousSettings?: FlatSettings
  controller: AbortController
  committing: boolean
  task?: Promise<void>
}

export interface OnboardingDependencies {
  registerApp: typeof registerApp
  renderQr: (url: string) => Promise<string>
  probeApp: (appId: string, appSecret: string, brand: LarkBrand) => Promise<AppProbe>
  getBridgeHealth: () => BridgeHealth | undefined
  waitForBridge: (appId: string, signal?: AbortSignal) => Promise<BridgeHealth>
}

class OnboardingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message)
  }
}

function suffix(value: string, length = 6): string {
  return value.slice(-length)
}

function sameBinding(left: FlatSettings, right: FlatSettings): boolean {
  return left.appId === right.appId
    && left.appSecretRef === right.appSecretRef
    && left.brand === right.brand
    && left.onboardingManaged === right.onboardingManaged
    && left.allowedOpenIds === right.allowedOpenIds
    && left.allowedChatIds === right.allowedChatIds
    && left.allowAllUsers === right.allowAllUsers
}

function safeErrorText(error: unknown, secret = ''): string {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutKnownSecret = secret === '' ? raw : raw.replaceAll(secret, '[REDACTED]')
  return bounded(redactSecrets(withoutKnownSecret), 400)
}

function externalErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function failureFor(error: unknown, secret = ''): OnboardingFailure {
  if (error instanceof OnboardingError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  switch (externalErrorCode(error)) {
    case 'access_denied':
      return { code: 'access_denied', message: '你取消了飞书授权；可以重新生成二维码。', retryable: true }
    case 'expired_token':
      return { code: 'expired_token', message: '二维码已过期，请刷新后重新扫码。', retryable: true }
    case 'abort':
      return { code: 'abort', message: '本次扫码已取消。', retryable: true }
    case 'connection_failed':
      return { code: 'connection_failed', message: '机器人长连接启动失败，请检查飞书权限后重试。', retryable: true }
    case 'connection_timeout':
      return { code: 'connection_timeout', message: '机器人已创建，但长连接尚未就绪。请稍后重试连接。', retryable: true }
    default:
      return {
        code: 'registration_failed',
        message: '飞书开通失败，请检查网络、企业策略或稍后重新扫码。',
        retryable: true,
      }
  }
}

function timeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OnboardingError('probe_timeout', message)), timeoutMs)
  })
  return Promise.race([operation, expired]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

/**
 * The legacy tenant-token endpoint returns the token at the response root,
 * while the generated v1.73 SDK type models it inside `data`. Accept both
 * envelopes so a successful credential probe is not reported as a failure.
 */
function tenantAccessTokenFrom(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const response = raw as Record<string, unknown>
  if (typeof response.tenant_access_token === 'string' && response.tenant_access_token !== '') {
    return response.tenant_access_token
  }
  if (typeof response.data !== 'object' || response.data === null) return undefined
  const token = (response.data as Record<string, unknown>).tenant_access_token
  return typeof token === 'string' && token !== '' ? token : undefined
}

/** Read the v6 app projection without retaining its secret-bearing raw shape. */
export function inspectAppProjection(raw: unknown): AppProbe {
  const app = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const scopesRaw = Array.isArray(app.scopes) ? app.scopes : undefined
  const scopes = scopesRaw?.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const scope = (item as Record<string, unknown>).scope
    return typeof scope === 'string' ? [scope] : []
  })
  const event = typeof app.event === 'object' && app.event !== null
    ? app.event as Record<string, unknown>
    : undefined
  const callback = typeof app.callback === 'object' && app.callback !== null
    ? app.callback as Record<string, unknown>
    : undefined
  const callbackInfo = typeof app.callback_info === 'object' && app.callback_info !== null
    ? app.callback_info as Record<string, unknown>
    : undefined
  const events = stringArray(event?.subscribed_events)
  const callbacks = stringArray(callbackInfo?.subscribed_callbacks)
    ?? stringArray(callback?.subscribed_callbacks)

  const missingCoreScopes = scopes === undefined
    ? []
    : CORE_SCOPES.filter(item => !scopes.includes(item))
  const missingEvents = events === undefined
    ? []
    : CORE_EVENTS.filter(item => !events.includes(item))
  const missingCallbacks = callbacks === undefined
    ? []
    : CORE_CALLBACKS.filter(item => !callbacks.includes(item))
  const missingCore = [...missingCoreScopes, ...missingEvents, ...missingCallbacks]
  const coreKnown = scopes !== undefined && events !== undefined && callbacks !== undefined

  const missingEnhanced = scopes === undefined
    ? []
    : ENHANCED_SCOPES.filter(item => !scopes.includes(item))
  const capabilities: OnboardingCapabilities = {
    core: missingCore.length > 0 ? 'missing' : coreKnown ? 'ok' : 'unknown',
    enhanced: missingEnhanced.length > 0 ? 'missing' : scopes === undefined ? 'unknown' : 'ok',
    missingCore,
    missingEnhanced,
  }

  const owner = typeof app.owner === 'object' && app.owner !== null
    ? app.owner as Record<string, unknown>
    : undefined
  const ownerOpenId = typeof owner?.owner_id === 'string'
    ? owner.owner_id
    : typeof app.creator_id === 'string'
      ? app.creator_id
      : undefined

  return {
    ...(ownerOpenId === undefined || ownerOpenId === '' ? {} : { ownerOpenId }),
    ...(typeof app.app_name === 'string' && app.app_name !== '' ? { appName: app.app_name } : {}),
    capabilities,
  }
}

/** Validate the new app identity, then best-effort inspect owner/capabilities. */
export async function probePersonalAgent(
  appId: string,
  appSecret: string,
  brand: LarkBrand,
): Promise<AppProbe> {
  const client = new Client({
    appId,
    appSecret,
    domain: brand === 'feishu' ? Domain.Feishu : Domain.Lark,
    loggerLevel: LoggerLevel.warn,
    source: 'dsh-feishu-remote/onboarding',
  })
  const token = await timeout(client.auth.v3.tenantAccessToken.internal({
    data: { app_id: appId, app_secret: appSecret },
  }), 15_000, '验证飞书应用凭据超时，请检查网络后重试。')
  if (token.code !== 0 || tenantAccessTokenFrom(token) === undefined) {
    throw new OnboardingError('credential_probe_failed', '飞书没有接受新应用凭据，请重新扫码。')
  }

  try {
    const response = await timeout(client.application.v6.application.get({
      path: { app_id: appId },
      params: { lang: 'zh_cn', user_id_type: 'open_id' },
    }), 15_000, '读取飞书应用权限超时。')
    if (response.code !== 0 || response.data?.app === undefined) {
      return {
        capabilities: { core: 'unknown', enhanced: 'unknown', missingCore: [], missingEnhanced: [] },
      }
    }
    return inspectAppProjection(response.data.app)
  } catch {
    // Credential validation above is authoritative. Some PersonalAgent tenants
    // do not expose application.v6; connection health remains the final gate.
    return {
      capabilities: { core: 'unknown', enhanced: 'unknown', missingCore: [], missingEnhanced: [] },
    }
  }
}

/** Unique provider ref for every bind; the hash contains App ID/session only. */
export function onboardingCredentialRef(appId: string, sessionId: string): string {
  const app = createHash('sha256').update(appId).digest('hex').slice(0, 12).toUpperCase()
  const run = createHash('sha256').update(sessionId).digest('hex').slice(0, 8).toUpperCase()
  return `DSH_FEISHU_APP_SECRET_${app}_${run}`
}

function defaultDependencies(overrides: Partial<OnboardingDependencies>): OnboardingDependencies {
  return {
    registerApp,
    renderQr: url => QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      type: 'image/png',
    }),
    probeApp: probePersonalAgent,
    getBridgeHealth: () => undefined,
    waitForBridge: async () => {
      throw new OnboardingError('connection_timeout', '机器人已创建，但长连接尚未就绪。请稍后重试连接。')
    },
    ...overrides,
  }
}

export class PersonalAgentOnboardingService {
  private revision = 0
  private active?: RegistrationSession
  private pendingApp?: { appId: string; brand: LarkBrand }
  private disposed = false
  private state: Omit<OnboardingStatus, 'configured' | 'connected'> = {
    revision: 0,
    phase: 'idle',
  }
  private readonly deps: OnboardingDependencies

  constructor(
    private readonly ctx: Context,
    private readonly settings: SettingsScope<FlatSettings>,
    dependencies: Partial<OnboardingDependencies> = {},
  ) {
    this.deps = defaultDependencies(dependencies)
  }

  status(): OnboardingStatus {
    const current = this.settings.get()
    const health = this.deps.getBridgeHealth()
    const configured = current.appId.trim() !== ''
    const currentApp = configured
      ? {
          appIdSuffix: suffix(current.appId),
          ...(health?.botName === undefined ? {} : { botName: health.botName }),
          brand: current.brand,
        }
      : undefined
    return {
      ...this.state,
      configured,
      connected: health?.connected === true && health.appId === current.appId,
      ...(this.state.app === undefined && currentApp !== undefined ? { app: currentApp } : {}),
    }
  }

  private replace(next: Omit<OnboardingStatus, 'configured' | 'connected' | 'revision'>): void {
    this.revision += 1
    this.state = { ...next, revision: this.revision }
  }

  private patch(patch: Partial<Omit<OnboardingStatus, 'configured' | 'connected' | 'revision'>>): void {
    this.revision += 1
    this.state = { ...this.state, ...patch, revision: this.revision }
  }

  private isCurrent(session: RegistrationSession): boolean {
    return !this.disposed && this.active === session
  }

  private assertCurrent(session: RegistrationSession): void {
    if (!this.isCurrent(session)) throw new OnboardingError('abort', '本次扫码已取消。')
  }

  async start(mode: OnboardingMode = 'create'): Promise<OnboardingStatus> {
    if (this.disposed) throw new OnboardingError('disposed', '插件正在停止，暂时不能开始扫码。', false)
    if (this.ctx.settings.writable === false) {
      throw new OnboardingError('read_only', '当前部署的设置存储为只读，无法保存扫码结果。', false)
    }
    if (this.settings.get().bots.length > 0) {
      throw new OnboardingError('multi_bot_unsupported', '多机器人模式请在机器人列表中配置目标 bot；当前扫码入口不会写入已失效的 legacy 根字段。', false)
    }
    if (this.active?.committing === true) {
      throw new OnboardingError('busy', '正在保存上一轮扫码结果，请等待完成。', false)
    }
    const previousSettings = { ...this.settings.get() }
    const configuredAppId = previousSettings.appId.trim()
    const targetAppId = this.pendingApp?.appId || configuredAppId
    if (mode === 'update' && (targetAppId === undefined || targetAppId === '')) {
      throw new OnboardingError('missing_app', '当前还没有可补充权限的 App ID。', false)
    }
    if (this.active !== undefined) this.active.controller.abort()
    if (mode !== 'update') this.pendingApp = undefined

    const session: RegistrationSession = {
      id: randomUUID(),
      mode,
      ...(mode === 'update' ? { targetAppId } : {}),
      previousSettings,
      controller: new AbortController(),
      committing: false,
    }
    this.active = session
    this.replace({ phase: 'starting', mode })
    const task = this.run(session).finally(() => {
      if (this.active === session) this.active = undefined
    })
    session.task = task
    void task.catch(error => {
      // run() owns user-facing state. This branch is only the final containment
      // fence keeping apply() and the web profile alive.
      this.ctx.logger?.warn?.('dsh-feishu-remote: onboarding task contained: %s', safeErrorText(error))
    })
    return this.status()
  }

  cancel(): OnboardingStatus {
    const active = this.active
    if (active === undefined) return this.status()
    if (active.committing) return this.status()
    this.active = undefined
    active.controller.abort()
    const recoverable = this.pendingApp
    this.replace({
      phase: 'cancelled',
      mode: active.mode,
      error: { code: 'abort', message: '本次扫码已取消。', retryable: true },
      ...(recoverable === undefined ? {} : {
        recoverableApp: true,
        app: { appIdSuffix: suffix(recoverable.appId), brand: recoverable.brand },
      }),
    })
    return this.status()
  }

  async retryConnection(): Promise<OnboardingStatus> {
    if (this.settings.get().bots.length > 0) {
      throw new OnboardingError('multi_bot_unsupported', '多机器人模式请从机器人状态列表检查连接。', false)
    }
    const appId = this.settings.get().appId.trim()
    if (appId === '') throw new OnboardingError('missing_app', '当前没有已保存的 App ID。', false)
    if (this.active !== undefined) throw new OnboardingError('busy', '扫码任务仍在进行，请稍候。', false)
    const session: RegistrationSession = {
      id: randomUUID(),
      mode: this.state.mode ?? 'create',
      targetAppId: appId,
      controller: new AbortController(),
      committing: false,
    }
    this.active = session
    this.replace({ phase: 'connecting', mode: session.mode })
    const task = this.runConnectionRetry(session, appId).finally(() => {
      if (this.active === session) this.active = undefined
    })
    session.task = task
    await task
    return this.status()
  }

  private async runConnectionRetry(session: RegistrationSession, appId: string): Promise<void> {
    try {
      const health = await this.deps.waitForBridge(appId, session.controller.signal)
      if (!this.isCurrent(session)) return
      if (this.settings.get().appId.trim() !== appId) {
        throw new OnboardingError('settings_changed', '重试连接期间飞书配置已被修改；未覆盖较新的设置。', false)
      }
      this.replace({
        phase: 'ready',
        mode: session.mode,
        app: {
          appIdSuffix: suffix(appId),
          ...(health.botName === undefined ? {} : { botName: health.botName }),
          brand: this.settings.get().brand,
        },
      })
    } catch (error) {
      if (!this.isCurrent(session)) return
      this.replace({ phase: 'failed', mode: session.mode, error: failureFor(error) })
    }
  }

  async stop(): Promise<void> {
    this.disposed = true
    const active = this.active
    active?.controller.abort()
    await active?.task?.catch(() => undefined)
    this.active = undefined
    this.pendingApp = undefined
  }

  async handleRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<OnboardingStatus>> {
    if (signal.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'request cancelled', details: {} } }
    }
    try {
      switch (endpoint) {
        case 'onboarding/status':
          return { ok: true, value: this.status() }
        case 'onboarding/start': {
          const body = typeof payload === 'object' && payload !== null
            ? payload as Record<string, unknown>
            : {}
          const mode = body.mode ?? 'create'
          if (mode !== 'create' && mode !== 'select' && mode !== 'update') {
            throw new OnboardingError('bad_request', 'mode 必须是 create、select 或 update。', false)
          }
          return { ok: true, value: await this.start(mode) }
        }
        case 'onboarding/cancel':
          return { ok: true, value: this.cancel() }
        case 'onboarding/retry':
          return { ok: true, value: await this.retryConnection() }
        default:
          return {
            ok: false,
            error: { code: 'bad-request', message: `unknown endpoint ${endpoint}`, details: { issues: [] } },
          }
      }
    } catch (error) {
      const failure = failureFor(error)
      if (error instanceof OnboardingError && error.code === 'bad_request') {
        return {
          ok: false,
          error: { code: 'bad-request', message: failure.message, details: { issues: [] } },
        }
      }
      return {
        ok: false,
        error: {
          code: 'internal',
          message: failure.message,
          details: {},
        },
      }
    }
  }

  private async run(session: RegistrationSession): Promise<void> {
    let result: RegisterResult | undefined
    let secret = ''
    try {
      const preflightRef = credentialRef(
        `DSH_FEISHU_APP_SECRET_PREFLIGHT_${createHash('sha256').update(session.id).digest('hex').slice(0, 12).toUpperCase()}`,
      )
      const preflight = await this.ctx.credentials.describe(preflightRef).catch(error => {
        throw new OnboardingError('credential_write_unavailable', `无法确认凭据存储是否可写：${safeErrorText(error)}`, false)
      })
      this.assertCurrent(session)
      if (!preflight.writable) {
        throw new OnboardingError('credential_write_unavailable', '当前凭据存储为只读，无法安全保存扫码结果。', false)
      }
      result = await this.deps.registerApp({
        source: 'dsh-feishu-remote',
        signal: session.controller.signal,
        ...(session.mode === 'create'
          ? { createOnly: true }
          : session.mode === 'update'
            ? { appId: session.targetAppId! }
            : {}),
        appPreset: {
          name: 'DSH Remote · {user}',
          desc: '用飞书远程操控本机 DeepSeek Harness',
        },
        addons: PERSONAL_AGENT_ADDONS,
        onQRCodeReady: info => {
          if (!this.isCurrent(session) || session.committing) return
          const expiresAt = Date.now() + Math.max(0, info.expireIn) * 1000
          this.patch({
            phase: 'qr_ready',
            qrUrl: info.url,
            qrImageDataUrl: undefined,
            expiresAt,
          })
          void this.deps.renderQr(info.url).then(dataUrl => {
            if (!this.isCurrent(session) || session.committing) return
            this.patch({ qrImageDataUrl: dataUrl })
          }).catch(error => {
            this.ctx.logger?.warn?.('dsh-feishu-remote: 本地二维码渲染失败（链接仍可用）：%s', safeErrorText(error))
          })
        },
        onStatusChange: info => {
          if (!this.isCurrent(session) || session.committing) return
          this.patch({ providerStatus: info.status })
        },
      })

      this.assertCurrent(session)
      session.committing = true
      secret = result.client_secret.trim()
      const appId = result.client_id.trim()
      if (!/^cli_[A-Za-z0-9]+$/u.test(appId) || secret === '') {
        throw new OnboardingError('invalid_result', '飞书返回了无效的应用凭据，请重新扫码。')
      }
      const brand: LarkBrand = result.user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu'
      this.pendingApp = { appId, brand }
      this.replace({ phase: 'committing', mode: session.mode })

      const probe = await this.deps.probeApp(appId, secret, brand)
      if (probe.capabilities.core === 'missing') {
        throw new OnboardingError(
          'permissions_missing',
          `飞书没有授予核心能力：${probe.capabilities.missingCore.join('、')}。请重新扫码确认权限。`,
        )
      }
      const scannedOwner = result.user_info?.open_id?.trim()
      const previousSettings = session.previousSettings!
      const previousOwners = previousSettings.allowedOpenIds
        .split(/[\s,]+/u)
        .map(item => item.trim())
        .filter(Boolean)
      const ownerOpenId = scannedOwner || probe.ownerOpenId || (session.mode === 'update' ? previousOwners[0] : undefined)
      if (ownerOpenId === undefined || ownerOpenId === '') {
        throw new OnboardingError('owner_missing', '应用已创建，但无法确认 owner；为保证安全，未切换本地配置。')
      }
      if (!sameBinding(this.settings.get(), previousSettings)) {
        throw new OnboardingError('settings_changed', '扫码期间飞书配置已被修改；为避免覆盖较新的设置，未切换本地配置。', false)
      }

      const refName = onboardingCredentialRef(appId, session.id)
      const ref = credentialRef(refName)
      let stored = false
      let settingsCommitted = false
      try {
        try {
          const credentialInfo = await this.ctx.credentials.describe(ref)
          if (!credentialInfo.writable) {
            throw new OnboardingError('credential_write_unavailable', '新应用的凭据引用被只读来源占用，未切换本地配置。', false)
          }
          await this.ctx.credentials.set(ref, secret)
          stored = true
        } catch (error) {
          if (error instanceof OnboardingError) throw error
          throw new OnboardingError('credential_write_failed', `无法安全保存 App Secret：${safeErrorText(error, secret)}`)
        }

        const patch: Partial<FlatSettings> = {
          appId,
          appSecretRef: refName,
          brand,
          onboardingManaged: true,
          ...(session.mode === 'create' || appId !== previousSettings.appId
            ? { allowedOpenIds: ownerOpenId, allowedChatIds: '', allowAllUsers: false }
            : {}),
        }
        try {
          await this.settings.update(patch)
          settingsCommitted = true
        } catch (error) {
          throw new OnboardingError('settings_write_failed', `无法保存飞书应用配置：${safeErrorText(error, secret)}`)
        }

        this.replace({
          phase: 'connecting',
          mode: session.mode,
          app: {
            appIdSuffix: suffix(appId),
            ownerOpenIdSuffix: suffix(ownerOpenId, 4),
            ...(probe.appName === undefined ? {} : { botName: probe.appName }),
            brand,
          },
          capabilities: probe.capabilities,
        })
        try {
          const health = await this.deps.waitForBridge(appId, session.controller.signal)
          this.pendingApp = undefined
          this.replace({
            phase: 'ready',
            mode: session.mode,
            app: {
              appIdSuffix: suffix(appId),
              ownerOpenIdSuffix: suffix(ownerOpenId, 4),
              ...(health.botName === undefined && probe.appName === undefined
                ? {}
                : { botName: health.botName ?? probe.appName }),
              brand,
            },
            capabilities: probe.capabilities,
          })
        } catch (error) {
          // Any failed health check during a rebind/update restores the working
          // configuration that existed before scanning. On a first bind there
          // is no working tuple to preserve, so retain the new app for retry.
          let rolledBack = false
          let selectionChanged = false
          if (previousSettings.appId.trim() !== '') {
            try {
              const selected = this.settings.get()
              if (selected.appId !== appId || selected.appSecretRef !== refName) {
                selectionChanged = true
                throw new Error('settings changed after onboarding commit; refusing to overwrite the newer selection')
              }
              await this.settings.update({
                appId: previousSettings.appId,
                appSecretRef: previousSettings.appSecretRef,
                brand: previousSettings.brand,
                onboardingManaged: previousSettings.onboardingManaged,
                allowedOpenIds: previousSettings.allowedOpenIds,
                allowedChatIds: previousSettings.allowedChatIds,
                allowAllUsers: previousSettings.allowAllUsers,
              })
              rolledBack = true
              this.pendingApp = undefined
              await this.ctx.credentials.unset(ref).catch(cleanupError => {
                this.ctx.logger?.warn?.(
                  'dsh-feishu-remote: rollback 已恢复旧配置，但新 credential ref 清理失败：%s',
                  safeErrorText(cleanupError, secret),
                )
              })
            } catch (rollbackError) {
              this.ctx.logger?.error?.(
                'dsh-feishu-remote: onboarding 重新绑定连接失败后的配置回滚失败：%s',
                safeErrorText(rollbackError, secret),
              )
            }
          }
          if (!rolledBack) this.pendingApp = undefined
          const failure = failureFor(error, secret)
          this.replace({
            phase: 'failed',
            mode: session.mode,
            ...(rolledBack || selectionChanged ? {} : {
              app: {
                appIdSuffix: suffix(appId),
                ownerOpenIdSuffix: suffix(ownerOpenId, 4),
                ...(probe.appName === undefined ? {} : { botName: probe.appName }),
                brand,
              },
              capabilities: probe.capabilities,
            }),
            error: rolledBack
              ? { ...failure, message: `${failure.message} 已恢复扫码前的本地配置。` }
              : selectionChanged
                ? { ...failure, message: `${failure.message} 检测到配置已被更新，未覆盖较新的选择。` }
              : failure,
          })
        }
      } catch (error) {
        if (stored && !settingsCommitted) {
          await this.ctx.credentials.unset(ref).catch(cleanupError => {
            this.ctx.logger?.warn?.(
              'dsh-feishu-remote: onboarding 补偿清理 credential ref 失败：%s',
              safeErrorText(cleanupError, secret),
            )
          })
        }
        throw error
      }
    } catch (error) {
      if (!this.isCurrent(session)) return
      const failure = failureFor(error, secret)
      const phase: OnboardingPhase = failure.code === 'expired_token'
        ? 'expired'
        : failure.code === 'abort'
          ? 'cancelled'
          : 'failed'
      const recoverable = this.pendingApp
      this.replace({
        phase,
        mode: session.mode,
        error: failure,
        ...(recoverable === undefined ? {} : {
          recoverableApp: true,
          app: { appIdSuffix: suffix(recoverable.appId), brand: recoverable.brand },
        }),
      })
    } finally {
      secret = ''
      if (result !== undefined) result.client_secret = ''
    }
  }
}
