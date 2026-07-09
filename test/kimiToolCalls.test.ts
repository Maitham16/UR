import { expect, test } from 'bun:test'
import {
  parseBareJsonToolCalls,
  parseClarifyingQuestions,
  parseTextToolCalls,
  reconcileToolName,
  synthesizeKimiToolCalls,
} from '../src/cli/transports/kimiToolCalls.ts'

const TOOLSET = new Set([
  'AskUserQuestion',
  'WebSearch',
  'Bash',
  'FileEdit',
  'ToolSearch',
])

test('reconcileToolName keeps an exact tool name', () => {
  expect(reconcileToolName('AskUserQuestion', TOOLSET)).toBe('AskUserQuestion')
  expect(reconcileToolName('Bash', TOOLSET)).toBe('Bash')
})

test('reconcileToolName strips leaked junk glued before a real name', () => {
  // The reported bug: a leaked token "indígen" fused onto the tool name made the
  // call match no tool, so the AskUserQuestion picker dumped raw JSON instead.
  expect(reconcileToolName('indígenAskUserQuestion', TOOLSET)).toBe(
    'AskUserQuestion',
  )
  expect(reconcileToolName('to=WebSearch', TOOLSET)).toBe('WebSearch')
})

test('reconcileToolName strips functions. prefix and index suffix', () => {
  expect(reconcileToolName('functions.WebSearch', TOOLSET)).toBe('WebSearch')
  expect(reconcileToolName('AskUserQuestion:0', TOOLSET)).toBe('AskUserQuestion')
})

test('reconcileToolName matches case-insensitively', () => {
  expect(reconcileToolName('askuserquestion', TOOLSET)).toBe('AskUserQuestion')
})

test('reconcileToolName prefers the longest affix match', () => {
  // "ToolSearch" must not collapse to a shorter "...Search" when both exist.
  expect(reconcileToolName('xToolSearch', TOOLSET)).toBe('ToolSearch')
})

test('reconcileToolName leaves unknown names cleaned but unchanged', () => {
  expect(reconcileToolName('TotallyUnknownTool', TOOLSET)).toBe(
    'TotallyUnknownTool',
  )
  expect(reconcileToolName('AskUserQuestion', undefined)).toBe('AskUserQuestion')
})

