# UR-Nexus release runbook

Release target:

- GitHub: `https://github.com/Maitham16/UR.git`
- npm package: `ur-agent`
- CLI binary: `ur`

## Standalone artifacts

Native releases are built on four matching OS/CPU runners for macOS and Linux,
each on ARM64 and x64, and contain the
executable, runtime, and a versioned resource tree. `native.yml` tests the exact
archived payload with Node, npm, and Bun absent from PATH, including real image,
search, compiler-library, task/write/read, streaming, timeout, and resume checks.
The release publishes no npm package or GitHub release until the native matrix
and existing verification gate succeed for the same immutable tag. Each native
runner also tests an assembled npm package installed with `--ignore-scripts`,
with no external Bun available. The public npm package has no dependencies or
lifecycle scripts; its Node.js launcher verifies and caches the pinned native
release on first use.

Both Linux runners also build the remote-worker container from their native
payload and test actual approvals, device revocation, durable event replay and
native session resume after container replacement. The recipe in
`deployment/acp/` documents persistent volumes, model configuration and private
remote access. It requires no additional Node/Bun runtime inside the image.

The same immutable tag builds the Node SDK, Python wheel/source distribution,
VS Code VSIX and JetBrains plugin archive. The integration workflow exercises
local/remote SDK transport, the installed wheel, the packaged VSIX in an actual
editor host, and JetBrains structure/API compatibility against its declared
IDE target. The verified Python/editor archives are attached to the GitHub
release and covered by build provenance. GitHub release creation waits for
these checks as well as native/npm qualification. Marketplace and PyPI
publication are separate publisher-account operations and are not implied by
these downloadable assets.

Windows native artifacts and PowerShell installers are excluded from 1.87.1.
Windows native development code remains in the repository and is outside the
public standalone release. On a matching macOS/Linux development host, use
the pinned Bun version.

Build and qualify the archive:

```sh
bun ci
npm --prefix extensions/vscode-ur-inline-diffs ci
npm --prefix extensions/vscode-ur-inline-diffs run build
bun run native:build
bun run native:pack
bun run native:smoke -- --artifact-dir dist-release/native
```

Keep native output in ignored `dist-native/` and `dist-release/`. The GitHub
release includes all target archives, merged `manifest.json`, `SHA256SUMS`,
`install.sh`/`uninstall.sh`, and build-provenance attestations. All manifests
must identify the exact source commit. Channel selection uses GitHub's latest
non-prerelease release; a failed qualification must never advance it.

macOS signing uses configured Apple publisher credentials. An incomplete
signing configuration fails; absent credentials produce an explicit unsigned
status in `resources/signing.json`. Never claim an unsigned artifact is signed
or notarized. See [native installation](docs/NATIVE_INSTALL.md) for verification,
platform support, recovery, and user-facing install commands.

## Required checks

Run from the repository root:

```bash
bun ci
bun run dependencies:audit
bunx --no-install playwright-core install chromium
bun test
bun run typecheck
bun run lint
bun run build
bun run release:check
node ./bin/ur.js --version
node ./bin/ur.js --help
node ./bin/ur.js upgrade
npm pack --dry-run
npm publish --dry-run
```

For the complete browser and functional-fixture qualification, run tests with
`UR_REQUIRE_BROWSER_QA_TESTS=1 UR_REQUIRE_FULL_BENCHMARK_FIXTURES=1`. This requires
a running Docker daemon, Python 3.11+ with venv support, and network access to
install the pinned Python and TypeScript fixture dependencies. CI provides
these prerequisites and treats missing prerequisites as failures. Internal
regression fixtures do not measure model task-solving performance; publish
real-provider results separately with their source/executable identity and
known/unknown usage.

A source `npm pack` is a developer bundle input, not the official production
npm artifact. After all four native archives pass, assemble the public package
with `scripts/npm-native-package.mjs` using the tested manifest and source
bundle. This strips development/runtime dependencies and lifecycle scripts and
embeds the exact native release identity. Verify that public artifact's
first-use download, cached offline launch, and package-manager ownership.

If publishing or attaching a source archive, verify the actual zip artifact
before release:

```bash
bun run release:create-source-zip
bun run release:check-source-zip -- artifacts/source/ur-nexus-$(node -p "require('./package.json').version")-source.zip
```

The source zip must contain source inputs such as `package.json`, `bun.lock`,
`src/`, `bin/`, `scripts/`, `README.md`, `CHANGELOG.md`, and `SECURITY.md`,
and must not contain local dependencies, runtime binaries, env files, logs,
caches, test output folders, temp files, or nested archives.

Also verify:

