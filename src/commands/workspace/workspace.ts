import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { workspaceInfo } from '../../ur/sysinfo.js'
export const call: LocalCommandCall = async () => ({ type: 'text', value: workspaceInfo(getCwd()) })
