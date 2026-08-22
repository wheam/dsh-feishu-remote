import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROFILE_MAX_BYTES, ProfileLoader } from '../src/profile.js'

const directories: string[] = []

async function fixture(name = 'profile.md', content: string | Uint8Array = '# Bot\n\nDefault Chinese.'): Promise<string> {
  const directory = await mkdtemp(join(homedir(), '.dsh-profile-test-'))
  directories.push(directory)
  const path = join(directory, name)
  await writeFile(path, content, { mode: 0o600 })
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('ProfileLoader', () => {
  it('loads an immutable UTF-8 snapshot and keeps template braces literal', async () => {
    const path = await fixture('profile.md', '\uFEFF  # Persona\n\nUse {{example}} literally.  ')
    const snapshot = await new ProfileLoader().load(path)
    expect(snapshot.text).toBe('# Persona\n\nUse {{example}} literally.')
    expect(snapshot.bytes).toBeGreaterThan(0)
    expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('accepts a symlink only after validating its canonical target', async () => {
    const target = await fixture('target.md', '# Canonical')
    const link = join(target, '..', 'profile-link.md')
    await symlink(target, link)
    const snapshot = await new ProfileLoader().load(link)
    expect(snapshot.path).toBe(target)
    expect(snapshot.text).toBe('# Canonical')
  })

  it('rejects unsafe modes, invalid UTF-8, NUL, empty and oversized files', async () => {
    const unsafe = await fixture('unsafe.md', '# unsafe')
    await chmod(unsafe, 0o666)
    await expect(new ProfileLoader().load(unsafe)).rejects.toThrow('group/world')

    const invalid = await fixture('invalid.md', new Uint8Array([0xff, 0xfe]))
    await expect(new ProfileLoader().load(invalid)).rejects.toThrow('UTF-8')

    const nul = await fixture('nul.md', new Uint8Array([0x61, 0, 0x62]))
    await expect(new ProfileLoader().load(nul)).rejects.toThrow('NUL')

    const empty = await fixture('empty.md', '  \n')
    await expect(new ProfileLoader().load(empty)).rejects.toThrow('不能为空')

    const large = await fixture('large.md', 'x'.repeat(PROFILE_MAX_BYTES + 1))
    await expect(new ProfileLoader().load(large)).rejects.toThrow('上限')
  })

  it('rejects a writable parent directory even when the file itself is private', async () => {
    const path = await fixture()
    const directory = join(path, '..')
    await chmod(directory, 0o777)
    await expect(new ProfileLoader().load(path)).rejects.toThrow('父目录')
  })
})
