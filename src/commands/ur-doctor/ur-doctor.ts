import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { urDoctor } from '../../ur/sysinfo.js'
export const call: LocalCommandCall = async () => ({ type: 'text', value: await urDoctor(getCwd()) })
