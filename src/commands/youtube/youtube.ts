import type { LocalCommandCall } from '../../types/command.js'
import { commandExists, runCapture } from '../../ur/sysinfo.js'

export const call: LocalCommandCall = async (args: string) => {
  const url = (args ?? '').trim().split(/\s+/)[0] ?? ''
  if (!url) return { type: 'text', value: 'usage: /youtube <url> [task]' }
  if (!commandExists('yt-dlp')) {
    return { type: 'text', value: `yt-dlp not installed — install with: brew install yt-dlp (or pipx install yt-dlp)\nThen /youtube fetches metadata + subtitles for ${url}.` }
  }
  // Metadata only — never downloads the video.
  const r = runCapture('yt-dlp', ['--dump-json', '--skip-download', '--no-warnings', url], 25000)
  if (!r.ok) return { type: 'text', value: `yt-dlp failed: ${(r.err || '').split('\n')[0] || 'unknown error'}` }
  try {
    const d = JSON.parse(r.out.split('\n')[0] || '{}') as { title?: string; uploader?: string; duration?: number; view_count?: number; description?: string }
    const mins = d.duration ? `${Math.floor(d.duration / 60)}m${d.duration % 60}s` : '?'
    const desc = (d.description ?? '').split('\n').slice(0, 4).join(' ').slice(0, 400)
    return { type: 'text', value: `title: ${d.title ?? '?'}\nuploader: ${d.uploader ?? '?'} · duration: ${mins} · views: ${d.view_count ?? '?'}\n\n${desc}\n\n(Ask UR to fetch subtitles/transcript and summarize.)` }
  } catch {
    return { type: 'text', value: r.out.slice(0, 2000) }
  }
}
