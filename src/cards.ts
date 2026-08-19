/**
 * Feishu card templates — adapted from dsh-lark-bridge (MIT, imetn/dsh-lark-bridge).
 * Single-session context (project dimension removed); group chats treat the
 * card as public: tool summaries only, never full arguments/results (docs/05 §2.9).
 */
import type { BridgeAction, CardPreset, ToolProgress, TurnProgress } from './types.js'
import { bounded, redactSecrets } from './security.js'

type CardTemplate = 'blue' | 'green' | 'orange' | 'red' | 'grey' | 'purple'
type ButtonType = 'default' | 'primary' | 'danger'

interface ButtonSpec {
  label: string
  type?: ButtonType
  value: BridgeAction
}

function button(spec: ButtonSpec, index: number, rowId: string): object {
  return {
    tag: 'button',
    element_id: `${rowId}_btn_${index}`,
    text: { tag: 'plain_text', content: spec.label },
    type: spec.type ?? 'default',
    width: 'fill',
    behaviors: [{ type: 'callback', value: spec.value }],
  }
}

function buttonRow(buttons: ButtonSpec[], rowId: string): object {
  return {
    tag: 'column_set',
    element_id: rowId,
    flex_mode: 'none',
    horizontal_spacing: '8px',
    columns: buttons.map((spec, index) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [button(spec, index, rowId)],
    })),
  }
}

function markdown(content: string, elementId?: string): object {
  return {
    tag: 'markdown',
    ...(elementId === undefined ? {} : { element_id: elementId }),
    content,
  }
}

/**
 * Feishu 卡片流式更新模式（streaming updates, docs/05 §2.5 + official
 * streaming-updates-openapi-overview）：卡片 config 带 `streaming_mode: true`
 * 后，客户端会把后续全量 patch 的文本增量按打字机效果渲染；终态 patch 显式
 * 置 `streaming_mode: false` 关闭模式（去掉生成中光标并固化摘要）。
 * 参数与官方文档/参考实现一致：70ms / 1 字符 / fast（快速上屏）。
 */
const STREAMING_CONFIG = {
  print_frequency_ms: { default: 70 },
  print_step: { default: 1 },
  print_strategy: 'fast',
} as const

/**
 * @param streaming `true` = 流式模式（运行中）；`false` = 显式关闭（终态）；
 *   `undefined` = 普通卡片，不携带 streaming 字段（审批/状态等非流式卡）。
 */
function card(title: string, template: CardTemplate, elements: object[], summary = title, streaming?: boolean): object {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      summary: { content: bounded(summary.replace(/\s+/g, ' ').trim(), 80) },
      ...(streaming === undefined ? {} : streaming
        ? { streaming_mode: true, streaming_config: STREAMING_CONFIG }
        : { streaming_mode: false }),
    },
    header: {
      title: { tag: 'plain_text', content: bounded(title, 80) },
      template,
      padding: '12px 12px 12px 12px',
    },
    body: {
      direction: 'vertical',
      vertical_spacing: '8px',
      padding: '12px 12px 12px 12px',
      elements,
    },
  }
}

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m${String(remainder).padStart(2, '0')}s`
}

function compactPath(path: string): string {
  const home = process.env.HOME
  return home !== undefined && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function toolLine(tool: ToolProgress, now: number): string {
  const icon = tool.finishedAt === undefined ? '⏳' : tool.failed ? '❌' : '✅'
  const duration = elapsed(tool.startedAt, tool.finishedAt ?? now)
  const summary = tool.summary === '' ? '' : ` · ${bounded(redactSecrets(tool.summary), 140)}`
  return `${icon} \`${tool.name}\`${summary} _${duration}_`
}

export interface TurnCardInput {
  progress: TurnProgress
  sessionId: string
  cwd: string
  model: string
  preset: CardPreset
  now?: number
  outcome?: 'completed' | 'cancelled' | 'blocked' | 'error'
  outcomeDetail?: string
  maxBodyChars: number
  truncated?: boolean
}

