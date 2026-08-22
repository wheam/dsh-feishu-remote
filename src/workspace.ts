/**
 * Workspace selection and local-path safety for the Feishu setup flow.
 *
 * DSH's Workspace Registry remains the source of truth. This module only
 * normalizes explicit user paths and creates one requested leaf directory;
 * it never guesses a project from the bridge process cwd.
 */
import { mkdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'

export type WorkspaceParentId = 'documents' | 'desktop' | 'downloads' | 'developer' | 'projects'

export interface WorkspaceParentSuggestion {
  id: WorkspaceParentId
  title: string
  path: string
  recommended: boolean
}

const PARENT_CANDIDATES: ReadonlyArray<{
  id: WorkspaceParentId
  title: string
  child: string
  recommended?: boolean
}> = [
  { id: 'documents', title: '文稿 / Documents', child: 'Documents', recommended: true },
  { id: 'desktop', title: '桌面 / Desktop', child: 'Desktop' },
  { id: 'downloads', title: '下载 / Downloads', child: 'Downloads' },
  { id: 'developer', title: 'Developer', child: 'Developer' },
  { id: 'projects', title: 'Projects', child: 'Projects' },
]

function unwrapPath(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value.at(-1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
      return value.slice(1, -1).trim()
    }
  }
  return value
}

/** Expand only a leading `~` belonging to the current user. */
export function expandWorkspacePath(raw: string, home = homedir()): string {
  const value = unwrapPath(raw)
  if (value === '~') return home
  if (value.startsWith('~/')) return join(home, value.slice(2))
  if (!isAbsolute(value)) throw new Error('请提供绝对路径，或使用 ~/ 开头的路径。')
  return resolve(value)
}

/**
 * Refuse roots whose scope is too broad for a remotely controlled agent.
 * Common user folders such as Documents or Downloads are allowed only when
 * the user explicitly names them; the picker uses them as parent suggestions.
 */
export function assertWorkspacePathScope(path: string, home = homedir()): void {
  const target = resolve(path)
  const root = parse(target).root
  const broad = new Set([
    root,
    resolve(home),
    resolve(dirname(home)),
    resolve(root, 'System'),
    resolve(root, 'Library'),
    resolve(root, 'Applications'),
    resolve(root, 'private'),
    resolve(root, 'usr'),
    resolve(root, 'bin'),
    resolve(root, 'sbin'),
    resolve(root, 'etc'),
    resolve(root, 'var'),
  ])
  if (broad.has(target)) {
    throw new Error('该目录范围过大，不能作为远程 Workspace；请选择具体的项目文件夹。')
  }
}

export async function resolveExistingWorkspacePath(raw: string, home = homedir()): Promise<string> {
  const requested = expandWorkspacePath(raw, home)
  assertWorkspacePathScope(requested, home)
  const canonical = await realpath(requested).catch(() => {
    throw new Error(`目录不存在：${requested}`)
  })
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new Error(`路径不是文件夹：${canonical}`)
  assertWorkspacePathScope(canonical, home)
  return canonical
}

/** Create exactly one leaf directory below an existing parent, then canonicalize it. */
export async function createWorkspacePath(raw: string, home = homedir()): Promise<string> {
  const requested = expandWorkspacePath(raw, home)
  assertWorkspacePathScope(requested, home)
  try {
    const canonical = await realpath(requested)
    const existing = await stat(canonical)
    if (!existing.isDirectory()) throw new Error(`路径不是文件夹：${canonical}`)
    assertWorkspacePathScope(canonical, home)
    return canonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const parent = await realpath(dirname(requested)).catch(() => {
    throw new Error(`父目录不存在：${dirname(requested)}`)
  })
  const parentInfo = await stat(parent)
  if (!parentInfo.isDirectory()) throw new Error(`父路径不是文件夹：${parent}`)
  const target = join(parent, basename(requested))
  assertWorkspacePathScope(target, home)
  await mkdir(target, { mode: 0o700 })
  return resolveExistingWorkspacePath(target, home)
}

export function workspacePathForName(parent: string, rawName: string): string {
  const name = rawName.normalize('NFKC').trim()
  if (name === '' || name === '.' || name === '..' || name.length > 100
    || /[/\\\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error('项目名必须是 1–100 个字符，且不能包含斜杠或控制字符。')
  }
  return join(parent, name)
}

/** Existing Mac folders suitable as parents for a newly created Workspace. */
export async function listWorkspaceParentSuggestions(home = homedir()): Promise<WorkspaceParentSuggestion[]> {
  const suggestions = await Promise.all(PARENT_CANDIDATES.map(async candidate => {
    const path = join(home, candidate.child)
    try {
      const canonical = await realpath(path)
      const info = await stat(canonical)
      if (!info.isDirectory()) return undefined
      return {
        id: candidate.id,
        title: candidate.title,
        path: canonical,
        recommended: candidate.recommended === true,
      }
    } catch {
      return undefined
    }
  }))
  return suggestions.filter((item): item is WorkspaceParentSuggestion => item !== undefined)
}
