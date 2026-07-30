import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  TASK_LIST_GATE_DEFAULTS,
  checkTaskListGate,
  countActionableTasksForGate,
  countActionableTodosForGate,
  isLocalPreviewOpenForTaskGate,
  isMutationRequiringTaskList,
  isMutatingTool,
  isPlanArtifactMutationForGate,
  isTaskListGateExempt,
  isSyntaxVerificationForTaskGate,
} from '../src/services/tools/taskListGate.ts'
import { AgentTool } from '../src/tools/AgentTool/AgentTool.tsx'
import { BashTool } from '../src/tools/BashTool/BashTool.tsx'
import { ComputerTool } from '../src/tools/ComputerTool/ComputerTool.tsx'
import { SkillTool } from '../src/tools/SkillTool/SkillTool.ts'
import { countToolCallsBeforeCurrent } from '../src/services/tools/toolExecution.ts'

// The system prompt already asked for a task list on multi-step work and the
// agent still edited files, ran commands and reported completion with no plan
// on record. Guidance does not hold; this is a gate.

const CONFIG = { enabled: true, freeReads: 3 }

test('a mutating call with no task list is refused', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 10,
    isSubagent: false,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  // The refusal has to say what to do, or it is just an obstacle.
  expect((decision as { reason: string }).reason).toContain('TaskCreate')
  expect((decision as { reason: string }).reason).toContain(
    'tasks.requireBeforeChanges',
  )
  expect((decision as { reason: string }).reason).toContain(
    'one task per cohesive outcome',
  )
  expect((decision as { reason: string }).reason).toContain(
    'observable done check',
  )
  expect((decision as { reason: string }).reason).toContain(
    'genuinely atomic',
  )
})

test('gate recovery names the task tool available in headless mode', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 3,
    isSubagent: false,
    isMutating: true,
    taskPlanningToolName: 'TodoWrite',
    config: CONFIG,
  })

  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'Call TodoWrite first',
  )
  expect((decision as { reason: string }).reason).not.toContain('TaskCreate')
})

test('a planner-less custom pool fails closed with configuration recovery', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 99,
    isSubagent: false,
    isMutating: true,
    taskPlanningToolName: null,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  const reason = (decision as { reason: string }).reason
  expect(reason).toContain('No task-list tool is available')
  expect(reason).toContain('TaskCreate+TaskUpdate')
  expect(reason).toContain('TodoWrite')
  expect(reason).toContain('tasks.requireBeforeChanges.enabled')
})

test('reads are never blocked, so it can investigate before planning', () => {
  // Demanding a plan before the agent is allowed to look at anything would
  // produce a worse plan, not a better one.
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
    expect(
      checkTaskListGate({
        toolName: tool,
        taskCount: 0,
        readsSoFar: 99,
        isSubagent: false,
        config: CONFIG,
      }).allowed,
    ).toBe(true)
  }
})

test('desktop screenshots and skill loading remain read-only', () => {
  expect(
    ComputerTool.isReadOnly({ action: 'screenshot' } as never),
  ).toBe(true)
  expect(ComputerTool.isReadOnly({ action: 'click' } as never)).toBe(false)
  expect(ComputerTool.isReadOnly({ action: 'type' } as never)).toBe(false)
  expect(SkillTool.isReadOnly({ skill: 'pdf' } as never)).toBe(true)
})

test('team lifecycle and emergency stop cannot deadlock on task state', () => {
  for (const tool of [
    'TeamCreate',
    'TeamDelete',
    'TaskStop',
    'KillShell',
  ]) {
    expect(isTaskListGateExempt(tool)).toBe(true)
  }

  for (const type of [
    'shutdown_request',
    'shutdown_response',
    'plan_approval_response',
  ]) {
    expect(
      isMutationRequiringTaskList({
        toolName: 'SendMessage',
        toolInput: { message: { type } },
        isMutating: true,
      }),
    ).toBe(false)
  }
  expect(
    isMutationRequiringTaskList({
      toolName: 'SendMessage',
      toolInput: { message: { type: 'unknown' } },
      isMutating: true,
    }),
  ).toBe(true)
})