/** Build the single mutable card used from turn start through terminal outcome. */
export function buildTurnCard(input: TurnCardInput): object {
  const now = input.now ?? Date.now()
  const done = input.outcome !== undefined
  const titleByOutcome = {
    completed: '✅ DeepSeek Harness 已完成',
    cancelled: '⏹️ DeepSeek Harness 已停止',
    blocked: '⚠️ DeepSeek Harness 等待处理',
    error: '❌ DeepSeek Harness 执行失败',
  } as const
  const templateByOutcome = {
    completed: 'green',
    cancelled: 'grey',
    blocked: 'orange',
    error: 'red',
  } as const
  const title = done ? titleByOutcome[input.outcome!] : `⏳ DeepSeek Harness · ${elapsed(input.progress.startedAt, now)}`
  const template: CardTemplate = done ? templateByOutcome[input.outcome!] : 'blue'
  const elements: object[] = []

  if (input.preset === 'developer') {
    elements.push(markdown(`📁 ${compactPath(input.cwd)}  ·  🤖 ${input.model}  ·  🧵 \`${input.sessionId}\``))
  } else if (input.preset === 'standard') {
    elements.push(markdown(`🤖 ${input.model}  ·  🧵 \`${input.sessionId}\``))
  }

  const toolLimit = input.preset === 'developer' ? 12 : input.preset === 'standard' ? 6 : 0
  const visibleTools = toolLimit === 0 ? [] : input.progress.tools.slice(-toolLimit)
  if (visibleTools.length > 0) {
    const hidden = input.progress.tools.length - visibleTools.length
    const prefix = hidden > 0 ? `_前 ${hidden} 个工具调用已折叠_\n` : ''
    const lines = input.preset === 'developer'
      ? visibleTools.map(tool => toolLine(tool, now))
      : visibleTools.map(tool => {
        const icon = tool.finishedAt === undefined ? '⏳' : tool.failed ? '❌' : '✅'
        return `${icon} \`${tool.name}\``
      })
    elements.push(markdown(`**执行轨迹**\n${prefix}${lines.join('\n')}`))
  }

  const cleanText = redactSecrets(input.progress.visibleText).trim()
  if (cleanText !== '') {
    const body = bounded(cleanText, input.maxBodyChars)
    const notice = input.truncated === true ? '\n\n_输出过长已截断，全文见会话记录。_' : ''
    elements.push(markdown(`**${done ? '结果' : '实时输出'}**\n${body}${notice}`, 'bridge_output'))
  }

  const stats = [`⏱️ ${elapsed(input.progress.startedAt, now)}`]
  if (input.preset !== 'compact') stats.push(`🔧 ${input.progress.tools.length} 次工具调用`)
  if (input.preset === 'developer') {
    stats.push(`⬇️ ${input.progress.inputTokens} 输入 token`, `⬆️ ${input.progress.outputTokens} 输出 token`)
    if (input.progress.cacheReadTokens > 0) stats.push(`💾 ${input.progress.cacheReadTokens} 缓存 token`)
  } else if (input.preset === 'standard' && input.progress.inputTokens + input.progress.outputTokens > 0) {
    stats.push(`🪙 ${input.progress.inputTokens + input.progress.outputTokens} token`)
  }
  elements.push(markdown(stats.join('  ·  ')))

  if (input.outcomeDetail !== undefined && input.outcomeDetail.trim() !== '') {
    elements.push(markdown(`_${bounded(redactSecrets(input.outcomeDetail), 700)}_`))
  }

  if (!done) {
    elements.push(buttonRow([{
      label: '停止任务',
      type: 'danger',
      value: { bridge: 'dsh-feishu-remote', action: 'stop', sessionId: input.sessionId },
    }], 'bridge_turn_actions'))
  } else {
    elements.push(buttonRow([
      {
        label: '新会话',
        type: 'primary',
        value: { bridge: 'dsh-feishu-remote', action: 'new', sessionId: input.sessionId },
      },
      {
        label: '查看状态',
        value: { bridge: 'dsh-feishu-remote', action: 'status', sessionId: input.sessionId },
      },
      {
        label: `视图：${{ compact: '精简', standard: '标准', developer: '开发者' }[input.preset]}`,
        value: { bridge: 'dsh-feishu-remote', action: 'view', sessionId: input.sessionId },
      },
    ], 'bridge_turn_actions'))
  }

  return card(title, template, elements, cleanText || title, !done)
}

export interface ApprovalCardInput {
  token: string
  toolName: string
  reason?: string
  sessionId: string
  settled?: 'allowed' | 'rejected' | 'cancelled' | 'unavailable'
}

