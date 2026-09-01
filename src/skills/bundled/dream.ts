import { getOriginalCwd } from '../../bootstrap/state.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Register the user-invoked memory-consolidation pass used by assistant mode.
 * Auto-dream deliberately shares this prompt, so manual and background
 * consolidation follow the same memory format and pruning rules.
 */
export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Consolidate recent session signal into durable auto-memory and prune stale memories.',
    whenToUse:
      'Use when the user asks to reflect on recent work, consolidate memories, or clean up auto-memory.',
    argumentHint: '[additional focus]',
    userInvocable: true,
    isEnabled: isAutoMemoryEnabled,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
    async getPromptForCommand(args) {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      return [
        {
          type: 'text',
          text: buildConsolidationPrompt(memoryRoot, transcriptDir, args),
        },
      ]
    },
  })
}