test('an existing task list opens the gate', () => {
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 1,
      readsSoFar: 50,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the reported Write stays blocked until TaskCreate has produced an actionable task', () => {
  const beforeTaskCreate = checkTaskListGate({
    toolName: 'Write',
    taskCount: countActionableTasksForGate([]),
    totalTaskCount: 0,
    readsSoFar: 4,
    isSubagent: false,
    config: CONFIG,
  })
  expect(beforeTaskCreate.allowed).toBe(false)

  const afterTaskCreate = [
    {
      status: 'pending',
      metadata: {
        doneCheck: 'Load warship.html and verify runtime behavior',
      },
    },
  ]
  const actionable = countActionableTasksForGate(afterTaskCreate)
  expect(actionable).toBe(1)
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: actionable,
      totalTaskCount: afterTaskCreate.length,
      readsSoFar: 5,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('a trivial one-shot edit is not gated', () => {
  // freeReads exists so a single-step request does not demand ceremony, which
  // is what would train the user to disable this.
  expect(
    checkTaskListGate({
      toolName: 'Edit',
      taskCount: 0,
      readsSoFar: 1,
      isSubagent: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('subagents must be bound to an actionable parent task before mutation', () => {
  const refusal = checkTaskListGate({
    toolName: 'Write',
    taskCount: 0,
    readsSoFar: 0,
    isSubagent: true,
    config: CONFIG,
  })
  expect(refusal.allowed).toBe(false)
  expect((refusal as { reason: string }).reason).toContain(
    'one task per cohesive outcome',
  )
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 1,
      readsSoFar: 0,
      isSubagent: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the gate never blocks the fix for itself', () => {
  // If TaskCreate were gated the agent could never satisfy the requirement.
  for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) {
    expect(isMutatingTool(tool)).toBe(false)
  }
})

test('exiting plan mode is not mistaken for an implementation mutation', () => {
  for (const taskCount of [0, null]) {
    expect(
      checkTaskListGate({
        toolName: 'ExitPlanMode',
        taskCount,
        readsSoFar: 99,
        isSubagent: false,
        isMutating: true,
        config: CONFIG,
      }).allowed,
    ).toBe(true)
  }

  // The control-flow exemption must not open the gate for real workspace
  // writes under otherwise identical conditions.
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('the exact current-session plan file is a narrow gate exemption', () => {
  const expectedPlanFile = '/tmp/ur-plans/steady-river.md'
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Write',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: true,
    }),
  ).toBe(true)
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/ur-plans/steady-river.md' },
      expectedPlanFile: '/tmp/ur-plans/../ur-plans/steady-river.md',
      isPlanMode: true,
    }),
  ).toBe(true)

  for (const filePath of [
    '/tmp/ur-plans/steady-river-copy.md',
    '/tmp/ur-plans/steady-river.md/child',
    '/tmp/ur-plans/other-plan.md',
  ]) {
    expect(
      isPlanArtifactMutationForGate({
        toolName: 'Write',
        toolInput: { file_path: filePath },
        expectedPlanFile,
        isPlanMode: true,
      }),
    ).toBe(false)
  }
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Bash',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: true,
    }),
  ).toBe(false)
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Write',
      toolInput: { file_path: expectedPlanFile },
      expectedPlanFile,
      isPlanMode: false,
    }),
  ).toBe(false)

  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      isPlanArtifactMutation: true,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('only exact current-plan directory bootstrap Bash is a plan artifact', () => {
  const expectedPlanFile =
    '/Users/example/.ur/plans/typed-scribbling-hoare.md'
  const planDirectory = '/Users/example/.ur/plans'
  const transcriptCommand =
    `ls -la ${planDirectory} 2>/dev/null || ` +
    `mkdir -p ${planDirectory} && ls -la ${planDirectory}`

  for (const command of [
    `mkdir -p ${planDirectory}`,
    `ls -la ${planDirectory} || mkdir -p ${planDirectory}`,
    transcriptCommand,
  ]) {
    expect(
      isPlanArtifactMutationForGate({
        toolName: 'Bash',
        toolInput: { command },
        expectedPlanFile,
        isPlanMode: true,
      }),
      command,
    ).toBe(true)
  }

  for (const command of [
    `mkdir -p ${planDirectory} && touch /tmp/not-a-plan`,
    `ls -la ${planDirectory} || mkdir -p ${planDirectory} && rm -rf /tmp/x`,
    'mkdir -p /Users/example/.ur/plans-sibling',
    `mkdir -p "${planDirectory}/$(touch /tmp/not-a-plan)"`,
  ]) {
    expect(
      isPlanArtifactMutationForGate({
        toolName: 'Bash',
        toolInput: { command },
        expectedPlanFile,
        isPlanMode: true,
      }),
      command,
    ).toBe(false)
  }
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Bash',
      toolInput: { command: transcriptCommand },
      expectedPlanFile,
      isPlanMode: false,
    }),
  ).toBe(false)
  expect(
    isPlanArtifactMutationForGate({
      toolName: 'Bash',
      toolInput: {
        command: transcriptCommand,
        dangerouslyDisableSandbox: true,
      },
      expectedPlanFile,
      isPlanMode: true,
    }),
  ).toBe(false)
})

