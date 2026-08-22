import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeStateStore } from '../src/state.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function stateStore(): Promise<{ root: string; path: string; store: BridgeStateStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-state-'))
  roots.push(root)
  const path = join(root, 'state.json')
  return { root, path, store: new BridgeStateStore(path) }
}

describe('BridgeStateStore (lightweight metadata)', () => {
  it('persists and clears Workspace bindings without consuming /new unless requested atomically', async () => {
    const { path, store } = await stateStore()
    await store.setPendingNew('p2p:oc_1', true)
    await store.setWorkspace('p2p:oc_1', 'workspace-1')
    expect(store.workspaceFor('p2p:oc_1')).toBe('workspace-1')
    expect(store.isPendingNew('p2p:oc_1')).toBe(true)
    await store.setWorkspace('p2p:oc_1', 'workspace-1', { pendingNew: false })
    expect(store.isPendingNew('p2p:oc_1')).toBe(false)

    const reloaded = new BridgeStateStore(path)
    await reloaded.refresh()
    expect(reloaded.workspaceFor('p2p:oc_1')).toBe('workspace-1')
    await reloaded.setWorkspace('p2p:oc_1', undefined)
    expect(reloaded.workspaceFor('p2p:oc_1')).toBeUndefined()
  })

  it('persists the /new pending marker atomically', async () => {
    const { path, store } = await stateStore()
    await store.setPendingNew('p2p:oc_1', true)
    expect(store.isPendingNew('p2p:oc_1')).toBe(true)
    const text = await readFile(path, 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, pendingNew: { 'p2p:oc_1': true } })

    const reloaded = new BridgeStateStore(path)
    await reloaded.refresh()
    expect(reloaded.isPendingNew('p2p:oc_1')).toBe(true)
    await reloaded.setPendingNew('p2p:oc_1', false)
    expect(reloaded.isPendingNew('p2p:oc_1')).toBe(false)
  })

  it('persists topic activation across store reloads without changing the first mention time', async () => {
    const { path, store } = await stateStore()
    const key = 'group:oc_1:thread:omt_1'
    await store.activateThread(key, 123)
    await store.activateThread(key, 456)
    expect(store.isThreadActivated(key)).toBe(true)
    expect(store.snapshot().activatedThreads[key]).toBe(123)

    const reloaded = new BridgeStateStore(path)
    await reloaded.refresh()
    expect(reloaded.isThreadActivated(key)).toBe(true)
    expect(reloaded.snapshot().activatedThreads[key]).toBe(123)
  })

  it('persists card view preferences and callback verification', async () => {
    const { path, store } = await stateStore()
    await store.setCardView('p2p:oc_1', 'developer')
    await store.markCardVerified(9_000)

    const reloaded = new BridgeStateStore(path)
    await reloaded.refresh()
    expect(reloaded.cardViewFor('p2p:oc_1')).toBe('developer')
    expect(reloaded.snapshot().cardVerifiedAt).toBe(9_000)
  })

  it('isolates invalid JSON to a .corrupt file and rebuilds from empty state', async () => {
    const { path, store } = await stateStore()
    await writeFile(path, '{not json', { mode: 0o600 })
    const events: string[] = []
    store.onCorrupt.push(event => events.push(event.corruptPath))

    await expect(store.refresh()).resolves.toMatchObject({ pendingNew: {} })
    expect(events).toHaveLength(1)
    expect(events[0]!).toMatch(/\.corrupt-\d+$/u)
    // The original bad file was moved away, not silently overwritten.
    await expect(readFile(events[0]!, 'utf8')).resolves.toBe('{not json')
  })

  it('isolates unknown state versions instead of rejecting startup', async () => {
    const { path, store } = await stateStore()
    await writeFile(path, JSON.stringify({ version: 99, pendingNew: {} }), { mode: 0o600 })
    const events: string[] = []
    store.onCorrupt.push(event => events.push(event.reason))
    await expect(store.refresh()).resolves.toMatchObject({ version: 1, pendingNew: {} })
    expect(events.join('')).toContain('unsupported state file version')
  })

  it('isolates a state file readable by other users on POSIX', async () => {
    if (process.platform === 'win32') return
    const { path, store } = await stateStore()
    await writeFile(path, '{"version":1,"pendingNew":{}}\n', { mode: 0o644 })
    await chmod(path, 0o644)
    const events: string[] = []
    store.onCorrupt.push(() => events.push('perm'))
    await expect(store.refresh()).resolves.toMatchObject({ pendingNew: {} })
    expect(events).toEqual(['perm'])
  })

  it('serializes mutations through the internal queue', async () => {
    const { store } = await stateStore()
    await Promise.all([
      store.setPendingNew('a', true),
      store.setPendingNew('b', true),
      store.setPendingNew('a', false),
    ])
    expect(store.isPendingNew('a')).toBe(false)
    expect(store.isPendingNew('b')).toBe(true)
  })
})
