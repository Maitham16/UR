import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBashShellProvider } from '../src/utils/shell/bashProvider.js'

/**
 * These tests execute real bash. They assert the contract the BashTool depends
 * on: stdout, stderr, exit code and working directory are all reported
 * accurately, and process creation is never mistaken for completion.
 */

const BASH = '/bin/bash'
let workdir: string
let counter = 0

beforeAll(() => {
  // The provider records `pwd -P`, the *physical* path, deliberately — it must
  // match process.cwd(). On macOS os.tmpdir() is /var/..., a symlink to
  // /private/var/..., so the expectation has to be resolved the same way or
  // every cwd assertion compares a logical path against a physical one.
  workdir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ur-bash-test-')))
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

type RunResult = {
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
  cwd: string | undefined
  durationMs: number
}

async function runThroughProvider(
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const provider = await createBashShellProvider(BASH, { skipSnapshot: true })
  const id = `test-${process.pid}-${counter++}`
  const { commandString, cwdFilePath } = await provider.buildExecCommand(command, {
    id,
    useSandbox: false,
  })
  const args = provider.getSpawnArgs(commandString)
  const started = Date.now()

  return await new Promise<RunResult>(resolve => {
    const child = spawn(BASH, args, {
      cwd: options.cwd ?? workdir,
      env: { ...process.env },
      // Own process group, so a timeout can reap the whole tree rather than
      // orphaning grandchildren that keep the output pipes open.
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }, options.timeoutMs)
    }
    // 'close' fires after the streams have drained; 'exit' can fire earlier and
    // would truncate output. Launching is not completing.
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      let cwd: string | undefined
      if (existsSync(cwdFilePath)) {
        cwd = readFileSync(cwdFilePath, 'utf8').trim()
        rmSync(cwdFilePath, { force: true })
      }
      resolve({ stdout, stderr, code, signal, cwd, durationMs: Date.now() - started })
    })
  })
}

describe('exit codes are the command’s own', () => {
  test('a successful command reports 0', async () => {
    const r = await runThroughProvider('true')
    expect(r.code).toBe(0)
  })

  test('a failing command reports its own status', async () => {
    for (const expected of [1, 2, 42, 127]) {
      const r = await runThroughProvider(`exit ${expected}`)
      expect(r.code).toBe(expected)
    }
  })

  test('a command that removes its own cwd still reports success', async () => {
    // Previously the trailing `pwd -P` failed here and its non-zero status
    // became the reported exit code, so a successful command read as failed.
    const doomed = path.join(workdir, 'doomed')
    const r = await runThroughProvider(
      `mkdir -p ${doomed} && cd ${doomed} && rmdir ${doomed} && echo survived`,
    )
    expect(r.stdout.trim()).toBe('survived')
    expect(r.code).toBe(0)
  })

  test('a non-existent command reports 127, not a launch success', async () => {
    const r = await runThroughProvider('definitely-not-a-real-binary-xyz')
    expect(r.code).toBe(127)
  })
})

describe('working directory tracking', () => {
  test('cwd is recorded after a successful cd', async () => {
    const sub = path.join(workdir, 'sub')
    const r = await runThroughProvider(`mkdir -p ${sub} && cd ${sub}`)
    expect(r.code).toBe(0)
    expect(r.cwd).toBe(sub)
  })

  test('cwd is still recorded when the command fails', async () => {
    // The regression: joined with `&&`, the capture never ran on failure, so a
    // cd followed by a failing command silently left the session behind.
    const sub = path.join(workdir, 'sub2')
    const r = await runThroughProvider(`mkdir -p ${sub} && cd ${sub} && false`)
    expect(r.code).toBe(1)
    expect(r.cwd).toBe(sub)
  })

  test('cwd is recorded even when the command calls exit itself', async () => {
    // `exit` terminates the shell immediately, so a capture chained after the
    // command could never run. The EXIT trap fires on this path too.
    const sub = path.join(workdir, 'sub3')
    const r = await runThroughProvider(`mkdir -p ${sub} && cd ${sub} && exit 7`)
    expect(r.code).toBe(7)
    expect(r.cwd).toBe(sub)
  })
})

describe('stdout and stderr are preserved separately', () => {
  test('both streams are captured and not interleaved into one', async () => {
    const r = await runThroughProvider('echo out; echo err 1>&2')
    expect(r.stdout.trim()).toBe('out')
    expect(r.stderr.trim()).toBe('err')
  })

  test('stderr is preserved on failure alongside the exit code', async () => {
    const r = await runThroughProvider('echo boom 1>&2; exit 3')
    expect(r.stderr.trim()).toBe('boom')
    expect(r.code).toBe(3)
  })
})

describe('quoting and argument integrity', () => {
  test('paths containing spaces survive', async () => {
    const spaced = path.join(workdir, 'a dir with spaces')
    const r = await runThroughProvider(`mkdir -p '${spaced}' && cd '${spaced}' && pwd`)
    expect(r.stdout.trim()).toBe(spaced)
    expect(r.cwd).toBe(spaced)
  })

  test('single and double quotes are not corrupted', async () => {
    const r = await runThroughProvider(`echo "it's \\"quoted\\""`)
    expect(r.stdout.trim()).toBe(`it's "quoted"`)
  })

  test('unicode round-trips byte for byte', async () => {
    const r = await runThroughProvider('printf "%s" "héllo — 世界 🌍"')
    expect(r.stdout).toBe('héllo — 世界 🌍')
  })

  test('dollar signs and backticks are not expanded unexpectedly', async () => {
    const r = await runThroughProvider(`printf '%s' 'literal $HOME and \`date\`'`)
    expect(r.stdout).toBe('literal $HOME and `date`')
  })

  test('backslashes survive', async () => {
    const r = await runThroughProvider(`printf '%s' 'C:\\path\\to\\file'`)
    expect(r.stdout).toBe('C:\\path\\to\\file')
  })
})