export function buildApprovalCard(input: ApprovalCardInput): object {
  if (input.settled !== undefined) {
    const labels = {
      allowed: ['✅ 已允许一次', 'green'],
      rejected: ['⛔ 已拒绝', 'red'],
      cancelled: ['⏹️ 请求已取消', 'grey'],
      unavailable: ['⌛ 请求已失效', 'orange'],
    } as const
    const [title, template] = labels[input.settled]
    return card(title, template, [markdown(`工具：\`${input.toolName}\`\n\n会话：\`${input.sessionId}\``)])
  }
  const reason = input.reason?.trim() === '' || input.reason === undefined
    ? '该操作超出当前自动权限，需要你明确确认。'
    : bounded(redactSecrets(input.reason), 1200)
  return card('🔐 DeepSeek Harness 请求授权', 'orange', [
    markdown([
      `**工具**：\`${input.toolName}\``,
      `**原因**：${reason}`,
      '',
      `会话：\`${input.sessionId}\``,
      '',
      '_只有卡片按钮与 `/approve` `/reject` 文字命令生效。_',
    ].join('\n')),
    buttonRow([
      {
        label: '仅允许这一次',
        type: 'primary',
        value: { bridge: 'dsh-feishu-remote', action: 'approval', token: input.token, decision: 'allow' },
      },
      {
        label: '拒绝',
        type: 'danger',
        value: { bridge: 'dsh-feishu-remote', action: 'approval', token: input.token, decision: 'reject' },
      },
    ], 'bridge_approval_actions'),
  ])
}

export interface StatusCardInput {
  sessionId: string
  status: 'idle' | 'running'
  cwd: string
  provider: string
  model: string
  connected: boolean
  pendingApprovals: number
  failedDeliveries: number
  preset: CardPreset
}

export function buildStatusCard(input: StatusCardInput): object {
  const status = input.status === 'running' ? '运行中' : '空闲'
  return card('DeepSeek Harness Feishu Remote', input.connected ? 'blue' : 'red', [
    markdown([
      `**状态**：${status}`,
      `**飞书长连接**：${input.connected ? '已连接' : '未连接'}`,
      `**会话**：\`${input.sessionId}\``,
      `**目录**：${compactPath(input.cwd)}`,
      `**模型**：${input.provider} / ${input.model}`,
      `**待审批**：${input.pendingApprovals}`,
      `**送达失败（审计）**：${input.failedDeliveries}`,
      `**卡片视图**：${input.preset}`,
    ].join('\n')),
  ], `${status} · ${input.model}`)
}

export function parseBridgeAction(value: unknown): BridgeAction | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const action = value as Record<string, unknown>
  if (action.bridge !== 'dsh-feishu-remote' || typeof action.action !== 'string') return undefined
  switch (action.action) {
    case 'stop':
    case 'new':
    case 'status':
    case 'view':
      return typeof action.sessionId === 'string' ? action as BridgeAction : undefined
    case 'approval':
      return typeof action.token === 'string' && (action.decision === 'allow' || action.decision === 'reject')
        ? action as BridgeAction
        : undefined
    default:
      return undefined
  }
}

/**
 * Constant-size fallback card for pathological payloads that still exceed the
 * 28KB patch budget after every shrink (Codex P1-12/review #2 finding 8):
 * no dynamic metadata beyond a bounded title — guaranteed far below the limit.
 * `state: 'running'` keeps the live-card semantics (streaming mode + stop
 * button) instead of mislabeling an in-flight turn as completed (Round 12 F4).
 */
export function buildOversizeCard(
  state: 'running' | 'completed' | 'cancelled' | 'blocked' | 'error',
  streaming = false,
  sessionId?: string,
): object {
  const titles = {
    running: ['⏳ DeepSeek Harness 生成中', 'blue'],
    completed: ['✅ DeepSeek Harness 已完成', 'green'],
    cancelled: ['⏹️ DeepSeek Harness 已停止', 'grey'],
    blocked: ['⚠️ DeepSeek Harness 等待处理', 'orange'],
    error: ['❌ DeepSeek Harness 执行失败', 'red'],
  } as const
  const [title, template] = titles[state]
  const elements: object[] = [
    markdown('输出过大，无法在卡片中呈现；请到 Web GUI 的会话记录中查看完整输出。'),
  ]
  if (state === 'running' && sessionId !== undefined) {
    elements.push(buttonRow([{
      label: '停止任务',
      type: 'danger',
      value: { bridge: 'dsh-feishu-remote', action: 'stop', sessionId },
    }], 'bridge_turn_actions'))
  }
  return card(title, template, elements, title, streaming)
}
