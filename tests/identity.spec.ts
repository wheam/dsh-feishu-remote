import { describe, expect, it } from 'vitest'
import { activeSessionsForPrefix, effectiveSessionPrefix, freshSessionId, latestSession, originOf, sessionPrefix, sessionPrefixForBot, sessionsForPrefix } from '../src/identity.js'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'

function header(id: string, createdAt: number): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt }
}

describe('session identity (private / ordinary group / topic)', () => {
  it('routes p2p messages to a per-chat key', () => {
    const origin = originOf({ chatType: 'p2p', chatId: 'oc_private', threadId: undefined, rootId: undefined })
    expect(origin).toEqual({ kind: 'p2p', key: 'p2p:oc_private' })
  })

  it('routes group threads to a per-thread key (threadId preferred over rootId)', () => {
    const withThread = originOf({ chatType: 'group', chatId: 'oc_team', threadId: 'omt_1', rootId: 'om_root' }, 'topic')
    expect(withThread).toEqual({ kind: 'thread', key: 'group:oc_team:thread:omt_1' })
    const withRootOnly = originOf({ chatType: 'group', chatId: 'oc_team', threadId: undefined, rootId: 'om_root' }, 'topic')
    expect(withRootOnly).toEqual({ kind: 'thread', key: 'group:oc_team:thread:om_root' })
  })

  it('routes an ordinary group to one chat-scoped key, even for a reply carrying rootId', () => {
    const topLevel = originOf({ chatType: 'group', chatId: 'oc_team', threadId: undefined, rootId: undefined }, 'group')
    const reply = originOf({ chatType: 'group', chatId: 'oc_team', threadId: undefined, rootId: 'om_root' }, 'group')
    expect(topLevel).toEqual({ kind: 'group', key: 'group:oc_team:chat' })
    expect(reply).toEqual(topLevel)
  })

  it('flags topic-chat messages outside a thread for rejection', () => {
    const origin = originOf({ chatType: 'group', chatId: 'oc_team', threadId: undefined, rootId: undefined }, 'topic')
    expect(origin.kind).toBe('nonthread')
  })

  it('uses the feishu- branded prefix and sortable fresh ids', () => {
    const prefix = sessionPrefix('p2p:oc_private')
    expect(prefix).toMatch(/^feishu-[a-f0-9]{24}$/u)
    expect(String(freshSessionId(prefix, 1_000))).toBe(`${prefix}-${(1_000).toString(36)}`)
    // Different from the upstream lark-bridge prefix — sessions must not mix in the GUI list.
    expect(prefix.startsWith('lark-')).toBe(false)
  })

  it('isolates app-scoped bots while preserving the exact legacy prefix', () => {
    const key = 'group:oc_same:thread:omt_same'
    expect(sessionPrefixForBot('cli_a', key)).not.toBe(sessionPrefixForBot('cli_b', key))
    expect(effectiveSessionPrefix('legacy', 'cli_a', key)).toBe(sessionPrefix(key))
    expect(effectiveSessionPrefix('app', 'cli_a', key)).toBe(sessionPrefixForBot('cli_a', key))
    expect(effectiveSessionPrefix('app', 'cli_a', key)).not.toContain('cli_a')
  })

  it('selects and lists the newest persisted session for one origin', () => {
    const prefix = sessionPrefix('p2p:oc_private')
    const headers = [
      header(`${prefix}-a`, 10),
      header('other-a', 99),
      header(`${prefix}-b`, 20),
    ]
    expect(latestSession(headers, prefix)?.id).toBe(`${prefix}-b`)
    expect(sessionsForPrefix(headers, prefix).map(item => item.id)).toEqual([`${prefix}-b`, `${prefix}-a`])
  })

  it('excludes GUI-archived sessions from automatic resume', () => {
    const prefix = sessionPrefix('p2p:oc_private')
    const headers = [
      header(`${prefix}-a`, 10),
      header(`${prefix}-b`, 20),
    ]
    expect(activeSessionsForPrefix(headers, prefix, new Set([`${prefix}-b`])).map(item => item.id))
      .toEqual([`${prefix}-a`])
  })
})
