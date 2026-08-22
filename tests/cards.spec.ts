import { describe, expect, it } from 'vitest'
import {
  buildApprovalCard,
  buildOversizeCard,
  buildStatusCard,
  buildTurnCard,
  buildWorkspaceChooserCard,
  buildWorkspaceCreateCard,
  parseBridgeAction,
} from '../src/cards.js'
import type { TurnProgress } from '../src/types.js'

function progress(partial: Partial<TurnProgress> = {}): TurnProgress {
  return {
    turn: 1,
    startedAt: 1_000,
    prompt: 'hello',
    visibleText: 'Hello from the harness.',
    steps: [{ turn: 1, step: 1, chunks: 'Hello', final: 'Hello from the harness.', hasToolCalls: false }],
    terminal: false,
    ...partial,
  }
}

describe('card templates', () => {
  it('builds a headerless progress card with only the latest assistant text', () => {
    const card = buildTurnCard({
      progress: progress({
        visibleText: 'Earlier progress.Latest progress.',
        steps: [
          { turn: 1, step: 1, chunks: '', final: 'Earlier progress.', hasToolCalls: true },
          { turn: 1, step: 2, chunks: 'Latest progress.', hasToolCalls: false },
        ],
      }),
      maxBodyChars: 12000,
    }) as { schema: string; config: { update_multi: boolean }; header?: object; body: { elements: object[] } }
    expect(card.schema).toBe('2.0')
    expect(card.config.update_multi).toBe(true)
    expect(card).not.toHaveProperty('header')
    const body = JSON.stringify(card.body)
    expect(body).toContain('正在处理')
    expect(body).toContain('Latest progress')
    expect(body).not.toContain('Earlier progress')
    for (const clutter of ['bash', '停止任务', '/tmp/work', 'v4-pro', 'feishu-abc-1', 'token', '飞书上下文']) {
      expect(body, clutter).not.toContain(clutter)
    }
  })

  it('renders a headerless terminal card with only the final answer', () => {
    const card = buildTurnCard({
      progress: progress({
        visibleText: 'I will inspect the code.The fix is complete and tests pass.',
        terminalText: 'The fix is complete and tests pass.',
        steps: [
          { turn: 1, step: 1, chunks: '', final: 'I will inspect the code.', hasToolCalls: true },
          { turn: 1, step: 2, chunks: '', final: 'The fix is complete and tests pass.', hasToolCalls: false },
        ],
      }),
      maxBodyChars: 12000,
      outcome: 'completed',
    }) as { header?: object; body: { elements: object[] } }
    expect(card).not.toHaveProperty('header')
    const body = JSON.stringify(card.body)
    expect(body).toContain('✅ 完成')
    expect(body).toContain('The fix is complete and tests pass.')
    expect(body).not.toContain('I will inspect the code.')
    for (const clutter of ['新会话', '查看状态', '视图：开发者', '停止任务', '/tmp/work', 'v4-pro', 'feishu-abc-1', 'token']) {
      expect(body, clutter).not.toContain(clutter)
    }
  })

  it('uses ordinary mutable patches so shorter progress cannot trigger typewriter artifacts', () => {
    const card = buildTurnCard({
      progress: progress(),
      maxBodyChars: 12000,
    }) as { config: Record<string, unknown>; body: { elements: Array<{ element_id?: string }> } }
    expect(card.config).not.toHaveProperty('streaming_mode')
    expect(card.config).not.toHaveProperty('streaming_config')
    // The output markdown element keeps a stable id across full-card patches.
    expect(card.body.elements.some(element => element.element_id === 'bridge_output')).toBe(true)
  })

  it('falls back from a blank terminalText to the latest non-empty step', () => {
    const card = buildTurnCard({
      progress: progress({ terminalText: '' }),
      maxBodyChars: 12000,
      outcome: 'completed',
    }) as { body: { elements: object[] } }
    expect(JSON.stringify(card.body)).toContain('Hello from the harness.')
  })

  it('keeps every terminal outcome out of streaming mode', () => {
    for (const outcome of ['completed', 'cancelled', 'blocked', 'error'] as const) {
      const card = buildTurnCard({
        progress: progress(),
        maxBodyChars: 12000,
        outcome,
      }) as { config: Record<string, unknown> }
      expect(card.config, outcome).not.toHaveProperty('streaming_mode')
    }
  })

  it('keeps live semantics on the headerless oversize fallback card', () => {
    const running = buildOversizeCard('running') as {
      config: Record<string, unknown>
      header?: object
      body: { elements: object[] }
    }
    expect(running.config).not.toHaveProperty('streaming_mode')
    expect(running).not.toHaveProperty('header')
    expect(JSON.stringify(running.body)).toContain('正在处理')
    expect(JSON.stringify(running.body)).not.toContain('停止任务')
    for (const outcome of ['completed', 'cancelled', 'blocked', 'error'] as const) {
      const card = buildOversizeCard(outcome) as { config: Record<string, unknown>; header?: object; body: { elements: object[] } }
      expect(card.config).not.toHaveProperty('streaming_mode')
      expect(card).not.toHaveProperty('header')
      expect(JSON.stringify(card.body)).not.toContain('停止任务')
    }
  })

  it('keeps non-progress cards out of streaming mode entirely', () => {
    const approval = buildApprovalCard({
      token: 't1',
      toolName: 'bash',
      sessionId: 'feishu-abc-1',
    }) as { config: Record<string, unknown> }
    expect(approval.config).not.toHaveProperty('streaming_mode')
    const status = buildStatusCard({
      sessionId: 'feishu-abc-1',
      status: 'idle',
      cwd: '/tmp/work',
      workspaceTitle: 'Work',
      showPath: true,
      provider: 'deepseek',
      model: 'v4-pro',
      connected: true,
      pendingApprovals: 0,
      failedDeliveries: 0,
    }) as { config: Record<string, unknown> }
    expect(status.config).not.toHaveProperty('streaming_mode')
  })

  it('shows the approval card with the text-fallback notice', () => {
    const card = buildApprovalCard({
      token: 't1',
      toolName: 'bash',
      reason: 'runs rm -rf',
      sessionId: 'feishu-abc-1',
    }) as { body: { elements: object[] } }
    const body = JSON.stringify(card.body)
    expect(body).toContain('bash')
    expect(body).toContain('仅允许这一次')
    expect(body).toContain('/approve')
  })

  it('renders a settled approval card', () => {
    const card = buildApprovalCard({
      token: 't1',
      toolName: 'bash',
      sessionId: 'feishu-abc-1',
      settled: 'allowed',
    }) as { header: { title: { content: string } } }
    expect(card.header.title.content).toContain('已允许')
  })

  it('shows the red status card while disconnected', () => {
    const card = buildStatusCard({
      sessionId: 'feishu-abc-1',
      status: 'idle',
      cwd: '/tmp/work',
      workspaceTitle: 'Work',
      showPath: true,
      provider: 'deepseek',
      model: 'v4-pro',
      connected: false,
      pendingApprovals: 2,
    }) as { header: { template: string }; body: { elements: object[] } }
    expect(card.header.template).toBe('red')
    expect(JSON.stringify(card.body)).toContain('未连接')
    expect(JSON.stringify(card.body)).toContain('2')
  })

  it('shows only the Workspace title when a group status card hides local paths', () => {
    const card = buildStatusCard({
      sessionId: 'feishu-abc-1',
      status: 'idle',
      cwd: '/Volumes/Secret/client-x',
      workspaceTitle: 'Client X',
      showPath: false,
      provider: 'deepseek',
      model: 'v4-pro',
      connected: true,
      pendingApprovals: 0,
      failedDeliveries: 0,
    }) as { body: { elements: object[] } }
    const body = JSON.stringify(card.body)
    expect(body).toContain('Client X')
    expect(body).not.toContain('/Volumes/Secret')
  })

  it('builds a Workspace chooser that can hide local paths in groups', () => {
    const group = buildWorkspaceChooserCard({
      token: 'token-1',
      workspaces: [{ id: 'ws-1', title: 'Curio', path: '/Users/me/Secret/Curio' }],
      showPaths: false,
      hasPendingPrompt: true,
    })
    const groupJson = JSON.stringify(group)
    expect(groupJson).toContain('Curio')
    expect(groupJson).toContain('workspace-select')
    expect(groupJson).toContain('自动继续')
    expect(groupJson).not.toContain('/Users/me/Secret')

    const direct = JSON.stringify(buildWorkspaceChooserCard({
      token: 'token-2',
      workspaces: [{ id: 'ws-1', title: 'Curio', path: '/Users/me/Secret/Curio' }],
      showPaths: true,
      hasPendingPrompt: false,
    }))
    expect(direct).toContain('/Users/me/Secret/Curio')
  })

  it('builds the new-Workspace parent picker', () => {
    const card = buildWorkspaceCreateCard('token-1', [{
      id: 'documents',
      title: '文稿 / Documents',
      path: '/Users/me/Documents',
      recommended: true,
    }], false)
    const json = JSON.stringify(card)
    expect(json).toContain('workspace-parent')
    expect(json).toContain('推荐')
    expect(json).toContain('workspace-path')
    expect(json).not.toContain('/Users/me/Documents')
  })

  it('parses and validates bridge actions', () => {
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'stop', sessionId: 's1' }))
      .toMatchObject({ action: 'stop', sessionId: 's1' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'approval', token: 't', decision: 'allow' }))
      .toMatchObject({ action: 'approval', decision: 'allow' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'workspace-select', token: 't', workspaceId: 'ws-1' }))
      .toMatchObject({ action: 'workspace-select', workspaceId: 'ws-1' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'workspace-parent', token: 't', parentId: 'documents' }))
      .toMatchObject({ action: 'workspace-parent', parentId: 'documents' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'approval', token: 't', decision: 'maybe' })).toBeUndefined()
    expect(parseBridgeAction({ bridge: 'other-bridge', action: 'stop' })).toBeUndefined()
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'steer' })).toBeUndefined()
    expect(parseBridgeAction('not-an-object')).toBeUndefined()
  })
})
