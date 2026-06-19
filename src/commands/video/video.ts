import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { commandExists, runCapture } from '../../ur/sysinfo.js'

export const call: LocalCommandCall = async (args: string) => {
  const target = (args ?? '').trim().split(/\s+/)[0] ?? ''
  if (!target) return { type: 'text', value: 'usage: /video <file|url> [task]' }
  const isUrl = /^https?:\/\//.test(target)
  if (isUrl) {
    const yd = commandExists('yt-dlp') ? 'yt-dlp ✓ — use /youtube for metadata/transcript' : 'install yt-dlp (brew install yt-dlp)'
    return { type: 'text', value: `remote video: ${target}\n${yd}` }
  }
  const abs = isAbsolute(target) ? target : resolve(getCwd(), target)
  if (!existsSync(abs)) return { type: 'text', value: `not found: ${target}` }
  if (!commandExists('ffprobe')) {
    return { type: 'text', value: `local video: ${target}\nInstall ffmpeg for metadata/frames (brew install ffmpeg).` }
  }
  const r = runCapture('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', abs], 20000)
  if (!r.ok) return { type: 'text', value: `ffprobe failed: ${r.err || 'unknown error'}` }
  try {
    const d = JSON.parse(r.out) as { format?: { duration?: string; format_name?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }> }
    const dur = d.format?.duration ? `${Number(d.format.duration).toFixed(1)}s` : '?'
    const streams = (d.streams ?? []).map((s) => (s.codec_type === 'video' ? `video ${s.codec_name} ${s.width}x${s.height}` : `${s.codec_type} ${s.codec_name}`)).join(', ')
    return { type: 'text', value: `video ${target}\nformat: ${d.format?.format_name ?? '?'} · duration: ${dur}\nstreams: ${streams}\n(Ask UR to extract frames/audio with ffmpeg — writes require approval.)` }
  } catch {
    return { type: 'text', value: r.out.slice(0, 2000) }
  }
}
