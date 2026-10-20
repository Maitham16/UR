import { spawn } from 'node:child_process'
import { constants } from 'node:os'

type Signal = NodeJS.Signals | number

function durationMs(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(value ?? '')
  if (!match) return null
  const scale = { '': 1_000, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!]
  const result = Number(match[1]) * scale!
  return Number.isFinite(result) ? Math.min(result, 2_147_483_647) : null
}

/** Internal supervisor; accepts timeout arguments, never runtime JS code. */
export async function runInternalTimeout(argv: string[]): Promise<number> {
  const args = [...argv]
  let preserve = false
  let verbose = false
  let signal: Signal = 'SIGTERM'
  let killAfter: number | null = null
  const fail = (message: string): number => {
    console.error(`timeout: ${message}`)
    return 125
  }
  const takeValue = (arg: string, long: string, short: string): string | undefined => {
    if (arg === long || arg === short) return args.shift() ?? ''
    if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1)
    if (arg.startsWith(short) && arg.length > short.length) return arg.slice(short.length)
    return undefined
  }
  while (args.length && args[0]!.startsWith('-') && args[0] !== '-') {
    const arg = args.shift()!
    if (arg === '--') break
    if (arg === '--foreground') continue
    if (arg === '--preserve-status') { preserve = true; continue }
    if (arg === '--verbose' || arg === '-v') { verbose = true; continue }
    const killValue = takeValue(arg, '--kill-after', '-k')
    if (killValue !== undefined) {
      killAfter = durationMs(killValue)
      if (killAfter === null) return fail('invalid --kill-after value')
      continue
    }
    const signalValue = takeValue(arg, '--signal', '-s')
    if (signalValue !== undefined) {
      const name = signalValue.toUpperCase().replace(/^SIG/, '')
      const normalized = /^\d+$/.test(name) ? Number(name) : `SIG${name}`
      if (typeof normalized === 'number') {
        if (!Object.values(constants.signals).includes(normalized)) return fail('invalid signal')
        signal = normalized
      } else {
        if (!(normalized in constants.signals)) return fail('invalid signal')
        signal = normalized as NodeJS.Signals
      }
      continue
    }
    return fail(`unsupported option ${arg}`)
  }
  const limit = durationMs(args.shift())
  const command = args.shift()
  if (limit === null || !command) return fail('expected a duration and command')

  return await new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit', detached: true })
    let expired = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const send = (requested: Signal): void => {
      if (!child.pid) return
      try { process.kill(-child.pid, requested) }
      catch { try { child.kill(requested) } catch { /* Child already exited. */ } }
    }
    const onInterrupt = (): void => send('SIGINT')
    const onHangup = (): void => send('SIGHUP')
    const onTerminate = (): void => send('SIGTERM')
    process.on('SIGINT', onInterrupt)
    process.on('SIGHUP', onHangup)
    process.on('SIGTERM', onTerminate)
    const finish = (status: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // Keep escalation alive if a shell exits while its grandchild ignores TERM.
      if (killTimer) {
        let groupAlive = false
        if (expired && child.pid) {
          try { process.kill(-child.pid, 0); groupAlive = true } catch { /* No descendants. */ }
        }
        if (!groupAlive) clearTimeout(killTimer)
      }
      process.off('SIGINT', onInterrupt)
      process.off('SIGHUP', onHangup)
      process.off('SIGTERM', onTerminate)
      resolve(status)
    }
    if (limit > 0) {
      timer = setTimeout(() => {
        expired = true
        if (verbose) console.error(`timeout: sending signal ${signal} to command ${command}`)
        send(signal)
        if (killAfter !== null) killTimer = setTimeout(() => send('SIGKILL'), killAfter)
      }, limit)
    }
    child.on('error', error => {
      console.error(`timeout: ${error.message}`)
      finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 126)
    })
    child.on('exit', (code, childSignal) => {
      if (expired && !preserve) finish(124)
      else if (code !== null) finish(code)
      else finish(128 + (constants.signals[childSignal!] ?? 1))
    })
  })
}