```bash
git remote -v
npm view ur-agent@$(node -p "require('./package.json').version") version
```

Before committing a release, verify the public docs match the current feature
set and version:

```bash
rg -n "Version [0-9]|expected: [0-9]|UR-Nexus v[0-9]" README.md docs documentation
bun test test/docsCoverage.test.ts test/docsCommands.test.ts
```

Run the repository-owned bump script so dependency ranges cannot be changed by
an accidental text replacement:

```bash
node scripts/version-bump.mjs <next-version>
```

Version bump checklist (all versioned release surfaces must move together):

1. `package.json` `version`
2. `bunfig.toml` `MACRO.VERSION`
3. `documentation/index.html` version eyebrow and the expected version in
   `docs/VALIDATION.md`
4. `extensions/vscode-ur-inline-diffs/package.json` and its lockfile version
   fields (the VSIX test requires them to match the root package version)
5. `extensions/jetbrains-ur/build.gradle.kts` `version`
6. `sdk-python/pyproject.toml` project version and the rebuilt Node SDK output
7. The `MACRO.VERSION` fallbacks in `src/commands/agent-ci/agent-ci.ts`,
   `src/services/agents/agenticCi.ts`, and
   `src/services/agents/featureScaffolds.ts`, and
   `src/services/agents/trends.ts`
8. Add a `CHANGELOG.md` entry, update current installation examples and regenerate
   measured release fixtures (older evidence remains in its historical tag),
   then run `bun run build` so `dist/cli.js`
   embeds the new version (`bun run release:check` verifies all of this).

Do not publish if the package version already exists on npm.

## Publish

GitHub Actions verifies the source and all four native payloads, then assembles
the production npm tarball from those tested artifacts. It publishes the
GitHub native assets before npm so a first npm launch can retrieve its exact
pinned native release. Do not run `npm publish` from the source checkout or
create a tag before the complete release commit is on the remote branch.

Configure npm trusted publishing for package `ur-agent` before tagging a version
that is not already published. In npm package settings, select GitHub Actions
with owner `Maitham16`, repository `UR`, workflow `release.yml`, no environment,
and allow `npm publish`. The publish job uses GitHub OIDC (`id-token: write`), so
it needs no long-lived `NPM_TOKEN` and cannot stall on interactive 2FA. The
GitHub assets must already be public before npm publication; an npm failure
remains a release blocker. Fix the trusted-publisher configuration and retry
the same immutable tag instead of publishing the source package manually.
The npm publish step uses `./dist-release/<tarball>.tgz`: the explicit relative
path marker prevents npm from interpreting the artifact name as GitHub
`owner/repository` shorthand.

If an immutable tag failed only during publication, fix the trusted-publisher
configuration and retry that tag through the default branch workflow:

```bash
gh workflow run release.yml -f tag=v$(node -p "require('./package.json').version")
```

Do not move or recreate the tag. Retrying preserves the matching verified
GitHub assets and publishes the assembled npm tarball after OIDC succeeds.
After a successful migration, remove the obsolete `NPM_TOKEN` repository secret
and revoke that npm token so CI has no dormant long-lived publish credential.

Only after every check passes, commit the complete release and push it:

```bash
git add .
git commit -m "chore: polish UR-Nexus production release"
git push origin master
```

Wait for the `Test Production` workflow on that commit to pass. Then use the
guarded tag command; its default mode is a read-only preflight:

```bash
bun run release:tag
bun run release:tag -- --push
```

The command refuses to tag a dirty tree, an uncommitted version, a commit that
is not yet the remote branch tip, a mismatched changelog, or a local/remote tag
that already exists. `--push` creates one annotated immutable tag pointing at
the verified commit. That tag starts `.github/workflows/release.yml`, which
verifies the source and native matrix, assembles the production npm package,
publishes the GitHub native assets, then publishes that exact npm tarball.

The `Maitham16/homebrew-ur` personal tap checks stable upstream releases hourly.
Its committed updater verifies the manifest provenance against `release.yml`,
the immutable tag, and source commit, and must pass all four platform formula
checks before pushing an update. Users add the personal tap and trust its
formula once, then install:

```sh
brew tap Maitham16/ur
brew trust --formula Maitham16/ur/ur-nexus
brew install ur-nexus
```

The launch command remains `ur`; updates use `brew upgrade ur-nexus`. See
[Homebrew tap trust](https://docs.brew.sh/Tap-Trust) for the required trust step.

If a tag was accidentally pushed from the wrong commit, keep it as failed
release history and bump to a fresh patch version. Do not move a published tag.
If the remote default branch is not `master`, push the checked-out release
branch instead; the tag command verifies that branch by name.
