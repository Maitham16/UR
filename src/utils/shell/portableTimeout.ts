import { getPlatform, type Platform } from '../platform.js'
import { quote } from '../bash/shellQuote.js'

// `timeout` is a GNU utility and is not included with macOS. Models still use
// it frequently because it is ubiquitous on Linux, so provide the familiar
// command inside UR's spawned shell instead of making every macOS run fail and
// consume another model turn. The supervisor uses UR's current Node/Bun
// executable, starts the child in its own process group, and reaps that group
// when the deadline expires.
const PORTABLE_TIMEOUT_RUNNER = String.raw`
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
let args = process.argv.slice(1);
let preserve = false;
let verbose = false;
let signal = 'SIGTERM';
let killAfter = null;
const durationMs = value => {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(value || '');
  if (!match) return null;
  const scale = { '': 1000, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  const result = Number(match[1]) * scale;
  return Number.isFinite(result) ? Math.min(result, 2147483647) : null;
};
const takeValue = (arg, longName, shortName) => {
  if (arg === longName || arg === shortName) return args.shift();
  if (arg.startsWith(longName + '=')) return arg.slice(longName.length + 1);
  if (arg.startsWith(shortName) && arg.length > shortName.length) return arg.slice(shortName.length);
  return undefined;
};
while (args.length && args[0].startsWith('-') && args[0] !== '-') {
  const arg = args.shift();
  if (arg === '--') break;
  if (arg === '--foreground') continue;
  if (arg === '--preserve-status') { preserve = true; continue; }
  if (arg === '--verbose' || arg === '-v') { verbose = true; continue; }
  const killValue = takeValue(arg, '--kill-after', '-k');
  if (killValue !== undefined) {
    killAfter = durationMs(killValue);
    if (killAfter === null) { console.error('timeout: invalid --kill-after value'); process.exit(125); }
    continue;
  }
  const signalValue = takeValue(arg, '--signal', '-s');
  if (signalValue !== undefined) {
    const normalizedSignal = signalValue.toUpperCase();
    signal = /^\d+$/.test(signalValue) ? Number(signalValue) : normalizedSignal.startsWith('SIG') ? normalizedSignal : 'SIG' + normalizedSignal;
    continue;
  }
  console.error('timeout: unsupported option ' + arg);
  process.exit(125);
}
const limit = durationMs(args.shift());
const command = args.shift();
if (limit === null || !command) {
  console.error('timeout: expected a duration and command');
  process.exit(125);
}
const child = spawn(command, args, { stdio: 'inherit', detached: true });
let expired = false;
let killTimer;
const send = requestedSignal => {
  if (!child.pid) return;
  try { process.kill(-child.pid, requestedSignal); }
  catch { try { child.kill(requestedSignal); } catch {} }
};
const timer = setTimeout(() => {
  expired = true;
  if (verbose) console.error('timeout: sending signal ' + signal + ' to command ' + command);
  send(signal);
  if (killAfter !== null) killTimer = setTimeout(() => send('SIGKILL'), killAfter);
}, limit);
for (const parentSignal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  process.on(parentSignal, () => send(parentSignal));
}
child.on('error', error => {
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  console.error('timeout: ' + error.message);
  process.exitCode = error.code === 'ENOENT' ? 127 : 126;
});
child.on('exit', (code, childSignal) => {
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (expired && !preserve) { process.exitCode = 124; return; }
  if (code !== null) { process.exitCode = code; return; }
  process.exitCode = 128 + (constants.signals[childSignal] || 1);
});
`.trim()

const PORTABLE_TIMEOUT_RUNNER_ENV = 'UR_CODE_PORTABLE_TIMEOUT_RUNNER'
const PORTABLE_TIMEOUT_RUNNER_BASE64 = Buffer.from(
  PORTABLE_TIMEOUT_RUNNER,
).toString('base64')

export function getPortableTimeoutEnvironment(
  platform: Platform = getPlatform(),
): Record<string, string> {
  return platform === 'macos'
    ? { [PORTABLE_TIMEOUT_RUNNER_ENV]: PORTABLE_TIMEOUT_RUNNER_BASE64 }
    : {}
}

export function getPortableTimeoutCompatibilityCommand(
  platform: Platform = getPlatform(),
  executable: string = process.execPath,
): string | null {
  if (platform !== 'macos') return null

  const launcher = `import("data:text/javascript;base64,"+process.env.${PORTABLE_TIMEOUT_RUNNER_ENV})`
  const runner = quote([
    executable,
    '--input-type=module',
    '-e',
    launcher,
  ])
  return `if ! command -v timeout >/dev/null 2>&1; then if command -v gtimeout >/dev/null 2>&1; then timeout() { command gtimeout "$@"; }; else timeout() { command ${runner} "$@"; }; fi; fi`
}
