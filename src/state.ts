/**
 * Owner-only atomic metadata state. Keeps the user's Workspace selection and
 * lightweight metadata (`/new` pending markers, activated Feishu topics,
 * card view preferences, callback verification):
 * session identity lives in session persistence (single source of truth).
 * Corrupt or mis-permissioned files are isolated to `.corrupt-<ts>` with a
 * warning and rebuilt from an empty state — never silently overwritten.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContextWatermark } from './context.js'

export const STATE_VERSION = 1

/** Bounded persistent audit of terminal-delivery failures (docs/05 §6.4). */
export interface DeliveryFailureRecord {
  at: number
  sessionId: string
  messageId?: string
  classification: string
  disposition: string
  detail: string
}

export const MAX_DELIVERY_FAILURES = 50
/** Session-keyed context watermarks (docs/13 F6); bounded, oldest dropped. */
export const MAX_CONTEXT_WATERMARKS = 50

const DELIVERY_CLASSIFICATIONS = new Set(['rate-limit', 'permanent', 'transient'])
const DELIVERY_DISPOSITIONS = new Set(['permanent'])

export interface BridgeState {
  version: 1
  /** Feishu originKey → durable DSH Workspace id. */
  workspaceBindings: Record<string, string>
  /** originKey → true while a `/new` is pending (consumed by the next plain message). */
  pendingNew: Record<string, true>
  /** Thread originKey → first authorized @mention time; survives restarts. */
  activatedThreads: Record<string, number>
  /** originKey → card view preference. */
  cardViewPrefs: Record<string, 'compact' | 'standard' | 'developer'>
  cardVerifiedAt?: number
  /** Persistent audit trail of permanent outbound failures (survives restarts). */
  deliveryFailures: DeliveryFailureRecord[]
  /** sessionId → last injected context message (docs/13 F6); bounded, LRU-ish. */
  contextWatermarks: Record<string, ContextWatermark>
}

export interface CorruptStateEvent {
  path: string
  corruptPath: string
  reason: string
}