test('runtime tool classification covers dynamic and future mutators', () => {
  expect(
    checkTaskListGate({
      toolName: 'mcp__filesystem__move_file',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: false,
      config: CONFIG,
    }).allowed,
  ).toBe(true)
})

test('the exact HTML syntax verifier bypasses only the task gate', () => {
  const input = {
    command:
      'wc -l index.html && node -e "const fs=require(\'fs\');' +
      'const s=fs.readFileSync(\'index.html\',\'utf8\');try{' +
      'new Function(s.split(\'<script>\')[1].split(\'</script>\')[0]);' +
      'console.log(\'JS syntax OK\');}catch(e){' +
      'console.log(\'SYNTAX ERROR:\',e.message);}"',
    description: 'Validate JS syntax of game file',
  }

  expect(
    isSyntaxVerificationForTaskGate({
      toolName: 'Bash',
      toolInput: input,
    }),
  ).toBe(true)
  expect(
    isMutationRequiringTaskList({
      toolName: 'Bash',
      toolInput: input,
      isMutating: true,
    }),
  ).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      totalTaskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      isMutating: isMutationRequiringTaskList({
        toolName: 'Bash',
        toolInput: input,
        isMutating: true,
      }),
      config: CONFIG,
    }).allowed,
  ).toBe(true)

  // Generic Node execution is still not permission-auto-approved. The narrow
  // compatibility rule affects task tracking only.
  expect(BashTool.isReadOnly?.(input as never)).toBe(false)
})

test('Node syntax verification recognition fails closed on executable variants', () => {
  const safeInline =
    'node -e "const fs=require(\'fs\');const s=' +
    'fs.readFileSync(\'index.html\',\'utf8\');try{new Function(' +
    's.split(\'<script>\')[1].split(\'</script>\')[0]);' +
    'console.log(\'OK\');}catch(e){console.log(\'ERROR:\',e.message);}"'
  expect(
    isSyntaxVerificationForTaskGate({
      toolName: 'Bash',
      toolInput: { command: safeInline },
    }),
  ).toBe(true)
  expect(
    isSyntaxVerificationForTaskGate({
      toolName: 'Bash',
      toolInput: { command: 'node --check game.js' },
    }),
  ).toBe(true)
  expect(
    isSyntaxVerificationForTaskGate({
      toolName: 'Bash',
      toolInput: { command: 'node --check "dir/game file.js"' },
    }),
  ).toBe(true)

  for (const command of [
    'node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"',
    `${safeInline}; touch /tmp/not-a-verification`,
    `${safeInline} > verification.txt`,
    safeInline.replace('new Function(', 'new Function(').replace(
      ');console.log(\'OK\')',
      ')();console.log(\'OK\')',
    ),
    `wc -l other.html && ${safeInline}`,
    'node --check --run test',
    'node --check game.js && touch /tmp/not-a-verification',
    'node --check "$(touch /tmp/not-a-verification)"',
    'node --check "`touch /tmp/not-a-verification`"',
    'node --check <(touch /tmp/not-a-verification)',
    'node --check >(touch /tmp/not-a-verification)',
    "node --check *(e:'touch /tmp/not-a-verification':)",
  ]) {
    expect(
      isSyntaxVerificationForTaskGate({
        toolName: 'Bash',
        toolInput: { command },
      }),
      command,
    ).toBe(false)
  }
})

