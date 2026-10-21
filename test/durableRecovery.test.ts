import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { beginWorkflowRun, checkpointWorkflowRun, loadRunState, workflowDigest, type WorkflowSpec } from '../src/services/agents/workflows.js'
import { executeWorkflow, type ExecutionSnapshot } from '../src/services/agents/executor.js'
import { compileStepPrompt } from '../src/services/agents/cliStepRunner.js'
import { runWorkflowSpec } from '../src/services/agents/runWorkflow.js'
import { claimNextTask, completeTask, createCrew, loadCrew, runCrew } from '../src/services/agents/crew.js'
import { atomicWriteJson, makeProcessOwner } from '../src/services/agents/durableState.js'
import { backgroundDir, createBackgroundTask, getBackgroundTask, reconcileBackgroundTasks, type BackgroundTask } from '../src/services/agents/backgroundRunner.js'

const roots: string[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
afterEach(async () => {
  for (const child of children.splice(0)) { try { child.kill('SIGKILL') } catch {} await child.exited }
  for (const cwd of roots.splice(0)) rmSync(cwd, { recursive: true, force: true })
})
function temp(): string { const path = mkdtempSync(join(tmpdir(), 'ur-durable-')); roots.push(path); return path }
async function until(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await Bun.sleep(20) }
}
function childCode(code: string, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  children.push(child); return child
}
const spec: WorkflowSpec = { version: 1, name: 'durable', steps: [
  { id: 'first', name: 'first', agent: 'worker', prompt: 'first effect' },
  { id: 'second', name: 'second', agent: 'worker', prompt: '{{first}}', dependsOn: ['first'] },
] }

