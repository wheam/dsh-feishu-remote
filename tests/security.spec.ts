import { chmod, lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  boundedUtf8Buffer,
  canonicalPath,
  isOpenIdAllowed,
  readBufferWithLimit,
  redactSecrets,
  resolveOutboundFile,
  safeFileName,
  saveInboundFile,
  saveOversizedText,
} from '../src/security.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-security-'))
  roots.push(root)
  return root
}

describe('security helpers', () => {
  it('redacts provider keys, bearer credentials, and named secret assignments', () => {
    const output = redactSecrets('api_key=abc123xyz token: topsecret Bearer aa.bb.cc sk-1234567890abcdef')
    expect(output).not.toContain('abc123xyz')
    expect(output).not.toContain('topsecret')
    expect(output).not.toContain('aa.bb.cc')
    expect(output).not.toContain('sk-1234567890abcdef')
    expect(output.match(/\[REDACTED\]/gu)?.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps the legacy user-access helper open for API compatibility', () => {
    expect(isOpenIdAllowed('ou_owner', false, ['ou_owner'])).toBe(true)
    expect(isOpenIdAllowed('ou_other', false, ['ou_owner'])).toBe(true)
    expect(isOpenIdAllowed('ou_other', false, [])).toBe(true)
  })

  it('normalizes hostile attachment names', () => {
    expect(safeFileName('../../bad\\name?.txt', 'fallback.bin')).toBe('name_.txt')
    expect(safeFileName('...', 'fallback.bin')).toBe('fallback.bin')
  })

  it('rejects symlinks escaping the workspace and enforces size', async () => {
    const workspace = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(workspace, 'ok.txt'), 'hello')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape.txt'))
    await expect(resolveOutboundFile(workspace, workspace, 'ok.txt', 5)).resolves.toMatchObject({ bytes: 5 })
    await expect(resolveOutboundFile(workspace, workspace, 'ok.txt', 4)).rejects.toThrow('outbound limit')
    await expect(resolveOutboundFile(workspace, workspace, 'escape.txt', 100)).rejects.toThrow('outside')
  })

  it('writes inbound data as a private exclusive file', async () => {
    const workspace = await tempRoot()
    const inbox = join(workspace, 'inbox')
    await mkdir(inbox)
    await chmod(inbox, 0o700)
    const saved = await saveInboundFile(inbox, 'session:key', '../demo.txt', Buffer.from('hello'), 10)
    expect(saved.fileName).toBe('demo.txt')
    expect((await lstat(saved.absolutePath)).mode & 0o777).toBe(0o600)
  })

  it('stops streaming inbound data as soon as it exceeds the limit', async () => {
    await expect(readBufferWithLimit(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 5))
      .rejects.toThrow('inbound limit')
    await expect(readBufferWithLimit(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 6))
      .resolves.toEqual(Buffer.from('abcdef'))
  })

  it('bounds long Markdown by UTF-8 bytes without splitting surrogate pairs', () => {
    const output = boundedUtf8Buffer('开头🙂'.repeat(30), 80)
    expect(output.byteLength).toBeLessThanOrEqual(80)
    expect(output.toString('utf8')).toContain('已截断')
    expect(output.toString('utf8')).not.toContain('\ufffd')
    expect(boundedUtf8Buffer('hello', 5).toString()).toBe('hello')
    expect(boundedUtf8Buffer('hello', 2).toString()).toBe('..')
    expect(() => boundedUtf8Buffer('hello', 0)).toThrow('positive safe integer')
  })

  it('saves oversized text into the workspace with a session id', async () => {
    const workspace = await tempRoot()
    const path = await saveOversizedText(workspace, 'feishu-abc', 'very long body')
    expect(path.startsWith(join(canonicalPath(workspace), '.dsh-feishu-remote'))).toBe(true)
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
  })
})
