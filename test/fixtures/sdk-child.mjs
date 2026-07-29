const args = process.argv.slice(2)
const outputFormatIndex = args.indexOf('--output-format')
const outputFormat =
  outputFormatIndex >= 0 ? args[outputFormatIndex + 1] : undefined

const result = JSON.stringify({
  prompt: args.at(-1),
  outputFormat,
  verbose: args.includes('--verbose'),
  maxTurns:
    args.indexOf('--max-turns') >= 0
      ? args[args.indexOf('--max-turns') + 1]
      : undefined,
  model: process.env.UR_MODEL,
  defaultEnv: process.env.SDK_DEFAULT,
  callEnv: process.env.SDK_CALL,
  sharedEnv: process.env.SDK_SHARED,
})

if (outputFormat === 'stream-json') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }))
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result,
    }),
  )
  // Real stream-json sessions can emit lifecycle events after the terminal
  // result. The SDK parser must still select the result envelope above.
  console.log(
    JSON.stringify({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'idle',
    }),
  )
} else {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result }))
}

const requestedExit = Number(process.env.SDK_TEST_EXIT ?? '0')
if (Number.isSafeInteger(requestedExit) && requestedExit > 0) {
  process.exit(requestedExit)
}
