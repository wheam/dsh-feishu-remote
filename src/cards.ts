/**
 * Feishu card templates — adapted from dsh-lark-bridge (MIT, imetn/dsh-lark-bridge).
 * Single-session context (project dimension removed); group chats treat the
 * card as public: tool summaries only, never full arguments/results (docs/05 §2.9).
 */
import type { BridgeAction, TurnProgress } from './types.js'
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

function card(
  title: string | undefined,
  template: CardTemplate | undefined,
  elements: object[],
  summary = title ?? '',
): object {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      summary: { content: bounded(summary.replace(/\s+/g, ' ').trim(), 80) },
    },
    ...(title === undefined
      ? {}
      : {
          header: {
            title: { tag: 'plain_text', content: bounded(title, 80) },
            ...(template === undefined ? {} : { template }),
            padding: '12px 12px 12px 12px',
          },
        }),
    body: {
      direction: 'vertical',
      vertical_spacing: '8px',
      padding: '12px 12px 12px 12px',
      elements,
    },
  }
}

function compactPath(path: string): string {
  const home = process.env.HOME
  return home !== undefined && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function latestStepText(progress: TurnProgress): string {
  const step = progress.steps.findLast(item => (item.final ?? item.chunks).trim() !== '')
  return step === undefined ? progress.visibleText : step.final ?? step.chunks
}

export interface TurnCardInput {
  progress: TurnProgress
  outcome?: 'completed' | 'cancelled' | 'blocked' | 'error'
  outcomeDetail?: string
  maxBodyChars: number
  truncated?: boolean
}

/** Build the single mutable card used from turn start through terminal outcome. */
export function buildTurnCard(input: TurnCardInput): object {
  const done = input.outcome !== undefined
  const statusByOutcome = {
    completed: '✅ 完成',
    cancelled: '⏹️ 已停止',
    blocked: '⚠️ 等待处理',
    error: '❌ 执行失败',
  } as const
  const status = done ? statusByOutcome[input.outcome!] : '⏳ 正在处理…'
  const terminalText = input.progress.terminalText
  const rawText = done
    ? terminalText === undefined || terminalText.trim() === ''
      ? latestStepText(input.progress)
      : terminalText
    : latestStepText(input.progress)
  const cleanText = redactSecrets(rawText).trim()
  const liveLimit = Math.min(input.maxBodyChars, 2_000)
  const bodyLimit = done ? input.maxBodyChars : liveLimit
  const body = bounded(cleanText, bodyLimit)
  const wasTruncated = cleanText.length > bodyLimit || input.truncated === true
  const parts = [`**${status}**`]
  if (body !== '') parts.push(body)
  if (done && input.outcomeDetail !== undefined && input.outcomeDetail.trim() !== '') {
    parts.push(`_${bounded(redactSecrets(input.outcomeDetail), 700)}_`)
  }
  if (done && wasTruncated) parts.push('_输出过长已截断，全文见会话记录。_')

  return card(undefined, undefined, [markdown(parts.join('\n\n'), 'bridge_output')], cleanText || status)
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
  /** Context backfill status (docs/13 §3.4). */
  context?: {
    mode: 'off' | 'auto'
    backend?: 'cli' | 'sdk'
    unavailable?: string
    circuitOpen: boolean
  }
}

export function buildStatusCard(input: StatusCardInput): object {
  const status = input.status === 'running' ? '运行中' : '空闲'
  const contextLine = input.context === undefined || input.context.mode === 'off'
    ? '**飞书上下文**：已关闭'
    : input.context.circuitOpen
      ? '**飞书上下文**：熔断中（连续失败，稍后自动恢复）'
      : input.context.backend === undefined
        ? `**飞书上下文**：不可用（${input.context.unavailable ?? '未找到 lark-cli'}）`
        : `**飞书上下文**：已启用（${input.context.backend}）`
  return card('DeepSeek Harness Feishu Remote', input.connected ? 'blue' : 'red', [
    markdown([
      `**状态**：${status}`,
      `**飞书长连接**：${input.connected ? '已连接' : '未连接'}`,
      `**会话**：\`${input.sessionId}\``,
      `**目录**：${compactPath(input.cwd)}`,
      `**模型**：${input.provider} / ${input.model}`,
      `**待审批**：${input.pendingApprovals}`,
      `**送达失败（审计）**：${input.failedDeliveries}`,
      contextLine,
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
 * no dynamic metadata — guaranteed far below the limit.
 * `state: 'running'` avoids mislabeling an in-flight turn as completed.
 */
export function buildOversizeCard(
  state: 'running' | 'completed' | 'cancelled' | 'blocked' | 'error',
): object {
  const labels = {
    running: '⏳ 正在处理…',
    completed: '✅ 完成',
    cancelled: '⏹️ 已停止',
    blocked: '⚠️ 等待处理',
    error: '❌ 执行失败',
  } as const
  const label = labels[state]
  return card(undefined, undefined, [markdown(`**${label}**\n\n输出过大，无法在卡片中呈现；请到 Web GUI 的会话记录中查看完整输出。`)], label)
}
