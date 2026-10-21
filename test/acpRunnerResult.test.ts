import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

test('actual ACP child terminal errors and missing results cannot become successful remote completion', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-acp-result-'))
  const root = resolve(import.meta.dir, '..')
  const cli = join(cwd, 'cli.ts'), wrapper = join(cwd, 'wrapper.ts')
  try {
    writeFileSync(cli, `import{createInterface}from'node:readline';
const lines=createInterface({input:process.stdin});lines.on('line',line=>{
 if(JSON.parse(line).type!=='user')return;
 const result=JSON.parse(process.env.FIXTURE_RESULT!);
 const output={type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'partial preserved'}}};
 process.stdout.write(JSON.stringify(output)+'\\n'+(result?JSON.stringify(result)+'\\n':''),()=>process.exit(0));
});`)
    writeFileSync(wrapper, `import{defaultAcpPromptRunner}from ${JSON.stringify(pathToFileURL(join(root, 'src/services/agents/acpStdio.ts')).href)};
process.argv[1]=${JSON.stringify(cli)};const chunks=[];
try{const result=await defaultAcpPromptRunner('fixture',{sessionId:'12345678-1234-1234-1234-123456789abc',cwd:process.cwd(),signal:new AbortController().signal,additionalDirectories:[],mcpServers:[],mode:'default',onChunk:text=>chunks.push(text),onToolUpdate:()=>{},requestPermission:async()=>({outcome:{outcome:'cancelled'}})});console.log(JSON.stringify({result,chunks}));}
catch(error){console.log(JSON.stringify({error:String(error),chunks}));}`)
    for (const [result, failure] of [
      [{ type: 'result', subtype: 'success', is_error: false }, undefined],
      [{ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['turn budget reached'] }, 'error_max_turns'],
      [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['provider unavailable'] }, 'provider unavailable'],
      [{ type: 'result', subtype: 'success', is_error: true }, 'success'],
      [{ type: 'result' }, 'error result'],
      [null, 'without a terminal result'],
    ] as const) {
      const child = spawnSync(process.execPath, ['--preload', join(root, 'plugins/bunBundleDev.ts'), wrapper], {
        cwd, encoding: 'utf8', timeout: 15_000, env: { ...process.env, FIXTURE_RESULT: JSON.stringify(result) },
      })
      expect(child.status, child.stderr).toBe(0)
      const observed = JSON.parse(child.stdout.trim().split('\n').at(-1)!)
      expect(observed.chunks).toEqual(['partial preserved'])
      if (failure) {
        expect(observed.error).toContain(failure)
        expect(observed.result).toBeUndefined()
      } else expect(observed.result.stopReason).toBe('end_turn')
    }
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}, 60_000)
