# UR Homebrew tap

Install the standalone terminal agent from this personal tap:

```sh
brew install Maitham16/ur/ur
ur --version
ur
```

The formula downloads the exact checksummed native release for macOS/Linux on
ARM64 or x64. UR includes its Bun runtime, repository search, image libraries,
and integration resources. Node.js, npm, and a separate Bun are not required.
Homebrew itself and any project or optional provider tools have their own
requirements.

macOS 15 or newer is required. Linux releases are qualified on Ubuntu 22.04
x64 and Ubuntu 24.04 ARM64 with glibc; system glibc 2.28 or newer is necessary.
Linux x64 also needs an x86-64-v2 CPU, including SSE4.2. Windows native releases
are unavailable. UR's upstream non-commercial license applies; see the
[license](https://github.com/Maitham16/UR/blob/master/LICENSE).

```sh
brew update
brew upgrade Maitham16/ur/ur
brew test Maitham16/ur/ur
brew uninstall ur
```

Uninstalling preserves your UR configuration, credentials, and sessions. If an
older npm or manual installation appears first on PATH, inspect `command -v ur`
and remove that conflicting installation through its own installer.

This tap is generated from the upstream release's `manifest.json`, which is
retained as `release-manifest.json`. Each formula update must use an immutable
release version and the exact four native archive hashes. The formula's test
runs the installed CLI version and full packaged-resource self-test without
Node.js or Bun on PATH. Platform signing status is recorded by each release in
`resources/signing.json`; checksums do not imply an OS publisher signature.

The tap checks for stable releases hourly and supports manual updates through
its update workflow. Its committed updater verifies the manifest's GitHub
provenance against the upstream release workflow, tag, and source commit
before generating a candidate. The same workflow installs, reinstalls, and
tests that unpublished candidate on all four platforms, then pushes it only
after every check passes and the original branch base is unchanged. No
cross-repository publishing token is required.

This is a personal tap, separate from Homebrew's official repositories. See
[Homebrew's tap instructions](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
for installation and formula trust.
