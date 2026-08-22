import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertWorkspacePathScope,
  createWorkspacePath,
  expandWorkspacePath,
  listWorkspaceParentSuggestions,
  resolveExistingWorkspacePath,
  workspacePathForName,
} from '../src/workspace.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fakeHome(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-workspace-home-')))
  roots.push(root)
  return root
}

describe('Workspace path selection', () => {
  it('expands ~, accepts quoted absolute paths, and rejects relative paths', async () => {
    const home = await fakeHome()
    expect(expandWorkspacePath('~/Projects/demo', home)).toBe(join(home, 'Projects/demo'))
    expect(expandWorkspacePath(`'${join(home, 'folder with spaces')}'`, home)).toBe(join(home, 'folder with spaces'))
    expect(() => expandWorkspacePath('relative/project', home)).toThrow('绝对路径')
  })

  it('rejects filesystem roots and the whole user home as overly broad', async () => {
    const home = await fakeHome()
    expect(() => assertWorkspacePathScope('/', home)).toThrow('范围过大')
    expect(() => assertWorkspacePathScope(home, home)).toThrow('范围过大')
  })

  it('creates exactly one project leaf and reuses an existing directory', async () => {
    const home = await fakeHome()
    const parent = join(home, 'Documents')
    await mkdir(parent)
    const target = join(parent, 'My Project')
    const created = await createWorkspacePath(target, home)
    expect(created).toBe(await realpath(target))
    expect((await stat(target)).isDirectory()).toBe(true)
    await expect(createWorkspacePath(target, home)).resolves.toBe(await realpath(target))
    await expect(createWorkspacePath(join(parent, 'missing', 'nested'), home)).rejects.toThrow('父目录不存在')
  })

  it('revalidates an existing symlink target before reusing it', async () => {
    const home = await fakeHome()
    const parent = join(home, 'Documents')
    await mkdir(parent)
    const alias = join(parent, 'home-alias')
    await symlink(home, alias, 'dir')
    await expect(createWorkspacePath(alias, home)).rejects.toThrow('范围过大')
  })

  it('requires existing paths to be directories and validates simple project names', async () => {
    const home = await fakeHome()
    const parent = join(home, 'Documents')
    await mkdir(parent)
    await expect(resolveExistingWorkspacePath(parent, home)).resolves.toBe(await realpath(parent))
    expect(workspacePathForName(parent, ' Curio App ')).toBe(join(parent, 'Curio App'))
    expect(() => workspacePathForName(parent, '../escape')).toThrow('项目名')
  })

  it('lists only Mac suggestion folders that actually exist', async () => {
    const home = await fakeHome()
    await mkdir(join(home, 'Documents'))
    await mkdir(join(home, 'Desktop'))
    const suggestions = await listWorkspaceParentSuggestions(home)
    expect(suggestions.map(item => item.id)).toEqual(['documents', 'desktop'])
    expect(suggestions[0]).toMatchObject({ recommended: true, title: '文稿 / Documents' })
  })
})
