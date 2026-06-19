/** /video */
import type { Command } from '../../types/command.js'
const videoCmd = {
  type: 'local',
  name: 'video',
  description: 'Inspect a local/remote video (ffmpeg/yt-dlp aware)',
  argumentHint: '<file|url> [task]',
  supportsNonInteractive: true,
  load: () => import('./video.js'),
} satisfies Command
export default videoCmd
