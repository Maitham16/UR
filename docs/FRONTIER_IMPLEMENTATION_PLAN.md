# UR-Nexus competitive implementation plan

Started: 2026-10-21. Baseline: `e81469b4554d5c209081df72d0350ffe8e59eca7`.

## Contract and completion rules

Implement the complete competitive audit in the existing product. Keep one
canonical public command per capability; replace obsolete behavior in place,
with explicit migration for persisted data. Do not introduce `v1`/`v2` commands.
The model chooses execution strategy, tools, delegation and replanning. Preserve
existing user permission choices: new isolation/security presets are opt-in,
not mandatory execution gates. Verification establishes evidence and reports
actual outcomes; it must never manufacture success or silently discard errors.

Every work package below requires implementation, meaningful failure-path tests,
integration into the existing command/runtime, and code-derived documentation.
An interface, stub, mock-only test or a roadmap entry is not completion. Separate
local checks, real provider measurements and external publication evidence.
Never claim numerical competitive parity without controlled measurements.

Status vocabulary: planned, implementing, locally verified, release verified,
external prerequisite. Record exact commands/results and remaining prerequisites
in the execution log. No item may silently disappear from this plan.

## Implementation order and acceptance matrix

| ID | Work package | Required acceptance evidence | Documentation | Status |
| --- | --- | --- | --- | --- |
| F01 | Execution-bound verification and shell mutation tracking | Shell/Python changes trigger edit verification; read-only commands prove no mutation; fabricated, failed, stale, unrelated or errored proof cannot pass; evidence identifies executions and tested state | technical/09, technical/10, technical/12 | release verified |
| F02 | Durable workflows, crew ownership and background recovery | Atomic versioned checkpoints restore dependency outputs; changed specifications invalidate resume; concurrent schedulers preserve live claims; killed workers resume persisted work without replaying completed effects | technical/08, technical/09, technical/14 | release verified |
| F03 | Real browser fixture QA | Run every assertion in a real browser at every viewport; failing client render/assertion fails; capture console/page errors and per-check artifacts; browser lifecycle cleanup tested | technical/04, technical/10 | release verified |
| F04 | End-to-end evaluations and real external runner adapters | Reproducible held-out tasks using the native UR loop; record model/config/environment/revision/cost/time/interventions/recovery/false completion; external adapters execute configured runners rather than emit stubs; publish honest measured results | benchmarks/README, technical/10, docs/VALIDATION | release verified |
| F05 | Persistent goal controller and aggregate budgets | Model-directed replanning; outcome criteria separate from workflow status; persisted budget/progress/blockers; interruption/restart tests; no hardcoded task strategy | technical/09, technical/14 | release verified |
| F06 | Memory retrieval and consistency | Body-aware hybrid retrieval; multilingual and paraphrase cases; provenance, freshness, conflict/supersession/deletion behavior; measured recall and false injection; no silent dependence on unavailable embedding service | technical/07 | release verified |
| F07 | Repository retrieval freshness and scale | Changed/deleted files cannot appear current; explicit coverage; symbol/dependency-aware ranking; reproducible recall/latency/coverage measurements on generated large-repository fixtures | technical/07 | release verified |
| F08 | Tested model profiles and efficient tool discovery | Capability-driven defaults and diagnostics; tool/context/structured-output/cancellation/continuation failure cases across native provider protocols; provider-neutral selective catalogs; permission semantics preserved | technical/04, technical/05, technical/06 | release verified |
| F09 | Optional safe autonomy and security evidence | Existing execution choice preserved; opt-in enforced boundaries; scoped credentials/publication; changed-code checks and attack fixtures measure malicious and benign outcomes; report unavailable enforcement honestly | technical/12, SECURITY | release verified |
| F10 | Onboarding, progress and review experience | Fresh setup reaches useful task; clear connection checks, diffs, evidence, cancellation, recovery and costs; verified first-use flows | README, technical/02, technical/05, documentation | release verified |
| F11 | Supported SDK and editor distribution | Versioned event/approval/cancellation/resume/local-remote contract; actual usable client package; packaged editor host integration tests; publication requirements explicit | technical/11, extensions, SDK examples | release verified |
| F12 | Dependable remote environments and control | Reproducible worker provisioning, artifacts/logs/previews, reconnection, authenticated approvals and device revocation; real local remote-worker integration tests; avoid provider-specific-only backend | technical/09, technical/11 | release verified |
| F13 | Team operations and distribution maturity | Identity, shared budgets, secret management, audit export and reviewed automation; clear commercial licensing route without changing license; platform/install evidence; preserve explicit Windows/signing deferrals unless prerequisites supplied | technical/11, technical/12, RELEASE, docs/NATIVE_INSTALL | release verified |
| F14 | Canonical commands, documentation and release | Audit command registry/help for duplicate/obsolete alternatives; update every affected technical/doc surface; full tests/typecheck/lint/build/audits/native checks; push verified commit, immutable tag, green GitHub/npm/Homebrew publication and installed smoke checks | all affected docs, CHANGELOG, RELEASE | implementing |

