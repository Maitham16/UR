import type { LocalCommandCall } from '../../types/command.js'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { runWorkflowSpec } from '../../services/agents/runWorkflow.js'
import { validateWorkflow } from '../../services/agents/workflows.js'
import {
  formatSkillStatus,
  initSkillDir,
  listSkillDirs,
  loadAllSkillDirs,
  loadSkillDir,
  skillToWorkflow,
  type SkillDirectoryInfo,
} from '../../skills/skillSpec.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { getURConfigHomeDir } from '../../utils/envUtils.js'
import { isFsInaccessible } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  getCrossClientSkillDirsUpToHome,
  getProjectDirsUpToHome,
} from '../../utils/markdownConfigLoader.js'
import {
  inspectSkillProvenance,
  loadTrustedSkillKeys,
  signSkillDirectory,
  trustedSkillKeysPath,
  type SkillProvenance,
} from '../../skills/skillProvenance.js'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep as pathSep } from 'node:path'

const VALUE_OPTIONS = new Set(['--key', '--key-id', '--max-turns', '--out'])

function parseCommandTokens(tokens: string[]): {
  positional: string[]
  flags: Set<string>
  values: Map<string, string>
} {
  const positional: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const equals = token.indexOf('=')
    if (equals > 2) {
      const name = token.slice(0, equals)
      values.set(name, token.slice(equals + 1))
      continue
    }
    if (VALUE_OPTIONS.has(token)) {
      const value = tokens[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value`)
      }
      values.set(token, value)
      index++
    } else {
      flags.add(token)
    }
  }
  return { positional, flags, values }
}

function findAgentSkillDirectory(cwd: string, input: string): string | null {
  const direct = isAbsolute(input) ? input : resolve(cwd, input)
  if (existsSync(join(direct, 'SKILL.md'))) return direct
  for (const root of [...getSkillRoots(cwd)].reverse()) {
    const candidate = join(root, input)
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate
  }
  return null
}

function formatProvenance(provenance: SkillProvenance): string {
  const errors = provenance.validation.diagnostics.filter(
    item => item.severity === 'error',
  )
  const warnings = provenance.validation.diagnostics.filter(
    item => item.severity === 'warning',
  )
  return [
    `Skill: ${provenance.name}`,
    `Path: ${provenance.canonicalPath}`,
    `Spec: ${provenance.validation.valid ? 'valid' : 'invalid'}`,
    `Tree: sha256:${provenance.tree.digest} (${provenance.tree.files} files, ${provenance.tree.bytes} bytes)`,
    `Signature: ${provenance.signature.status}${provenance.signature.keyId ? ` (${provenance.signature.keyId})` : ''}`,
    `Permissions: ${provenance.permissions.allowedTools.join(', ') || 'not declared'}`,
    ...errors.map(item => `ERROR ${item.code}: ${item.message}`),
    ...warnings.map(item => `WARN ${item.code}: ${item.message}`),
  ].join('\n')
}

function readPrivateKey(path: string): Buffer {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error('Signing key must be a regular file under 64 KiB')
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('Signing key permissions are too broad; use chmod 600')
  }
  return readFileSync(path)
}

function writeTrustedKeys(keys: Record<string, string>): void {
  const path = trustedSkillKeysPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(keys, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // Renamed or not created.
    }
  }
}

function getSkillRoots(cwd: string): string[] {
  const project = [
    ...getProjectDirsUpToHome('skills', cwd).map(path => ({ path, kind: 0 })),
    ...getCrossClientSkillDirsUpToHome(cwd).map(path => ({ path, kind: 1 })),
  ]
    .sort(
      (a, b) =>
        b.path.split(pathSep).length - a.path.split(pathSep).length ||
        a.kind - b.kind ||
        a.path.localeCompare(b.path),
    )
    .map(entry => entry.path)
  // loadAllSkillDirs uses later roots as higher precedence. Keep this list
  // low-to-high: cross-client < native, user < project, parent < nearest.
  return [
    join(homedir(), '.agents', 'skills'),
    join(getURConfigHomeDir(), 'skills'),
    ...[...project].reverse(),
  ]
}

function notFound(name: string, available: string[]): { type: 'text'; value: string } {
  const hint = available.length > 0 ? `\nAvailable: ${available.join(', ')}` : ''
  return {
    type: 'text',
    value: `Skill not found: ${name}${hint}\nCreate one: ur skill init ${name}`,
  }
}

async function findSkill(cwd: string, name: string): Promise<SkillDirectoryInfo | null> {
  const roots = getSkillRoots(cwd)
  for (const root of [...roots].reverse()) {
    const info = loadSkillDir(root, name)
    if (info) return info
  }
  return null
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  let parsedTokens: ReturnType<typeof parseCommandTokens>
  try {
    parsedTokens = parseCommandTokens(tokens)
  } catch (error) {
    return {
      type: 'text',
      value: error instanceof Error ? error.message : String(error),
    }
  }
  const { positional, flags, values } = parsedTokens
  const json = flags.has('--json')
  const dryRun = flags.has('--dry-run')
  const command = positional[0] ?? 'list'
  const name = positional[1]
  const rest = positional.slice(2).join(' ')

  if (command === 'keygen') {
    if (!name) {
      return {
        type: 'text',
        value: 'Usage: ur skill keygen <key-id> [--out <private-key.pem>]',
      }
    }
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(name)) {
      return { type: 'text', value: 'Invalid key ID.' }
    }
    const privatePath = resolve(
      cwd,
      values.get('--out') ??
        join(getURConfigHomeDir(), 'skill-keys', `${name}.pem`),
    )
    const publicPath = `${privatePath}.pub`
    if (existsSync(privatePath) || existsSync(publicPath)) {
      return {
        type: 'text',
        value: `Refusing to overwrite an existing key: ${privatePath}`,
      }
    }
    let createdPrivate = false
    let createdPublic = false
    try {
      const existingKeys = loadTrustedSkillKeys()
      if (existingKeys[name]) {
        throw new Error(`Trusted key ID already exists: ${name}`)
      }
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
      const publicPem = publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString()
      mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 })
      writeFileSync(privatePath, privatePem, { flag: 'wx', mode: 0o600 })
      createdPrivate = true
      writeFileSync(publicPath, publicPem, { flag: 'wx', mode: 0o644 })
      createdPublic = true
      writeTrustedKeys({ ...existingKeys, [name]: publicPem })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              {
                keyId: name,
                privateKey: privatePath,
                publicKey: publicPath,
                trustedKeys: trustedSkillKeysPath(),
              },
              null,
              2,
            )
          : `Created Ed25519 skill-signing key "${name}".\nPrivate key: ${privatePath}\nPublic key: ${publicPath}\nTrusted key store: ${trustedSkillKeysPath()}\nKeep the private key secret and backed up.`,
      }
    } catch (error) {
      if (createdPublic) unlinkSync(publicPath)
      if (createdPrivate) unlinkSync(privatePath)
      return {
        type: 'text',
        value: `Key generation failed: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  if (command === 'verify' || command === 'sign') {
    if (!name) {
      return {
        type: 'text',
        value:
          command === 'verify'
            ? 'Usage: ur skill verify <name-or-directory> [--require-trusted] [--json]'
            : 'Usage: ur skill sign <name-or-directory> --key <private-key.pem> --key-id <id> [--json]',
      }
    }
    const skillDir = findAgentSkillDirectory(cwd, name)
    if (!skillDir) {
      return { type: 'text', value: `Agent Skill directory not found: ${name}` }
    }
    try {
      const provenance =
        command === 'sign'
          ? (() => {
              const keyPath = values.get('--key')
              const keyId = values.get('--key-id')
              if (!keyPath || !keyId) {
                throw new Error('sign requires --key and --key-id')
              }
              return signSkillDirectory({
                skillDir,
                keyId,
                privateKey: readPrivateKey(resolve(cwd, keyPath)),
              })
            })()
          : inspectSkillProvenance({
              skillDir,
              source: 'command',
              loadedFrom: 'local',
            })
      const requiresTrusted = flags.has('--require-trusted')
      const passed =
        provenance.validation.valid &&
        provenance.signature.status !== 'invalid' &&
        provenance.signature.status !== 'unknown-key' &&
        (!requiresTrusted || provenance.signature.status === 'verified')
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ passed, provenance }, null, 2)
          : `${formatProvenance(provenance)}\nVERDICT: ${passed ? 'PASS' : 'FAIL'}${requiresTrusted ? ' (trusted signature required)' : ''}`,
      }
    } catch (error) {
      return {
        type: 'text',
        value: `${command === 'sign' ? 'Signing' : 'Verification'} failed: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  if (command === 'list') {
    const roots = getSkillRoots(cwd)
    const all = loadAllSkillDirs(roots)
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify(
          {
            skills: all.map(s => ({
              name: s.name,
              path: s.path,
              description: s.spec.description,
              steps: s.spec.steps.length,
            })),
          },
          null,
          2,
        ),
      }
    }
    if (all.length === 0) {
      return { type: 'text', value: 'No executable skills found. Create one: ur skill init <name>' }
    }
    return {
      type: 'text',
      value: `Executable skills:\n${all.map(s => `  - ${s.name}${s.spec.description ? ` — ${s.spec.description}` : ''}`).join('\n')}`,
    }
  }

  if (command === 'init') {
    if (!name) {
      return { type: 'text', value: 'Usage: ur skill init <name>' }
    }
    const projectSkills = getProjectDirsUpToHome('skills', cwd)[0] ?? join(cwd, '.ur', 'skills')
    const dir = join(projectSkills, name)
    const fs = getFsImplementation()
    try {
      const exists = await fs.stat(dir).then(() => true).catch(() => false)
      if (exists) {
        return {
          type: 'text',
          value: `Skill directory already exists: ${dir}\nUse --force to overwrite (not yet implemented).`,
        }
      }
    } catch (e) {
      if (!isFsInaccessible(e)) return { type: 'text', value: `Error checking ${dir}: ${e}` }
    }
    const result = initSkillDir(dir, name)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : `Initialized skill "${name}" at ${result.path}\n  ${result.files.join('\n  ')}`,
    }
  }

  if (!name) {
    return { type: 'text', value: `Usage: ur skill ${command} <name> [args]` }
  }

  const available = listSkillDirs([...getSkillRoots(cwd)].reverse().find(r => loadSkillDir(r, name)?.name === name) ?? join(cwd, '.ur', 'skills'))
  const info = await findSkill(cwd, name)
  if (!info) return notFound(name, available)

  if (command === 'show') {
    const workflow = skillToWorkflow(info.spec, rest, {
      skillDir: info.path,
      instructionText: info.files.instructions,
    })
    const validation = validateWorkflow(workflow)
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify(
          {
            skill: info.name,
            path: info.path,
            files: info.files,
            workflow,
            validation,
          },
          null,
          2,
        ),
      }
    }
    return {
      type: 'text',
      value: [
        formatSkillStatus(info),
        '',
        `Compiled workflow: ${workflow.name}`,
        workflow.description ? workflow.description : '',
        '',
        `Steps (${workflow.steps.length}):`,
        ...workflow.steps.map(s =>
          `  ${s.id}: ${s.name} (${s.agent})${s.gate ? ` [${s.gate}]` : ''}${s.checkpoint ? ' 💾' : ''}`),
        '',
        validation.valid ? 'Workflow valid.' : `Validation:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`,
      ]
        .filter(line => line !== '')
        .join('\n'),
    }
  }

  if (command === 'run') {
    const workflow = skillToWorkflow(info.spec, rest, {
      skillDir: info.path,
      instructionText: info.files.instructions,
    })
    const validation = validateWorkflow(workflow)
    if (!validation.valid) {
      return {
        type: 'text',
        value: `Invalid compiled workflow:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`,
      }
    }
    const skipPermissions =
      flags.has('--skip-permissions') ||
      flags.has('--dangerously-skip-permissions')
    const maxTurnsValue = Number(values.get('--max-turns') ?? '30')
    const result = await runWorkflowSpec(workflow, {
      cwd,
      stateName: workflow.name,
      dryRun,
      skipPermissions,
      maxTurns: Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? maxTurnsValue : 30,
    })
    if (json) {
      return { type: 'text', value: JSON.stringify(result, null, 2) }
    }
    const header = dryRun ? '(dry run — no model calls)\n\n' : ''
    return { type: 'text', value: `${header}Skill "${name}" finished.\n${JSON.stringify(result, null, 2)}` }
  }

  return { type: 'text', value: `Unknown skill command: ${command}` }
}
