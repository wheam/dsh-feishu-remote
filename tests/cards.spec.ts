import { describe, expect, it } from 'vitest'
import { buildApprovalCard, buildStatusCard, buildTurnCard, parseBridgeAction } from '../src/cards.js'
import type { TurnProgress } from '../src/types.js'

function progress(partial: Partial<TurnProgress> = {}): TurnProgress {
  return {
    turn: 1,
    startedAt: 1_000,
    prompt: 'hello',
    visibleText: 'Hello from the harness.',
    steps: [{ turn: 1, step: 1, chunks: 'Hello', final: 'Hello from the harness.' }],
    tools: [{ callId: 'c1', name: 'bash', summary: 'ls', startedAt: 1_100, finishedAt: 1_500 }],
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 0,
    terminal: false,
    ...partial,
  }
}

describe('card templates', () => {
  it('builds a mutable progress card with tool trace and stats', () => {
    const card = buildTurnCard({
      progress: progress(),
      sessionId: 'feishu-abc-1',
      cwd: '/tmp/work',
      model: 'v4-pro',
      preset: 'standard',
      maxBodyChars: 12000,
      now: 3_000,
    }) as { schema: string; config: { update_multi: boolean }; body: { elements: object[] } }
    expect(card.schema).toBe('2.0')
    expect(card.config.update_multi).toBe(true)
    const body = JSON.stringify(card.body)
    expect(body).toContain('Hello from the harness')
    expect(body).toContain('bash')
    expect(body).toContain('停止任务')
    expect(body).not.toContain('/tmp/work') // standard preset hides cwd
  })

  it('renders terminal outcome headers and actions', () => {
    const card = buildTurnCard({
      progress: progress({ visibleText: '' }),
      sessionId: 'feishu-abc-1',
      cwd: '/tmp/work',
      model: 'v4-pro',
      preset: 'standard',
      maxBodyChars: 12000,
      outcome: 'completed',
    }) as { header: { title: { content: string }; template: string }; body: { elements: object[] } }
    expect(card.header.title.content).toContain('已完成')
    expect(card.header.template).toBe('green')
    expect(JSON.stringify(card.body)).toContain('新会话')
    expect(JSON.stringify(card.body)).not.toContain('停止任务')
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
      provider: 'deepseek',
      model: 'v4-pro',
      connected: false,
      pendingApprovals: 2,
      preset: 'standard',
    }) as { header: { template: string }; body: { elements: object[] } }
    expect(card.header.template).toBe('red')
    expect(JSON.stringify(card.body)).toContain('未连接')
    expect(JSON.stringify(card.body)).toContain('2')
  })

  it('parses and validates bridge actions', () => {
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'stop', sessionId: 's1' }))
      .toMatchObject({ action: 'stop', sessionId: 's1' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'approval', token: 't', decision: 'allow' }))
      .toMatchObject({ action: 'approval', decision: 'allow' })
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'approval', token: 't', decision: 'maybe' })).toBeUndefined()
    expect(parseBridgeAction({ bridge: 'other-bridge', action: 'stop' })).toBeUndefined()
    expect(parseBridgeAction({ bridge: 'dsh-feishu-remote', action: 'steer' })).toBeUndefined()
    expect(parseBridgeAction('not-an-object')).toBeUndefined()
  })
})