test('a single loopback browser preview bypasses only the task gate', () => {
  const input = {
    command: 'open "http://localhost:8123/index.html?v=11"',
  }

  expect(
    isLocalPreviewOpenForTaskGate({
      toolName: 'Bash',
      toolInput: input,
    }),
  ).toBe(true)
  expect(
    isMutationRequiringTaskList({
      toolName: 'Bash',
      toolInput: input,
      isMutating: true,
    }),
  ).toBe(false)

  // App launch remains a side effect under Bash's permission policy. The
  // task-only classification must never become an auto-approval shortcut.
  expect(BashTool.isReadOnly?.(input as never)).toBe(false)
})

test('local preview classification fails closed for shell and URL variants', () => {
  const stillTaskGated = [
    'open "http://localhost:8123" && touch /tmp/task-gate-proof',
    'open "http://localhost:8123/$(touch /tmp/task-gate-proof)"',
    'open "http://localhost:8123/`touch /tmp/task-gate-proof`"',
    'open "https://example.com"',
    'open "./index.html"',
    'open -a Safari "http://localhost:8123"',
    'open "http://localhost:8123" > /tmp/task-gate-proof',
    'touch /tmp/task-gate-proof',
  ]

  for (const command of stillTaskGated) {
    expect(
      isMutationRequiringTaskList({
        toolName: 'Bash',
        toolInput: { command },
        isMutating: true,
      }),
      command,
    ).toBe(true)
  }

  expect(
    isMutationRequiringTaskList({
      toolName: 'Bash',
      toolInput: {
        command: 'open "http://127.0.0.1:8123"',
        _simulatedSedEdit: { filePath: '/tmp/x', newContent: 'changed' },
      },
      isMutating: true,
    }),
  ).toBe(true)
  expect(
    isMutationRequiringTaskList({
      toolName: 'Edit',
      toolInput: {
        command: 'open "http://localhost:8123"',
      },
      isMutating: true,
    }),
  ).toBe(true)
})

test('terminal and internal tasks do not permanently bypass the gate', () => {
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'pending', metadata: { _internal: true } },
    ]),
  ).toBe(0)
  expect(
    countActionableTasksForGate([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
    ]),
  ).toBe(2)
})

test('gate recovery distinguishes an absent list from an all-terminal list', () => {
  const absent = checkTaskListGate({
    toolName: 'Edit',
    taskCount: 0,
    totalTaskCount: 0,
    readsSoFar: 10,
    isSubagent: false,
    isMutating: true,
    config: CONFIG,
  })
  expect(absent.allowed).toBe(false)
  expect((absent as { reason: string }).reason).toContain(
    'No actionable task exists',
  )
  expect((absent as { reason: string }).reason).not.toContain(
    'task list exists',
  )

  const terminal = checkTaskListGate({
    toolName: 'Edit',
    taskCount: 0,
    totalTaskCount: 9,
    readsSoFar: 10,
    isSubagent: false,
    isMutating: true,
    config: CONFIG,
  })
  expect(terminal.allowed).toBe(false)
  const reason = (terminal as { reason: string }).reason
  expect(reason).toContain('task list exists')
  expect(reason).toContain('every tracked task is terminal')
  expect(reason).toContain('TaskCreate')
  expect(reason).toContain('TaskUpdate')
  expect(reason).toContain('pending/in_progress')
  expect(reason).toContain(
    'do not mark that task complete before the check',
  )
})

test('headless TodoWrite plans open the same mutation gate as task-v2 plans', () => {
  expect(
    countActionableTodosForGate([
      { status: 'completed' },
      { status: 'pending' },
      { status: 'in_progress' },
    ]),
  ).toBe(2)
  expect(countActionableTodosForGate([])).toBe(0)

  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const counter = source.slice(source.indexOf('async function countTasksForGate'))
  expect(counter.slice(0, 900)).toContain('isTodoV2Enabled')
  expect(counter.slice(0, 900)).toContain('countActionableTodosForGate')
})

