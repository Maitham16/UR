# Video & YouTube

These are dependency-aware: they do the local part and tell you what to install.

- `/video <file|url> [task]` — checks `ffmpeg` (frames/audio) and `yt-dlp`
  (download); with them present, ask UR to extract frames or a transcript.
- `/youtube <url> [task]` — checks `yt-dlp`; fetches metadata/subtitles/transcript
  when installed (`brew install yt-dlp ffmpeg`).