function emptyState(): BridgeState {
  return {
    version: 1,
    workspaceBindings: {},
    pendingNew: {},
    activatedThreads: {},
    cardViewPrefs: {},
    deliveryFailures: [],
    contextWatermarks: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(
  value: unknown,
  field: string,
  allowed: (item: string) => boolean,
): Record<string, string> {
  if (!isRecord(value)) throw new Error(`dsh-feishu-remote: invalid ${field} in state file`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() === '' || typeof item !== 'string' || !allowed(item)) {
      throw new Error(`dsh-feishu-remote: invalid ${field} entry in state file`)
    }
    result[key] = item
  }
  return result
}

function parseState(text: string): BridgeState {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`dsh-feishu-remote: invalid state JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(raw) || raw.version !== STATE_VERSION) throw new Error('dsh-feishu-remote: unsupported state file version')
  if (!isRecord(raw.pendingNew)) throw new Error('dsh-feishu-remote: invalid pendingNew in state file')
  const pendingNew: Record<string, true> = {}
  for (const [key, value] of Object.entries(raw.pendingNew)) {
    if (key.trim() === '' || value !== true) throw new Error('dsh-feishu-remote: invalid pendingNew entry in state file')
    pendingNew[key] = true
  }
  const workspaceBindings = stringRecord(
    raw.workspaceBindings ?? {},
    'workspaceBindings',
    value => value.length <= 200,
  )
  const activatedThreads: Record<string, number> = {}
  if (raw.activatedThreads !== undefined) {
    if (!isRecord(raw.activatedThreads)) throw new Error('dsh-feishu-remote: invalid activatedThreads in state file')
    for (const [key, value] of Object.entries(raw.activatedThreads)) {
      if (!key.startsWith('group:') || !key.includes(':thread:') || key.length > 500
        || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('dsh-feishu-remote: invalid activatedThreads entry in state file')
      }
      activatedThreads[key] = value
    }
  }
  const cardViewPrefs = stringRecord(
    raw.cardViewPrefs ?? {},
    'cardViewPrefs',
    value => value === 'compact' || value === 'standard' || value === 'developer',
  ) as Record<string, 'compact' | 'standard' | 'developer'>
  const cardVerifiedAt = typeof raw.cardVerifiedAt === 'number' && Number.isFinite(raw.cardVerifiedAt)
    ? raw.cardVerifiedAt
    : undefined
  const deliveryFailures: DeliveryFailureRecord[] = []
  if (raw.deliveryFailures !== undefined) {
    if (!Array.isArray(raw.deliveryFailures)) throw new Error('dsh-feishu-remote: invalid deliveryFailures in state file')
    // Strict per-record validation + semantic enums + field caps; keep the
    // NEWEST 50 (the writer's own retention policy) (review #6 finding 4).
    for (const item of raw.deliveryFailures.slice(-MAX_DELIVERY_FAILURES)) {
      if (!isRecord(item)
        || typeof item.at !== 'number' || !Number.isFinite(item.at)
        || typeof item.sessionId !== 'string' || item.sessionId.trim() === ''
        || item.sessionId.length > 200
        || (item.messageId !== undefined && (typeof item.messageId !== 'string' || item.messageId.length > 200))
        || typeof item.classification !== 'string'
        || !DELIVERY_CLASSIFICATIONS.has(item.classification)
        || typeof item.disposition !== 'string'
        || !DELIVERY_DISPOSITIONS.has(item.disposition)
        || typeof item.detail !== 'string') {
        throw new Error('dsh-feishu-remote: invalid deliveryFailure entry in state file')
      }
      deliveryFailures.push({
        at: item.at,
        sessionId: item.sessionId,
        ...(typeof item.messageId === 'string' ? { messageId: item.messageId } : {}),
        classification: item.classification,
        disposition: item.disposition,
        detail: item.detail.slice(0, 500),
      })
    }
  }
  const contextWatermarks: Record<string, ContextWatermark> = {}
  if (raw.contextWatermarks !== undefined) {
    if (!isRecord(raw.contextWatermarks)) throw new Error('dsh-feishu-remote: invalid contextWatermarks in state file')
    const entries = Object.entries(raw.contextWatermarks).slice(-MAX_CONTEXT_WATERMARKS)
    for (const [sessionId, item] of entries) {
      if (sessionId.trim() === '' || sessionId.length > 200 || !isRecord(item)
        || typeof item.messageId !== 'string' || item.messageId === '' || item.messageId.length > 200
        || typeof item.createdAtMs !== 'number' || !Number.isFinite(item.createdAtMs)) {
        throw new Error('dsh-feishu-remote: invalid contextWatermark entry in state file')
      }
      contextWatermarks[sessionId] = { messageId: item.messageId, createdAtMs: item.createdAtMs }
    }
  }
  return {
    version: 1,
    workspaceBindings,
    pendingNew,
    activatedThreads,
    cardViewPrefs,
    deliveryFailures,
    contextWatermarks,
    ...(cardVerifiedAt === undefined ? {} : { cardVerifiedAt }),
  }
}

/**
 * Owner-only, atomic persistent state for lightweight metadata. Corruption is
 * isolated and reported through `onCorrupt` instead of blocking startup.
 */
export class BridgeStateStore {
  private state: BridgeState = emptyState()
  private mutation: Promise<unknown> = Promise.resolve()
  readonly onCorrupt: Array<(event: CorruptStateEvent) => void> = []

  constructor(readonly path: string) {}

  snapshot(): BridgeState {
    return structuredClone(this.state)
  }

  async refresh(): Promise<BridgeState> {
    try {
      const info = await stat(this.path)
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        await this.isolateCorrupt(`state file must be owner-only (mode ${(info.mode & 0o777).toString(8)})`)
        this.state = emptyState()
        return this.snapshot()
      }
      try {
        this.state = parseState(await readFile(this.path, 'utf8'))
      } catch (error) {
        await this.isolateCorrupt(error instanceof Error ? error.message : String(error))
        this.state = emptyState()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = emptyState()
    }
    return this.snapshot()
  }

  private async isolateCorrupt(reason: string): Promise<void> {
    const corruptPath = `${this.path}.corrupt-${Date.now()}`
    try {
      await rename(this.path, corruptPath)
      this.onCorrupt.forEach(handler => handler({ path: this.path, corruptPath, reason }))
    } catch (error) {
      throw new Error(`dsh-feishu-remote: corrupt state file could not be isolated: ${error instanceof Error ? error.message : String(error)} (${reason})`)
    }
  }

  private async write(next: BridgeState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await chmod(directory, 0o700)
    const temporary = join(directory, `.${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      if (process.platform !== 'win32') await chmod(temporary, 0o600)
      await rename(temporary, this.path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    this.state = next
  }

  private mutate<T>(operation: (current: BridgeState) => Promise<{ next: BridgeState; result: T }> | { next: BridgeState; result: T }): Promise<T> {
    const run = this.mutation.then(async () => {
      const current = await this.refresh()
      const { next, result } = await operation(current)
      await this.write(next)
      return result
    })
    this.mutation = run.then(() => undefined, () => undefined)
    return run
  }

  /** Mark an origin for `/new`; the next plain message creates a fresh session and clears the mark. */
  async setPendingNew(key: string, pending: boolean): Promise<void> {
    await this.mutate(current => {
      const pendingNew = { ...current.pendingNew }
      if (pending) pendingNew[key] = true
      else delete pendingNew[key]
      return { next: { ...current, pendingNew }, result: undefined }
    })
  }

  isPendingNew(key: string): boolean {
    return this.state.pendingNew[key] === true
  }

  workspaceFor(key: string): string | undefined {
    return this.state.workspaceBindings[key]
  }

  /** Bind or unbind one Feishu origin; optionally set `/new` in the same atomic write. */
  async setWorkspace(
    key: string,
    workspaceId: string | undefined,
    options: { pendingNew?: boolean } = {},
  ): Promise<void> {
    await this.mutate(current => {
      const workspaceBindings = { ...current.workspaceBindings }
      const pendingNew = { ...current.pendingNew }
      if (workspaceId === undefined) delete workspaceBindings[key]
      else {
        if (workspaceId.trim() === '' || workspaceId.length > 200) {
          throw new Error('dsh-feishu-remote: invalid workspace id')
        }
        workspaceBindings[key] = workspaceId
      }
      if (options.pendingNew === true) pendingNew[key] = true
      else if (options.pendingNew === false) delete pendingNew[key]
      return { next: { ...current, workspaceBindings, pendingNew }, result: undefined }
    })
  }

  /** Persist the first authorized @mention that activates one group topic. */
  async activateThread(key: string, at = Date.now()): Promise<void> {
    if (!key.startsWith('group:') || !key.includes(':thread:')) {
      throw new Error('dsh-feishu-remote: only group thread origins can be activated')
    }
    await this.mutate(current => ({
      next: {
        ...current,
        activatedThreads: current.activatedThreads[key] === undefined
          ? { ...current.activatedThreads, [key]: at }
          : current.activatedThreads,
      },
      result: undefined,
    }))
  }

  isThreadActivated(key: string): boolean {
    return this.state.activatedThreads[key] !== undefined
  }

  async setCardView(key: string, preset: 'compact' | 'standard' | 'developer'): Promise<void> {
    await this.mutate(current => ({
      next: { ...current, cardViewPrefs: { ...current.cardViewPrefs, [key]: preset } },
      result: undefined,
    }))
  }

  cardViewFor(key: string): 'compact' | 'standard' | 'developer' | undefined {
    return this.state.cardViewPrefs[key]
  }

  async markCardVerified(now = Date.now()): Promise<void> {
    await this.mutate(current => ({ next: { ...current, cardVerifiedAt: now }, result: undefined }))
  }

  /** Append one permanent delivery failure; the trail is bounded (oldest dropped). */
  async recordDeliveryFailure(record: Omit<DeliveryFailureRecord, 'at'> & { at?: number }): Promise<void> {
    await this.mutate(current => ({
      next: {
        ...current,
        deliveryFailures: [
          ...current.deliveryFailures,
          { ...record, at: record.at ?? Date.now(), detail: record.detail.slice(0, 500) },
        ].slice(-MAX_DELIVERY_FAILURES),
      },
      result: undefined,
    }))
  }

  /** Last injected context message for a session (docs/13 F6); undefined = full window next time. */
  contextWatermarkFor(sessionId: string): ContextWatermark | undefined {
    return this.state.contextWatermarks[sessionId]
  }

  /** Persist a session watermark; bounded (oldest entries dropped), re-inserted for recency. */
  async setContextWatermark(sessionId: string, watermark: ContextWatermark): Promise<void> {
    await this.mutate(current => {
      const entries = Object.entries(current.contextWatermarks).filter(([key]) => key !== sessionId)
      const nextMap: Record<string, ContextWatermark> = {}
      for (const [key, value] of entries) nextMap[key] = value
      nextMap[sessionId] = watermark
      const overflow = Object.keys(nextMap).length - MAX_CONTEXT_WATERMARKS
      if (overflow > 0) {
        for (const key of Object.keys(nextMap).slice(0, overflow)) delete nextMap[key]
      }
      return { next: { ...current, contextWatermarks: nextMap }, result: undefined }
    })
  }
}
