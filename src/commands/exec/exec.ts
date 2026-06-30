import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  fanoutBackgroundTasks,
  getBackgroundTask,
  readBackgroundLog,
  startBackgroundTask,
  type StartBackgroundTaskResult,
} from '../../services/agents/backgroundRunner.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set([
    '--concurrency',
    '--max-turns',
    '--model',
    '--output-dir',
  ])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur exec "prompt" [--concurrency 1] [--max-turns 10] [--model qwen3-coder:480b-cloud] [--output-dir ./outputs]',
    '  echo \'{"prompt": "add tests"}\' | ur exec --concurrency 4',
    '  ur exec --file prompts.jsonl --concurrency 2',
  ].join('\n')
}

export async function readPrompts(tokens: string[]): Promise<string[]> {
  const file = option(tokens, '--file')
  if (file) {
    const text = await Bun.file(file).text()
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          const parsed = JSON.parse(line) as { prompt?: string }
          return typeof parsed.prompt === 'string' ? parsed.prompt : line
        } catch {
          return line
        }
      })
  }
  const args = positionals(tokens)
  if (args.length > 0) return args

  if (!process.stdin.isTTY) {
    const text = await new Promise<string>(resolve => {
      let data = ''
      process.stdin.on('data', chunk => {
        data += chunk
      })
      process.stdin.on('end', () => resolve(data))
    })
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          const parsed = JSON.parse(line) as { prompt?: string }
          return typeof parsed.prompt === 'string' ? parsed.prompt : line
        } catch {
          return line
        }
      })
  }

  return []
}

export function execCommandForPrompt(
  prompt: string,
  opts: {
    maxTurns?: number
    model?: string
    worktree?: boolean
  },
): string[] {
  const args = ['-p', '--output-format', 'json']
  if (opts.maxTurns !== undefined) {
    args.push('--max-turns', String(opts.maxTurns))
  }
  if (opts.model) {
    args.push('--model', opts.model)
  }
  if (opts.worktree) {
    args.push('--worktree')
  }
  args.push(prompt)
  return [process.execPath, process.argv[1] ?? '', ...args]
}

export async function runExecPool(
  prompts: string[],
  opts: {
    cwd: string
    concurrency: number
    maxTurns?: number
    model?: string
    outputDir?: string
    worktree?: boolean
    dryRun?: boolean
  },
): Promise<StartBackgroundTaskResult[]> {
  if (opts.dryRun) {
    return prompts.map((prompt, index) => ({
      task: {
        id: `dry-run-${index}`,
        task: prompt,
        status: 'queued' as const,
        cwd: opts.cwd,
        runCwd: opts.cwd,
        logFile: '',
        outputFile: '',
        inboxFile: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      command: execCommandForPrompt(prompt, opts),
      dryRun: true,
    }))
  }

  if (opts.concurrency === 1 && prompts.length === 1) {
    const command = execCommandForPrompt(prompts[0]!, opts)
    return [
      await startBackgroundTask({
        cwd: opts.cwd,
        task: prompts[0]!,
        worktree: opts.worktree,
        model: opts.model,
        maxTurns: opts.maxTurns,
        bin: { file: command[0]!, baseArgs: command.slice(1, -1) },
      }),
    ]
  }

  return await fanoutBackgroundTasks({
    cwd: opts.cwd,
    task: prompts[0]!,
    agents: Math.min(prompts.length, opts.concurrency),
    worktree: opts.worktree,
    model: opts.model,
    maxTurns: opts.maxTurns,
  })
}

function writeOutputFile(outputDir: string, prompt: string, content: string): void {
  mkdirSync(outputDir, { recursive: true })
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task'
  writeFileSync(join(outputDir, `${slug}.txt`), content)
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const concurrency = Math.max(1, Math.min(32, Number(option(tokens, '--concurrency') ?? '1')))
  const maxTurns = option(tokens, '--max-turns') ? Number(option(tokens, '--max-turns')) : undefined
  const model = option(tokens, '--model')
  const outputDir = option(tokens, '--output-dir')
  const worktree = tokens.includes('--worktree')
  const dryRun = tokens.includes('--dry-run')

  const prompts = await readPrompts(tokens)
  if (prompts.length === 0) {
    return { type: 'text', value: usage() }
  }

  const results = await runExecPool(prompts, {
    cwd: getCwd(),
    concurrency,
    maxTurns,
    model,
    outputDir,
    worktree,
    dryRun,
  })

  const outputs = results.map((result, index) => {
    const prompt = prompts[index] ?? prompts[0]!
    const task = result.dryRun
      ? undefined
      : getBackgroundTask(getCwd(), result.task.id)
    const log = task ? readBackgroundLog(getCwd(), result.task.id) : null
    const content = log ?? ''
    if (outputDir && !result.dryRun) {
      writeOutputFile(outputDir, prompt, content)
    }
    return {
      index,
      prompt,
      taskId: result.task.id,
      command: result.command,
      status: task?.status ?? result.task.status,
      output: content || undefined,
    }
  })

  return {
    type: 'text',
    value: json
      ? JSON.stringify(outputs, null, 2)
      : outputs.map(o => `${o.index}: ${o.prompt} -> ${o.status}`).join('\n'),
  }
}