## Resources and design use

Use the sources as design/evaluation guidance, not as claims that copying a
technique guarantees a gain. Consult current official API documentation before
integrating changing external interfaces.

| Resource | Application |
| --- | --- |
| [MemTrace](https://arxiv.org/abs/2610.04838) | F01/F06: provenance and state-consistent evidence invalidation |
| [OpenCollab](https://arxiv.org/abs/2609.38345) | F02/F04/F05: observable role adherence and collaboration |
| [Code Isn't Memory](https://arxiv.org/abs/2606.22417) | F07: structural retrieval with controlled ablations |
| [DeepSWE](https://arxiv.org/abs/2607.07946) and [benchmark](https://deepswe.datacurve.ai/) | F04: original tasks and independent functional verification |
| [SWE-Marathon](https://arxiv.org/abs/2606.07682) | F02/F04/F05: interruption and long-task failure evaluation |
| [SlopCodeBench](https://arxiv.org/abs/2603.24755) | F04: iterative changes, regressions and maintainability |
| [Scaling Agent Systems](https://arxiv.org/abs/2512.08296) | F04/F05: equal-budget single/multi-agent measurements |
| [Prompt-injection detector evaluation](https://arxiv.org/abs/2610.03448) | F09: representative attacks and benign-task preservation |
| [Anthropic advanced tool use](https://www.anthropic.com/research/advanced-tool-use) | F08: lazy tool definitions and composition |
| [Terminal-Bench](https://www.tbench.ai/) and [Harbor](https://www.harborframework.com/) | F04: actual external runner integration |
| [Codex cloud](https://learn.chatgpt.com/docs/cloud) and [security](https://learn.chatgpt.com/docs/agent-approvals-security) | F09/F10/F12: environment lifecycle and configurable execution boundaries |
| [Claude Remote Control](https://code.claude.com/docs/en/remote-control) and [ultrareview](https://code.claude.com/docs/en/ultrareview) | F01/F10/F12: evidence-based review and session continuity |
| [Cursor environments](https://cursor.com/docs/cloud-agent/setup) and [computer use](https://cursor.com/blog/agent-computer-use) | F03/F12: provisioning and visual artifacts |
| [Devin workflows](https://docs.devin.ai/work-with-devin/dynamic-workflows) and [review](https://docs.devin.ai/work-with-devin/devin-review) | F02/F10: recorded results and review lifecycle |
| [Copilot security](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations) | F09/F13: scoped publication and review evidence |
| [Gemini browser agent](https://geminicli.com/docs/core/subagents/) and [Jules planning critic](https://jules.google/docs/changelog/2026-01-26-1/) | F03/F05: browser lifecycle and model-directed critique |
| [OpenHands SDK](https://docs.openhands.dev/sdk) and [team controls](https://www.openhands.dev/blog/the-latest-openhands-enterprise-more-visibility-governance-control) | F11/F13: supported interfaces and administration |

## External prerequisites and existing decisions

- Apple signing/notarization requires publisher credentials; the owner previously
  deferred paid Apple enrollment. Do not claim unsigned builds are notarized.
- Windows standalone publication was explicitly deferred. Investigate/test code
  where practical, but keep support statements tied to actual passing artifacts.
- Editor marketplace publication requires publisher credentials/registration.
  Build and validate publishable packages before requesting missing access.
- Hosted remote operation requires a selected host and operational credentials.
  Implement and test self-hostable deployment before identifying hosting gaps.
- Real model benchmarks require available models and provider access; inspect
  configured credentials without revealing them, use existing authorized access
  where available, and record actual costs/results. Never substitute mock results.
- The noncommercial license remains the owner's policy. Document a commercial
  contact path; do not silently change licensing terms.

## Execution log

- 2026-10-21: Plan created before implementation. Working tree initially clean;
  baseline release is 1.86.2. Release remains native macOS/Linux artifacts,
  dependency-free production npm launcher, then verified Homebrew tap update.

- 2026-10-21: Implemented and locally qualified F01–F11 and F13. Handoff
  records in `docs/implementation/` distinguish deterministic fixtures, real
  subprocess/browser/editor checks and live-provider observations. F12
  container validation and F14 publication remain open.
- 2026-10-21: Synchronized candidate 1.87.0, including Python/editor metadata.
  Typecheck includes 152 strict-core files; lint, secret scanning, the reviewed
  dependency-backport gate, documentation and source-package checks pass.
  Native macOS ARM64 archive and assembled npm installation passed with no
  external Bun, scripts disabled, zero production dependencies and offline
  cached launch. Other architectures still require the GitHub native matrix.
  Internal release fixtures were regenerated (20/20 regression, 6/6 smoke);
  these are explicitly separate from model benchmarks.

- 2026-10-21: Full suite passed: 3,120 tests, 0 failures, 2 Windows-only
  skips, 14,554 assertions. Final native Node/Python SDK allow, replacement and
  deny checks passed against a real provider; rebuilt SDK npm installation
  passed without Bun. Actual native bug-fix measurement (3/3) is published in
  benchmarks/results/1.87.0, explicitly labeled dirty-candidate/internal evidence.
  A native live goal resumed without resetting prior usage and reached verified
  completion after its earlier explicit budget stop.
- 2026-10-21: F12 native Linux ARM64 container qualification passed all nine
  checks using freshly built resources, actual tool approval and persisted
  replay/resume after container replacement. Both Linux CI jobs now run it.
  Final source archive, SDK/npm rebuild, documentation, lint, secret scanning
  and release checks pass. F14 GitHub/platform publication remains outstanding.
- 2026-10-21: Pushed implementation and corrected Linux editor-host setup.
  All four native jobs and SDK/editor distribution checks passed at `2e481a27`.
  The full Linux suite exposed source-version and subprocess failures; targeted
  corrections/regressions are recorded in F14. Fresh Linux execution also found
  and corrected the Docker grader's local-daemon networking assumption. Publish
  only after the corrected revision passes the entire GitHub workflow.

- 2026-10-21: Corrected revision passed the complete fresh Linux run: 3,119
  passed, 0 failed, 6 environment/platform skips, 14,538 assertions. Final native
  Mac smoke, strict typecheck, lint, secret scan and source archive checks pass.
  Ready for the final GitHub CI run before tagging.

- 2026-10-21: A further GitHub shell failure exposed a swallowed launch
  diagnostic and matched the pinned runtime's upstream descriptor-ownership
  bug after browser subprocesses. Upgraded CI/native builds to stable Bun 1.4.3
  and retained OS shell errors. Full qualification passed on macOS (3,124)
  and Linux (3,120), with zero failures; native and dependency-free npm checks
  passed again. F14 records the upstream evidence and exact run provenance.
  Publication still requires the corrected revision's entire GitHub workflow.

- 2026-10-21: Release 1.87.0 shipped at `327bfc9089f1e859acea9cb834e7f2ce50f17c86`.
  Production CI and tagged release CI each passed 3,121 tests with zero failures;
  all native and SDK/editor jobs passed. npm latest and a fresh no-Bun install
  passed. Homebrew passed install/reinstall/test on all four platforms and
  published at tap commit `2808acf`; a separate local sandboxed install/test
  passed. Published interactive first-use reached a real Ollama task.
  That final UI check found hidden command placeholders in slash readiness output;
  the small 1.87.1 presentation patch keeps F14 open until its publication.
