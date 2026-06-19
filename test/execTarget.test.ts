import { expect, test } from 'bun:test'
import {
  buildDockerArgs,
  defaultExecTargetConfig,
  isContainerized,
  resolveExecTarget,
  wrapCommand,
  type ExecTargetConfig,
} from '../src/services/agents/execTarget.ts'

test('local target passes commands through unchanged', () => {
  const config: ExecTargetConfig = { kind: 'local' }
  expect(isContainerized(config)).toBe(false)
  expect(wrapCommand(config, { file: 'bun', args: ['test'] }, '/repo')).toEqual({
    file: 'bun',
    args: ['test'],
  })
})

test('buildDockerArgs isolates network and mounts the workspace', () => {
  const config = defaultExecTargetConfig('node:22')
  const argv = buildDockerArgs(config, { file: 'bun', args: ['test', '--bail'] }, '/repo')
  expect(argv).toContain('--rm')
  expect(argv).toContain('--network')
  expect(argv).toContain('none')
  expect(argv.join(' ')).toContain('-v /repo:/workspace')
  expect(argv.join(' ')).toContain('-w /workspace')
  expect(argv.slice(-4)).toEqual(['node:22', 'bun', 'test', '--bail'])
})

test('buildDockerArgs ends with image then the command and args', () => {
  const argv = buildDockerArgs(
    { kind: 'docker', image: 'img:1', network: true },
    { file: 'pytest', args: ['-q'] },
    '/w',
  )
  // network true -> no --network none
  expect(argv).not.toContain('none')
  const imgIndex = argv.indexOf('img:1')
  expect(argv.slice(imgIndex)).toEqual(['img:1', 'pytest', '-q'])
})

test('buildDockerArgs forwards requested env vars and extra mounts', () => {
  const argv = buildDockerArgs(
    { kind: 'docker', image: 'img', env: ['CI'], mounts: ['/cache:/cache'] },
    { file: 'make', args: [] },
    '/w',
  )
  expect(argv.join(' ')).toContain('-e CI')
  expect(argv.join(' ')).toContain('-v /cache:/cache')
})

test('wrapCommand routes through docker for containerized targets', () => {
  const wrapped = wrapCommand(
    { kind: 'docker', image: 'img' },
    { file: 'bun', args: ['test'] },
    '/repo',
  )
  expect(wrapped.file).toBe('docker')
  expect(wrapped.args[0]).toBe('run')
})

test('resolveExecTarget honors env overrides and defaults to local', () => {
  expect(resolveExecTarget('/repo', {}).kind).toBe('local')
  const docker = resolveExecTarget('/repo', { UR_EXEC_TARGET: 'docker', UR_EXEC_IMAGE: 'x:1' })
  expect(docker).toMatchObject({ kind: 'docker', image: 'x:1' })
  expect(resolveExecTarget('/repo', { UR_EXEC_TARGET: 'local' }).kind).toBe('local')
})
