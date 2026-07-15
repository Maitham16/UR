import type { AgentCard as ProtocolAgentCard } from '@a2a-js/sdk'

type TrendStatus = 'covered' | 'partial' | 'adapter-ready'

type TrendCoverage = {
  id: string
  name: string
  status: TrendStatus
  summary: string
  evidence: string[]
  references: string[]
  professionalNextStep: string
}

type AgentTrendReport = {
  generatedAt: string
  researchSnapshotDate: string
  urVersion: string
  coverage: TrendCoverage[]
  a2aAgentCard: A2AAgentCard
  priorityRoadmap: string[]
}

type A2AAgentCardOptions = {
  baseUrl?: string
  staticBearer?: boolean
  delegationBearer?: boolean
}

export type A2AAgentCard = ProtocolAgentCard

const urVersion = MACRO.VERSION
const researchSnapshotDate = '2026-07-15'

const coverage: TrendCoverage[] = [
  {
    id: 'local-runtime',
    name: 'Provider-flexible, local-first model runtime',
    status: 'covered',
    summary:
      'UR can stay fully local through Ollama, call supported API providers directly, or delegate to authenticated subscription CLIs. Provider changes are explicit and never happen through a silent fallback.',
    evidence: [
      'ur provider list|status|doctor and ur connect',
      'Ollama, OpenAI, Anthropic, Gemini, OpenRouter, and OpenAI-compatible adapters',
      'Codex CLI, Claude Code, Gemini CLI, and Antigravity subscription adapters',
      'ur model-doctor and ur model-route "<task>" for local capability reporting',
    ],
    references: [
      'https://docs.ollama.com/',
      'https://developers.openai.com/api/docs/guides/responses-vs-chat-completions',
    ],
    professionalNextStep:
      'Normalize capability discovery across providers, then choose a compatible provider/model per subagent step only when the user opts into automatic routing.',
  },
  {
    id: 'mcp',
    name: 'MCP tool ecosystem',
    status: 'covered',
    summary:
      'UR has first-class MCP configuration, registry integration, OAuth/XAA helpers, tool approval, and elicitation handling.',
    evidence: [
      'ur mcp list/get/add-json/remove',
      'src/services/mcp/*',
      'MCP tools run through the same permission and evidence path as built-in tools',
    ],
    references: ['https://modelcontextprotocol.io/docs/getting-started/intro'],
    professionalNextStep:
      'Keep the production v1 SDK pinned while preparing a compatibility branch for the stateless core and extension model in the 2026-07-28 specification.',
  },
  {
    id: 'mcp-async-apps',
    name: 'MCP Tasks and MCP Apps',
    status: 'adapter-ready',
    summary:
      'UR has a durable background-task engine and MCP resources, but it does not advertise the experimental MCP Tasks lifecycle or render MCP Apps. The 2026-07-28 release candidate moves Tasks into an extension and makes Apps a first-class extension.',
    evidence: [
      'ur bg provides durable, cancellable local work that could back an MCP Tasks adapter',
      'MCP task capabilities are not advertised',
      'MCP Apps UI resources are not rendered or exposed as a client capability',
    ],
    references: [
      'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/',
      'https://modelcontextprotocol.io/extensions/tasks/overview',
    ],
    professionalNextStep:
      'Prototype Tasks and Apps behind negotiated capability flags, then ship only after the final specification and production TypeScript SDK support are available.',
  },
  {
    id: 'a2a',
    name: 'A2A / Agent Card interoperability',
    status: 'partial',
    summary:
      'UR exposes an official-SDK-backed A2A v0.3 JSON-RPC binding and Agent Card plus a separate UR task-lifecycle compatibility API. The A2A v1 protocol is stable, while the official JavaScript SDK exposes v1 only on its prerelease channel.',
    evidence: [
      'ur a2a card',
      '/a2a-card',
      'ur a2a serve: /.well-known/agent-card.json + /a2a/jsonrpc',
      'Agent Card accurately describes the implemented JSON-RPC transport and configured authentication',
    ],
    references: [
      'https://a2a-protocol.org/latest/specification/',
      'https://github.com/a2aproject/a2a-js',
    ],
    professionalNextStep:
      'Add a version-negotiated v1 binding, signed Agent Card verification, and official TCK coverage when the JavaScript SDK ships stable v1 support; keep v0.3 during migration.',
  },
  {
    id: 'acp',
    name: 'ACP editor interoperability',
    status: 'partial',
    summary:
      'UR implements native ACP v1 over stdio with the official SDK, durable new/resume/close sessions, MCP server configuration, additional roots, permissions, streaming, and cancellation. It deliberately does not advertise full-history load, list, delete, config options, or slash commands.',
    evidence: [
      'ur acp stdio',
      'session/new, session/resume, session/close, session/prompt, and session/cancel',
      'capability declarations match only implemented behavior',
    ],
    references: [
      'https://agentclientprotocol.com/protocol/v1/schema',
      'https://github.com/agentclientprotocol/typescript-sdk',
    ],
    professionalNextStep:
      'Implement paginated session/list and session/delete first; add session/load only with exact, ordered history replay and truthful capability negotiation.',
  },
  {
    id: 'durable-workflows',
    name: 'Durable workflows and checkpoints',
    status: 'covered',
    summary:
      'UR exposes a declarative DAG workflow format with approval/verification gates and resumable checkpoints, on top of session resume, background tasks, and task state.',
    evidence: [
      'ur workflow run (live executor: spawns subagents, gates, checkpoints, --resume)',
      'ur workflow run --concurrency N (independent ready steps run in parallel)',
      'ur workflow run --live (real-time execution board) + state under .ur/workflows/.state',
      'ur --continue / --resume, background task UI, rewind',
    ],
    references: ['https://docs.langchain.com/oss/python/langgraph/overview'],
    professionalNextStep:
      'Unify the live execution board with the post-hoc agent-inspect timeline into one view.',
  },
  {
    id: 'multi-agent',
    name: 'Multi-agent orchestration',
    status: 'covered',
    summary:
      'UR ships built-in subagents plus named collaboration patterns — PEER, DOE, concurrent (fan-out/fan-in), handoff (triage→specialist), and debate (group-chat) — that compile into checkpointed workflows, plus an intent router that recommends the right agent/pattern per task and a headless crew that runs a lead+worker task board. The five patterns map onto the standard sequential/concurrent/handoff/group-chat/manager-loop taxonomy.',
    evidence: [
      'ur pattern run peer --execute (auto-iterating Plan-Execute-Express-Review loop)',
      'ur pattern run concurrent --execute (parallel fan-out, then synthesize)',
      'ur crew run <name> --workers N --worktrees (lead splits a goal; workers claim+run tasks, each in its own worktree)',
      'ur route "<task>" (intent classification → agent + pattern)',
      'interactive swarm/teammate teams (tmux) + src/tools/AgentTool/built-in/*, custom agents via --agents and .ur assets',
    ],
    references: [
      'https://openai.github.io/openai-agents-python/',
      'https://github.com/agentuniverse-ai/agentUniverse',
    ],
    professionalNextStep:
      'Surface live per-iteration review verdicts and crew worker timelines in the agent-inspect view as they happen.',
  },
  {
    id: 'memory',
    name: 'Long-term memory',
    status: 'partial',
    summary:
      'UR has file-backed memory, research notes, team memory, forget controls, consolidation prompts, lexical fallback, and optional local dense retrieval for both curated knowledge and code. Integrity policy and quarantine for poisoned durable memories remain incomplete.',
    evidence: [
      '/remember, /forget, /memory',
      'ur knowledge build --embeddings (dense retrieval) + lexical fallback, provenance, retention',
      'team memory sync and auto-dream consolidation services',
    ],
    references: [
      'https://docs.langchain.com/oss/python/langgraph/overview',
      'https://docs.langchain.com/oss/python/langgraph/memory',
      'https://owasp.org/www-project-agent-memory-guard/',
    ],
    professionalNextStep:
      'Add per-scope deletion guarantees plus provenance, integrity baselines, quarantine, and rollback for memory writes influenced by untrusted content.',
  },
  {
    id: 'agent-skills',
    name: 'Portable Agent Skills',
    status: 'partial',
    summary:
      'UR loads project, user, plugin, remote, and bundled SKILL.md directories and can create or execute reusable skills. Strict open-spec validation, provenance policy, dependency review, and lifecycle signing are not yet one end-to-end trust system.',
    evidence: [
      '.ur/skills/<name>/SKILL.md and ~/.ur/skills/<name>/SKILL.md',
      '/skills, /create-skill, /skillify, and the Skill tool',
      'skill-scoped file permissions and restricted MCP skill execution',
    ],
    references: [
      'https://openagentskills.dev/docs/specification',
      'https://docs.github.com/en/copilot/concepts/agents/about-agent-skills',
    ],
    professionalNextStep:
      'Add a strict compatibility validator and a signed provenance/permission manifest before enabling one-command installation from community skill registries.',
  },
  {
    id: 'browser-computer-use',
    name: 'Browser and computer-use workflows',
    status: 'covered',
    summary:
      'UR supports browser workflows, Chrome integration, Playwright-aware tasks, read-only web search/fetch, and approval boundaries for risky browser actions.',
    evidence: [
      '/browser',
      '/chrome',
      'WebSearch and WebFetch run read-only by default while respecting deny/ask rules',
    ],
    references: ['https://platform.openai.com/docs/guides/tools-computer-use'],
    professionalNextStep:
      'Add more browser replay fixtures and screenshot assertions for release validation.',
  },
  {
    id: 'provenance',
    name: 'Source provenance and citation discipline',
    status: 'partial',
    summary:
      'UR records fetched source URLs and has research citation commands, but claim-level source ledgers are not yet enforced for every generated answer.',
    evidence: [
      'WebFetch tool results include Source URL',
      '/cite and /graph research workflows',
      '/trace exposes recent tool calls and results',
    ],
    references: [
      'https://openai.github.io/openai-agents-python/tracing/',
      'https://modelcontextprotocol.io/docs/getting-started/intro',
    ],
    professionalNextStep:
      'Add a claim-to-source ledger for web/MCP outputs and expose it through /evidence or /trace.',
  },
  {
    id: 'evals-observability',
    name: 'Evals, tracing, and observability',
    status: 'partial',
    summary:
      'UR has verifier gates, project gates, /trace, a per-subagent run inspector, OpenTelemetry plumbing, release checks, and a replayable eval harness with deterministic grading. Trace-level policy graders and published regression series are not yet release gates.',
    evidence: [
      'UR_VERIFIER_MODE and .ur/verify.json',
      'ur eval run (replayable, gradeable cases by category: coding/research/browser/mcp/memory)',
      '/trace and ur agent-inspect (per-subagent timeline)',
      'OpenTelemetry tracing utilities',
    ],
    references: [
      'https://developers.openai.com/api/docs/guides/agent-evals',
      'https://developers.openai.com/api/docs/guides/evals',
    ],
    professionalNextStep:
      'Grade complete trajectories for tool choice, handoffs, instruction compliance, and safety; run the eval set in CI and publish versioned category scores.',
  },
  {
    id: 'genai-telemetry',
    name: 'Standard GenAI telemetry',
    status: 'partial',
    summary:
      'UR emits internal interaction, model, tool, agent, hook, and Perfetto traces, but its public spans do not yet implement the current OpenTelemetry GenAI agent, workflow, tool, retrieval, and token semantic conventions end to end.',
    evidence: [
      'src/utils/telemetry/sessionTracing.ts',
      'src/utils/telemetry/perfettoTracing.ts',
      'content capture is configurable and redacted when disabled',
    ],
    references: [
      'https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/',
      'https://opentelemetry.io/docs/specs/semconv/general/events/',
    ],
    professionalNextStep:
      'Dual-emit standard GenAI spans and lifecycle events behind an opt-in, with prompt, tool-argument, retrieval-query, and result content redacted by default.',
  },
  {
    id: 'test-first-execution',
    name: 'Test-first execution',
    status: 'covered',
    summary:
      'UR can detect a project stack, run compile/test/lint commands as command evidence, store failed command traces, and install the detected command set into edit-time verifier gates.',
    evidence: [
      'ur test-first detect',
      'ur test-first --dry-run / --max-attempts N',
      'failure traces under .ur/test-first/traces',
      'ur test-first install merges commands into .ur/verify.json',
    ],
    references: [
      'https://openai.github.io/openai-agents-python/tracing/',
      'https://openai.github.io/openai-agents-python/guardrails/',
    ],
    professionalNextStep:
      'Add per-package command plans for large monorepos with multiple quality stacks.',
  },
  {
    id: 'permission-safety',
    name: 'Permission and safety policy',
    status: 'covered',
    summary:
      'UR applies a project shell safety policy before broad command approvals: read/write/execute/network classes are separated, destructive commands require approval, risky operations are sandbox-recommended, and common secret exfiltration paths are denied.',
    evidence: [
      'ur safety status|init|check',
      '.ur/safety-policy.json',
      'Bash permission integration before sandbox auto-allow',
      'secret-file and secret-like environment exfiltration deny rules',
    ],
    references: [
      'https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices',
      'https://openai.github.io/openai-agents-python/guardrails/',
    ],
    professionalNextStep:
      'Add OS-specific sandbox attestation to command evidence so every risky command records which sandbox was active.',
  },
  {
    id: 'context-management',
    name: 'Project context management',
    status: 'covered',
    summary:
      'UR can build a project manifest from repository manifests, instruction files, Project DNA, and verify/safety config; it also records decisions, constraints, commands, and diffs into durable task memory and writes compressed context summaries.',
    evidence: [
      'ur context-pack scan',
      'ur context-pack remember --decision|--constraint|--command|--diff',
      'ur context-pack compress',
      '.ur/project-manifest.json and .ur/context/*',
    ],
    references: [
      'https://docs.langchain.com/oss/python/langgraph/overview',
      'https://docs.langchain.com/oss/python/langgraph/memory',
    ],
    professionalNextStep:
      'Feed the generated project manifest directly into subagent prompts and verifier gate selection.',
  },
  {
    id: 'security',
    name: 'Agent security and prompt-injection resistance',
    status: 'covered',
    summary:
      'UR has permission modes, read-only validation, shell security checks, MCP trust guidance, secret scanning, and explicit untrusted-web-content guidance. Durable-memory poisoning and hostile skill supply chains need their own regression corpus.',
    evidence: [
      'permission allow/ask/deny rules',
      'Bash and PowerShell static safety validation',
      'WebSearch/WebFetch prompts treat external content as untrusted evidence',
    ],
    references: [
      'https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices',
      'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html',
    ],
    professionalNextStep:
      'Continuously test web, MCP, repository, skill, and memory injection plus confused-deputy and tool-abuse cases in the release suite.',
  },
  {
    id: 'identity-auth',
    name: 'Agent identity and delegated authorization',
    status: 'adapter-ready',
    summary:
      'UR has OAuth, XAA, MCP auth helpers, permissions, local trust boundaries, and signed, expiring delegation tokens for the A2A adapter. Tokens are scoped to specific skills and bound to a single audience; narrower child tokens can only be minted by the trusted issuer that holds the HMAC secret.',
    evidence: [
      'ur a2a token mint|verify (HMAC-signed, scope + audience + expiry, issuer-side narrowing)',
      'A2A server accepts static bearer or delegation tokens and enforces per-skill scope',
      'Agent Card advertises bearer + delegation securitySchemes',
      'MCP OAuth and XAA helpers; tool permission allow/ask/deny rules',
    ],
    references: [
      'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization',
      'https://a2a-protocol.org/latest/specification/',
    ],
    professionalNextStep:
      'Evaluate portable cross-agent identity only for deliberate non-loopback A2A deployments; keep local HMAC delegation simple and auditable.',
  },
  {
    id: 'multimodal',
    name: 'Multimodal workflows',
    status: 'partial',
    summary:
      'UR includes image, video, YouTube, voice, and browser workflows, but polished real-time multimodal agent UX is still provider/model dependent.',
    evidence: ['/image', '/video', '/youtube', '/voice', 'examples/images.md', 'ur model-route (routes vision tasks to vision-capable models)'],
    references: [
      'https://platform.openai.com/docs/guides/tools-computer-use',
      'https://docs.ollama.com/',
    ],
    professionalNextStep:
      'Auto-pull or warn when a multimodal task has no capable local model, using the model-route gap signal.',
  },
  {
    id: 'provider-native-runtime',
    name: 'Provider-native durable inference',
    status: 'partial',
    summary:
      'UR can run its own durable background processes and compact local conversation state, but direct OpenAI traffic still uses Chat Completions. It does not yet expose Responses background polling/webhooks, WebSocket continuation, server compaction, or deferred tool search through the provider-neutral runtime.',
    evidence: [
      'ur bg supplies process-level durability independent of any model provider',
      'OpenAI-compatible transport targets /v1/chat/completions',
      'UR has local compaction and lazy Skill loading, but no Responses protocol adapter',
    ],
    references: [
      'https://developers.openai.com/api/docs/guides/background',
      'https://developers.openai.com/api/docs/guides/websocket-mode',
      'https://developers.openai.com/api/docs/guides/compaction',
      'https://developers.openai.com/api/docs/guides/tools-tool-search',
    ],
    professionalNextStep:
      'Add an opt-in, capability-driven Responses adapter with store=false by default, bounded polling/webhook verification, cancellation, opaque compaction preservation, and a tested Chat Completions fallback.',
  },
  {
    id: 'scheduling',
    name: 'Scheduled and recurring agents',
    status: 'covered',
    summary:
      'UR turns cron-defined automations into ones that actually fire: a resident scheduler installs a launchd LaunchAgent (macOS), a systemd --user timer (Linux), or prints a crontab line, and an in-process daemon loop covers containers/CI.',
    evidence: [
      'ur automation create --schedule "<cron>" (cron-validated specs)',
      'ur automation install [--platform] [--interval] (launchd/systemd/cron)',
      'ur automation daemon [--once] (in-process poll loop) → run-due',
    ],
    references: ['https://docs.langchain.com/oss/python/langgraph/overview'],
    professionalNextStep:
      'Add per-automation run history and failure alerting surfaced through /trace.',
  },
  {
    id: 'inbound-triggers',
    name: 'Inbound chat/VCS triggers',
    status: 'adapter-ready',
    summary:
      'UR parses a GitHub issue/PR comment or Slack mention webhook payload, decides whether a keyword (default /ur) should dispatch it, extracts the prompt, and can launch a headless run — the inbound counterpart to the bundled GitHub Action and install-slack-app/install-github-app helpers.',
    evidence: [
      'ur trigger parse --file payload.json (deterministic, testable decision)',
      'ur trigger run --file payload.json (launches headless ur -p for the prompt)',
      '.github/workflows/ur.yml outbound runner + .ur/triggers scaffold',
    ],
    references: ['https://docs.github.com/en/webhooks', 'https://api.slack.com/events/app_mention'],
    professionalNextStep:
      'Ship a reference webhook receiver (serverless function) that calls ur trigger run with an actor allow-list.',
  },
  {
    id: 'sdk',
    name: 'Programmatic SDK',
    status: 'covered',
    summary:
      'A dependency-free TypeScript SDK (ur-agent/sdk: query, queryJSON, UrClient) plus a Python wrapper drive headless `ur -p`, inheriting the selected provider, CLI permission model, and MCP configuration. It is the in-process counterpart to the loopback A2A server.',
    evidence: [
      'src/sdk/index.ts (query / queryJSON / UrClient)',
      'ur sdk init (scaffolds runnable TS + Python examples)',
      'ur -p --output-format json headless contract',
    ],
    references: ['https://openai.github.io/openai-agents-python/'],
    professionalNextStep:
      'Publish the SDK as a documented subpath export and add a streaming (stream-json) iterator.',
  },
]

