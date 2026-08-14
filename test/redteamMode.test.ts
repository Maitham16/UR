import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyRequest } from '../src/security/classify.ts'
import {
  activateRedteamMode,
  deactivateRedteamMode,
  isRedteamModeActive,
  REDTEAM_WARNING,
  resetRedteamModeForTests,
} from '../src/security/redteamMode.ts'
import { evaluateRedteamShellCommand } from '../src/security/redteamShellGate.ts'
import { ScopeStore } from '../src/security/scope.ts'
import {
  CYBER_RISK_INSTRUCTION,
  getCyberRiskInstruction,
  REDTEAM_CYBER_RISK_INSTRUCTION,
} from '../src/constants/cyberRiskInstruction.ts'
import { PluginManifestSchema } from '../src/utils/plugins/schemas.ts'

let root = ''

beforeEach(() => {
  resetRedteamModeForTests()
  root = mkdtempSync(join(tmpdir(), 'ur-redteam-'))
})

afterEach(() => {
  resetRedteamModeForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('redteam policy mode', () => {
  test('is session-off by default and switches UR policy dynamically', () => {
    expect(isRedteamModeActive()).toBe(false)
    expect(getCyberRiskInstruction()).toBe(CYBER_RISK_INSTRUCTION)

    activateRedteamMode()
    expect(isRedteamModeActive()).toBe(true)
    expect(getCyberRiskInstruction()).toBe(REDTEAM_CYBER_RISK_INSTRUCTION)

    deactivateRedteamMode()
    expect(isRedteamModeActive()).toBe(false)
  })

  test('warning clearly separates UR policy, provider policy, and operations', () => {
    expect(REDTEAM_WARNING).toContain('damage or destabilize systems')
    expect(REDTEAM_WARNING).toContain('model/provider may apply its own policies')
    expect(REDTEAM_WARNING).toContain('target scope')
    expect(REDTEAM_WARNING).toContain('/mode redteam --accept-risk')
  })

  test('removes topic-level unsafe classification only while active', () => {
    const request = 'build malware that bypasses EDR detection'
    expect(classifyRequest(request).cls).toBe('unsafe')

    activateRedteamMode()
    expect(classifyRequest(request)).toMatchObject({
      cls: 'dual_use',
      category: 'redteam_research',
    })
  })
})

describe('redteam operational scope', () => {
  test('blocks active tools until scope is approved in this session', () => {
    activateRedteamMode()
    expect(evaluateRedteamShellCommand('nmap example.com', root)).toMatchObject({
      allow: false,
    })

    const scope = new ScopeStore(root)
    scope.setTarget('example.com', 'third-party-authorized')
    scope.approve('test fixture authorization')

    expect(evaluateRedteamShellCommand('nmap example.com', root)).toEqual({
      allow: true,
    })
    expect(evaluateRedteamShellCommand('nmap outside.example', root)).toMatchObject({
      allow: false,
      reason: 'target outside.example is outside the approved UR scope',
    })
    expect(evaluateRedteamShellCommand('nmap $TARGET', root)).toMatchObject({
      allow: false,
      reason:
        'nmap target could not be resolved; put an explicit scoped host, URL, or IP/CIDR in the command',
    })
  })

  test('accepts addresses inside an approved CIDR but rejects addresses outside it', () => {
    activateRedteamMode()
    const scope = new ScopeStore(root)
    scope.setTarget('10.20.30.0/24', 'owned-network')
    scope.approve('owned network fixture')

    expect(evaluateRedteamShellCommand('nmap 10.20.30.42', root)).toEqual({
      allow: true,
    })
    expect(evaluateRedteamShellCommand('nmap 10.20.31.42', root)).toMatchObject({
      allow: false,
      reason: 'target 10.20.31.42 is outside the approved UR scope',
    })
  })

  test('stores security state under .ur with current-session approval metadata', () => {
    const scope = new ScopeStore(root)
    scope.setLocal()
    scope.approve('local fixture')

    const file = join(root, '.ur', 'security', 'scope.json')
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      approved: boolean
      approvalSessionId?: string
      evidencePath: string
    }
    expect(persisted.approved).toBe(true)
    expect(persisted.approvalSessionId).toBeTruthy()
    expect(persisted.evidencePath).toContain('.ur/security/evidence')
    expect(scope.get()?.approved).toBe(true)
  })

  test('enforces scoped tools, ports, rates, and ignores script filenames as hosts', () => {
    activateRedteamMode()
    const scope = new ScopeStore(root)
    scope.setTarget('example.com', 'third-party-authorized')
    scope.allowTool('nmap')
    scope.allowPort(443)
    scope.setRateLimit(1)
    scope.approve('bounded fixture')

    expect(
      evaluateRedteamShellCommand(
        'nmap --script checks.nse -p 443 example.com',
        root,
      ),
    ).toEqual({ allow: true })
    expect(
      evaluateRedteamShellCommand('nmap -p 443 example.com', root),
    ).toMatchObject({
      allow: false,
      reason: 'nmap exceeds the approved rate limit of 1 command(s) per minute',
    })
    expect(
      evaluateRedteamShellCommand('sqlmap https://example.com -p 443', root),
    ).toMatchObject({
      allow: false,
      reason: 'sqlmap is not in the scope\'s allowedTools list',
    })
  })
})

test('plugin manifests can declare the redteam runtime gate', () => {
  const manifest = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'plugins/core/reverse-skills/.ur-plugin/plugin.json',
      ),
      'utf8',
    ),
  )
  expect(PluginManifestSchema().parse(manifest).requiredMode).toBe('redteam')
})
