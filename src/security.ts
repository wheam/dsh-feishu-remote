/**
 * Security helpers — ported from dsh-lark-bridge (MIT, imetn/dsh-lark-bridge)
 * and adapted for dsh-feishu-remote. Secret redaction, bounded text, file
 * sandboxing for the outbound/inbound workspace boundary.
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

const SECRET_ASSIGNMENT = /((?:api[_-]?key|app[_-]?secret|access[_-]?token|authorization|password|secret|token)\s*[=:]\s*["']?)([^\s,"'}]+)/giu
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu
const PROVIDER_KEY = /\b(sk-[A-Za-z0-9_-]{10,})\b/gu

export function redactSecrets(value: string): string {
  return value
    .replace(BEARER, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(PROVIDER_KEY, '[REDACTED]')
}

export function bounded(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/** Encode Markdown without ever exceeding the outbound file budget. */
export function boundedUtf8Buffer(value: string, maxBytes: number): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer')
  }
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) return encoded

  const footer = '\n\n… [内容因飞书文件大小限制已截断]\n'
  const footerBytes = Buffer.byteLength(footer)
  if (maxBytes <= footerBytes) return Buffer.from('.'.repeat(maxBytes), 'ascii')

  const prefixBudget = maxBytes - footerBytes
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= prefixBudget) low = middle
    else high = middle - 1
  }
  if (low > 0
    && value.charCodeAt(low - 1) >= 0xd800
    && value.charCodeAt(low - 1) <= 0xdbff
    && value.charCodeAt(low) >= 0xdc00
    && value.charCodeAt(low) <= 0xdfff) {
    low -= 1
  }
  return Buffer.from(`${value.slice(0, low)}${footer}`, 'utf8')
}

export function parseCsv(value: string | undefined): string[] {
  if (value === undefined) return []
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

export function parseBooleanEnv(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** @deprecated User access is always open; retained for API compatibility. */
export function isOpenIdAllowed(
  _openId: string,
  _allowAllUsers: boolean,
  _allowedOpenIds: readonly string[],
): boolean {
  return true
}

export function safeFileName(value: string | undefined, fallback: string): string {
  const leaf = basename((value ?? '').replaceAll('\\', '/'))
  const clean = leaf
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/^\.+/g, '')
    .trim()
  return bounded(clean || fallback, 180)
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Canonicalize a path (symlink-resolved) when it exists; otherwise keep it resolved. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Consume a download stream without buffering beyond the configured limit. */
export async function readBufferWithLimit(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
      total += chunk.byteLength
      if (total > maxBytes) throw new Error(`attachment exceeds the ${maxBytes}-byte inbound limit`)
      chunks.push(chunk)
    }
  } catch (error) {
    stream.destroy()
    throw error
  }
  return Buffer.concat(chunks, total)
}

export interface SafeOutboundFile {
  absolutePath: string
  fileName: string
  bytes: number
}

/** Resolve symlinks and require an ordinary file inside the configured workspace. */
export async function resolveOutboundFile(
  workspaceRoot: string,
  cwd: string,
  requested: string,
  maxBytes: number,
): Promise<SafeOutboundFile> {
  const candidate = resolve(cwd, requested)
  const [rootReal, targetReal] = await Promise.all([realpath(workspaceRoot), realpath(candidate)])
  if (!isInside(rootReal, targetReal)) throw new Error('file_path is outside the configured workspace root')
  const info = await stat(targetReal)
  if (!info.isFile()) throw new Error('file_path must identify a regular file')
  if (info.size > maxBytes) throw new Error(`file exceeds the ${maxBytes}-byte outbound limit`)
  return { absolutePath: targetReal, fileName: safeFileName(targetReal, 'attachment.bin'), bytes: info.size }
}

export interface SavedInboundFile {
  absolutePath: string
  fileName: string
  bytes: number
}

/** Persist one inbound object privately and exclusively under the bridge inbox. */
export async function saveInboundFile(
  inboundRoot: string,
  sessionKey: string,
  rawName: string | undefined,
  data: Buffer,
  maxBytes: number,
): Promise<SavedInboundFile> {
  if (data.byteLength === 0) throw new Error('received an empty attachment')
  if (data.byteLength > maxBytes) throw new Error(`attachment exceeds the ${maxBytes}-byte inbound limit`)
  const directory = join(inboundRoot, sessionKey.replace(/[^A-Za-z0-9_-]/g, '_'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const name = safeFileName(rawName, 'attachment.bin')
  const suffix = randomBytes(5).toString('hex')
  const path = join(directory, `${Date.now()}-${suffix}-${name}`)
  await writeFile(path, data, { flag: 'wx', mode: 0o600 })
  return { absolutePath: path, fileName: name, bytes: data.byteLength }
}

export function isImageFileName(fileName: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extname(fileName).toLowerCase())
}

/**
 * Write a full-text artifact into the workspace so oversized replies remain
 * readable on the Mac later (the phone cannot open the loopback Web UI). The
 * file lands under `<workspaceRoot>/.dsh-feishu-remote/` next to a session id.
 * The target directory is re-verified against the canonical workspace root so
 * a symlinked component cannot redirect the write outside (Codex P1-8).
 */
export async function saveOversizedText(
  workspaceRoot: string,
  sessionId: string,
  text: string,
): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot).catch(() => resolve(workspaceRoot))
  const directory = join(canonicalRoot, '.dsh-feishu-remote')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const canonicalDirectory = await realpath(directory)
  if (!isInside(canonicalRoot, canonicalDirectory)) {
    throw new Error('oversized-output directory escapes the workspace root')
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${stamp}-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.md`
  const path = join(canonicalDirectory, name)
  await writeFile(path, text, { flag: 'wx', mode: 0o600 })
  return path
}