test('an unreadable task store fails closed for mutations', () => {
  const decision = checkTaskListGate({
    toolName: 'Write',
    taskCount: null,
    readsSoFar: 99,
    isSubagent: false,
    isMutating: true,
    config: CONFIG,
  })
  expect(decision.allowed).toBe(false)
  expect((decision as { reason: string }).reason).toContain(
    'could not be read',
  )
})

test('an unreadable task store fails closed even during the free-call allowance', () => {
  expect(
    checkTaskListGate({
      toolName: 'Write',
      taskCount: null,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('delegating to an agent is classified as potentially mutating', () => {
  expect(AgentTool.isReadOnly({} as never)).toBe(false)
  expect(
    checkTaskListGate({
      toolName: 'Agent',
      taskCount: 0,
      readsSoFar: 0,
      isSubagent: false,
      isMutating: true,
      config: CONFIG,
    }).allowed,
  ).toBe(false)
})

test('disabling it restores advisory behaviour', () => {
  expect(
    checkTaskListGate({
      toolName: 'Bash',
      taskCount: 0,
      readsSoFar: 99,
      isSubagent: false,
      config: { enabled: false, freeReads: 0 },
    }).allowed,
  ).toBe(true)
})

test('defaults are on, with room for a trivial request', () => {
  expect(TASK_LIST_GATE_DEFAULTS.enabled).toBe(true)
  expect(TASK_LIST_GATE_DEFAULTS.freeReads).toBeGreaterThan(0)
})

test('the allowance counts tool calls, not conversation length', () => {
  // Shipped counting messages, so any back-and-forth exhausted the allowance
  // and the gate blocked the first Write of a one-file request — the case the
  // allowance exists to let through.
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const call = source.slice(source.indexOf('checkTaskListGate({'))
  expect(call.slice(0, 700)).toContain('countToolCalls')
  expect(call.slice(0, 700)).not.toContain('messages?.length')
})

test('countToolCalls ignores plain conversation', () => {
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current', content: [] },
  } as never
  expect(
    countToolCallsBeforeCurrent(
      [
        { type: 'user', message: { content: 'hello' } },
        {
          type: 'assistant',
          message: { id: 'earlier', content: [{ type: 'text', text: 'hi' }] },
        },
      ],
      assistantMessage,
      'not-present',
    ),
  ).toBe(0)
})

test('parallel calls in one response consume the allowance by ordinal', () => {
  const blocks = Array.from({ length: 4 }, (_, index) => ({
    type: 'tool_use' as const,
    id: `mutation-${index}`,
    name: 'Write',
    input: {},
  }))
  const assistantMessage = {
    type: 'assistant',
    message: { id: 'current-batch', content: blocks },
  } as never
  const counts = blocks.map(block =>
    countToolCallsBeforeCurrent([], assistantMessage, block.id),
  )
  expect(counts).toEqual([0, 1, 2, 3])
  expect(
    blocks.map(block =>
      countToolCallsBeforeCurrent(
        [assistantMessage],
        assistantMessage,
        block.id,
      ),
    ),
  ).toEqual([0, 1, 2, 3])
  expect(
    counts.map(
      readsSoFar =>
        checkTaskListGate({
          toolName: 'Write',
          taskCount: 0,
          readsSoFar,
          isSubagent: false,
          isMutating: true,
          config: CONFIG,
        }).allowed,
    ),
  ).toEqual([true, true, true, false])
})

test('an unreadable task directory cannot silently open the mutation gate', () => {
  const source = readFileSync(
    'src/services/tools/toolExecution.ts',
    'utf8',
  )
  const start = source.indexOf('async function countTasksForGate')
  const end = source.indexOf('\nfunction getStopHookInfo', start)
  const fn = source.slice(start, end)
  expect(fn).toContain('catch {\n    return null')
  expect(fn).not.toContain('POSITIVE_INFINITY')
})
