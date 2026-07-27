import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import {
  agenticCiSpecPath,
  compileAgenticCiWorkflow,
  defaultAgenticCiSpec,
  loadAgenticCiEventFile,
  loadAgenticCiSpec,
  runAgenticCi,
  saveAgenticCiSpec,
  validateAgenticCiSpec,
} from '../../services/agents/agenticCi.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function value(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

function cliVersion(): string {
  return typeof MACRO !== 'undefined' ? MACRO.VERSION : '1.51.0'
}

function workflowPath(cwd: string): string {
  return join(cwd, '.github', 'workflows', 'ur-agentic-ci.yml')
}

function formatValidation(
  path: string,
  validation: ReturnType<typeof validateAgenticCiSpec>,
  json: boolean,
): string {
  if (json) return JSON.stringify({ path, ...validation }, null, 2)
  return [
    validation.valid ? `Valid Agentic CI spec: ${path}` : `Invalid spec: ${path}`,
    ...validation.errors.map(error => `error: ${error}`),
    ...validation.warnings.map(warning => `warning: ${warning}`),
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const dryRun = tokens.includes('--dry-run')
  const positional = tokens.filter((token, index) => {
    if (token.startsWith('--')) return false
    return ![
      '--event',
      '--event-name',
      '--output-dir',
    ].includes(tokens[index - 1] ?? '')
  })
  const command = positional[0] ?? 'validate'
  const name = positional[1] ?? 'default'

  if (command === 'init') {
    const generatedSpec = defaultAgenticCiSpec(name)
    if (dryRun) {
      const spec = agenticCiSpecPath(cwd, name)
      const target = workflowPath(cwd)
      const result = {
        dryRun: true,
        spec,
        specCreated: !existsSync(spec) || force,
        workflow: target,
        workflowCreated: !existsSync(target) || force,
      }
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : [
              `${result.specCreated ? 'Would create' : 'Would keep'} ${spec}`,
              `${result.workflowCreated ? 'Would create' : 'Would keep'} ${target}`,
            ].join('\n'),
      }
    }
    const saved = saveAgenticCiSpec(cwd, generatedSpec, { force })
    const compiledSpec =
      saved.created
        ? generatedSpec
        : (loadAgenticCiSpec(cwd, name) ?? generatedSpec)
    const target = workflowPath(cwd)
    let workflowCreated = false
    if (!existsSync(target) || force) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(
        target,
        compileAgenticCiWorkflow(name, {
          packageVersion: cliVersion(),
          spec: compiledSpec,
        }),
      )
      workflowCreated = true
    }
    const result = {
      spec: saved.path,
      specCreated: saved.created,
      workflow: target,
      workflowCreated,
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : [
            `${saved.created ? 'Created' : 'Kept'} ${saved.path}`,
            `${workflowCreated ? 'Created' : 'Kept'} ${target}`,
          ].join('\n'),
    }
  }

  if (command === 'workflow') {
    const target = workflowPath(cwd)
    const workflowSpec =
      loadAgenticCiSpec(cwd, name) ?? defaultAgenticCiSpec(name)
    if (existsSync(target) && !force) {
      process.exitCode = 1
      return {
        type: 'text',
        value: `Workflow already exists: ${target}\nUse --force to replace it.`,
      }
    }
    if (dryRun) {
      const result = {
        dryRun: true,
        workflow: target,
        workflowCreated: true,
        replacing: existsSync(target),
      }
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : `${result.replacing ? 'Would replace' : 'Would write'} hardened workflow at ${target}`,
      }
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(
      target,
      compileAgenticCiWorkflow(name, {
        packageVersion: cliVersion(),
        spec: workflowSpec,
      }),
    )
    return { type: 'text', value: `Wrote hardened workflow to ${target}` }
  }

  const spec = loadAgenticCiSpec(cwd, name)
  if (command === 'validate') {
    if (!spec) {
      process.exitCode = 1
      return {
        type: 'text',
        value: `Spec not found: ${agenticCiSpecPath(cwd, name)}\nCreate it with: ur agent-ci init ${name}`,
      }
    }
    const validation = validateAgenticCiSpec(spec)
    if (!validation.valid) process.exitCode = 1
    return {
      type: 'text',
      value: formatValidation(agenticCiSpecPath(cwd, name), validation, json),
    }
  }

  if (command === 'run') {
    // The built-in default lets an installed GitHub workflow run before a
    // repository customizes its policy. Named policies remain explicit.
    const selected =
      spec ?? (name === 'default' ? defaultAgenticCiSpec(name) : null)
    if (!selected) {
      process.exitCode = 1
      return {
        type: 'text',
        value: `Spec not found: ${agenticCiSpecPath(cwd, name)}`,
      }
    }
    const eventPath = value(tokens, '--event')
    const result = await runAgenticCi({
      cwd,
      spec: selected,
      event: eventPath ? loadAgenticCiEventFile(eventPath) : undefined,
      eventName: value(tokens, '--event-name'),
      outputDir: value(tokens, '--output-dir'),
      dryRun,
    })
    if (!['passed', 'dry-run'].includes(result.status)) process.exitCode = 1
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : [
            `Agentic CI: ${result.status}`,
            `manifest: ${result.manifestPath}`,
            result.patch ? `patch: ${result.patch.path} (${result.patch.sha256})` : '',
            result.violations.length
              ? `violations: ${result.violations.join('; ')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
    }
  }

  process.exitCode = 1
  return {
    type: 'text',
    value:
      'Usage: ur agent-ci [init|validate|workflow|run] [name] [--event path] [--event-name name] [--dry-run] [--json]',
  }
}
