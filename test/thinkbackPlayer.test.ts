import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('registered Thinkback native player', () => {
  let directory: string
  let skill: string
  let player: string
  let binary: string
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ur thinkback '))
    const install = join(directory, 'registered plugin')
    skill = join(install, 'skills', 'thinkback')
    player = join(skill, 'player.js')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'year_in_review.js'), 'module.exports = {title:"Fixture"};')
    writeFileSync(player, `
const fs = require('node:fs');
const path = require('node:path');
if (require.main !== module) throw new Error('Player must run as the main script');
const data = require('./year_in_review.js');
fs.writeFileSync(path.join(__dirname, 'played.json'), JSON.stringify({ title:data.title, bun:process.versions.bun, argv:process.argv[1] }));
`)
    const entry = join(directory, 'entry.ts')
    writeFileSync(entry, `
import { runThinkbackPlayer } from ${JSON.stringify(resolve('src/utils/thinkbackPlayer.ts'))};
process.exitCode = await runThinkbackPlayer(process.argv[2], [${JSON.stringify(install)}]);
`)
    binary = join(directory, process.platform === 'win32' ? 'UR player.exe' : 'UR player')
    const built = spawnSync(process.execPath, ['build', entry, '--compile', '--define', 'UR_NATIVE_BUILD=true', '--outfile', binary], {
      encoding: 'utf8', timeout: 60_000,
    })
    if (built.status !== 0) throw new Error(built.stderr)
  }, 70_000)
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  const run = (candidate: string) => spawnSync(binary, [candidate], {
    env: { ...process.env, PATH: '' }, cwd: directory, encoding: 'utf8', timeout: 10_000,
  })

  test('runs the registered CommonJS entry through embedded Bun without Node on PATH', () => {
    const result = run(player)
    expect(result.status).toBe(0)
    const played = JSON.parse(readFileSync(join(skill, 'played.json'), 'utf8'))
    expect(played.title).toBe('Fixture')
    expect(played.bun).toBeDefined()
    expect(played.argv).toBe(realpathSync(player))
  })

  test('refuses arbitrary script paths even when they are valid JavaScript', () => {
    const unauthorized = join(directory, 'unauthorized.js')
    const marker = join(directory, 'unauthorized-ran')
    writeFileSync(unauthorized, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`)
    const result = run(unauthorized)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not belong to an installed Thinkback plugin')
    expect(existsSync(marker)).toBe(false)
  })

  test('does not claim success when the registered player fails', () => {
    const original = readFileSync(player)
    try {
      writeFileSync(player, 'process.exit(4)')
      expect(run(player).status).toBe(4)
    } finally { writeFileSync(player, original) }
  })

  test('reports missing animation data before starting the player', () => {
    const data = join(skill, 'year_in_review.js')
    const original = readFileSync(data)
    try {
      rmSync(data)
      const result = run(player)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Thinkback playback unavailable')
    } finally { writeFileSync(data, original) }
  })

  test('reports a missing optional player dependency without installing packages', () => {
    const original = readFileSync(player)
    try {
      writeFileSync(player, "require('ur-missing-thinkback-fixture-dependency')")
      const result = run(player)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('ur-missing-thinkback-fixture-dependency')
    } finally { writeFileSync(player, original) }
  })

  test.skipIf(process.platform === 'win32')('rejects a player symlink escaping the registered skill', () => {
    const original = readFileSync(player)
    const outside = join(directory, 'outside.js')
    writeFileSync(outside, 'process.exit(0)')
    try {
      rmSync(player)
      symlinkSync(outside, player)
      expect(run(player).status).toBe(1)
    } finally { rmSync(player); writeFileSync(player, original) }
  })
})