test('bare TaskCreate JSON is converted when the tool is available', () => {
  const result = parseBareJsonToolCalls(
    'Planning\n{"subject":"Create project structure","description":"Set up HTML, CSS, and JS files"}\nNext\n',
    {
      availableToolNames: new Set(['TaskCreate']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('Planning\nNext\n')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('TaskCreate')
  expect(result.toolCalls[0]!.input).toEqual({
    subject: 'Create project structure',
    description: 'Set up HTML, CSS, and JS files',
  })
})

test('bare AskUserQuestion JSON is converted and normalized', () => {
  const result = parseTextToolCalls(
    'The directory is empty, so I have choices to confirm first.\n{"questions":[{"question":"What technology stack do you prefer?","options":[{"label":"HTML5 Canvas + plain JavaScript (no build step, runs directly in browser)","value":"canvas-vanilla","description":"Single index.html and game.js. Fastest to run and simplest to understand."},{"label":"HTML5 Canvas + TypeScript with a small build","value":"canvas-ts","description":"Uses Vite or esbuild. Better typed but requires npm install and build."},{"label":"Phaser 3 JavaScript","value":"phaser-js","description":"Popular game framework. More features, but external dependency."}]},{"question":"Which platformer features should the level include?","options":[{"label":"Mario-style basics only: run, jump, platforms, coins, enemies, flagpole end","value":"basic"},{"label":"Add power-ups (mushroom/fire flower), pits, and a boss at the end","value":"advanced"}],"multiSelect":false},{"question":"Do you want this to be desktop-only or also support mobile touch controls?","options":[{"label":"Desktop keyboard only","value":"desktop"},{"label":"Desktop + on-screen touch controls for mobile","value":"mobile"}]}]}',
    {
      availableToolNames: new Set(['AskUserQuestion']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('The directory is empty, so I have choices to confirm first.\n')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('AskUserQuestion')
  expect(result.toolCalls[0]!.input).toEqual({
    questions: [
      {
        question: 'What technology stack do you prefer?',
        header: 'technology',
        options: [
          {
            label: 'HTML5 Canvas + plain JavaScript (no build step, runs directly in browser)',
            description: 'Single index.html and game.js. Fastest to run and simplest to understand.',
          },
          {
            label: 'HTML5 Canvas + TypeScript with a small build',
            description: 'Uses Vite or esbuild. Better typed but requires npm install and build.',
          },
          {
            label: 'Phaser 3 JavaScript',
            description: 'Popular game framework. More features, but external dependency.',
          },
        ],
      },
      {
        question: 'Which platformer features should the level include?',
        header: 'platformer',
        options: [
          {
            label: 'Mario-style basics only: run, jump, platforms, coins, enemies, flagpole end',
            description: 'Mario-style basics only: run, jump, platforms, coins, enemies, flagpole end',
          },
          {
            label: 'Add power-ups (mushroom/fire flower), pits, and a boss at the end',
            description: 'Add power-ups (mushroom/fire flower), pits, and a boss at the end',
          },
        ],
        multiSelect: false,
      },
      {
        question: 'Do you want this to be desktop-only or also support mobile touch controls?',
        header: 'desktop',
        options: [
          {
            label: 'Desktop keyboard only',
            description: 'Desktop keyboard only',
          },
          {
            label: 'Desktop + on-screen touch controls for mobile',
            description: 'Desktop + on-screen touch controls for mobile',
          },
        ],
      },
    ],
  })
})

test('bare AskUserQuestion JSON accepts prompt aliases and missing descriptions', () => {
  const result = parseTextToolCalls(
    'Let me clarify what you want.\n{"questions":[{"prompt":"Which game should I build from \\"Mario egg\\"?","options":[{"label":"Platformer"},{"label":"Egg puzzle"},{"label":"Pet sim"}]},{"text":"Which visual style should I use?","options":[{"label":"Pixel art"},{"label":"Cartoon"},{"label":"Minimal"}]}]}',
    {
      availableToolNames: new Set(['AskUserQuestion']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('Let me clarify what you want.\n')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('AskUserQuestion')
  expect(result.toolCalls[0]!.input).toEqual({
    questions: [
      {
        question: 'Which game should I build from "Mario egg"?',
        header: 'game',
        options: [
          { label: 'Platformer', description: 'Platformer' },
          { label: 'Egg puzzle', description: 'Egg puzzle' },
          { label: 'Pet sim', description: 'Pet sim' },
        ],
      },
      {
        question: 'Which visual style should I use?',
        header: 'visual',
        options: [
          { label: 'Pixel art', description: 'Pixel art' },
          { label: 'Cartoon', description: 'Cartoon' },
          { label: 'Minimal', description: 'Minimal' },
        ],
      },
    ],
  })
})

test('remote transport synthesizes bare AskUserQuestion JSON into a tool use', () => {
  const message = {
    message: {
      content: [
        {
          type: 'text',
          text: 'The directory is empty, so I have choices to confirm first.\n{"questions":[{"question":"What technology stack do you prefer?","options":[{"label":"HTML5 Canvas + plain JavaScript","value":"canvas-vanilla","description":"Single index.html and game.js."},{"label":"Phaser 3 JavaScript","value":"phaser-js","description":"Popular game framework."}]}]}',
        },
      ],
      stop_reason: 'end_turn',
    },
  }

  synthesizeKimiToolCalls(message)

  expect(message.message.stop_reason).toBe('tool_use')
  expect(message.message.content).toHaveLength(2)
  expect(message.message.content[0]).toEqual({
    type: 'text',
    text: 'The directory is empty, so I have choices to confirm first.\n',
  })
  expect(message.message.content[1]).toMatchObject({
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'What technology stack do you prefer?',
          header: 'technology',
          options: [
            {
              label: 'HTML5 Canvas + plain JavaScript',
              description: 'Single index.html and game.js.',
            },
            {
              label: 'Phaser 3 JavaScript',
              description: 'Popular game framework.',
            },
          ],
        },
      ],
    },
  })
})

test('bare Bash Read and TaskUpdate JSON objects are recovered separately', () => {
  const result = parseTextToolCalls(
    `Now let me run the syntax check on the rewritten game.js and verify all files.\n\n  {"command":"node --check /Users/maith/Desktop/mario_v1/game.js","description":"Check rewritten game.js syntax"}\n\n  {"file_path":"/Users/maith/Desktop/mario_v1/index.html"}\n\n  {"file_path":"/Users/maith/Desktop/mario_v1/style.css"}\nLet me run the final syntax check and mark the tasks complete.\n\n  {"command":"node --check /Users/maith/Desktop/mario_v1/game.js","description":"Final syntax check on game.js"}\n\n  {"taskId":"6","status":"completed"}\n\n  {"taskId":"7","status":"completed"}\n\n  {"taskId":"8","status":"completed"}\n\n  {"command":"node --check /Users/maith/Desktop/mario_v1/game.js","description":"Final syntax check on game.js"}\n\n  {"taskId":"6","status":"completed"}\n\n  {"taskId":"7","status":"completed"}\n\n  {"taskId":"8","status":"completed"}`,
    {
      availableToolNames: new Set(['Bash', 'Read', 'TaskUpdate']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe(
    'Now let me run the syntax check on the rewritten game.js and verify all files.\n\nLet me run the final syntax check and mark the tasks complete.\n\n',
  )
  expect(result.toolCalls.map(call => call.name)).toEqual([
    'Bash',
    'Read',
    'Read',
    'Bash',
    'TaskUpdate',
    'TaskUpdate',
    'TaskUpdate',
    'Bash',
    'TaskUpdate',
    'TaskUpdate',
    'TaskUpdate',
  ])
  expect(result.toolCalls[0]!.input).toEqual({
    command: 'node --check /Users/maith/Desktop/mario_v1/game.js',
    description: 'Check rewritten game.js syntax',
  })
  expect(result.toolCalls[1]!.input).toEqual({
    file_path: '/Users/maith/Desktop/mario_v1/index.html',
  })
  expect(result.toolCalls[2]!.input).toEqual({
    file_path: '/Users/maith/Desktop/mario_v1/style.css',
  })
  expect(result.toolCalls[4]!.input).toEqual({
    taskId: '6',
    status: 'completed',
  })
})

test('remote transport synthesizes bare Bash Read and TaskUpdate JSON into tool uses', () => {
  const message = {
    message: {
      content: [
        {
          type: 'text',
          text: 'Verify files.\n{"command":"node --check /Users/maith/Desktop/mario_v1/game.js","description":"Final syntax check on game.js"}\n{"file_path":"/Users/maith/Desktop/mario_v1/index.html"}\n{"taskId":"6","status":"completed"}',
        },
      ],
      stop_reason: 'end_turn',
    },
  }

  synthesizeKimiToolCalls(message)

  expect(message.message.stop_reason).toBe('tool_use')
  expect(message.message.content).toHaveLength(4)
  expect(message.message.content[0]).toEqual({
    type: 'text',
    text: 'Verify files.\n',
  })
  expect(message.message.content.slice(1).map(block => (block as { name?: string }).name)).toEqual([
    'Bash',
    'Read',
    'TaskUpdate',
  ])
})

test('bare Write JSON is converted when the tool is available', () => {
  const result = parseBareJsonToolCalls(
    '{"file_path":"/tmp/game.js","content":"const title = \\"Mario\\";\\nconsole.log(title);"}\n',
    {
      availableToolNames: new Set(['Write']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('Write')
  expect(result.toolCalls[0]!.input).toEqual({
    file_path: '/tmp/game.js',
    content: 'const title = "Mario";\nconsole.log(title);',
  })
})

test('loose Write JSON with unescaped content quotes is recovered', () => {
  const result = parseBareJsonToolCalls(
    '{"file_path":"/tmp/package.json","content":"{\\n  "name": "mario-one-level"\\n}"}\n',
    {
      availableToolNames: new Set(['Write']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.input).toEqual({
    file_path: '/tmp/package.json',
    content: '{\n  "name": "mario-one-level"\n}',
  })
})

test('multiline loose Write JSON is recovered as one tool call', () => {
  const result = parseBareJsonToolCalls(
    `{"file_path": "/tmp/mario.html", "content": "\\n<html lang="en">\\n<style>\\nbody { margin: 0; }\\ncanvas { width: 960px; }\\n</style>\\n<script>\\nconst level = { width: 320 };\\nfunction draw() { ctx.fillRect(0, 0, 1, 1); }\\n</script>\\n"}`,
    {
      availableToolNames: new Set(['Write']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('')
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('Write')
  expect(result.toolCalls[0]!.input).toEqual({
    file_path: '/tmp/mario.html',
    content:
      '\n<html lang="en">\n<style>\nbody { margin: 0; }\ncanvas { width: 960px; }\n</style>\n<script>\nconst level = { width: 320 };\nfunction draw() { ctx.fillRect(0, 0, 1, 1); }\n</script>\n',
  })
})

test('multiline loose Write JSON after prose is recovered', () => {
  const result = parseTextToolCalls(
    `Approved. I'll create the game now.\n{"file_path": "/tmp/mario.html", "content": "\\n<html lang="en">\\n<style>\\nbody { margin: 0; }\\n</style>\\n"}`,
    {
      availableToolNames: new Set(['Write']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe("Approved. I'll create the game now.\n")
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('Write')
  expect(result.toolCalls[0]!.input.file_path).toBe('/tmp/mario.html')
})

test('remote transport synthesizes bare Write JSON into a tool use', () => {
  const message = {
    message: {
      content: [
        {
          type: 'text',
          text: `Approved. I'll create the game now.\n{"file_path": "/tmp/mario.html", "content": "\\n<html lang="en">\\n<style>\\nbody { margin: 0; }\\n</style>\\n"}`,
        },
      ],
      stop_reason: 'end_turn',
    },
  }

  synthesizeKimiToolCalls(message)

  expect(message.message.stop_reason).toBe('tool_use')
  expect(message.message.content).toHaveLength(2)
  expect(message.message.content[0]).toEqual({
    type: 'text',
    text: "Approved. I'll create the game now.\n",
  })
  expect(message.message.content[1]).toMatchObject({
    type: 'tool_use',
    name: 'Write',
    input: {
      file_path: '/tmp/mario.html',
      content: '\n<html lang="en">\n<style>\nbody { margin: 0; }\n</style>\n',
    },
  })
})

test('loose Edit JSON after prose is recovered', () => {
  const result = parseTextToolCalls(
    `I'll fix it now.\n{"replace_all":false,"file_path":"/tmp/index.html","old_string":"const title = "Mario";\\ncoins.push({ x: 1 });","new_string":"const title = "Mario";\\ncoinObjects.push({ x: 1 });"}`,
    {
      availableToolNames: new Set(['Edit']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe("I'll fix it now.\n")
  expect(result.toolCalls).toHaveLength(1)
  expect(result.toolCalls[0]!.name).toBe('Edit')
  expect(result.toolCalls[0]!.input).toEqual({
    replace_all: false,
    file_path: '/tmp/index.html',
    old_string: 'const title = "Mario";\ncoins.push({ x: 1 });',
    new_string: 'const title = "Mario";\ncoinObjects.push({ x: 1 });',
  })
})

test('multiple bare Edit JSON objects after prose are recovered separately', () => {
  const result = parseTextToolCalls(
    `I'll use Edit for each.\n\n  {"replace_all": false, "file_path": "/Users/maith/Desktop/mario_v1/game.js", "old_string": "  let cameraX = 0;\\n  let score = 0;", "new_string": "  let cameraX = 0;\\n  let cameraY = 0;\\n  let score = 0;"}\n\n  {"replace_all": false, "file_path": "/Users/maith/Desktop/mario_v1/game.js", "old_string": "  function updateCamera() {\\n    const targetX = player.x - VIEW_W * 0.35;\\n    cameraX += (targetX - cameraX) * 0.12;\\n    const maxCam = mapWidth * TILE - VIEW_W;\\n    cameraX = Math.max(0, Math.min(cameraX, maxCam));\\n  }", "new_string": "  function updateCamera() {\\n    const targetX = player.x - VIEW_W * 0.35;\\n    cameraX += (targetX - cameraX) * 0.12;\\n    const maxCamX = mapWidth * TILE - VIEW_W;\\n    cameraX = Math.max(0, Math.min(cameraX, maxCamX));\\n\\n    const targetY = player.y - VIEW_H * 0.45;\\n    cameraY += (targetY - cameraY) * 0.1;\\n    const maxCamY = mapHeight * TILE - VIEW_H;\\n    cameraY = Math.max(0, Math.min(cameraY, maxCamY));\\n  }"}\n\n  {"replace_all": false, "file_path": "/Users/maith/Desktop/mario_v1/game.js", "old_string": "    ctx.save();\\n    ctx.translate(-Math.round(cameraX), 0);", "new_string": "    ctx.save();\\n    ctx.translate(-Math.round(cameraX), -Math.round(cameraY));"}\n\n  {"replace_all": false, "file_path": "/Users/maith/Desktop/mario_v1/game.js", "old_string": "    player.invincible = 0;\\n    cameraX = 0;\\n    timeLeft = WORLD_TIME;", "new_string": "    player.invincible = 0;\\n    cameraX = 0;\\n    cameraY = 0;\\n    timeLeft = WORLD_TIME;"}`,
    {
      availableToolNames: new Set(['Edit']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe("I'll use Edit for each.\n\n")
  expect(result.toolCalls).toHaveLength(4)
  expect(result.toolCalls.map(call => call.name)).toEqual(['Edit', 'Edit', 'Edit', 'Edit'])
  expect(result.toolCalls[0]!.input).toEqual({
    replace_all: false,
    file_path: '/Users/maith/Desktop/mario_v1/game.js',
    old_string: '  let cameraX = 0;\n  let score = 0;',
    new_string: '  let cameraX = 0;\n  let cameraY = 0;\n  let score = 0;',
  })
  expect(result.toolCalls[1]!.input).toMatchObject({
    replace_all: false,
    file_path: '/Users/maith/Desktop/mario_v1/game.js',
    old_string: '  function updateCamera() {\n    const targetX = player.x - VIEW_W * 0.35;\n    cameraX += (targetX - cameraX) * 0.12;\n    const maxCam = mapWidth * TILE - VIEW_W;\n    cameraX = Math.max(0, Math.min(cameraX, maxCam));\n  }',
  })
  expect(result.toolCalls[2]!.input).toEqual({
    replace_all: false,
    file_path: '/Users/maith/Desktop/mario_v1/game.js',
    old_string: '    ctx.save();\n    ctx.translate(-Math.round(cameraX), 0);',
    new_string: '    ctx.save();\n    ctx.translate(-Math.round(cameraX), -Math.round(cameraY));',
  })
  expect(result.toolCalls[3]!.input).toEqual({
    replace_all: false,
    file_path: '/Users/maith/Desktop/mario_v1/game.js',
    old_string: '    player.invincible = 0;\n    cameraX = 0;\n    timeLeft = WORLD_TIME;',
    new_string: '    player.invincible = 0;\n    cameraX = 0;\n    cameraY = 0;\n    timeLeft = WORLD_TIME;',
  })
})

test('remote transport synthesizes bare Edit JSON into a tool use', () => {
  const message = {
    message: {
      content: [
        {
          type: 'text',
          text: `I'll fix it now.\n{"replace_all":false,"file_path":"/tmp/index.html","old_string":"let coins = [];\\ncoins.push({ x: 1 });","new_string":"let coinObjects = [];\\ncoinObjects.push({ x: 1 });"}`,
        },
      ],
      stop_reason: 'end_turn',
    },
  }

  synthesizeKimiToolCalls(message)

  expect(message.message.stop_reason).toBe('tool_use')
  expect(message.message.content).toHaveLength(2)
  expect(message.message.content[0]).toEqual({
    type: 'text',
    text: "I'll fix it now.\n",
  })
  expect(message.message.content[1]).toMatchObject({
    type: 'tool_use',
    name: 'Edit',
    input: {
      replace_all: false,
      file_path: '/tmp/index.html',
      old_string: 'let coins = [];\ncoins.push({ x: 1 });',
      new_string: 'let coinObjects = [];\ncoinObjects.push({ x: 1 });',
    },
  })
})

test('bare JSON remains text when the matching tool is unavailable', () => {
  const text =
    '{"file_path":"/tmp/game.js","content":"console.log(1)"}\n'
  const result = parseBareJsonToolCalls(text, {
    availableToolNames: new Set(['TaskCreate']),
    parseBareJsonToolCalls: true,
  })

  expect(result.text).toBe(text)
  expect(result.toolCalls).toHaveLength(0)
})

test('Kimi markup and bare JSON are both parsed', () => {
  const result = parseTextToolCalls(
    '<|tool_call_begin|>functions.Write:0<|tool_call_argument_begin|>{"file_path":"/tmp/a.js","content":"a"}<|tool_call_end|>\n{"file_path":"/tmp/b.js","content":"b"}\n',
    {
      availableToolNames: new Set(['Write']),
      parseBareJsonToolCalls: true,
    },
  )

  expect(result.text).toBe('')
  expect(result.toolCalls.map(call => call.name)).toEqual(['Write', 'Write'])
  expect(result.toolCalls.map(call => call.input.file_path)).toEqual([
    '/tmp/a.js',
    '/tmp/b.js',
  ])
})

const ASK = new Set(['AskUserQuestion'])

function labels(call: ReturnType<typeof parseClarifyingQuestions>) {
  const questions = (call!.input.questions as Array<{
    question: string
    options: Array<{ label: string }>
  }>)
  return questions.map(q => ({
    question: q.question,
    options: q.options.map(o => o.label),
  }))
}

test('plain-prose numbered clarifying questions synthesize an AskUserQuestion', () => {
  const text = [
    '1. What technology? Python with Pygame is the simplest. Or do you want JavaScript/HTML5, Unity, Godot, or something else?',
    '2. What should be in the game? Just run/jump and a level? Or also coins, enemies, flagpole, multiple levels, sound?',
  ].join('\n')

  const call = parseClarifyingQuestions(text, { availableToolNames: ASK })
  expect(call).not.toBeNull()
  expect(call!.name).toBe('AskUserQuestion')
  expect(labels(call)).toEqual([
    {
      question: 'What technology?',
      options: ['Python with Pygame', 'JavaScript/HTML5', 'Unity', 'Godot'],
    },
    {
      question: 'What should be in the game?',
      options: [
        'run/jump and a level',
        'coins, enemies, flagpole, multiple levels, sound',
      ],
    },
  ])
})

test('inline-option single question synthesizes options from the question clause', () => {
  const call = parseClarifyingQuestions(
    'Should I use TypeScript or JavaScript?',
    { availableToolNames: ASK },
  )
  expect(call).not.toBeNull()
  expect(labels(call)).toEqual([
    { question: 'Should I use TypeScript or JavaScript?', options: ['TypeScript', 'JavaScript'] },
  ])
})

test('every synthesized option has a description and a short header', () => {
  const call = parseClarifyingQuestions(
    'Which database? Postgres, MySQL, or SQLite?',
    { availableToolNames: ASK },
  )
  const questions = call!.input.questions as Array<{
    header: string
    options: Array<{ label: string; description: string }>
  }>
  expect(questions[0]!.header.length).toBeLessThanOrEqual(12)
  for (const opt of questions[0]!.options) {
    expect(opt.description).toBe(opt.label)
  }
})

test('no synthesis when AskUserQuestion is unavailable', () => {
  expect(
    parseClarifyingQuestions('Pick A, B, or C?', {
      availableToolNames: new Set(['Bash']),
    }),
  ).toBeNull()
})

test('no synthesis for a yes/no question with no concrete options', () => {
  expect(
    parseClarifyingQuestions('Done. Want me to add tests too?', {
      availableToolNames: ASK,
    }),
  ).toBeNull()
})

test('no synthesis when the turn does not end on a question', () => {
  expect(
    parseClarifyingQuestions(
      'I can use Python, Ruby, or Go. I will start now.',
      { availableToolNames: ASK },
    ),
  ).toBeNull()
})

test('no synthesis when the turn contains a code block', () => {
  expect(
    parseClarifyingQuestions(
      'Use one of these?\n```\nnpm i a or b\n```\nWhich, a or b?',
      { availableToolNames: ASK },
    ),
  ).toBeNull()
})

// --- Regression: Kimi-marker tool calls with almost-JSON arguments.
// Local models emit raw newlines inside JSON string values; parseArgs used to
// silently return {} which executed Write with empty input and failed
// validation with "required parameter `file_path` is missing".

test('kimi-format call with raw newlines in content is repaired, not emptied', () => {
  const text =
    '<|tool_call_begin|>Write<|tool_call_argument_begin|>' +
    '{"file_path": "/home/u/tests/__init__.py", "content": "line1\nline2\n"}' +
    '<|tool_call_end|>'
  const { toolCalls } = parseTextToolCalls(text, {
    availableToolNames: new Set(['Write']),
  })
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]?.name).toBe('Write')
  expect(toolCalls[0]?.input).toEqual({
    file_path: '/home/u/tests/__init__.py',
    content: 'line1\nline2\n',
  })
})

test('bare JSON write call with raw newlines and trailing comma is repaired', () => {
  const text =
    '{"file_path": "/tmp/a.py", "content": "import os\nprint(1)\n",}'
  const { toolCalls } = parseBareJsonToolCalls(text, {
    availableToolNames: new Set(['Write']),
    parseBareJsonToolCalls: true,
  })
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]?.name).toBe('Write')
  expect(toolCalls[0]?.input.content).toBe('import os\nprint(1)\n')
})

test('bare JSON write call with a hallucinated extra key is recognized and stripped', () => {
  const text =
    '{"file_path": "/tmp/a.py", "content": "print(1)", "encoding": "utf-8"}'
  const { toolCalls } = parseBareJsonToolCalls(text, {
    availableToolNames: new Set(['Write']),
    parseBareJsonToolCalls: true,
  })
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0]?.name).toBe('Write')
  expect(toolCalls[0]?.input).toEqual({
    file_path: '/tmp/a.py',
    content: 'print(1)',
  })
})

test('objects with many unknown keys are not misparsed as Write calls', () => {
  const text =
    '{"file_path": "/tmp/a.py", "content": "x", "a": 1, "b": 2, "c": 3}'
  const { toolCalls } = parseBareJsonToolCalls(text, {
    availableToolNames: new Set(['Write']),
    parseBareJsonToolCalls: true,
  })
  expect(toolCalls).toHaveLength(0)
})
