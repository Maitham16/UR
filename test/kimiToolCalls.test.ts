import { expect, test } from 'bun:test'
import {
  parseBareJsonToolCalls,
  parseTextToolCalls,
} from '../src/cli/transports/kimiToolCalls.ts'
import { synthesizeKimiToolCalls } from '../src/cli/transports/ccrClient.ts'

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
  expect(message.message.content.slice(1).map(block => block.name)).toEqual([
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
