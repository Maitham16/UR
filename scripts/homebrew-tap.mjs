#!/usr/bin/env node
// Generate a personal tap from the verified four-platform native release.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HOMEBREW_TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
const repository = 'https://github.com/Maitham16/UR'
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const template = fileURLToPath(new URL('../packaging/homebrew-tap/', import.meta.url))

export function validateHomebrewManifest(value, { expectedVersion, expectedCommit } = {}) {
  if (!value || value.schemaVersion !== 1 || typeof value.version !== 'string' || value.version.length > 100 || !stableVersion.test(value.version) || !/^[a-f0-9]{40}$/.test(value.sourceCommit ?? '')) throw new Error('Invalid stable native release manifest')
  const parts = value.version.split('.').map(BigInt)
  if (parts[0] < 1n || (parts[0] === 1n && (parts[1] < 86n || (parts[1] === 86n && parts[2] < 1n)))) throw new Error('Homebrew requires UR 1.86.1 or newer for package-manager ownership')
  if (expectedVersion && value.version !== expectedVersion) throw new Error('Homebrew manifest version does not match the requested release')
  if (expectedCommit && value.sourceCommit !== expectedCommit) throw new Error('Homebrew manifest source commit does not match the requested release')
  if (!value.platforms || Object.keys(value.platforms).sort().join(',') !== [...HOMEBREW_TARGETS].sort().join(',')) throw new Error('Homebrew requires exactly the four macOS/Linux native targets')
  for (const target of HOMEBREW_TARGETS) {
    const artifact = value.platforms[target]
    if (!artifact || artifact.file !== `ur-${value.version}-${target}.tar.gz` || artifact.executable !== 'ur' || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 1024 ** 3) throw new Error(`Invalid Homebrew native artifact: ${target}`)
  }
  return value
}

export function generateHomebrewFormula(value, options = {}) {
  const manifest = validateHomebrewManifest(value, options)
  const artifact = target => `      url "${repository}/releases/download/v${manifest.version}/${manifest.platforms[target].file}"\n      sha256 "${manifest.platforms[target].sha256}"`
  return `# Generated from the immutable native release manifest. Do not edit checksums by hand.
# Source commit: ${manifest.sourceCommit}
class UrNexus < Formula
  desc "Terminal coding agent with a bundled runtime and local-first provider support"
  homepage "${repository}"
  version "${manifest.version}"
  license :cannot_represent

  # Keep upstream native library IDs and resource-integrity hashes intact.
  preserve_rpath
  skip_clean "libexec"

  on_macos do
    depends_on macos: :sequoia
    on_arm do
      depends_on arch: :arm64
${artifact('darwin-arm64')}
    end
    on_intel do
      depends_on arch: :x86_64
${artifact('darwin-x64')}
    end
  end

  on_linux do
    on_arm do
      depends_on arch: :arm64
${artifact('linux-arm64')}
    end
    on_intel do
      depends_on arch: :x86_64
${artifact('linux-x64')}
    end
  end

  def install
    if OS.linux?
      odie "UR requires system glibc 2.28 or newer" if OS::Linux::Glibc.system_version < Version.new("2.28")
      if Hardware::CPU.intel?
        features = Hardware::CPU.features
        required = %i[cx16 lahf_lm popcnt sse4_1 sse4_2 ssse3]
        unless (required - features).empty? && (features.include?(:pni) || features.include?(:sse3))
          odie "UR's image library requires an x86-64-v2 CPU, including SSE4.2"
        end
      end
    end
    libexec.install "ur", "resources"
    bin.install_symlink libexec/"ur"
  end

  def caveats
    <<~EOS
      UR includes its runtime; Node.js, npm, and Bun are not required.
      Choose a provider and model on the first run with: ur
      Manage this installation with: brew upgrade ur-nexus
      UR uses its upstream non-commercial license; see #{libexec}/resources/LICENSE.
      macOS 15+ is required. Linux qualification: Ubuntu 22.04 x64 and 24.04 ARM64
      with glibc; Linux x64 additionally requires an x86-64-v2 CPU.
    EOS
  end

  test do
    ENV["HOME"] = testpath.to_s
    ENV["UR_CONFIG_DIR"] = (testpath/"config").to_s
    ENV["UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    ENV["DISABLE_TELEMETRY"] = "1"
    ENV["PATH"] = "/usr/bin:/bin"
    assert_equal "#{version} (UR-Nexus)", shell_output("#{bin}/ur --version").strip
    report = JSON.parse(shell_output("#{bin}/ur --ur-native-self-test"))
    assert_equal true, report["passed"]
  end
end
`
}

export function writeHomebrewTap(manifest, outputDirectory, options = {}) {
  const formula = generateHomebrewFormula(manifest, options)
  const output = resolve(outputDirectory)
  mkdirSync(join(output, 'Formula'), { recursive: true })
  writeFileSync(join(output, 'Formula', 'ur-nexus.rb'), formula)
  writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (!options.updateOnly) {
    mkdirSync(join(output, '.github', 'workflows'), { recursive: true })
    mkdirSync(join(output, 'scripts'), { recursive: true })
    copyFileSync(join(template, 'README.md'), join(output, 'README.md'))
    for (const name of ['test.yml', 'update.yml']) copyFileSync(join(template, '.github', 'workflows', name), join(output, '.github', 'workflows', name))
    for (const name of ['homebrew-tap.mjs', 'update-homebrew-tap.mjs']) copyFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), join(output, 'scripts', name))
  }
  return join(output, 'Formula', 'ur-nexus.rb')
}

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--manifest', '--manifest-url', '--manifest-sha256', '--output-dir', '--expected-version', '--expected-commit'])
  const values = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--update-only') { values['--update-only'] = true; i--; continue }
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || values[args[i]]) throw new Error('Usage: node scripts/homebrew-tap.mjs (--manifest <file> | --manifest-url <immutable release URL>) --output-dir <tap> [--manifest-sha256 <hash>] [--expected-version <version>] [--expected-commit <commit>]')
    values[args[i]] = args[i + 1]
  }
  if (!values['--output-dir'] || Boolean(values['--manifest']) === Boolean(values['--manifest-url'])) throw new Error('Choose one native manifest input and an output tap directory')
  let bytes
  let urlVersion
  if (values['--manifest-url']) {
    const match = values['--manifest-url'].match(/^https:\/\/github\.com\/Maitham16\/UR\/releases\/download\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/manifest\.json$/)
    if (!match) throw new Error('Use an immutable Maitham16/UR stable release manifest URL')
    urlVersion = match[1]
    const response = await fetch(values['--manifest-url'], { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Native manifest download failed: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } else bytes = readFileSync(values['--manifest'])
  if (bytes.length > 1024 * 1024) throw new Error('Native release manifest is too large')
  if (values['--manifest-sha256'] && (!/^[a-f0-9]{64}$/.test(values['--manifest-sha256']) || createHash('sha256').update(bytes).digest('hex') !== values['--manifest-sha256'])) throw new Error('Native manifest SHA-256 mismatch')
  const manifest = JSON.parse(bytes.toString('utf8'))
  const options = { expectedVersion: values['--expected-version'] ?? urlVersion, expectedCommit: values['--expected-commit'], updateOnly: values['--update-only'] }
  if (urlVersion && manifest.version !== urlVersion) throw new Error('Native manifest version does not match its immutable URL')
  console.log(`Homebrew formula generated: ${writeHomebrewTap(manifest, values['--output-dir'], options)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