const priorityRoadmap = [
  'A2A v1 dual stack: add version negotiation, signed Agent Card verification, multi-tenancy boundaries, and the official TCK after the JavaScript SDK v1 line is stable.',
  'ACP lifecycle completeness: paginated session/list and session/delete first, then exact-history session/load and truthful config/slash-command capabilities.',
  'MCP 2026 readiness: test a stateless-core compatibility branch and capability-gated Tasks/Apps extensions without shipping against the release candidate.',
  'Provider-native durable inference: add a privacy-aware Responses adapter for background/WebSocket execution, server compaction, and deferred tool discovery while retaining provider neutrality.',
  'Security integrity: provenance, quarantine, rollback, and adversarial regression tests for durable memories and installable skills.',
  'Standard observability and eval gates: OpenTelemetry GenAI semantics, trajectory graders, CI trend history, and published category scores.',
  'Claim provenance: map final-answer claims to WebSearch/WebFetch/MCP source URLs and show them in trace/evidence output.',
  'Windows OS-sandbox parity for the agent shell (macOS Seatbelt and Linux bubblewrap already ship).',
]

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function buildA2AAgentCard(
  options: A2AAgentCardOptions = {},
): A2AAgentCard {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const url = baseUrl ? `${baseUrl}/a2a/jsonrpc` : 'local-cli://ur'
  const securitySchemes: NonNullable<A2AAgentCard['securitySchemes']> = {}
  const security: NonNullable<A2AAgentCard['security']> = []

  if (options.staticBearer) {
    securitySchemes.bearer = {
      type: 'http',
      scheme: 'bearer',
      description:
        'Static shared-secret bearer token configured for this A2A server.',
    }
    security.push({ bearer: [] })
  }
  if (options.delegationBearer) {
    securitySchemes.delegation = {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'UR-Delegation',
      description:
        'Issuer-minted HMAC delegation token scoped to specific skills, bound to this agent, and time-limited.',
    }
    security.push({ delegation: [] })
  }

  return {
    protocolVersion: '0.3.0',
    name: 'UR',
    description:
      'Provider-flexible, local-first terminal coding agent with MCP tools, custom agents, browser workflows, memory, verifier gates, and permission controls.',
    url,
    preferredTransport: 'JSONRPC',
    additionalInterfaces: [{ url, transport: 'JSONRPC' }],
    version: urVersion,
    documentationUrl:
      'https://github.com/Maitham16/UR/blob/master/docs/AGENT_TRENDS.md',
    capabilities: {
      // The opt-in HTTP adapter currently returns unary task lifecycle
      // responses. Do not advertise streaming until an A2A streaming binding
      // is actually implemented.
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    ...(security.length > 0 ? { security } : {}),
    defaultInputModes: ['text/plain', 'text/markdown', 'application/json'],
    defaultOutputModes: ['text/plain', 'text/markdown', 'application/json'],
    provider: {
      organization: 'Maitham Al-rubaye',
      url: 'https://github.com/Maitham16/UR',
    },
    skills: [
      {
        id: 'coding-agent',
        name: 'Coding Agent',
        description:
          'Read, edit, test, verify, and explain code inside a local workspace with permission controls.',
        tags: ['coding', 'terminal', 'verification'],
        examples: [
          'Fix this failing test and run the relevant checks.',
          'Review the current diff for behavioral regressions.',
        ],
        inputModes: ['text/plain', 'text/markdown'],
        outputModes: ['text/plain', 'text/markdown'],
      },
      {
        id: 'research-agent',
        name: 'Research Agent',
        description:
          'Search, fetch, summarize, cite, and organize web or document evidence with source awareness.',
        tags: ['research', 'web', 'citations'],
        examples: [
          'Compare current agent interoperability standards and cite sources.',
          'Summarize this paper and add key claims to the research graph.',
        ],
        inputModes: ['text/plain', 'text/markdown'],
        outputModes: ['text/plain', 'text/markdown', 'application/json'],
      },
      {
        id: 'mcp-agent',
        name: 'MCP Tool Agent',
        description:
          'Use configured MCP servers through UR permission checks and elicitation flows.',
        tags: ['mcp', 'tools', 'integrations'],
        examples: [
          'Use the configured MCP tools to inspect this issue.',
          'List available MCP resources for this workspace.',
        ],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['text/plain', 'application/json'],
      },
      {
        id: 'browser-agent',
        name: 'Browser Agent',
        description:
          'Use browser, Chrome, Playwright-aware, WebSearch, and WebFetch workflows with approval for risky actions.',
        tags: ['browser', 'computer-use', 'web'],
        examples: [
          'Open the local app and verify the login page renders.',
          'Search the current docs and cite the relevant source URLs.',
        ],
        inputModes: ['text/plain', 'text/markdown'],
        outputModes: ['text/plain', 'text/markdown', 'application/json'],
      },
    ],
  }
}

export function buildAgentTrendReport(
  options: A2AAgentCardOptions = {},
): AgentTrendReport {
  return {
    generatedAt: new Date().toISOString(),
    researchSnapshotDate,
    urVersion,
    coverage,
    a2aAgentCard: buildA2AAgentCard(options),
    priorityRoadmap,
  }
}

export function formatAgentTrendReport(
  report: AgentTrendReport = buildAgentTrendReport(),
): string {
  const lines = [
    `UR Trend Coverage`,
    `Version: ${report.urVersion}`,
    `Generated: ${report.generatedAt}`,
    `Research snapshot: ${report.researchSnapshotDate}`,
    '',
    'Status: covered = shipped, partial = useful base exists, adapter-ready = discovery metadata exists and full runtime adapter is separate.',
    '',
  ]

  for (const item of report.coverage) {
    lines.push(`[${item.status}] ${item.name}`)
    lines.push(`  ${item.summary}`)
    lines.push(`  Evidence: ${item.evidence.join('; ')}`)
    lines.push(`  References: ${item.references.join(', ')}`)
    lines.push(`  Next: ${item.professionalNextStep}`)
    lines.push('')
  }

  lines.push('Priority Roadmap')
  for (const item of report.priorityRoadmap) {
    lines.push(`- ${item}`)
  }
  lines.push('')
  lines.push('A2A')
  lines.push('- Agent Card export: ur a2a card')
  lines.push('- Slash command: /a2a-card')
  lines.push('- Full remote task execution should stay opt-in because it changes UR from a local CLI into a network-facing agent service.')

  return lines.join('\n')
}

export function formatA2AAgentCard(
  options: A2AAgentCardOptions = {},
  pretty = true,
): string {
  return JSON.stringify(buildA2AAgentCard(options), null, pretty ? 2 : 0)
}
