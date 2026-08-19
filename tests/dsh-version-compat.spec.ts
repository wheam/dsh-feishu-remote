/**
 * dsh 版本兼容闸（CI / pnpm run check 内建）。
 *
 * 兼容性基准 = Mac App 实际使用的 dsh（/opt/homebrew/bin/dsh），不是终端
 * PATH。若 Mac App 自动升级到新 rc 而插件仍锁定旧版本，本测试会**直接失败**
 * 并给出明确诊断——"检查全绿"从此不再可能掩盖版本漂移。
 * 事故背景：docs/11-incident-rc7-keyed-slot.md；固定规则：docs/12。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function versionOf(binary: string): string | undefined {
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const MAC_APP_BINARY = '/opt/homebrew/bin/dsh'
const MAC_APP_PACKAGE = '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json'

describe('dsh 版本兼容闸', () => {
  it('插件锁定的 rc 版本必须与 Mac App 实际使用的 dsh 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      peerDependencies?: Record<string, string>
    }
    const pin = manifest.peerDependencies?.['@deepseek-ai/dsh-agent']
    expect(pin, 'peerDependencies 必须精确锁定 dsh-agent 版本').toBeDefined()

    let runtimeVersion = versionOf(MAC_APP_BINARY)
    if (runtimeVersion === undefined && existsSync(MAC_APP_PACKAGE)) {
      runtimeVersion = (JSON.parse(readFileSync(MAC_APP_PACKAGE, 'utf8')) as { version?: string }).version
    }
    if (runtimeVersion === undefined) {
      console.warn('跳过：本机不是 Mac（找不到 /opt/homebrew/bin/dsh）')
      return
    }

    const localVersion = versionOf(`${process.env.HOME ?? ''}/.local/bin/dsh`)
    expect(
      runtimeVersion,
      `版本漂移：插件锁定 ${pin}，但 Mac App 使用的 dsh 是 ${runtimeVersion}` +
      `（终端 ~/.local/bin/dsh = ${localVersion ?? '无'}）。` +
      '不要继续安装/启用插件；先按 docs/12 适配插件到目标版本，或报告并停止。',
    ).toBe(pin)
  })
})
