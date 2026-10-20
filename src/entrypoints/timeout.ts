// Development/source consumers do not necessarily have the CLI in argv[1].
// Production JS and native distributions dispatch through --internal-timeout.
import { runInternalTimeout } from '../utils/shell/internalTimeout.js'

process.exitCode = await runInternalTimeout(process.argv.slice(2))