// These are recovery tests, not provider benchmarks. Their effects are real files/processes.
describe('durable workflow checkpoints', () => {
  test('a killed scheduler restores complete dependency output without replaying its effect', async () => {
    const cwd = temp()
    const workflowUrl = new URL('../src/services/agents/workflows.ts', import.meta.url).href
    const executorUrl = new URL('../src/services/agents/executor.ts', import.meta.url).href
    const child = childCode(`
      import {appendFileSync} from 'node:fs';
      import {beginWorkflowRun,checkpointWorkflowRun,workflowDigest} from ${JSON.stringify(workflowUrl)};
      import {executeWorkflow} from ${JSON.stringify(executorUrl)};
      const spec=${JSON.stringify(spec)}, cwd=${JSON.stringify(cwd)};
      const state=beginWorkflowRun(cwd,spec.name,workflowDigest(spec,cwd),false);
      await executeWorkflow(spec,{maxConcurrency:1,runStep:async()=>{appendFileSync(cwd+'/effects','first\\n');return {output:'dependency:'+ 'x'.repeat(5000)}},onState:s=>{
        checkpointWorkflowRun(cwd,spec.name,state.owner.token,s);
        if(s.completed.includes('first')&&!s.inFlight.length)process.kill(process.pid,'SIGKILL');
      }});
    `)
    await child.exited
    expect(loadRunState(cwd, spec.name)?.completed).toEqual(['first'])
    const calls: string[] = []
    const result = await runWorkflowSpec(spec, { cwd, resume: true, runStep: async input => {
      calls.push(input.step.id)
      expect(input.priorOutputs.first).toBe(`dependency:${'x'.repeat(5000)}`)
      appendFileSync(join(cwd, 'effects'), 'second\n')
      return { output: 'verified', verdict: 'PASS' }
    } })
    expect(result.status).toBe('completed')
    expect(calls).toEqual(['second'])
    expect(readFileSync(join(cwd, 'effects'), 'utf8')).toBe('first\nsecond\n')
    expect(result.steps[0].output.length).toBe(5011)
    expect(readdirSync(join(cwd, '.ur/workflows/.state')).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('changed specifications, dry-run evidence, legacy and damaged checkpoints cannot authorize resume', async () => {
    const cwd = temp()
    await runWorkflowSpec(spec, { cwd, dryRun: true })
    await expect(runWorkflowSpec(spec, { cwd, resume: true, runStep: async () => { throw new Error('must not execute') } })).rejects.toThrow('changed')
    await expect(runWorkflowSpec({ ...spec, steps: [{ ...spec.steps[0], prompt: 'changed' }] }, { cwd, dryRun: true, resume: true })).rejects.toThrow('changed')
    const stateFile = join(cwd, '.ur/workflows/.state/durable.json')
    writeFileSync(stateFile, JSON.stringify({ version: 1, name: spec.name, completed: ['first'] }))
    await expect(runWorkflowSpec(spec, { cwd, resume: true })).rejects.toThrow('Legacy')
    writeFileSync(stateFile, '{"version":2,')
    expect(() => loadRunState(cwd, spec.name)).toThrow('Invalid workflow checkpoint')
  })

  test('an interrupted in-flight effect is disclosed for model-directed reconciliation', async () => {
    const cwd = temp()
    const state = beginWorkflowRun(cwd, spec.name, workflowDigest(spec, cwd), false)
    checkpointWorkflowRun(cwd, spec.name, state.owner!.token, { completed: [], outputs: {}, results: [], inFlight: ['first'], cycle: 1 })
    const path = join(cwd, '.ur/workflows/.state/durable.json')
    const saved = JSON.parse(readFileSync(path, 'utf8')); saved.owner.pid = 2147483647; writeFileSync(path, JSON.stringify(saved))
    const result = await runWorkflowSpec(spec, { cwd, resume: true, runStep: async input => {
      if (input.step.id === 'first') {
        expect(input.recovery).toEqual({ unknownOutcome: true, priorOutput: undefined })
        expect(compileStepPrompt(input)).toContain('effects are UNKNOWN')
        expect(compileStepPrompt(input)).toContain('Choose your own reconciliation strategy')
      }
      return { output: 'inspected existing effects and completed remaining work' }
    } })
    expect(result.status).toBe('completed')
  })

  test('completed parallel effects are checkpointed even when an earlier sibling fails', async () => {
    let saved: ExecutionSnapshot | undefined
    const result = await executeWorkflow({ ...spec, steps: spec.steps.map(step => ({ ...step, dependsOn: [] })) }, {
      stopOnError: true, runStep: async input => input.step.id === 'first' ? { output: 'failed', isError: true } : { output: 'saved result' },
      onState: state => { saved = state },
    })
    expect(result.status).toBe('failed')
    expect(saved?.completed).toEqual(['second'])
    expect(saved?.outputs.second).toBe('saved result')
    expect(saved?.inFlight).toEqual(['first'])
  })

  test('approval resume reuses held output rather than repeating the step', async () => {
    let state: ExecutionSnapshot | undefined
    let calls = 0
    const gated: WorkflowSpec = { ...spec, steps: [{ ...spec.steps[0], gate: 'approval' }] }
    const options = { runStep: async () => { calls++; return { output: 'effect complete' } }, onState: (value: ExecutionSnapshot) => { state = value } }
    expect((await executeWorkflow(gated, options)).status).toBe('held')
    expect((await executeWorkflow(gated, { ...options, resumeState: state, approve: () => true })).status).toBe('completed')
    expect(calls).toBe(1)
  })

  test('serialization failure preserves the previous atomic checkpoint', () => {
    const cwd = temp(), path = join(cwd, 'state.json')
    atomicWriteJson(path, { valid: true })
    const circular: Record<string, unknown> = {}; circular.self = circular
    expect(() => atomicWriteJson(path, circular)).toThrow()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ valid: true })
    expect(readdirSync(cwd)).toEqual(['state.json'])
  })
})

describe('crew scheduler ownership', () => {
  test('another real scheduler cannot recover a live claim, even with an expired heartbeat', async () => {
    const cwd = temp()
    createCrew(cwd, 'live', 'change one file')
    const moduleUrl = new URL('../src/services/agents/crew.ts', import.meta.url).href
    const child = childCode(`import {runCrew} from ${JSON.stringify(moduleUrl)}; await runCrew('live',{cwd:${JSON.stringify(cwd)},runnerFor:()=>async()=>{setInterval(()=>{},1000);await new Promise(()=>{})}});`)
    await until(() => loadCrew(cwd, 'live')?.tasks[0]?.status === 'claimed', 'child did not claim')
    const path = join(cwd, '.ur/crew/live.json')
    const before = JSON.parse(readFileSync(path, 'utf8')); before.tasks[0].owner.heartbeatAt = '2000-01-01T00:00:00Z'; writeFileSync(path, JSON.stringify(before))
    let calls = 0
    const result = await runCrew('live', { cwd, dynamic: true, runnerFor: () => async () => { calls++; return { output: 'duplicate' } } })
    expect(calls).toBe(0)
    expect(result.progress.claimed).toBe(1)
    expect(loadCrew(cwd, 'live')?.tasks[0]?.owner?.token).toBe(before.tasks[0].owner.token)
    child.kill('SIGKILL'); await child.exited
    const recovered = await runCrew('live', { cwd, runnerFor: () => async () => { calls++; return { output: 'duplicate' } } })
    expect(calls).toBe(0)
    expect(recovered.progress.claimed).toBe(1)
    expect(loadCrew(cwd, 'live')?.tasks[0]?.lastError).toContain('claim retained')
  })

  test('a surviving real child holds its claim; after exit the model receives unknown-outcome context', async () => {
    const cwd = temp(); createCrew(cwd, 'child', 'inspect work')
    const child = childCode('setInterval(()=>{},1000)')
    const owner = { ...makeProcessOwner(), pid: 2147483647 }
    claimNextTask(cwd, 'child', 'old', 2, { owner })
    const path = join(cwd, '.ur/crew/child.json')
    const board = JSON.parse(readFileSync(path, 'utf8'))
    board.tasks[0].agentPid = child.pid
    board.tasks[0].attemptIsolation = 'shared'
    writeFileSync(path, JSON.stringify(board))
    let calls = 0
    const options = { cwd, runnerFor: () => async (input: import('../src/services/agents/executor.js').StepRunInput) => {
      calls++; expect(input.recovery?.unknownOutcome).toBe(true)
      expect(compileStepPrompt(input)).toContain('inspect existing work')
      return { output: 'inspected and finished', verdict: 'PASS' as const }
    } }
    expect((await runCrew('child', options)).progress.claimed).toBe(1)
    expect(calls).toBe(0)
    child.kill('SIGKILL'); await child.exited
    expect((await runCrew('child', options)).progress.done).toBe(1)
    expect(calls).toBe(1)
  })

  test('a throwing scheduler callback relinquishes its lease and reconciles instead of appearing live forever', async () => {
    const cwd = temp(); createCrew(cwd, 'callback', 'inspect work')
    await expect(runCrew('callback', { cwd, onEvent: event => { if (event.kind === 'claim') throw new Error('UI closed') }, runnerFor: () => async () => ({ output: 'never executed' }) })).rejects.toThrow('UI closed')
    expect(loadCrew(cwd, 'callback')?.tasks[0].owner?.releasedAt).toBeDefined()
    const result = await runCrew('callback', { cwd, runnerFor: () => async input => {
      expect(input.recovery?.unknownOutcome).toBe(true)
      return { output: 'reconciled' }
    } })
    expect(result.progress.done).toBe(1)
  })

  test('completion fencing rejects stale schedulers and dependency outputs are not truncated', async () => {
    const cwd = temp(); createCrew(cwd, 'fence', 'one task')
    const owner = makeProcessOwner()
    const task = claimNextTask(cwd, 'fence', 'w1', 2, { owner })!
    expect(completeTask(cwd, 'fence', task.id, { status: 'done', output: 'stale', ownerToken: 'wrong' })).toBeNull()
    expect(loadCrew(cwd, 'fence')?.tasks[0].status).toBe('claimed')
    completeTask(cwd, 'fence', task.id, { status: 'done', output: 'x'.repeat(12000), ownerToken: owner.token })
    expect(loadCrew(cwd, 'fence')?.tasks[0].result?.length).toBe(12000)
  })
})

function writeManifestTask(cwd: string, task: BackgroundTask): void {
  writeFileSync(join(backgroundDir(cwd), 'tasks.json'), JSON.stringify({ version: 1, tasks: [task] }))
}
function deadOwner() { return { ...makeProcessOwner(), pid: 2147483647, host: hostname() } }

// The fake headless executable implements actual process/stdin/session files, never a mocked module.
function headlessFixture(cwd: string): string {
  const path = join(cwd, 'headless.ts')
  writeFileSync(path, `
    import {appendFileSync,mkdirSync,readFileSync} from 'node:fs';
    import {dirname,join} from 'node:path';
    const args=process.argv.slice(2), resumed=args.includes('--resume');
    const id=args[args.indexOf(resumed?'--resume':'--session-id')+1];
    const task=JSON.parse(readFileSync(join(process.env.FIXTURE_CWD,'.ur/background/tasks.json'),'utf8')).tasks[0];
    const transcript=task.session.transcriptPath;
    mkdirSync(dirname(transcript),{recursive:true});
    appendFileSync(join(process.env.FIXTURE_CWD,'argv.jsonl'),JSON.stringify(args)+'\\n');
    if(resumed && !readFileSync(transcript,'utf8').includes('tool_result')) throw new Error('no saved tool result');
    let pending='';
    for await(const chunk of process.stdin){ pending+=Buffer.from(chunk).toString(); let i;
      while((i=pending.indexOf('\\n'))!==-1){ const line=pending.slice(0,i);pending=pending.slice(i+1);if(!line.trim())continue;const user=JSON.parse(line);
        appendFileSync(transcript,JSON.stringify({...user,sessionId:id})+'\\n');
        process.stdout.write(JSON.stringify(user)+'\\n');
        if(resumed && process.env.REQUIRE_UNKNOWN_EFFECT==='1' && !user.message.content.includes('UNKNOWN OUTCOMES'))throw new Error('unknown outcomes were hidden from model');
        if(!resumed){
          appendFileSync(join(process.env.FIXTURE_CWD,'effect'),'once\\n');
          appendFileSync(transcript,JSON.stringify({type:'assistant',sessionId:id,message:{content:[{type:'tool_use',id:'effect-1'}]}})+'\\n');
          appendFileSync(transcript,JSON.stringify({type:'user',sessionId:id,message:{content:[{type:'tool_result',tool_use_id:'effect-1',content:'effect completed'}]}})+'\\n');
          appendFileSync(join(process.env.FIXTURE_CWD,'ready'),'ready');
          setInterval(()=>{},1000); await new Promise(()=>{});
        }
        process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:id,result:'continued'})+'\\n');
      }
    }
  `)
  return path
}

describe('background saved-session recovery', () => {
  test('a killed worker resumes the actual saved conversation and never repeats its completed effect', async () => {
    const cwd = temp(), config = join(cwd, 'config'), fixture = headlessFixture(cwd)
    const task = createBackgroundTask({ cwd, task: 'finish remaining work' })
    const moduleUrl = new URL('../src/services/agents/backgroundRunner.ts', import.meta.url).href
    const code = `import {runBackgroundWorker} from ${JSON.stringify(moduleUrl)}; const task=await runBackgroundWorker(${JSON.stringify(cwd)},${JSON.stringify(task.id)},{bin:{file:process.execPath,baseArgs:[${JSON.stringify(fixture)}]}});process.stdout.write(JSON.stringify(task));`
    const env = { FIXTURE_CWD: cwd, UR_CONFIG_DIR: config, REQUIRE_UNKNOWN_EFFECT: '1' }
    const worker = childCode(code, env)
    await until(() => existsSync(join(cwd, 'ready')), 'headless process did not save effect')
    const active = getBackgroundTask(cwd, task.id)!
    expect(active.session?.id).toBeDefined()
    worker.kill('SIGKILL'); await worker.exited
    // A surviving agent is not a license to start a duplicate worker.
    expect(reconcileBackgroundTasks(cwd)[0].status).toBe('running')
    expect(reconcileBackgroundTasks(cwd)[0].error).toContain('agent is still alive')
    process.kill(active.agentPid!, 'SIGKILL')
    await until(() => { try { process.kill(active.agentPid!, 0); return false } catch { return true } }, 'agent did not exit')
    appendFileSync(active.session!.transcriptPath, JSON.stringify({ type: 'assistant', sessionId: active.session!.id, message: { content: [{ type: 'tool_use', id: 'uncertain-write', name: 'Bash', input: { command: 'an external effect with unknown outcome' } }] } }) + '\n')
    expect(reconcileBackgroundTasks(cwd)[0].status).toBe('queued')
    const resumed = childCode(code, env)
    const [exit, stdout, stderr] = await Promise.all([resumed.exited, new Response(resumed.stdout).text(), new Response(resumed.stderr).text()])
    expect(exit, stderr).toBe(0)
    expect(JSON.parse(stdout).status).toBe('completed')
    const calls = readFileSync(join(cwd, 'argv.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('--session-id')
    expect(calls[1]).toContain('--resume')
    expect(calls[1][calls[1].indexOf('--resume') + 1]).toBe(active.session!.id)
    expect(readFileSync(join(cwd, 'effect'), 'utf8')).toBe('once\n')
  }, 60_000)

  test('terminal results skip model execution; changed specs refuse and unknown effects reach reconciliation context', async () => {
    const cwd = temp(), fixture = headlessFixture(cwd)
    const task = createBackgroundTask({ cwd, task: 'finish work' })
    // Start the real worker long enough to obtain its canonical digest/session binding.
    const moduleUrl = new URL('../src/services/agents/backgroundRunner.ts', import.meta.url).href
    const worker = childCode(`import {runBackgroundWorker} from ${JSON.stringify(moduleUrl)};await runBackgroundWorker(${JSON.stringify(cwd)},${JSON.stringify(task.id)},{bin:{file:process.execPath,baseArgs:[${JSON.stringify(fixture)}]}});`, { FIXTURE_CWD: cwd, UR_CONFIG_DIR: join(cwd, 'config') })
    await until(() => existsSync(join(cwd, 'ready')), 'fixture not ready')
    const saved = getBackgroundTask(cwd, task.id)!
    worker.kill('SIGKILL'); await worker.exited
    process.kill(saved.agentPid!, 'SIGKILL')
    await until(() => { try { process.kill(saved.agentPid!, 0); return false } catch { return true } }, 'agent did not exit')
    saved.owner = deadOwner(); delete saved.agentPid
    writeFileSync(saved.outputFile, JSON.stringify({ type: 'result', session_id: saved.session!.id, subtype: 'success', is_error: false }) + '\n')
    writeManifestTask(cwd, saved)
    expect(reconcileBackgroundTasks(cwd)[0].status).toBe('completed')
    saved.task = 'a different effect'; writeManifestTask(cwd, saved)
    expect(reconcileBackgroundTasks(cwd)[0].error).toContain('specification changed')
    saved.task = task.task; writeFileSync(saved.outputFile, '')
    appendFileSync(saved.session!.transcriptPath, JSON.stringify({ type: 'assistant', sessionId: saved.session!.id, message: { content: [{ type: 'tool_use', id: 'unknown' }] } }) + '\n')
    writeManifestTask(cwd, saved)
    const recovery = reconcileBackgroundTasks(cwd)[0]
    expect(recovery.status).toBe('queued')
    expect(recovery.recovery?.reason).toContain('unknown effects')
    expect(recovery.recovery?.unknownEffects).toEqual([{ id: 'unknown' }])
    expect(readFileSync(join(cwd, 'effect'), 'utf8')).toBe('once\n')
  }, 60_000)
})
