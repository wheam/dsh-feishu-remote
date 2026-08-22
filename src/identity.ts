/**
 * Session identity — explicit private / ordinary-group / topic routing,
 * `feishu-` session prefix, and persistence-backed session lookup.
 * Session persistence is the single source of truth: no explicit mapping table.
 */
import { createHash } from 'node:crypto'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'

/**
 * Topic-chat messages outside a thread remain non-actionable. Ordinary-group
 * messages use one chat-scoped origin and are gated by an explicit @mention in
 * the bridge before they can reach session creation.
 */
export type Origin =
  | { kind: 'p2p'; key: string }
  | { kind: 'group'; key: string }
  | { kind: 'thread'; key: string }
  | { kind: 'nonthread'; key: string }

export type GroupChatMode = 'group' | 'topic'

/**
 * Origin key (docs/05 §2.6):
 * - p2p → `p2p:<chatId>`
 * - ordinary group → `group:<chatId>:chat`
 * - group thread → `group:<chatId>:thread:<thread_id>` (thread_id preferred, falls back to root_id)
 * - topic chat outside a thread → `nonthread` marker; the caller rejects before session work.
 *
 * Direct callers without a resolved mode retain the legacy thread/root
 * inference. The bridge itself supplies an authoritative mode and deliberately
 * falls back ambiguous root-only traffic to mention-only ordinary-group mode.
 */
export function originOf(
  message: Pick<NormalizedMessage, 'chatType' | 'chatId' | 'threadId' | 'rootId'>,
  groupMode?: GroupChatMode,
): Origin {
  if (message.chatType === 'p2p') {
    return { kind: 'p2p', key: `p2p:${message.chatId}` }
  }
  if (groupMode === 'group') {
    return { kind: 'group', key: `group:${message.chatId}:chat` }
  }
  const threadId = message.threadId ?? message.rootId
  if (threadId !== undefined && threadId !== '') {
    return { kind: 'thread', key: `group:${message.chatId}:thread:${threadId}` }
  }
  if (groupMode !== 'topic') {
    return { kind: 'group', key: `group:${message.chatId}:chat` }
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
