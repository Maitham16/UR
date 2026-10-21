import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseHeadlessRun } from '../src/services/agents/headlessAgent.js'

test('Ollama Cloud marks billing unknown while local inference retains zero API cost', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-cost-evidence-'))
  const root = resolve(import.meta.dir, '..')
  const module = (path: string) => JSON.stringify(pathToFileURL(join(root, path)).href)
  const script = join(cwd, 'check.ts')
  writeFileSync(script, `
import {calculateUSDCost} from ${module('src/utils/modelCost.ts')};
import {hasUnknownModelCost,resetCostState,setFlagSettingsInline} from ${module('src/bootstrap/state.ts')};
import {setOllamaBaseUrlOverride} from ${module('src/utils/model/ollamaConfig.ts')};
setFlagSettingsInline({provider:{active:'ollama'}});
const results=[];
for(const [model,url] of [['local-test','http://127.0.0.1:11434'],['minimax-m3.1-flash:cloud','http://127.0.0.1:11434'],['hosted-name','https://ollama.com']]){
 resetCostState();setOllamaBaseUrlOverride(url);const cost=calculateUSDCost(model,{input_tokens:12,output_tokens:5});results.push({cost,unknown:hasUnknownModelCost()});
}
console.log(JSON.stringify(results));
`)
  try {
    const result = spawnSync(process.execPath, ['run', '--preload', join(root, 'plugins/bunBundleDev.ts'), script], { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, UR_CONFIG_DIR: cwd } })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{ cost: 0, unknown: false }, { cost: 0, unknown: true }, { cost: 0, unknown: true }])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('headless consumers do not turn an unknown legacy numeric estimate into a measured budget', () => {
  const result = { type: 'result', subtype: 'success', result: 'VERDICT: PASS', total_cost_usd: 0, cost_status: 'unknown' }
  expect(parseHeadlessRun(JSON.stringify(result), { cwd: '/tmp' }).costUsd).toBeUndefined()
  expect(parseHeadlessRun(JSON.stringify({ ...result, cost_status: 'known', total_cost_usd: .25 }), { cwd: '/tmp' }).costUsd).toBe(.25)
})
