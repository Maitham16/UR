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
  urVersion: string
  coverage: TrendCoverage[]
  a2aAgentCard: A2AAgentCard
  priorityRoadmap: string[]
}

type A2AAgentCardOptions = {
  baseUrl?: string
}

export type A2AAgentCard = {
  protocolVersion: string
  name: string
  description: string
  url: string
  version: string
  documentationUrl: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  securitySchemes: {
    bearer: { type: string; scheme: string; description: string }
    delegation: {
      type: string
      scheme: string
      bearerFormat: string
      description: string
    }
  }
  security: Array<Record<string, string[]>>
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
  }>
  provider: {
    organization: string
    url: string
  }
}

const urVersion = MACRO.VERSION

const coverage: TrendCoverage[] = [
  {
    id: 'local-runtime',
    name: 'Local-first model runtime',
    status: 'covered',
    summary:
      'UR routes all model traffic through the local Ollama app, so local models and Ollama Cloud-backed models exposed by that app share one local endpoint and permission boundary.',
    evidence: [
      'fixed local Ollama endpoint',
      'OLLAMA_MODEL and UR_MODEL selection',
      'auto-routing over models advertised by the local Ollama app',
      'ur model-doctor (capability report) + ur model-route "<task>" (capability-aware per-task model pick)',
    ],
    references: ['https://docs.ollama.com/'],
    professionalNextStep:
      'Let UR auto-apply the model-route recommendation per subagent step instead of only reporting it.',
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
      'Keep server trust UX, registry metadata, and MCP security guidance current as the MCP spec evolves.',
  },
  {
    id: 'a2a',
    name: 'A2A / Agent Card interoperability',
    status: 'adapter-ready',
    summary:
      'UR now exports Agent Card metadata for discovery, while full remote A2A task serving remains an adapter layer rather than a CLI-core behavior.',
    evidence: [
      'ur a2a card',
      '/a2a-card',
      'Agent Card describes UR skills, modes, and local-first operating boundary',
    ],
    references: ['https://a2a-protocol.org/latest/specification/'],
    professionalNextStep:
      'Add a separate opt-in A2A task server when UR should accept remote agent-to-agent task execution.',
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
      'UR has file-backed memory, research notes, team memory, forget controls, consolidation prompts, and a curated knowledge base with source-level provenance and retention; dense vector retrieval is still lexical rather than embedding-based.',
    evidence: [
      '/remember, /forget, /memory',
      'ur knowledge build --embeddings (dense retrieval) + lexical fallback, provenance, retention',
      'team memory sync and auto-dream consolidation services',
    ],
    references: [
      'https://docs.langchain.com/oss/python/langgraph/overview',
      'https://docs.langchain.com/oss/python/langgraph/memory',
    ],
    professionalNextStep:
      'Add optional local embedding indexes with scope, retention, and deletion guarantees.',
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
      'UR has verifier gates, project gates, /trace, a per-subagent run inspector, OpenTelemetry plumbing, release checks, and now a replayable eval harness with deterministic grading; published benchmark numbers and dashboards are the remaining layer.',
    evidence: [
      'UR_VERIFIER_MODE and .ur/verify.json',
      'ur eval run (replayable, gradeable cases by category: coding/research/browser/mcp/memory)',
      '/trace and ur agent-inspect (per-subagent timeline)',
      'OpenTelemetry tracing utilities',
    ],
    references: [
      'https://openai.github.io/openai-agents-python/tracing/',
      'https://openai.github.io/openai-agents-python/guardrails/',
    ],
    professionalNextStep:
      'Run the eval harness in CI and track pass-rate per category over time as a published number.',
  },
  {
    id: 'security',
    name: 'Agent security and prompt-injection resistance',
    status: 'covered',
    summary:
      'UR has permission modes, read-only validation, shell security checks, MCP trust guidance, secret scanning, and explicit untrusted-web-content guidance.',
    evidence: [
      'permission allow/ask/deny rules',
      'Bash and PowerShell static safety validation',
      'WebSearch/WebFetch prompts treat external content as untrusted evidence',
    ],
    references: [
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices',
      'https://openai.github.io/openai-agents-python/guardrails/',
    ],
    professionalNextStep:
      'Continuously test web/MCP prompt-injection cases in the release suite.',
  },
  {
    id: 'identity-auth',
    name: 'Agent identity and delegated authorization',
    status: 'adapter-ready',
    summary:
      'UR has OAuth, XAA, MCP auth helpers, permissions, local trust boundaries, and now signed, attenuated, expiring delegation tokens for the A2A adapter — scoped to specific skills and bound to a single audience — so a holder can hand onward a strictly narrower capability without UR becoming an identity provider.',
    evidence: [
      'ur a2a token mint|verify (HMAC-signed, scope + audience + expiry, attenuation)',
      'A2A server accepts static bearer or delegation tokens and enforces per-skill scope',
      'Agent Card advertises bearer + delegation securitySchemes',
      'MCP OAuth and XAA helpers; tool permission allow/ask/deny rules',
    ],
    references: [
      'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization',
      'https://a2a-protocol.org/latest/specification/',
    ],
    professionalNextStep:
      'Federate delegation with a portable cross-agent identity only when UR exposes a network-facing A2A adapter beyond loopback.',
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
      '.github/workflows/ur-agent.yml outbound runner + .ur/triggers scaffold',
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
      'A dependency-free TypeScript SDK (ur-agent/sdk: query, queryJSON, UrClient) plus a Python wrapper drive headless `ur -p`, inheriting the CLI permission model, MCP config, and local Ollama routing. The in-process counterpart to the loopback A2A server.',
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
  'Unify views: stream live executor and crew worker events into the agent-inspect timeline so the live board and post-hoc inspector are one surface.',
  'Auto-apply model-route: pick the best local model per subagent step automatically, not just on demand.',
  'Reference webhook receiver for ur trigger run with an actor allow-list, closing the inbound-trigger loop end to end.',
  'Embedding cache and scope: persist knowledge embeddings with per-scope deletion guarantees and incremental rebuilds.',
  'Claim provenance: map final-answer claims to WebSearch/WebFetch/MCP source URLs and show them in trace/evidence output.',
  'Published eval scores: run the eval harness in CI and track pass-rate per category over time.',
  'Windows OS-sandbox parity for the agent shell (macOS Seatbelt and Linux bubblewrap already ship).',
  'Federate delegation with portable cross-agent identity only if UR exposes a network-facing A2A adapter beyond loopback.',
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
  const url = baseUrl ? `${baseUrl}/a2a` : 'local-cli://ur'

  return {
    protocolVersion: '0.3.0',
    name: 'UR Agent',
    description:
      'Local-first terminal coding agent powered through the local Ollama app, with MCP tools, custom agents, browser workflows, memory, verifier gates, and permission controls.',
    url,
    version: urVersion,
    documentationUrl:
      'https://github.com/Maitham16/UR-mapek/blob/master/docs/AGENT_TRENDS.md',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Static shared-secret bearer token for task execution (ur a2a serve --token).',
      },
      delegation: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'UR-Delegation',
        description:
          'Attenuated delegation token: scoped to specific skills, bound to this agent (aud), and time-limited. Mint with `ur a2a token mint` and verify with `ur a2a token verify`.',
      },
    },
    security: [{ bearer: [] }, { delegation: [] }],
    defaultInputModes: ['text/plain', 'text/markdown', 'application/json'],
    defaultOutputModes: ['text/plain', 'text/markdown', 'application/json'],
    provider: {
      organization: 'Maitham Al-rubaye',
      url: 'https://github.com/Maitham16/UR-mapek',
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
    `UR Agent Trend Coverage`,
    `Version: ${report.urVersion}`,
    `Generated: ${report.generatedAt}`,
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
