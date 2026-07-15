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

export type A2AV1SecurityRequirement = {
  schemes: Record<string, string[]>
}

export type A2AV1AgentCard = {
  name: string
  description: string
  supportedInterfaces: Array<{
    url: string
    protocolBinding: 'JSONRPC' | 'HTTP+JSON'
    tenant: string
    protocolVersion: '0.3' | '1.0'
  }>
  provider: { organization: string; url: string }
  version: string
  documentationUrl: string
  capabilities: {
    streaming: false
    pushNotifications: false
    extensions: []
    extendedAgentCard: false
  }
  securitySchemes: Record<
    string,
    {
      httpAuthSecurityScheme: {
        description: string
        scheme: 'Bearer'
        bearerFormat: string
      }
    }
  >
  securityRequirements: A2AV1SecurityRequirement[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: Array<{
    id: string
    name: string
    description: string
    tags: string[]
    examples: string[]
    inputModes: string[]
    outputModes: string[]
    securityRequirements: A2AV1SecurityRequirement[]
  }>
  signatures: []
}

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
      'UR has first-class MCP configuration, registry integration, OAuth/XAA helpers, tool approval, elicitation handling, and an opt-in stateless MCP 2026 HTTP adapter.',
    evidence: [
      'ur mcp list/get/add-json/remove',
      'src/services/mcp/*',
      'MCP tools run through the same permission and evidence path as built-in tools',
      'ur mcp serve-http exposes strict request metadata and the real UR tool registry',
    ],
    references: ['https://modelcontextprotocol.io/docs/getting-started/intro'],
    professionalNextStep:
      'Track the final MCP 2026 specification and production SDK, keeping the compatibility adapter opt-in until both stabilize.',
  },
  {
    id: 'mcp-async-apps',
    name: 'MCP Tasks and MCP Apps',
    status: 'covered',
    summary:
      'UR exposes capability-negotiated MCP Tasks and a self-contained MCP App through its opt-in stateless HTTP adapter, backed by private owner-isolated durable state.',
    evidence: [
      'tasks/create|get|update|cancel with owner isolation and corruption quarantine',
      'MCP Apps resource metadata, CSP, permissions, and capability negotiation',
      'Tasks and Apps are advertised only by ur mcp serve-http',
    ],
    references: [
      'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/',
      'https://tasks.extensions.modelcontextprotocol.io/',
      'https://apps.extensions.modelcontextprotocol.io/',
    ],
    professionalNextStep:
      'Add interoperability fixtures from independent clients and migrate the adapter only after the final extension schemas are published.',
  },
  {
    id: 'a2a',
    name: 'A2A / Agent Card interoperability',
    status: 'covered',
    summary:
      'UR runs the official-SDK A2A v0.3 binding beside strict v1 ProtoJSON JSON-RPC and HTTP+JSON bindings, with negotiated cards, tenant boundaries, durable artifacts, and a separate UR compatibility API.',
    evidence: [
      'ur a2a card',
      '/a2a-card',
      'ur a2a serve: negotiated discovery plus /a2a/jsonrpc and /a2a/v1/*',
      'official A2A TCK compatibility coverage and strict version isolation',
    ],
    references: [
      'https://a2a-protocol.org/latest/specification/',
      'https://github.com/a2aproject/a2a-js',
    ],
    professionalNextStep:
      'Adopt the stable v1 JavaScript SDK when released, close remaining TCK ambiguities, and add signed-card verification plus streaming only when truthfully supported.',
  },
  {
    id: 'acp',
    name: 'ACP editor interoperability',
    status: 'covered',
    summary:
      'UR implements native ACP v1 over stdio with the official SDK, durable list/load/delete/new/resume/close, exact history replay, modes, config options, commands, MCP servers, roots, permissions, streaming, and cancellation.',
    evidence: [
      'ur acp stdio',
      'session/list, session/load, session/delete, resume/close, prompt, and cancel',
      'default, acceptEdits, and plan modes plus bounded tool-update configuration',
      'capability declarations match only implemented behavior',
    ],
    references: [
      'https://agentclientprotocol.com/protocol/v1/schema',
      'https://github.com/agentclientprotocol/typescript-sdk',
    ],
    professionalNextStep:
      'Add editor-host interoperability fixtures and expand commands/config options only when clients expose stable UX for them.',
  },
  {
    id: 'ag-ui',
    name: 'AG-UI agent-to-frontend interoperability',
    status: 'covered',
    summary:
      'UR exposes an opt-in AG-UI HTTP/SSE adapter with official schemas and encoding, truthful capability discovery, complete text/tool lifecycle events, bounded input/output, cancellation, exact CORS, and loopback-or-bearer security.',
    evidence: [
      'ur ag-ui serve',
      'POST /ag-ui plus GET /ag-ui/capabilities and /healthz',
      'official @ag-ui/core validation and @ag-ui/encoder SSE framing',
      'unsupported client tools, multimodal input, interrupts, and encrypted input fail explicitly instead of being discarded',
    ],
    references: [
      'https://docs.ag-ui.com/concepts/events',
      'https://docs.ag-ui.com/concepts/architecture',
      'https://github.com/ag-ui-protocol/ag-ui',
    ],
    professionalNextStep:
      'Add independent frontend fixtures before enabling optional interrupt, binary, WebSocket, or client-tool capabilities; advertise each only after end-to-end support exists.',
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
      'UR has file-backed memory, research notes, team memory, forget controls, consolidation, retrieval, and a provenance-rich tamper-evident project task-memory chain with quarantine and rollback.',
    evidence: [
      '/remember, /forget, /memory',
      'ur knowledge build --embeddings (dense retrieval) + lexical fallback, provenance, retention',
      'team memory sync and auto-dream consolidation services',
      'ur context-pack memory verify|quarantine|rollback',
    ],
    references: [
      'https://docs.langchain.com/oss/python/langgraph/overview',
      'https://docs.langchain.com/oss/python/langgraph/memory',
      'https://owasp.org/www-project-agent-memory-guard/',
    ],
    professionalNextStep:
      'Extend the same integrity and deletion guarantees from project task memory to every legacy, team, and embedding-backed memory store.',
  },
  {
    id: 'agent-skills',
    name: 'Portable Agent Skills',
    status: 'covered',
    summary:
      'UR loads reusable SKILL.md directories from native and cross-client locations with strict Agent Skills validation, deterministic content/permission provenance, Ed25519 signing, trusted-key policy, and invocation-time integrity checks.',
    evidence: [
      '.ur/skills/<name>/SKILL.md and ~/.ur/skills/<name>/SKILL.md',
      '.agents/skills/<name>/SKILL.md and ~/.agents/skills/<name>/SKILL.md with deterministic native/project precedence',
      '/skills, /create-skill, /skillify, and the Skill tool',
      'skill-scoped file permissions and restricted MCP skill execution',
      'ur skill verify|sign|keygen and trusted-signature enforcement',
    ],
    references: [
      'https://agentskills.io/specification',
      'https://agentskills.io/client-implementation/adding-skills-support',
      'https://docs.github.com/en/copilot/concepts/agents/about-agent-skills',
    ],
    professionalNextStep:
      'Require registry provenance attestations and dependency review before enabling one-command installation from community skill registries.',
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
    status: 'covered',
    summary:
      'UR emits opt-in OpenTelemetry GenAI inference, agent, workflow, tool, and memory spans plus standard duration, token, streaming time-to-first-chunk, and inter-output-chunk metrics, with sensitive content excluded by default.',
    evidence: [
      'src/utils/telemetry/sessionTracing.ts',
      'src/utils/telemetry/genAiSemantics.ts',
      'src/utils/telemetry/perfettoTracing.ts',
      'invoke_workflow spans and streaming time-to-first-chunk/inter-output-chunk histograms',
      'OTLP/console exporters are explicit and message-content capture is off by default',
    ],
    references: [
      'https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/',
      'https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md',
    ],
    professionalNextStep:
      'Add trace-level policy graders and cross-provider dashboards without increasing default content capture or attribute cardinality.',
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
    status: 'covered',
    summary:
      'UR retains Chat Completions by default and provides an explicit privacy-aware OpenAI Responses transport with background polling/cancellation, WebSocket continuation, server compaction, and deferred tool search.',
    evidence: [
      'ur bg supplies process-level durability independent of any model provider',
      'ur config set openai_transport responses',
      'store=false by default with identifier-only durable state and optional encrypted compacted context',
      'fake HTTP, SSE, and WebSocket regression coverage requires no paid API calls',
    ],
    references: [
      'https://developers.openai.com/api/docs/guides/background',
      'https://developers.openai.com/api/docs/guides/websocket-mode',
      'https://developers.openai.com/api/docs/guides/compaction',
      'https://developers.openai.com/api/docs/guides/tools-tool-search',
    ],
    professionalNextStep:
      'Generalize provider capability discovery while keeping provider-native state and features explicitly selected rather than silently emulated.',
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
  'Protocol stabilization: adopt final MCP 2026 and stable A2A v1 SDK artifacts when released, retaining explicit dual-stack negotiation and independent-client fixtures.',
  'A2A trust and streaming: signed Agent Card verification, streaming/resubscription, and push notifications only with end-to-end authentication and truthful capability tests.',
  'Memory unification: apply provenance chains, quarantine, rollback, and deletion proofs to legacy, team, semantic, and embedding-backed stores.',
  'Trajectory eval gates: grade tool choice, handoffs, policy compliance, recovery, and outcome quality in CI with versioned category history.',
  'Community supply chain: registry attestations, dependency review, revocation, and update transparency for installable skills and plugins.',
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

/**
 * Build the A2A v1 ProtoJSON Agent Card. Keeping this separate from the v0.3
 * card prevents mixed-version fields from confusing strict clients and TCKs.
 */
export function buildA2AV1AgentCard(
  options: A2AAgentCardOptions = {},
): A2AV1AgentCard {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const root = baseUrl ?? 'http://127.0.0.1'
  const securitySchemes: A2AV1AgentCard['securitySchemes'] = {}
  const securityRequirements: A2AV1SecurityRequirement[] = []

  if (options.staticBearer) {
    securitySchemes.bearer = {
      httpAuthSecurityScheme: {
        description:
          'Static shared-secret bearer token configured for this A2A server.',
        scheme: 'Bearer',
        bearerFormat: 'Opaque',
      },
    }
    securityRequirements.push({ schemes: { bearer: [] } })
  }
  if (options.delegationBearer) {
    securitySchemes.delegation = {
      httpAuthSecurityScheme: {
        description:
          'Issuer-minted, audience-bound, expiring UR delegation token with skill and optional tenant scopes.',
        scheme: 'Bearer',
        bearerFormat: 'UR-Delegation',
      },
    }
    securityRequirements.push({ schemes: { delegation: [] } })
  }

  const legacy = buildA2AAgentCard(options)
  return {
    name: legacy.name,
    description: legacy.description,
    supportedInterfaces: [
      {
        url: root,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: root,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `${root}/a2a/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '0.3',
      },
    ],
    provider: {
      organization: legacy.provider?.organization ?? 'Maitham Al-rubaye',
      url: legacy.provider?.url ?? 'https://github.com/Maitham16/UR',
    },
    version: legacy.version,
    documentationUrl:
      legacy.documentationUrl ??
      'https://github.com/Maitham16/UR/blob/master/docs/AGENT_TRENDS.md',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes,
    securityRequirements,
    defaultInputModes: [...legacy.defaultInputModes],
    defaultOutputModes: [...legacy.defaultOutputModes],
    skills: legacy.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [...skill.tags],
      examples: [...(skill.examples ?? [])],
      inputModes: [...(skill.inputModes ?? legacy.defaultInputModes)],
      outputModes: [...(skill.outputModes ?? legacy.defaultOutputModes)],
      securityRequirements: structuredClone(securityRequirements),
    })),
    signatures: [],
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
