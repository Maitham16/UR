import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('unbundled ACP initialization works outside a checkout without build defines', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-acp-source-version-'))
  try {
    const entry = join(cwd, 'initialize.ts')
    writeFileSync(entry, `
import { createAcpStdioAgent } from ${JSON.stringify(resolve(import.meta.dir, '../src/services/agents/acpStdio.ts'))}
const messages=[]
const agent=createAcpStdioAgent({cwd:process.cwd(),persistSessions:false,write:message=>messages.push(message)})
await agent.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{}})
console.log(JSON.stringify(messages[0]))
`)
    const result = spawnSync(process.execPath, [entry], {
      cwd, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, UR_CONFIG_DIR: join(cwd, 'config') },
    })
    expect(result.status, result.stderr).toBe(0)
    const message = JSON.parse(result.stdout)
    expect(message.error).toBeUndefined()
    expect(message.result.protocolVersion).toBe(1)
    expect(typeof message.result.agentInfo.version).toBe('string')
    expect(message.result.agentInfo.version.length).toBeGreaterThan(0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
