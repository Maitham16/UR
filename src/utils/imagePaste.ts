import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { execa } from 'execa'
import { writeFile, unlink } from 'fs/promises'
import { basename, extname, isAbsolute, join } from 'path'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  detectImageFormatFromBuffer,
  detectImageFormatFromBase64,
  type ImageDimensions,
  maybeResizeAndDownsampleImageBuffer,
  type ResizeResult,
} from './imageResizer.js'
import { logError } from './log.js'

// Native NSPasteboard reader. GrowthBook gate tengu_collage_kaleidoscope is
// a kill switch (default on). Falls through to osascript when off.
// The gate string is inlined at each callsite INSIDE the feature() condition
// — module-scope helpers are NOT tree-shaken (see docs/feature-gating.md).

type SupportedPlatform = 'darwin' | 'linux' | 'win32'

// Threshold in characters for when to consider text a "large paste"
export const PASTE_THRESHOLD = 800
function getClipboardCommands() {
  const platform = process.platform as SupportedPlatform

  // Platform-specific temporary file paths
  // Use UR_CODE_TMPDIR if set, otherwise fall back to platform defaults
  const baseTmpDir =
    process.env.UR_CODE_TMPDIR ||
    (platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : '/tmp')
  const screenshotFilename = 'ur_cli_latest_screenshot.png'
  const tempPaths: Record<SupportedPlatform, string> = {
    darwin: join(baseTmpDir, screenshotFilename),
    linux: join(baseTmpDir, screenshotFilename),
    win32: join(baseTmpDir, screenshotFilename),
  }

  const screenshotPath = tempPaths[platform] || tempPaths.linux

  // Platform-specific clipboard commands
  const commands: Record<
    SupportedPlatform,
    {
      checkImage: string
      saveImage: string
      getPath: string
      deleteFile: string
    }
  > = {
    darwin: {
      // Prefer PNG but fall back to TIFF. macOS screenshots and many apps put
      // only a TIFF representation on the pasteboard, so a PNG-only check
      // (`the clipboard as «class PNGf»`) fails with -1700 and the paste is
      // reported as "No image found in clipboard". `clipboard info` lists the
      // available types without dumping the (potentially huge) data.
      checkImage: `osascript -e 'clipboard info' 2>/dev/null | grep -qiE 'PNGf|TIFF'`,
      saveImage: `osascript -e 'try' -e 'set imgData to (the clipboard as «class PNGf»)' -e 'on error' -e 'set imgData to (the clipboard as «class TIFF»)' -e 'end try' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'set eof fp to 0' -e 'write imgData to fp' -e 'close access fp'`,
      getPath: `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`,
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    linux: {
      checkImage:
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null || xclip -selection clipboard -t image/bmp -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/bmp > "${screenshotPath}"`,
      getPath:
        'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    win32: {
      checkImage:
        'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
      saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
      getPath: 'powershell -NoProfile -Command "Get-Clipboard"',
      deleteFile: `del /f "${screenshotPath}"`,
    },
  }

  return {
    commands: commands[platform] || commands.linux,
    screenshotPath,
  }
}

export type ImageWithDimensions = {
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
}

// BMP magic bytes ("BM"). Windows/WSL2 copies images as BMP by default.
function isBmpBuffer(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d
}

// TIFF magic bytes — little-endian ("II*\0") or big-endian ("MM\0*"). macOS
// screenshots and many apps expose only a TIFF clipboard representation.
function isTiffBuffer(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    ((buf[0] === 0x49 &&
      buf[1] === 0x49 &&
      buf[2] === 0x2a &&
      buf[3] === 0x00) ||
      (buf[0] === 0x4d &&
        buf[1] === 0x4d &&
        buf[2] === 0x00 &&
        buf[3] === 0x2a))
  )
}

function encodedBase64Size(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3)
}

async function readSipsDimensions(
  path: string,
): Promise<{ width?: number; height?: number }> {
  if (process.platform !== 'darwin') {
    return {}
  }

  const result = await execa(
    'sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', path],
    { reject: false },
  )
  if (result.exitCode !== 0) {
    return {}
  }

  const width = /pixelWidth:\s*(\d+)/.exec(result.stdout)?.[1]
  const height = /pixelHeight:\s*(\d+)/.exec(result.stdout)?.[1]
  return {
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
  }
}

async function tryResizeClipboardImageWithSips(
  imageBuffer: Buffer,
  sourcePath?: string,
): Promise<ImageWithDimensions | null> {
  if (process.platform !== 'darwin') {
    return null
  }

  const tempId = randomBytes(6).toString('hex')
  const inputPath =
    sourcePath ??
    join(
      process.env.UR_CODE_TMPDIR || '/tmp',
      `ur_cli_clipboard_source_${tempId}.png`,
    )
  const createdInput = !sourcePath

  if (createdInput) {
    await writeFile(inputPath, imageBuffer)
  }

  try {
    const originalDimensions = await readSipsDimensions(inputPath)
    const maxDimension = Math.max(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
    const attempts: Array<{ format: 'png' | 'jpeg'; quality?: number }> = [
      { format: 'png' },
      { format: 'jpeg', quality: 85 },
      { format: 'jpeg', quality: 65 },
      { format: 'jpeg', quality: 45 },
      { format: 'jpeg', quality: 25 },
    ]

    for (const attempt of attempts) {
      const extension = attempt.format === 'jpeg' ? 'jpg' : 'png'
      const outputPath = join(
        process.env.UR_CODE_TMPDIR || '/tmp',
        `ur_cli_clipboard_resized_${tempId}_${attempt.format}_${attempt.quality ?? 'lossless'}.${extension}`,
      )
      const args = [
        '-Z',
        String(maxDimension),
        '-s',
        'format',
        attempt.format,
      ]
      if (attempt.quality) {
        args.push('-s', 'formatOptions', String(attempt.quality))
      }
      args.push(inputPath, '--out', outputPath)

      const result = await execa('sips', args, { reject: false })
      if (result.exitCode !== 0) {
        logForDebugging(
          `sips clipboard image resize failed: ${
            result.stderr?.trim() || 'unknown error'
          }`,
          { level: 'warn' },
        )
        continue
      }

      try {
        const outputBuffer =
          getFsImplementation().readFileBytesSync(outputPath)
        if (
          outputBuffer.length > 0 &&
          encodedBase64Size(outputBuffer.length) <= API_IMAGE_MAX_BASE64_SIZE
        ) {
          const displayDimensions = await readSipsDimensions(outputPath)
          return {
            base64: outputBuffer.toString('base64'),
            mediaType: detectImageFormatFromBuffer(outputBuffer),
            dimensions: {
              originalWidth: originalDimensions.width,
              originalHeight: originalDimensions.height,
              displayWidth: displayDimensions.width,
              displayHeight: displayDimensions.height,
            },
          }
        }
      } finally {
        void unlink(outputPath).catch(() => {})
      }
    }
  } catch (error) {
    logForDebugging(
      `sips clipboard image fallback failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { level: 'warn' },
    )
  } finally {
    if (createdInput) {
      void unlink(inputPath).catch(() => {})
    }
  }

  return null
}

/**
 * Check if clipboard contains an image without retrieving it.
 */
export async function hasImageInClipboard(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    // Native NSPasteboard check (~0.03ms warm). Fall through to osascript
    // when the module/export is missing. Catch a throw too: it would surface
    // as an unhandled rejection in useClipboardImageHint's setTimeout.
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const hasImage = getNativeModule()?.hasClipboardImage
      if (hasImage) {
        return hasImage()
      }
    } catch (e) {
      logError(e as Error)
    }
  }
  // `clipboard info` lists pasteboard types without dumping data; match PNG or
  // TIFF so screenshots that only expose a TIFF representation are detected too.
  const result = await execFileNoThrowWithCwd('osascript', [
    '-e',
    'clipboard info',
  ])
  return result.code === 0 && /PNGf|TIFF/i.test(result.stdout ?? '')
}

