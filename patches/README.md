# Reviewed dependency security backports

`node-forge@1.4.0` has no upstream patched npm release for
[GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
as reviewed on 2026-10-20. UR applies a minimal canonical DER validation backport
based on the still unmerged [upstream proposal #1160](https://github.com/digitalbazaar/forge/pull/1160),
following [issue #1149](https://github.com/digitalbazaar/forge/issues/1149) and
[proposal #1152](https://github.com/digitalbazaar/forge/pull/1152). The latter's
nested element count alone does not reject nonempty NULL values or nonminimal
length encodings; the canonical reconstruction handles those variants too.

`node-forge-security.json` records the exact upstream version, patch hash,
original and patched RSA source hashes, and a review deadline of **2026-11-20**.
Bun applies the patch through `patchedDependencies`; the version remains 1.4.0.
The sandbox remains enabled on supported platforms.

`bun run dependencies:audit` runs the real Bun registry audit against the lockfile.
It accepts this exact advisory and the separately verified legacy Zod advisory below after checking patch registration, installed
version, patch/source hashes, seven actual RSA behavior checks and review expiry.
Every other advisory or audit transport/format failure blocks the gate. The raw
registry finding remains present; this is an explicit verified backport, not a
clean raw audit. Remove this exception when an upstream fixed release is adopted.

The native application statically bundles the patched verifier. The official
npm package has no runtime dependencies; it launches the same verified native
application rather than installing a separate `node-forge` dependency tree.
Installing the development source package with npm does **not** apply Bun's
patch and can still report the registry advisory. The source-package gate and
installed-npm/native acceptance run `--ur-security-self-test` against their
actual application. These checks cover canonical signatures with and without
NULL parameters, nested extra elements, nonempty NULL values, nonminimal DER
lengths, non-NULL parameters and the published low exponent RSA forgery.

## Zod collection size checks (reviewed 2026-10-24)

The root validator is upgraded to Zod 4.6.7, including upstream's fix for
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The upstream [size-gate fix](https://github.com/colinhacks/zod/commit/a0ebf97)
rejects oversized constrained collections before traversing their elements.

`@ag-ui/core` and `@anthropic-ai/sandbox-runtime` still require Zod 3.25.76;
forcing Zod 4 would break their version-3 record schemas. The registry has no
patched version-3 release. UR applies the same early-rejection behavior to
version-3 arrays (`max`/`length`) and sets (`max`/`size`) in the TypeScript,
ES module and CommonJS implementations. Version-3 maps have no size-bound API.
Existing size limits are honored before element validation; valid in-range
collections and ordinary type/minimum-size errors retain their behavior.
This does not impose new collection limits on agent execution.

`zod-security.json` records the patch and installed source hashes, the exact two
legacy consumers, and the **2026-11-20** review deadline. The release gate checks
the complete locked Zod resolution set, upstream-fixed root version, both legacy
copies, hashes, and real bounded validation behavior. Tests cover ESM/CommonJS,
synchronous/asynchronous validation, valid inputs and tamper/expiry rejection.
The legacy package's unused experimental `zod/v4` entry point is outside this
backport; UR's legacy consumers use its version-3 root API. UR's own version-4
imports resolve to the upstream-fixed root package.

The raw legacy registry advisory remains present. This is a narrow reviewed
runtime backport, not a clean raw audit or a claim that every historical Zod
entry point is fixed. Remove the patch/exception when those dependencies migrate
to an upstream-fixed validator. Use Bun for source development so the registered
patch is applied; the native application bundles the reviewed implementations.
