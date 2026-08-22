import { describe, expect, it, vi } from 'vitest'
import {
  PersonalAgentOnboardingService,
  inspectAppProjection,
  onboardingCredentialRef,
  type AppProbe,
  type BridgeHealth,
  type OnboardingDependencies,
} from '../src/onboarding.js'
import { SETTINGS_NAMESPACE, flatten, type FlatSettings } from '../src/settings.js'

function okProbe(overrides: Partial<AppProbe> = {}): AppProbe {
  return {
    ownerOpenId: 'ou_owner',
    appName: 'DSH Remote · Tester',
    capabilities: { core: 'ok', enhanced: 'ok', missingCore: [], missingEnhanced: [] },
    ...overrides,
  }
}

function connected(appId = 'cli_new'): BridgeHealth {
  return { appId, connected: true, terminalFailure: false, botName: 'DSH Remote · Tester' }
}

function harness(options: {
  settingsUpdate?: (patch: Partial<FlatSettings>) => Promise<void>
  initialSettings?: Partial<FlatSettings>
  settingsWritable?: boolean
  settingsCas?: boolean
  credentialWritable?: boolean
  probe?: AppProbe
  waitForBridge?: (appId: string, signal?: AbortSignal) => Promise<BridgeHealth>
} = {}) {
  let current = { ...flatten({}), ...options.initialSettings }
  let settingsRevision = 7
  const updates: Array<Partial<FlatSettings>> = []
  const settings = {
    get: () => current,
    watch: () => () => undefined,
    replace: async () => undefined,
    update: vi.fn(async (patch: Partial<FlatSettings>) => {
      updates.push(patch)
      if (options.settingsUpdate !== undefined) await options.settingsUpdate(patch)
      current = { ...current, ...patch }
    }),
  }
  const credentials = {
    describe: vi.fn(async () => ({ configured: false, writable: options.credentialWritable ?? true })),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  const mutate = vi.fn(async (
    _namespace: unknown,
    operations: Array<{ op: string; path: string[]; value?: unknown }>,
    revision: number,
  ) => {
    if (revision !== settingsRevision) throw Object.assign(new Error('settings conflict'), { code: 'SETTINGS_CONFLICT' })
    const bots = operations.find(item => item.op === 'set' && item.path[0] === 'bots')?.value as FlatSettings['bots'] | undefined
    if (bots === undefined) throw new Error('missing bots operation')
    const patch = { bots }
    updates.push(patch)
    if (options.settingsUpdate !== undefined) await options.settingsUpdate(patch)
    current = { ...current, ...patch }
    settingsRevision += 1
  })
  let resolveRegistration: ((value: {
    client_id: string
    client_secret: string
    user_info?: { open_id?: string; tenant_brand?: 'feishu' | 'lark' }
  }) => void) | undefined
  let rejectRegistration: ((error: unknown) => void) | undefined
  const registration = new Promise<{
    client_id: string
    client_secret: string
    user_info?: { open_id?: string; tenant_brand?: 'feishu' | 'lark' }
  }>((resolve, reject) => {
    resolveRegistration = resolve
    rejectRegistration = reject
  })
  const registerAppMock = vi.fn(async (request: Parameters<OnboardingDependencies['registerApp']>[0]) => {
    request.onQRCodeReady({ url: 'https://open.feishu.cn/page/launcher?user_code=short-lived', expireIn: 3600 })
    request.signal?.addEventListener('abort', () => {
      rejectRegistration?.(Object.assign(new Error('cancelled'), { code: 'abort' }))
    }, { once: true })
    return registration
  })
  const registerApp = registerAppMock as unknown as OnboardingDependencies['registerApp']
  let health: BridgeHealth | undefined
  const waitForBridge = options.waitForBridge ?? (async (appId: string) => {
    health = connected(appId)
    return health
  })
  const deps: Partial<OnboardingDependencies> = {
    registerApp,
    renderQr: async () => 'data:image/png;base64,LOCAL_QR',
    probeApp: async () => options.probe ?? okProbe(),
    getBridgeHealth: () => health,
    waitForBridge,
  }
  const ctx = {
    credentials,
    settings: {
      writable: options.settingsWritable ?? true,
      ...(options.settingsCas ? {
        describe: () => [{ ns: SETTINGS_NAMESPACE, revision: settingsRevision }],
        mutate,
      } : {}),
    },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  }
  const service = new PersonalAgentOnboardingService(ctx as never, settings as never, deps)
  return {
    service,
    settings,
    mutate,
    credentials,
    updates,
    registerApp,
    registerAppMock,
    resolveRegistration: resolveRegistration!,
    changeSettings: (patch: Partial<FlatSettings>) => {
      current = { ...current, ...patch }
      settingsRevision += 1
    },
  }
}

async function waitForPhase(service: PersonalAgentOnboardingService, phase: string): Promise<void> {
  await vi.waitFor(() => expect(service.status().phase).toBe(phase), { timeout: 2_000 })
}

describe('PersonalAgent onboarding', () => {
  it('adds a scanned PersonalAgent directly to multi-bot settings', async () => {
    const primary = flatten({
      bots: [{
        id: 'primary',
        appId: 'cli_primary',
        appSecretRef: 'REF_PRIMARY',
        allowedOpenIds: ['ou_primary_owner'],
      }],
    }).bots[0]!
    const h = harness({ initialSettings: { bots: [primary] }, settingsCas: true })

    await h.service.start('select', 'new-bot')
    h.resolveRegistration({
      client_id: 'cli_second',
      client_secret: 'second-secret',
      user_info: { open_id: 'ou_second_owner', tenant_brand: 'lark' },
    })
    await waitForPhase(h.service, 'ready')

    expect(h.settings.update).not.toHaveBeenCalled()
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.updates[0]?.bots).toHaveLength(2)
    expect(h.updates[0]?.bots?.[0]).toEqual(primary)
    expect(h.updates[0]?.bots?.[1]).toMatchObject({
      id: 'bot-cli-second',
      enabled: true,
      appId: 'cli_second',
      brand: 'lark',
      allowedOpenIds: ['ou_second_owner'],
      allowAllUsers: false,
      contextBackend: 'sdk',
      sessionNamespace: 'app',
    })
    expect(h.updates[0]?.bots?.[1]?.appSecretRef).toMatch(/^DSH_FEISHU_APP_SECRET_[A-F0-9]{12}_[A-F0-9]{8}$/u)
    expect(JSON.stringify(h.updates)).not.toContain('second-secret')
    expect(h.service.status()).toMatchObject({ destination: 'new-bot', configured: true, connected: true })
  })

  it('does not duplicate a bot selected again in multi-bot onboarding', async () => {
    const existing = flatten({
      bots: [{ id: 'primary', appId: 'cli_existing', appSecretRef: 'REF_PRIMARY' }],
    }).bots[0]!
    const h = harness({ initialSettings: { bots: [existing] }, settingsCas: true })

    await h.service.start('select', 'new-bot')
    h.resolveRegistration({
      client_id: 'cli_existing',
      client_secret: 'duplicate-secret',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')

    expect(h.service.status().error?.code).toBe('duplicate_app')
    expect(h.settings.update).not.toHaveBeenCalled()
    expect(h.credentials.set).not.toHaveBeenCalled()
    expect(h.credentials.unset).not.toHaveBeenCalled()
    expect(JSON.stringify(h.service.status())).not.toContain('duplicate-secret')
  })

  it('cleans up the new credential when a concurrent settings revision wins', async () => {
    const existing = flatten({
      bots: [{ id: 'primary', appId: 'cli_primary', appSecretRef: 'REF_PRIMARY' }],
    }).bots[0]!
    const h = harness({ initialSettings: { bots: [existing] }, settingsCas: true })

    await h.service.start('create', 'new-bot')
    h.changeSettings({ maxTotalLiveAgents: 4 })
    h.resolveRegistration({
      client_id: 'cli_concurrent',
      client_secret: 'concurrent-secret',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')

    expect(h.service.status().error?.code).toBe('settings_changed')
    expect(h.credentials.set).toHaveBeenCalledOnce()
    expect(h.credentials.unset).toHaveBeenCalledOnce()
    expect(h.settings.update).not.toHaveBeenCalled()
  })

  it('offers an existing-app selection flow without forcing creation or targeting one App ID', async () => {
    const h = harness()
    await h.service.start('select')
    await vi.waitFor(() => expect(h.registerApp).toHaveBeenCalledOnce())
    const request = h.registerAppMock.mock.calls[0]?.[0]
    expect(request?.createOnly).toBeUndefined()
    expect(request?.appId).toBeUndefined()
    expect(h.service.status().mode).toBe('select')

    h.resolveRegistration({
      client_id: 'cli_existing',
      client_secret: 'existing-secret',
      user_info: { open_id: 'ou_existing_owner', tenant_brand: 'feishu' },
    })
    await waitForPhase(h.service, 'ready')
    expect(h.updates[0]).toMatchObject({
      appId: 'cli_existing',
      allowedOpenIds: 'ou_existing_owner',
      allowAllUsers: false,
    })
  })

  it('keeps create mode create-only and update mode targeted to the current app', async () => {
    const create = harness()
    await create.service.start('create')
    await vi.waitFor(() => expect(create.registerApp).toHaveBeenCalledOnce())
    expect(create.registerAppMock.mock.calls[0]?.[0]).toMatchObject({ createOnly: true })
    expect(create.registerAppMock.mock.calls[0]?.[0].appId).toBeUndefined()
    create.service.cancel()

    const update = harness({ initialSettings: { appId: 'cli_current' } })
    await update.service.start('update')
    await vi.waitFor(() => expect(update.registerApp).toHaveBeenCalledOnce())
    expect(update.registerAppMock.mock.calls[0]?.[0]).toMatchObject({ appId: 'cli_current' })
    expect(update.registerAppMock.mock.calls[0]?.[0].createOnly).toBeUndefined()
    update.service.cancel()
  })

  it('renders the QR locally, commits one atomic settings patch, and never exposes the secret', async () => {
    const h = harness()
    await h.service.start('create')
    await vi.waitFor(() => expect(h.service.status().qrImageDataUrl).toContain('LOCAL_QR'))
    expect(h.service.status().qrUrl).toContain('open.feishu.cn')

    h.resolveRegistration({
      client_id: 'cli_new',
      client_secret: 'top-secret-value',
      user_info: { open_id: 'ou_owner', tenant_brand: 'lark' },
    })
    await waitForPhase(h.service, 'ready')

    expect(h.credentials.set).toHaveBeenCalledOnce()
    expect(h.settings.update).toHaveBeenCalledOnce()
    expect(h.updates[0]).toMatchObject({
      appId: 'cli_new',
      brand: 'lark',
      onboardingManaged: true,
      allowedOpenIds: 'ou_owner',
      allowedChatIds: '',
      allowAllUsers: false,
    })
    expect(h.updates[0]?.appSecretRef).toMatch(/^DSH_FEISHU_APP_SECRET_[A-F0-9]{12}_[A-F0-9]{8}$/u)
    expect(JSON.stringify(h.updates)).not.toContain('top-secret-value')
    expect(JSON.stringify(h.service.status())).not.toContain('top-secret-value')
    expect(h.service.status().connected).toBe(true)
  })

  it('unsets the new credential when the atomic settings write fails', async () => {
    const h = harness({ settingsUpdate: async () => { throw new Error('disk read-only') } })
    await h.service.start()
    h.resolveRegistration({
      client_id: 'cli_new',
      client_secret: 'secret-for-rollback',
      user_info: { open_id: 'ou_owner', tenant_brand: 'feishu' },
    })
    await waitForPhase(h.service, 'failed')
    expect(h.credentials.set).toHaveBeenCalledOnce()
    expect(h.credentials.unset).toHaveBeenCalledOnce()
    expect(h.service.status().error?.code).toBe('settings_write_failed')
    expect(JSON.stringify(h.service.status())).not.toContain('secret-for-rollback')
  })

  it('refuses known-missing core permissions before writing credentials', async () => {
    const h = harness({
      probe: okProbe({
        capabilities: {
          core: 'missing',
          enhanced: 'missing',
          missingCore: ['card.action.trigger'],
          missingEnhanced: ['im:message.group_msg'],
        },
      }),
    })
    await h.service.start()
    h.resolveRegistration({
      client_id: 'cli_new',
      client_secret: 'never-written',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')
    expect(h.credentials.set).not.toHaveBeenCalled()
    expect(h.settings.update).not.toHaveBeenCalled()
    expect(h.service.status().error?.code).toBe('permissions_missing')
    expect(h.service.status().recoverableApp).toBe(true)
    expect(h.service.status().app?.appIdSuffix).toBe('li_new')

    await new Promise(resolve => setTimeout(resolve, 0))
    await h.service.start('update')
    await waitForPhase(h.service, 'failed')
    expect(h.registerApp).toHaveBeenCalledTimes(2)
    expect(h.registerAppMock.mock.calls[1]?.[0]).toMatchObject({ appId: 'cli_new' })
  })

  it('cancels a pre-commit registration without touching settings or credentials', async () => {
    const h = harness()
    await h.service.start()
    expect(h.service.cancel().phase).toBe('cancelled')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.credentials.set).not.toHaveBeenCalled()
    expect(h.settings.update).not.toHaveBeenCalled()
  })

  it('keeps the new config when only the long connection is temporarily unavailable', async () => {
    const h = harness({
      waitForBridge: async () => {
        throw Object.assign(new Error('offline'), { code: 'connection_timeout' })
      },
    })
    await h.service.start()
    h.resolveRegistration({
      client_id: 'cli_new',
      client_secret: 'saved-secret',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')
    expect(h.settings.update).toHaveBeenCalledOnce()
    expect(h.credentials.unset).not.toHaveBeenCalled()
    expect(h.service.status().configured).toBe(true)
    expect(h.service.status().error?.code).toBe('connection_timeout')
  })

  it('restores an existing working tuple after any rebind health-check failure', async () => {
    const h = harness({
      initialSettings: {
        appId: 'cli_old',
        appSecretRef: 'DSH_FEISHU_APP_SECRET_OLD',
        onboardingManaged: true,
        allowedOpenIds: 'ou_old',
        allowedChatIds: 'oc_team',
      },
      waitForBridge: async () => {
        throw Object.assign(new Error('initial connect rejected'), { code: 'connection_timeout' })
      },
    })
    await h.service.start()
    h.resolveRegistration({
      client_id: 'cli_new',
      client_secret: 'rolled-back-secret',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')
    expect(h.settings.update).toHaveBeenCalledTimes(2)
    expect(h.updates[1]).toMatchObject({
      appId: 'cli_old',
      appSecretRef: 'DSH_FEISHU_APP_SECRET_OLD',
      onboardingManaged: true,
      allowedOpenIds: 'ou_old',
      allowedChatIds: 'oc_team',
    })
    expect(h.credentials.unset).toHaveBeenCalledOnce()
    expect(h.service.status().configured).toBe(true)
    expect(h.service.status().app?.appIdSuffix).toBe('li_old')
    expect(h.service.status().error?.message).toContain('已恢复扫码前的本地配置')
  })

  it('refuses read-only settings before creating a Feishu app', async () => {
    const h = harness({ settingsWritable: false })
    await expect(h.service.start()).rejects.toThrow('设置存储为只读')
    expect(h.registerApp).not.toHaveBeenCalled()
  })

  it('refuses a non-writable credential provider before creating a Feishu app', async () => {
    const h = harness({ credentialWritable: false })
    await h.service.start()
    await waitForPhase(h.service, 'failed')
    expect(h.registerApp).not.toHaveBeenCalled()
    expect(h.service.status().error?.code).toBe('credential_write_unavailable')
  })

  it('does not overwrite settings changed while the QR confirmation was open', async () => {
    const h = harness({ initialSettings: { appId: 'cli_old', appSecretRef: 'OLD_REF' } })
    await h.service.start()
    h.changeSettings({ appId: 'cli_newer_manual', appSecretRef: 'NEWER_REF' })
    h.resolveRegistration({
      client_id: 'cli_scanned',
      client_secret: 'not-written',
      user_info: { open_id: 'ou_owner' },
    })
    await waitForPhase(h.service, 'failed')
    expect(h.service.status().error?.code).toBe('settings_changed')
    expect(h.settings.update).not.toHaveBeenCalled()
    expect(h.credentials.set).not.toHaveBeenCalled()
  })

  it('fences an aborted connection retry from overwriting a newer QR session', async () => {
    const h = harness({
      initialSettings: { appId: 'cli_old' },
      waitForBridge: async (_appId, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'abort' })), { once: true })
      }),
    })
    const retry = h.service.retryConnection()
    await waitForPhase(h.service, 'connecting')
    await h.service.start('create')
    await retry
    await waitForPhase(h.service, 'qr_ready')
    expect(h.service.status().phase).toBe('qr_ready')
    expect(h.service.status().qrUrl).toContain('open.feishu.cn')
  })

  it('ignores a stale expiry from an older registration after a new QR is active', async () => {
    let current = flatten({})
    const settings = {
      get: () => current,
      watch: () => () => undefined,
      replace: async () => undefined,
      update: async (patch: Partial<FlatSettings>) => { current = { ...current, ...patch } },
    }
    const registrations: Array<{
      resolve: (value: { client_id: string; client_secret: string; user_info: { open_id: string } }) => void
      reject: (error: unknown) => void
    }> = []
    const registerApp = vi.fn((request: Parameters<OnboardingDependencies['registerApp']>[0]) => {
      const index = registrations.length + 1
      request.onQRCodeReady({ url: `https://open.feishu.cn/page/launcher?user_code=session-${index}`, expireIn: 3600 })
      return new Promise((resolve, reject) => registrations.push({ resolve, reject }))
    }) as unknown as OnboardingDependencies['registerApp']
    const ctx = {
      settings: { writable: true },
      credentials: {
        describe: async () => ({ configured: false, writable: true }),
        set: async () => undefined,
        unset: async () => undefined,
      },
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }
    const service = new PersonalAgentOnboardingService(ctx as never, settings as never, {
      registerApp,
      renderQr: async url => `data:image/png;base64,${url.slice(-1)}`,
      probeApp: async () => okProbe(),
      getBridgeHealth: () => undefined,
      waitForBridge: async appId => connected(appId),
    })

    await service.start()
    await vi.waitFor(() => expect(registrations).toHaveLength(1))
    await service.start()
    await vi.waitFor(() => expect(registrations).toHaveLength(2))
    expect(service.status().qrUrl).toContain('session-2')

    registrations[0]!.reject(Object.assign(new Error('expired'), { code: 'expired_token' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(service.status().phase).toBe('qr_ready')
    expect(service.status().qrUrl).toContain('session-2')

    registrations[1]!.resolve({ client_id: 'cli_new', client_secret: 'secret', user_info: { open_id: 'ou_owner' } })
    await waitForPhase(service, 'ready')
  })

  it('validates RPC modes and unknown endpoints without starting registration', async () => {
    const h = harness()
    const signal = new AbortController().signal
    const badMode = await h.service.handleRpc('onboarding/start', { mode: 'replace' }, signal)
    const unknown = await h.service.handleRpc('onboarding/nope', {}, signal)
    expect(badMode).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(unknown).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(h.registerApp).not.toHaveBeenCalled()
  })
})

describe('onboarding projections', () => {
  it('classifies core and enhanced capabilities from the v6 app projection', () => {
    const probe = inspectAppProjection({
      app_name: 'Agent',
      owner: { owner_id: 'ou_owner' },
      scopes: [
        { scope: 'im:message.p2p_msg:readonly' },
        { scope: 'im:message.group_at_msg:readonly' },
        { scope: 'im:message.send_as_bot' },
      ],
      event: { subscribed_events: ['im.message.receive_v1'] },
      callback_info: { subscribed_callbacks: ['card.action.trigger'] },
    })
    expect(probe.ownerOpenId).toBe('ou_owner')
    expect(probe.capabilities.core).toBe('missing')
    expect(probe.capabilities.missingCore).toContain('im:message:send_as_bot')
    expect(probe.capabilities.enhanced).toBe('missing')
  })

  it('derives valid unique refs without including the App ID', () => {
    const first = onboardingCredentialRef('cli_sensitive_app_id', 'session-1')
    const second = onboardingCredentialRef('cli_sensitive_app_id', 'session-2')
    expect(first).toMatch(/^DSH_FEISHU_APP_SECRET_[A-F0-9]{12}_[A-F0-9]{8}$/u)
    expect(second).not.toBe(first)
    expect(first).not.toContain('sensitive')
  })
})
