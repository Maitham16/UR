# Native installation and recovery

The 1.87.2 standalone release supports macOS and Linux on ARM64 and x64.
The application includes its Bun runtime and required resources.
Homebrew and standalone-installer users need no Node.js, npm, separate Bun,
source checkout, or compiler. The npm launcher requires Node.js `>=22.12` and
uses the same standalone application without a separate Bun.
Install the complete archive: the executable and its adjacent `resources/`
directory belong to the same immutable release.

## Supported platforms

| Target | Native release qualification |
| --- | --- |
| macOS Apple Silicon | macOS 15 ARM64 runner |
| macOS Intel | macOS 15 Intel runner |
| Linux x64 with glibc | Ubuntu 22.04 runner |
| Linux ARM64 with glibc | Ubuntu 24.04 ARM64 runner |

Windows native installation is unavailable in 1.87.2 and has been deferred.
Windows developers can optionally use the Bun-based source workflow in the
[Development Guide](DEVELOPMENT.md). The public npm package supports the same
four macOS/Linux targets and does not provide a Windows binary.

These are the environments exercised by the release matrix, not a claim that
every older OS version is supported. Linux x64 additionally requires an
x86-64-v2 CPU, including SSE4.2, for the packaged sharp/libvips image library.
Virtual machines must expose those CPU features. The library's
[upstream platform requirements](https://sharp.pixelplumbing.com/install/#prebuilt-binaries)
include glibc 2.28 or newer on Linux x64/ARM64; the complete UR application is
qualified on the newer runner environments above.

Other CPU architectures and Linux musl are currently unsupported by the public
installer. Project toolchains and optional integrations have separate
requirements; UR does not install an application's Node, Python, Docker, Git,
browser, provider CLI, or model server automatically.

## Install

### Homebrew

Add the personal tap and trust this formula once, then install it:

```sh
brew tap Maitham16/ur
brew trust --formula Maitham16/ur/ur-nexus
brew install ur-nexus
ur --version
ur
```

The formula is `ur-nexus`; its executable remains `ur`. Current Homebrew
requires [formula trust](https://docs.brew.sh/Tap-Trust) for personal taps.
The personal tap installs the checksummed native application and resources
without Node.js or Bun dependencies. Its updater checks stable releases hourly,
verifies the release manifest's GitHub provenance, and tests formula updates on
all four targets. Homebrew owns this installation and its upgrades.

### npm

With Node.js `>=22.12` already installed:

```sh
npm install -g ur-agent
ur --version
ur
```

The official npm package has no dependencies or lifecycle scripts. The first
`ur` launch downloads the exact native version pinned by the package, validates
its archive and resources, and caches it at
`~/.cache/ur/npm/<version>-<platform>`. An absolute `XDG_CACHE_HOME` overrides the
cache base. The first launch needs access to GitHub; later cached launches
work offline. Provider requests and optional integrations have their own
network requirements. No separate Bun is installed or invoked, and
`npm install --ignore-scripts -g ur-agent` is supported.

### Standalone installer

Download the installer from the published GitHub release, inspect it if desired,
then run it as your normal user. Administrator access is not required.

macOS and Linux:

```sh
curl -fsSL https://github.com/Maitham16/UR/releases/latest/download/install.sh -o install-ur.sh
sh install-ur.sh
export PATH="$HOME/.local/bin:$PATH"
```

Unix installation creates `~/.local/bin/ur` pointing to a version under
`${XDG_DATA_HOME:-~/.local/share}/ur/versions/`. The `export` command above adds
the launcher directory to PATH for the current terminal.

For future Unix terminals, open your shell's startup file and add this line
once: use `~/.zshrc` for zsh (the default on current macOS), `~/.bashrc` for
bash on Linux, or `~/.bash_profile` for macOS bash login shells.

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Save the file, then open a new terminal. The installer leaves these shell
startup files for you to manage.

```sh
ur --version
ur --help
ur
```

First-run setup lets you select and connect a provider and choose a validated
model. A new workspace deliberately saves its own model choice. Credentials
remain in secure storage or environment variables; they do not belong in
project settings or release artifacts.

To pin the first installation, download the installer from a specific release
and pass the version:

```sh
curl -fsSL https://github.com/Maitham16/UR/releases/download/v1.87.2/install.sh -o install-ur.sh
sh install-ur.sh 1.87.2
export PATH="$HOME/.local/bin:$PATH"
```

## Verify a download

Every release publishes target archives, `manifest.json`, `SHA256SUMS`,
installers, and GitHub build-provenance attestations. The installers validate
the release version and platform, archive SHA-256, safe extraction paths,
executable version, and packaged-resource self-test before activation.

Manual installation can extract the matching archive into a user-owned
directory. Keep `ur` beside `resources/` and run:

```sh
./ur --version
./ur --ur-native-self-test
```

The downloaded `resources/signing.json` records whether macOS signing and Apple
notarization were performed. Missing publisher credentials produce an explicit
unsigned status; checksum verification and GitHub provenance do not turn an
unsigned executable into an OS-signed application. On systems that block
unsigned applications, use the distribution permitted by your organization's
policy or a release carrying the required publisher signature.

Users who already have GitHub CLI can independently verify provenance:

```sh
gh attestation verify ur-1.87.2-darwin-arm64.tar.gz --repo Maitham16/UR
```

## Update and select a previous version

Use the command for the installation you chose:

| Installation | Update command |
| --- | --- |
| Homebrew | `brew upgrade ur-nexus` |
| npm | `npm install -g ur-agent@latest` |
| Standalone installer | `ur upgrade` |

Pin npm with `npm install -g ur-agent@1.87.2`. Homebrew and npm installations
reject `ur install`; use their package manager to avoid creating a second
installation. For a standalone installation, select a native release with:

```sh
ur install 1.87.2
```

Standalone upgrades retrieve public GitHub release metadata directly and require no
npm or Bun command. Installation verifies the entire staged release before
replacing the stable launcher. Earlier immutable version directories are kept
so active processes and scheduled runs can finish. An installation lock
prevents concurrent activations; follow the reported lock diagnostic only
after confirming no installer is still running.

`ur install <previous-version>` can select an earlier **native-enabled** release.
Versions before 1.86.0 do not have this native artifact layout. Before a
downgrade, back up your UR configuration and session directory. Restoration of
data created by a newer release depends on that release's compatibility notes;
binary rollback does not undo configuration migrations.

## Optional capabilities

- Image handling, repository search, TypeScript compiler libraries, bundled
  skills, and IDE/viewer resources are included in the native release.
- Browser and Electron automation use the packaged driver but need a
  compatible browser/Electron application installed separately.
- Voice uses a supported native audio addon when present, then available
  SoX/ALSA recording tools on supported systems. Missing devices, denied access,
  or absent backends are reported as unavailable.
- OS sandboxing depends on supported platform facilities and helpers. Required
  sandbox mode must fail closed when confinement cannot be established.
- Third-party MCP servers and plugins retain their own runtime requirements.
  Downloaded plugin code is trusted executable content; registration of the
  packaged official catalog does not enable its plugins automatically.
- Computer-control backends that are not implemented stay unavailable.

## Uninstall and recover

- Homebrew: `brew uninstall ur-nexus` removes the Homebrew application and its Cellar
  versions.
- npm: `npm uninstall -g ur-agent` removes the npm package and launcher. The
  downloaded native cache under `~/.cache/ur/npm/` remains (`XDG_CACHE_HOME` is
  honored).
- Standalone installer: download the matching `uninstall.sh` release asset and
  run it with `sh`. It removes the owned launcher while preserving immutable
  application versions and prints their optional manual cleanup path.

These uninstall commands preserve UR configuration, sessions, and credentials.
Other installations, aliases, and project data remain unchanged.

If the wrong `ur` starts, inspect `command -v ur`. A shell alias or an old
package-manager install may precede the native launcher.

For missing or corrupted resources, repair through the original installation
channel:

- Homebrew: run `brew reinstall ur-nexus`.
- npm: run `ur --version` with GitHub access available. The launcher checks its
  cache and downloads the exact installed package version again when the cache
  is missing or damaged. If the npm package or launcher itself is damaged,
  reinstall with `npm install -g ur-agent@1.87.2`, then run `ur --version`.
- Standalone installer: rerun the pinned installer for the matching release.

Keep each executable with its matching resource directory; copying a new
executable over older resources is unsupported.
