/**
 * Feishu card templates — adapted from dsh-lark-bridge (MIT, imetn/dsh-lark-bridge).
 * Single-session context (project dimension removed); group chats treat the
 * card as public: tool summaries only, never full arguments/results (docs/05 §2.9).
 */
import type { BridgeAction, TurnProgress } from './types.js'
import { bounded, redactSecrets } from './security.js'
import type { WorkspaceParentSuggestion } from './workspace.js'

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

function buttonRows(buttons: ButtonSpec[], rowId: string, perRow = 2): object[] {
  const rows: object[] = []
  for (let index = 0; index < buttons.length; index += perRow) {
    rows.push(buttonRow(buttons.slice(index, index + perRow), `${rowId}_${index / perRow}`))
  }
  return rows
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

function workspaceTitle(title: string, showPaths: boolean): string {
  const clean = bounded(redactSecrets(title), 80)
  if (showPaths) return clean
  const leaf = clean.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1)
  return leaf === undefined || leaf.trim() === '' ? 'Workspace' : leaf
}

function latestStepText(progress: TurnProgress): string {
  const step = progress.steps.findLast(item => (item.final ?? item.chunks).trim() !== '')
  return step === undefined ? progress.visibleText : step.final ?? step.chunks
}

/**
 * Feishu card Markdown mention for an authenticated event sender. Restrict the
 * value to an Open ID before embedding it in markup so untrusted payload text
 * can never inject another card tag (especially `id=all`).
 */
function requesterLine(openId: string | undefined): string | undefined {
  if (openId === undefined || !/^ou_[A-Za-z0-9_-]{1,128}$/u.test(openId)) return undefined
  return `**回复：** <at id="${openId}"></at>`
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
  const requester = requesterLine(input.progress.reply?.requesterOpenId)
  if (requester !== undefined) parts.push(requester)
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
  botId?: string
  sessionId: string
  status: 'idle' | 'running'
  cwd: string
  workspaceTitle: string
  showPath: boolean
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
  workspacePolicy?: 'default' | 'locked'
  defaultWorkspaceTitle?: string
  agentPreset?: string
  profile?: { basename: string; bytes: number; digest: string; loadedAt: number }
  capacity?: { live: number; provisional: number; totalLive?: number; totalProvisional?: number; maxTotal?: number }
}

export function buildStatusCard(input: StatusCardInput): object {
  const status = input.status === 'running' ? '运行中' : '空闲'
  const workspaceLine = input.showPath
    ? `**目录**：${compactPath(input.cwd)}`
    : `**Workspace**：${bounded(redactSecrets(input.workspaceTitle), 80)}`
  const contextLine = input.context === undefined || input.context.mode === 'off'
    ? '**飞书上下文**：已关闭'
    : input.context.circuitOpen
      ? '**飞书上下文**：熔断中（连续失败，稍后自动恢复）'
      : input.context.backend === undefined
        ? `**飞书上下文**：不可用（${input.context.unavailable ?? '未找到 lark-cli'}）`
        : `**飞书上下文**：已启用（${input.context.backend}）`
  const optional = [
    ...(input.botId === undefined ? [] : [`**机器人**：${bounded(redactSecrets(input.botId), 60)}`]),
    ...(input.workspacePolicy === undefined ? [] : [
      `**Workspace 策略**：${input.workspacePolicy === 'locked' ? 'locked（管理员锁定）' : 'default'}`,
    ]),
    ...(input.defaultWorkspaceTitle === undefined ? [] : [
      `**默认 Workspace**：${bounded(redactSecrets(input.defaultWorkspaceTitle), 80)}`,
    ]),
    ...(input.agentPreset === undefined ? [] : [`**Agent preset**：${bounded(input.agentPreset, 80)}`]),
    ...(input.profile === undefined ? [] : [
      `**Profile**：${bounded(input.profile.basename, 80)} · ${input.profile.bytes} bytes · ${input.profile.digest.slice(0, 12)}`,
    ]),
    ...(input.capacity === undefined ? [] : [
      `**本机器人 Agent**：${input.capacity.live} live / ${input.capacity.provisional} provisional`,
      ...(input.capacity.totalLive === undefined ? [] : [
        `**全部飞书机器人 Agent**：${input.capacity.totalLive} live / ${input.capacity.totalProvisional ?? 0} provisional${(input.capacity.maxTotal ?? 0) > 0 ? ` / 上限 ${input.capacity.maxTotal}` : ''}`,
      ]),
    ]),
  ]
  return card('DeepSeek Harness Feishu Remote', input.connected ? 'blue' : 'red', [
    markdown([
      `**状态**：${status}`,
      `**飞书长连接**：${input.connected ? '已连接' : '未连接'}`,
      `**会话**：\`${input.sessionId}\``,
      workspaceLine,
      `**模型**：${input.provider} / ${input.model}`,
      `**待审批**：${input.pendingApprovals}`,
      `**送达失败（审计）**：${input.failedDeliveries}`,
      contextLine,
      ...optional,
    ].join('\n')),
  ], `${status} · ${input.model}`)
}

export interface WorkspaceCardItem {
  id: string
  title: string
  path: string
}

export interface WorkspaceChooserCardInput {
  token: string
  workspaces: WorkspaceCardItem[]
  currentWorkspaceId?: string
  showPaths: boolean
  hasPendingPrompt: boolean
}

