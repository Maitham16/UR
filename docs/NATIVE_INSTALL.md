# Native installation and recovery

The 1.86.0 standalone release supports macOS and Linux on ARM64 and x64.
The application includes its Bun runtime and required resources.
Users do not need Node.js, npm, Bun, a source checkout, or a compiler to run it.
Install the complete archive: the executable and its adjacent `resources/`
directory belong to the same immutable release.

## Supported platforms

| Target | Native release qualification |
| --- | --- |
| macOS Apple Silicon | macOS 15 ARM64 runner |
| macOS Intel | macOS 15 Intel runner |
| Linux x64 with glibc | Ubuntu 22.04 runner |
| Linux ARM64 with glibc | Ubuntu 24.04 ARM64 runner |

Windows native installation is unavailable in 1.86.0 and has been deferred.
Windows developers can optionally use the Bun-based source or npm compatibility
workflows in the [Development Guide](DEVELOPMENT.md). Those workflows need
separately installed runtimes and are outside this standalone release.

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
curl -fsSL https://github.com/Maitham16/UR/releases/download/v1.86.0/install.sh -o install-ur.sh
sh install-ur.sh 1.86.0
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
gh attestation verify ur-1.86.0-darwin-arm64.tar.gz --repo Maitham16/UR
```

## Update and select a previous version

```sh
ur upgrade
ur install 1.86.0
```

Native upgrades retrieve public GitHub release metadata directly and require no
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

Download the matching `uninstall.sh` release asset and run it with `sh`.
Uninstall removes the owned launcher files while preserving configuration, sessions,
credentials, and immutable versions. The script prints any optional manual
cleanup path. Other npm installations, aliases, project data, and dependencies
are preserved.

If the wrong `ur` starts, inspect `command -v ur`. A shell alias or an old
package-manager install may precede the native launcher.

For missing or corrupted resources, rerun the pinned installer. A resource
integrity failure must be repaired with the matching release; copying a new
executable over an older resource directory is unsupported.
