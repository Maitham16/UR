/** /youtube */
import type { Command } from '../../types/command.js'
const youtube = {
  type: 'local',
  name: 'youtube',
  description: 'Fetch YouTube metadata/transcript (yt-dlp aware)',
  argumentHint: '<url> [task]',
  supportsNonInteractive: true,
  load: () => import('./youtube.js'),
} satisfies Command
export default youtube