describe('multiline input and heredocs', () => {
  test('a multiline command runs every line', async () => {
    const r = await runThroughProvider('echo one\necho two\necho three')
    expect(r.stdout.trim().split('\n')).toEqual(['one', 'two', 'three'])
  })

  test('a heredoc preserves its body verbatim', async () => {
    const r = await runThroughProvider(`cat <<'EOF'\nline one\n  indented $notexpanded\nEOF`)
    expect(r.stdout).toBe('line one\n  indented $notexpanded\n')
  })

  test('a multiline command reports the last line’s status, per shell semantics', async () => {
    const r = await runThroughProvider('echo first\nfalse\necho third')
    expect(r.stdout.trim().split('\n')).toEqual(['first', 'third'])
    expect(r.code).toBe(0)
  })

  test('a multiline command ending in failure reports non-zero', async () => {
    const r = await runThroughProvider('echo first\necho second\nfalse')
    expect(r.stdout.trim().split('\n')).toEqual(['first', 'second'])
    expect(r.code).toBe(1)
  })
})

describe('pipelines and redirection', () => {
  test('a pipeline reports the last command’s status', async () => {
    const r = await runThroughProvider('echo hello | grep hello')
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('hello')
  })

  test('a pipeline whose last stage fails reports non-zero', async () => {
    const r = await runThroughProvider('echo hello | grep nomatch')
    expect(r.code).toBe(1)
  })

  test('redirection to a file works and the file is readable', async () => {
    const target = path.join(workdir, 'redirected.txt')
    const r = await runThroughProvider(`echo written > '${target}'`)
    expect(r.code).toBe(0)
    expect(readFileSync(target, 'utf8').trim()).toBe('written')
  })

  test('a command reading stdin does not hang', async () => {
    // Without the stdin redirect this blocks forever on the spawn pipe.
    const r = await runThroughProvider('cat')
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
  })

  test('grep with no path in a pipeline does not hang', async () => {
    const r = await runThroughProvider('echo needle | grep needle | wc -l')
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('1')
  })
})

describe('large output', () => {
  test('a large stdout is captured without truncation at the shell layer', async () => {
    const r = await runThroughProvider(`for i in $(seq 1 5000); do echo "line $i"; done`)
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(5000)
    expect(lines[0]).toBe('line 1')
    expect(lines[4999]).toBe('line 5000')
  })

  test('a large single line is not split', async () => {
    const r = await runThroughProvider(`printf 'x%.0s' $(seq 1 100000)`)
    expect(r.stdout).toHaveLength(100000)
  })
})

describe('signals, timeouts and cleanup', () => {
  test('a killed command reports the signal, not a clean exit', async () => {
    const r = await runThroughProvider('sleep 30', { timeoutMs: 500 })
    expect(r.code).not.toBe(0)
    expect(r.durationMs).toBeLessThan(15000)
  })

  test('a self-terminating command reports a non-zero status', async () => {
    const r = await runThroughProvider('kill -TERM $$')
    expect(r.code).not.toBe(0)
  })

  test('duration reflects the command, not the spawn', async () => {
    const r = await runThroughProvider('sleep 1')
    expect(r.code).toBe(0)
    expect(r.durationMs).toBeGreaterThanOrEqual(900)
  })

  test('a backgrounded command does not make the shell hang', async () => {
    const marker = path.join(workdir, 'bg-marker')
    const r = await runThroughProvider(
      `( sleep 0.2; echo done > '${marker}' ) >/dev/null 2>&1 & echo launched`,
    )
    expect(r.stdout.trim()).toBe('launched')
    expect(r.code).toBe(0)
  })
})

describe('command construction is deterministic', () => {
  test('the cwd capture is not chained with && behind the command', async () => {
    const provider = await createBashShellProvider(BASH, { skipSnapshot: true })
    const { commandString } = await provider.buildExecCommand('echo hi', {
      id: 'shape-check',
      useSandbox: false,
    })
    expect(commandString).toContain("trap 'pwd -P")
    expect(commandString).toContain("' EXIT")
    expect(commandString).not.toMatch(/eval .* && pwd -P/)
  })

  test('building the same command twice yields the same string', async () => {
    const provider = await createBashShellProvider(BASH, { skipSnapshot: true })
    const a = await provider.buildExecCommand('echo hi', { id: 'x', useSandbox: false })
    const b = await provider.buildExecCommand('echo hi', { id: 'x', useSandbox: false })
    expect(a.commandString).toBe(b.commandString)
  })

  test('a command runs exactly once', async () => {
    const counterFile = path.join(workdir, 'run-count')
    writeFileSync(counterFile, '')
    const r = await runThroughProvider(`echo tick >> '${counterFile}'`)
    expect(r.code).toBe(0)
    expect(readFileSync(counterFile, 'utf8').trim().split('\n')).toHaveLength(1)
  })
})
