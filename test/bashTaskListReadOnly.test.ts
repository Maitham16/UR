import { expect, test } from 'bun:test'
import { BashTool } from '../src/tools/BashTool/BashTool.tsx'
import { isBashTaskListReadOnly } from '../src/tools/BashTool/taskListReadOnly.ts'

const REPORTED_PROBE =
  'node --version 2>/dev/null; ' +
  'python3 -c "import http.server" 2>&1 | head -1; ' +
  'which npx 2>/dev/null'

test('task tracking distinguishes observational Bash from auto-approval', () => {
  expect(isBashTaskListReadOnly({ command: REPORTED_PROBE })).toBe(true)
  expect(
    BashTool.isTaskListReadOnly?.({ command: REPORTED_PROBE } as never),
  ).toBe(true)

  // Interpreter startup remains executable for permission, sandbox,
  // concurrency, and read-only planning-agent decisions.
  expect(BashTool.isReadOnly({ command: REPORTED_PROBE } as never)).toBe(false)
  expect(
    BashTool.isConcurrencySafe({ command: REPORTED_PROBE } as never),
  ).toBe(false)
})

test('capability probing is generic rather than module-specific', () => {
  for (const command of [
    'python -c "import json"',
    'python3.13 -c "import sqlite3 as db, pathlib"',
    "python3 -c 'from importlib import util'",
    'python3 -c "import json; from pathlib import Path"',
    'ruby --version',
    '/opt/tools/custom-runtime --help',
    'node --version; python3 -c "import email.parser"; command -v npm',
  ]) {
    expect(isBashTaskListReadOnly({ command }), command).toBe(true)
  }
})

test('task-list Bash classification fails closed on implementation work', () => {
  for (const command of [
    'python3 -c "from pathlib import Path; Path(\'x\').write_text(\'y\')"',
    'python3 -c "import http.server; open(\'probe.txt\', \'w\')"',
    'python3 -c "print(\'hello\')"',
    'node -e "require(\'fs\').writeFileSync(\'x\', \'y\')"',
    'touch output.txt',
    'ruby --version > runtime-version.txt',
    `${REPORTED_PROBE}; rm -f output.txt`,
    'python3 -c "import http.server" > probe.txt',
  ]) {
    expect(isBashTaskListReadOnly({ command }), command).toBe(false)
  }

  for (const extraInput of [
    { run_in_background: true },
    { dangerouslyDisableSandbox: true },
    { _simulatedSedEdit: { filePath: 'x', newContent: 'y' } },
  ]) {
    expect(
      isBashTaskListReadOnly({
        command: REPORTED_PROBE,
        ...extraInput,
      }),
    ).toBe(false)
  }
})