export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  // Fast path: native NSPasteboard reader (macOS only). Reads PNG bytes
  // directly in-process and downsamples via CoreGraphics if over the
  // dimension cap. ~5ms cold, sub-ms warm — vs. ~1.5s for the osascript
  // path below. Throws if the native module is unavailable, in which case
  // the catch block falls through to osascript. A `null` return from the
  // native call is authoritative (clipboard has no image).
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    process.platform === 'darwin' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const readClipboard = getNativeModule()?.readClipboardImage
      if (!readClipboard) {
        throw new Error('native clipboard reader unavailable')
      }
      const native = readClipboard(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
      if (!native) {
        // native reader can miss formats detection caught — fall back to osascript
        throw new Error('native clipboard read returned null')
      }
      // The native path caps dimensions but not file size. A complex
      // 2000×2000 PNG can still exceed the 3.75MB raw / 5MB base64 API
      // limit — for that edge case, run through the same size-cap that
      // the osascript path uses (degrades to JPEG if needed). Cheap if
      // already under: just a sharp metadata read.
      const buffer: Buffer = native.png
      if (buffer.length > IMAGE_TARGET_RAW_SIZE) {
        let resized: ResizeResult
        try {
          resized = await maybeResizeAndDownsampleImageBuffer(
            buffer,
            buffer.length,
            'png',
          )
        } catch (error) {
          const fallback = await tryResizeClipboardImageWithSips(buffer)
          if (fallback) {
            return fallback
          }
          throw error
        }
        return {
          base64: resized.buffer.toString('base64'),
          mediaType: `image/${resized.mediaType}`,
          // resized.dimensions sees the already-downsampled buffer; native knows the true originals.
          dimensions: {
            originalWidth: native.originalWidth,
            originalHeight: native.originalHeight,
            displayWidth: resized.dimensions?.displayWidth ?? native.width,
            displayHeight: resized.dimensions?.displayHeight ?? native.height,
          },
        }
      }
      return {
        base64: buffer.toString('base64'),
        mediaType: 'image/png',
        dimensions: {
          originalWidth: native.originalWidth,
          originalHeight: native.originalHeight,
          displayWidth: native.width,
          displayHeight: native.height,
        },
      }
    } catch (e) {
      logError(e as Error)
      // Fall through to osascript fallback.
    }
  }

  const { commands, screenshotPath } = getClipboardCommands()

  // Is there an image on the clipboard at all? Guard the spawn itself so a
  // missing helper (e.g. xclip on Linux) returns null rather than throwing.
  let checkResult
  try {
    checkResult = await execa(commands.checkImage, { shell: true, reject: false })
  } catch (e) {
    logForDebugging(
      `Clipboard image check could not run: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { level: 'warn' },
    )
    return null
  }
  if (checkResult.exitCode !== 0) {
    // Genuinely no image on the clipboard — the caller shows the
    // "copy an image first" hint for this case.
    return null
  }

  // An image IS present. From here on, let failures propagate (throw) instead
  // of returning null, so the caller can surface the real reason
  // ("Image paste failed: …") rather than the misleading
  // "No image found in clipboard".
  const saveResult = await execa(commands.saveImage, { shell: true, reject: false })
  if (saveResult.exitCode !== 0) {
    throw new Error(
      `Could not read the clipboard image (osascript: ${
        saveResult.stderr?.trim() || 'unknown error'
      })`,
    )
  }

  // Read the image and convert to base64
  let imageBuffer = getFsImplementation().readFileBytesSync(screenshotPath)

  // BMP and TIFF are not supported by the API — convert to PNG via Sharp.
  // BMP covers WSL2 (Windows copies images as BMP); TIFF covers macOS
  // screenshots and apps that only expose a TIFF clipboard representation.
  if (isBmpBuffer(imageBuffer) || isTiffBuffer(imageBuffer)) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }

  // Resize if needed to stay under 5MB API limit
  let resized: ResizeResult
  try {
    resized = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )
  } catch (error) {
    const fallback = await tryResizeClipboardImageWithSips(
      imageBuffer,
      screenshotPath,
    )
    if (fallback) {
      void execa(commands.deleteFile, { shell: true, reject: false })
      return fallback
    }
    throw error
  }
  const base64Image = resized.buffer.toString('base64')

  // Detect format from magic bytes
  const mediaType = detectImageFormatFromBase64(base64Image)

  // Cleanup (fire-and-forget, don't await)
  void execa(commands.deleteFile, { shell: true, reject: false })

  return {
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}

export async function getImagePathFromClipboard(): Promise<string | null> {
  const { commands } = getClipboardCommands()

  try {
    // Try to get text from clipboard
    const result = await execa(commands.getPath, {
      shell: true,
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

/**
 * Regex pattern to match supported image file extensions. Kept in sync with
 * MIME_BY_EXT in BriefTool/upload.ts — attachments.ts uses this to set isImage
 * on the wire, and remote viewers fetch /preview iff isImage is true. An ext
 * here but not in MIME_BY_EXT (e.g. bmp) uploads as octet-stream and has no
 * /preview variant → broken thumbnail.
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

/**
 * Remove outer single or double quotes from a string
 * @param text Text to clean
 * @returns Text without outer quotes
 */
function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Remove shell escape backslashes from a path (for macOS/Linux/WSL)
 * On Windows systems, this function returns the path unchanged
 * @param path Path that might contain shell-escaped characters
 * @returns Path with escape backslashes removed (on macOS/Linux/WSL only)
 */
function stripBackslashEscapes(path: string): string {
  const platform = process.platform as SupportedPlatform

  // On Windows, don't remove backslashes as they're part of the path
  if (platform === 'win32') {
    return path
  }

  // On macOS/Linux/WSL, handle shell-escaped paths
  // Double-backslashes (\\) represent actual backslashes in the filename
  // Single backslashes followed by special chars are shell escapes

  // First, temporarily replace double backslashes with a placeholder
  // Use random salt to prevent injection attacks where path contains literal placeholder
  const salt = randomBytes(8).toString('hex')
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)

  // Remove single backslashes that are shell escapes
  // This handles cases like "name\ \(15\).png" -> "name (15).png"
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')

  // Replace placeholders back to single backslashes
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

/**
 * Check if a given text represents an image file path
 * @param text Text to check
 * @returns Boolean indicating if text is an image path
 */
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Clean and normalize a text string that might be an image file path
 * @param text Text to process
 * @returns Cleaned text with quotes removed, whitespace trimmed, and shell escapes removed, or null if not an image path
 */
export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

/**
 * Try to find and read an image file, falling back to clipboard search
 * @param text Pasted text that might be an image filename or path
 * @returns Object containing the image path and base64 data, or null if not found
 */
export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  // Strip terminal added spaces or quotes to dragged in paths
  const cleanedPath = asImageFilePath(text)

  if (!cleanedPath) {
    return null
  }

  const imagePath = cleanedPath
  let imageBuffer

  try {
    if (isAbsolute(imagePath)) {
      imageBuffer = getFsImplementation().readFileBytesSync(imagePath)
    } else {
      // VSCode Terminal just grabs the text content which is the filename
      // instead of getting the full path of the file pasted with cmd-v. So
      // we check if it matches the filename of the image in the clipboard.
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && imagePath === basename(clipboardPath)) {
        imageBuffer = getFsImplementation().readFileBytesSync(clipboardPath)
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  // BMP is not supported by the API — convert to PNG via Sharp.
  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0x42 &&
    imageBuffer[1] === 0x4d
  ) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }

  // Resize if needed to stay under 5MB API limit
  // Extract extension from path for format hint
  const ext = extname(imagePath).slice(1).toLowerCase() || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    imageBuffer.length,
    ext,
  )
  const base64Image = resized.buffer.toString('base64')

  // Detect format from the actual file contents using magic bytes
  const mediaType = detectImageFormatFromBase64(base64Image)
  return {
    path: imagePath,
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}
