import type { LocalCommandCall } from '../../types/command.js'
import { osInfo } from '../../ur/sysinfo.js'
export const call: LocalCommandCall = async () => ({ type: 'text', value: osInfo() })
