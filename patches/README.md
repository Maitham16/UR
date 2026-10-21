# Reviewed dependency security backport

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
It accepts only this exact advisory after checking patch registration, installed
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
