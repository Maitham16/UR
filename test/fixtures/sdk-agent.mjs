import { createInterface } from 'node:readline'
const input = createInterface({input:process.stdin})
let prompt
for await (const line of input) { const message=JSON.parse(line); if(message.type==='control_request') { if(message.request.subtype!=='initialize')process.exit(9); continue } if(message.type==='user') { prompt=message.message.content; break } }
if(typeof prompt!=='string')process.exit(8)
const mode = process.env.UR_SDK_FIXTURE_MODE ?? 'success'
const args = process.argv.slice(2)
const sessionId = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'sdk-fixture-session'
const send = event => process.stdout.write(JSON.stringify(event) + '\n')
send({ type: 'system', subtype: 'init', session_id: sessionId })
if (mode === 'wait') {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
} else if (mode === 'malformed') { process.stdout.write('not-json\n'); setInterval(() => {}, 1000) }
else if (mode === 'missing') process.exit(0)
else if (mode === 'overflow') { for (let i = 0; i < 500; i++) send({ type: 'assistant', message: 'x'.repeat(300) }); setInterval(() => {}, 1000) }
else if (mode === 'permission' || mode === 'permission-input') {
  send({ type: 'control_request', request_id: 'permission-1', request: { subtype: 'can_use_tool', tool_name: 'Read', input: { file_path: '/fixture' } } })
  const reader = createInterface({ input: process.stdin })
  reader.on('line', line => {
    const wire = JSON.parse(line)
    if (wire.type !== 'control_response' || wire.response.request_id !== 'permission-1' || wire.response.subtype !== 'success') process.exit(3)
    const decision = wire.response.response
    // Match the native permission wire: bare allow/deny lacks required fields.
    if (decision.behavior === 'allow' && (!decision.updatedInput || typeof decision.updatedInput !== 'object' || Array.isArray(decision.updatedInput))) process.exit(4)
    if (decision.behavior === 'deny' && typeof decision.message !== 'string') process.exit(5)
    send({ type: 'result', subtype: 'success', is_error: false, result: mode === 'permission-input' ? JSON.stringify(decision) : decision.behavior, session_id: sessionId })
    reader.close(); process.stdin.destroy()
  })
} else {
  const data = Buffer.from(JSON.stringify({ type: 'result', subtype: mode === 'error' ? 'error_max_turns' : 'success', is_error: mode === 'error', result: mode === 'args' ? JSON.stringify({args,prompt}) : 'こんにちは café العربية', session_id: sessionId }) + '\n')
  for (let i = 0; i < data.length; i++) { process.stdout.write(data.subarray(i, i + 1)); await new Promise(resolve => setTimeout(resolve, 1)) }
}
