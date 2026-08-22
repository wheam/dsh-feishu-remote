import { createHash } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import type { ProfileSnapshot } from './types.js'

export const PROFILE_MAX_BYTES = 32 * 1024

/** User/log-safe Profile failure without leaking an absolute local path. */
export function safeProfileError(error: unknown, path: string): string {
  const leaf = basename(path.replaceAll('\\', '/')) || 'profile.md'
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  const raw = error instanceof Error ? error.message : String(error)
  let reason = '无法读取或验证'
  if (code === 'ENOENT') reason = '文件不存在'
  else if (code === 'EACCES' || code === 'EPERM') reason = '没有读取权限'
  else if (/group\/world|父目录/u.test(raw)) reason = '文件或父目录权限不安全'
  else if (/UTF-8/u.test(raw)) reason = '不是合法 UTF-8'
  else if (/NUL/u.test(raw)) reason = '包含 NUL 字符'
  else if (/不能为空/u.test(raw)) reason = '内容为空'
  else if (/上限/u.test(raw)) reason = `超过 ${PROFILE_MAX_BYTES} 字节上限`
  else if (/读取期间/u.test(raw)) reason = '读取期间发生变化，请重试'
  return `Profile ${leaf} ${reason}`
}

function expandProfilePath(raw: string, home = homedir()): string {
  const value = raw.trim()
  if (value === '~') return home
  if (value.startsWith('~/')) return join(home, value.slice(2))
  if (!isAbsolute(value)) throw new Error('Profile 必须使用绝对路径或 ~/ 开头的路径。')
  return resolve(value)
}

function assertTrustedStat(info: { uid: number; mode: number }, label: string): void {
  const uid = typeof process.getuid === 'function' ? process.getuid() : info.uid
  if (info.uid !== uid && info.uid !== 0) throw new Error(`${label} owner 不是当前用户或 root`)
  if ((info.mode & 0o022) !== 0) throw new Error(`${label} 不能被 group/world 写入`)
}

async function assertTrustedParents(target: string, home = homedir()): Promise<void> {
  const canonicalHome = await realpath(home).catch(() => resolve(home))
  let current = dirname(target)
  const root = parse(current).root
  for (;;) {
    const info = await stat(current)
    if (!info.isDirectory()) throw new Error(`Profile 父路径不是目录：${current}`)
    assertTrustedStat(info, `Profile 父目录 ${current}`)
    if (current === root || current === canonicalHome) break
    current = dirname(current)
  }
}

export class ProfileLoader {
  async load(path: string): Promise<ProfileSnapshot> {
    const requested = expandProfilePath(path)
    const canonical = await realpath(requested)
    await assertTrustedParents(canonical)
    const handle = await open(canonical, 'r')
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new Error('Profile 必须是普通文件')
      assertTrustedStat(before, 'Profile 文件')
      if (before.size > PROFILE_MAX_BYTES) throw new Error(`Profile 超过 ${PROFILE_MAX_BYTES} 字节上限`)
      const buffer = Buffer.alloc(PROFILE_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > PROFILE_MAX_BYTES) throw new Error(`Profile 超过 ${PROFILE_MAX_BYTES} 字节上限`)
      if (bytesRead !== before.size) throw new Error('Profile 未能完整读取，请重试')
      const after = await handle.stat()
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error('Profile 在读取期间发生变化，请重试')
      }
      let text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
      if (text.includes('\u0000')) throw new Error('Profile 不能包含 NUL 字符')
      text = text.replace(/^\uFEFF/u, '').trim()
      if (text === '') throw new Error('Profile 不能为空')
      return {
        path: canonical,
        text,
        digest: createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex'),
        bytes: bytesRead,
        loadedAt: Date.now(),
      }
    } catch (error) {
      if (error instanceof TypeError && /encoded data/u.test(error.message)) throw new Error('Profile 不是合法 UTF-8')
      throw error
    } finally {
      await handle.close()
    }
  }
}
