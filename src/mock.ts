/**
 * Mock channel adapter — dev/test infrastructure borrowed from dsh-im-hub
 * (MIT, ThreeBody6666/dsh-im-hub): no Feishu credentials needed to exercise
 * the text path end-to-end. Reads one message per stdin line, prints replies
 * to stdout. Coverage boundary (docs/05 §7): text path only — no real card
 * interaction, no approval buttons (use the `/approve` `/reject` text
 * fallback), and stdin is not guaranteed in a shell-App-launched process.
 *
 * Enable by configuring `appId: 'mock'` + any appSecret, or by passing the
 * factory explicitly in tests.
 */
import { createInterface } from 'node:readline'
import type { CardActionEvent, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { LarkChannelLike } from './types.js'

let sequence = 0

function summarizeInput(input: Record<string, unknown>): string {
  if (typeof input.markdown === 'string') return input.markdown
  if (typeof input.text === 'string') return input.text
  if (typeof input.card === 'object' && input.card !== null) return '[card]'
  if (typeof input.file === 'object' && input.file !== null) return '[file]'
  if (typeof input.image === 'object' && input.image !== null) return '[image]'
  return JSON.stringify(input)
}

type MessageHandler = (message: NormalizedMessage) => void | Promise<void>
type CardActionHandler = (event: CardActionEvent) => void | Promise<void>

export interface MockChannelOptions {
  logger?: {
    info?: (message: string, ...args: unknown[]) => void
    warn?: (message: string, ...args: unknown[]) => void
  }
  /** Feed messages programmatically instead of reading stdin (tests). */
  feed?: (emit: (content: string) => void) => void
}

/** A minimal LarkChannelLike reading p2p lines from stdin and echoing replies to stdout. */
export function createMockChannel(options: MockChannelOptions = {}): LarkChannelLike {
  const messageHandlers: MessageHandler[] = []
  const cardActionHandlers: CardActionHandler[] = []
  let readline: ReturnType<typeof createInterface> | undefined
  let connected = false

  const emitMessage = (content: string): void => {
    const message: NormalizedMessage = {
      messageId: `om_mock_${++sequence}`,
      chatId: 'oc_mock_p2p',
      chatType: 'p2p',
      senderId: 'ou_mock_tester',
      content,
      rawContentType: 'text',
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: true,
      createTime: Date.now(),
    }
    for (const handler of [...messageHandlers]) void handler(message)
  }

  return {
    botIdentity: { openId: 'ou_mock_bot', name: 'mock-bot' },
    async connect() {
      connected = true
      if (typeof options.feed === 'function') {
        options.feed(emitMessage)
        return
      }
      readline = createInterface({ input: process.stdin })
      readline.on('line', (line: string) => {
        if (line.trim() === '') return
        emitMessage(line)
      })
      console.log('[dsh-feishu-remote mock] 从 stdin 逐行读取消息，回复打印到 stdout')
      options.logger?.info?.('dsh-feishu-remote: mock channel ready (stdin → stdout)')
    },
    async disconnect() {
      connected = false
      readline?.close()
    },
    getConnectionStatus() {
      return { state: connected ? 'connected' as const : 'idle' as const, reconnectAttempts: 0 }
    },
    on(name, handler) {
      if (name === 'message') {
        messageHandlers.push(handler as MessageHandler)
      } else if (name === 'cardAction') {
        cardActionHandlers.push(handler as CardActionHandler)
      }
      return () => undefined
    },
    async send(to, input) {
      console.log(`[mock → ${to}] ${summarizeInput(input as Record<string, unknown>)}`)
      return { messageId: `om_mock_${++sequence}` }
    },
    async updateCard(messageId, card) {
      console.log(`[mock patch ${messageId}] ${summarizeInput(card as Record<string, unknown>)}`)
    },
    async addReaction() {
      return 'reaction_mock'
    },
    async removeReactionByEmoji() {
      return true
    },
    async downloadMessageResource() {
      throw new Error('mock channel does not download message resources')
    },
  }
}