/** First-use and `/workspace` picker. Paths are deliberately hidden in groups. */
export function buildWorkspaceChooserCard(input: WorkspaceChooserCardInput): object {
  const rows = input.workspaces.slice(0, 10).flatMap((workspace, index) => {
    const current = workspace.id === input.currentWorkspaceId
    const detail = input.showPaths ? `\n${compactPath(workspace.path)}` : ''
    return [
      markdown(`**${workspaceTitle(workspace.title, input.showPaths)}**${current ? ' · 当前' : ''}${detail}`),
      buttonRow([{
        label: current ? '继续使用' : '选择此 Workspace',
        type: current ? 'default' : 'primary',
        value: {
          bridge: 'dsh-feishu-remote',
          action: 'workspace-select',
          token: input.token,
          workspaceId: workspace.id,
        },
      }], `workspace_pick_${index}`),
    ]
  })
  const intro = input.hasPendingPrompt
    ? '这条消息尚未执行。先选择工作区，绑定完成后会自动继续。'
    : '选择这个飞书会话要使用的 DSH Workspace。'
  const empty = input.workspaces.length === 0
    ? [markdown('还没有已登记的 Workspace。你可以直接使用一个已有文件夹，或新建独立的项目文件夹。')]
    : []
  return card('选择 Workspace', 'blue', [
    markdown(intro),
    ...empty,
    ...rows,
    ...buttonRows([
      {
        label: '新建独立项目文件夹',
        type: 'primary',
        value: { bridge: 'dsh-feishu-remote', action: 'workspace-new', token: input.token },
      },
      {
        label: '直接使用已有文件夹',
        value: { bridge: 'dsh-feishu-remote', action: 'workspace-use', token: input.token },
      },
    ], 'workspace_create'),
    markdown('_也可以发送 `/workspace use ~/路径` 或 `/workspace create ~/路径`。_'),
  ], '选择或新建工作区')
}

export function buildWorkspaceUseCard(
  token: string,
  folders: WorkspaceParentSuggestion[],
  showPaths: boolean,
): object {
  const buttons: ButtonSpec[] = folders.map(folder => ({
    label: `${folder.recommended ? '推荐 · ' : ''}直接使用 ${folder.title}`,
    type: folder.recommended ? 'primary' : 'default',
    value: {
      bridge: 'dsh-feishu-remote',
      action: 'workspace-use-parent',
      token,
      parentId: folder.id,
    },
  }))
  const details = showPaths && folders.length > 0
    ? folders.map(folder => `- ${folder.title}：${compactPath(folder.path)}`).join('\n')
    : ''
  return card('直接使用已有文件夹', 'blue', [
    markdown('选择后，**该文件夹本身**会成为 Workspace，不会新建子文件夹；Agent 可以访问其中的全部内容。'),
    ...(details === '' ? [] : [markdown(details)]),
    ...buttonRows(buttons, 'workspace_use_parent'),
    buttonRow([{
      label: '输入其他已有文件夹路径…',
      value: { bridge: 'dsh-feishu-remote', action: 'workspace-use-path', token },
    }], 'workspace_use_custom_path'),
  ], '直接使用已有 Workspace 文件夹')
}

export function buildWorkspaceCreateCard(
  token: string,
  parents: WorkspaceParentSuggestion[],
  showPaths: boolean,
): object {
  const buttons: ButtonSpec[] = parents.map(parent => ({
    label: `${parent.recommended ? '推荐 · ' : ''}在 ${parent.title} 下新建`,
    type: parent.recommended ? 'primary' : 'default',
    value: {
      bridge: 'dsh-feishu-remote',
      action: 'workspace-parent',
      token,
      parentId: parent.id,
    },
  }))
  const details = showPaths && parents.length > 0
    ? parents.map(parent => `- ${parent.title}：${compactPath(parent.path)}`).join('\n')
    : ''
  return card('新建独立项目文件夹', 'blue', [
    markdown('这里选择的是**父目录**。选择后还需要发送项目名称；最终 Workspace 是“父目录/项目名”，不会把父目录本身作为 Workspace。'),
    ...(details === '' ? [] : [markdown(details)]),
    ...buttonRows(buttons, 'workspace_parent'),
    buttonRow([{
      label: '输入项目完整路径（可新建）…',
      value: { bridge: 'dsh-feishu-remote', action: 'workspace-create-path', token },
    }], 'workspace_custom_path'),
  ], '选择新 Workspace 的位置')
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
    case 'workspace-select':
      return typeof action.token === 'string' && typeof action.workspaceId === 'string'
        ? action as BridgeAction
        : undefined
    case 'workspace-new':
    case 'workspace-use':
    case 'workspace-use-path':
    case 'workspace-create-path':
    case 'workspace-path':
      return typeof action.token === 'string' ? action as BridgeAction : undefined
    case 'workspace-use-parent':
    case 'workspace-parent':
      return typeof action.token === 'string' && typeof action.parentId === 'string'
        ? action as BridgeAction
        : undefined
    default:
      return undefined
  }
}

/**
 * Constant-size fallback card for pathological payloads that still exceed the
 * 28KB patch budget after every shrink (Codex P1-12/review #2 finding 8):
 * only the optional validated requester Open ID is dynamic and tightly
 * bounded, so the card remains guaranteed far below the limit.
 * `state: 'running'` avoids mislabeling an in-flight turn as completed.
 */
export function buildOversizeCard(
  state: 'running' | 'completed' | 'cancelled' | 'blocked' | 'error',
  requesterOpenId?: string,
): object {
  const labels = {
    running: '⏳ 正在处理…',
    completed: '✅ 完成',
    cancelled: '⏹️ 已停止',
    blocked: '⚠️ 等待处理',
    error: '❌ 执行失败',
  } as const
  const label = labels[state]
  const parts = [`**${label}**`]
  const requester = requesterLine(requesterOpenId)
  if (requester !== undefined) parts.push(requester)
  parts.push('输出过大，无法在卡片中呈现；请到 Web GUI 的会话记录中查看完整输出。')
  return card(undefined, undefined, [markdown(parts.join('\n\n'))], label)
}
