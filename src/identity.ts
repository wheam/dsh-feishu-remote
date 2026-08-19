/**
 * Session identity — three-branch originKey (triple-review revised),
 * `feishu-` session prefix, and persistence-backed session lookup.
 * Session persistence is the single source of truth: no explicit mapping table.
 */
import { createHash } from 'node:crypto'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'

/**
 * Origin routing result. P0 rejects group messages outside any thread
 * ("请在话题内 @我") — they never reach session creation.
 */
export type Origin =
  | { kind: 'p2p'; key: string }
  | { kind: 'thread'; key: string }
  | { kind: 'nonthread'; key: string }

/**
 * Three-branch origin key (docs/05 §2.6):
 * - p2p → `p2p:<chatId>`
 * - group thread → `group:<chatId>:thread:<thread_id>` (thread_id preferred, falls back to root_id)
 * - group non-thread → `nonthread` marker; the caller rejects before any session work.
 */
export function originOf(message: Pick<NormalizedMessage, 'chatType' | 'chatId' | 'threadId' | 'rootId'>): Origin {
  if (message.chatType === 'p2p') {
    return { kind: 'p2p', key: `p2p:${message.chatId}` }
  }
  const threadId = message.threadId ?? message.rootId
  if (threadId !== undefined && threadId !== '') {
    return { kind: 'thread', key: `group:${message.chatId}:thread:${threadId}` }
  }
  return { kind: 'nonthread', key: `group:${message.chatId}:nonthread` }
}

/** Deterministic session prefix: SHA-256 first 24 hex chars under the `feishu-` brand. */
export function sessionPrefix(key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24)
  return `feishu-${digest}`
}

export function freshSessionId(prefix: string, now = Date.now()): SessionId {
  return SessionId(`${prefix}-${now.toString(36)}`)
}

export function latestSession(headers: readonly SessionHeader[], prefix: string): SessionHeader | undefined {
  return headers
    .filter(header => String(header.id).startsWith(`${prefix}-`))
    .toSorted((left, right) => right.createdAt - left.createdAt)[0]
}

export function sessionsForPrefix(headers: readonly SessionHeader[], prefix: string): SessionHeader[] {
  return headers
    .filter(header => String(header.id).startsWith(`${prefix}-`))
    .toSorted((left, right) => right.createdAt - left.createdAt)
}

/** Session headers for one prefix, excluding GUI-archived sessions (docs/05 §2.6). */
export function activeSessionsForPrefix(
  headers: readonly SessionHeader[],
  prefix: string,
  archived: ReadonlySet<string>,
): SessionHeader[] {
  return sessionsForPrefix(headers, prefix)
    .filter(header => !archived.has(String(header.id)))
}
