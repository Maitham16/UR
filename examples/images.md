# Images

- Paste from clipboard with `Ctrl+V`, then ask about the image — the model's
  vision path handles it (requires a vision-capable model).
- `/image <file> [task]` inspects an image by path (absolute or workspace).
  Reports size/format; notes when OCR (`tesseract`) is available.
- If the vision model isn't installed, UR tells you the exact `ollama pull`
  command instead of failing silently.
