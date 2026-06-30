/**
 * Built-in public benchmark suites for UR.
 *
 * These are small, self-contained eval suites designed to run safely in a
 * fresh worktree. They cover bug fixing, refactoring, test generation,
 * Docker repair, TypeScript migration, and Python package repair.
 */

import { join } from 'node:path'
import { evalsDir, saveSuite, type EvalSuite } from './evals.js'

export type BuiltinSuiteId =
  | 'bug-fix'
  | 'refactor'
  | 'test-gen'
  | 'docker-repair'
  | 'ts-migrate'
  | 'py-package-repair'

const BUILTIN_SUITE_IDS: BuiltinSuiteId[] = [
  'bug-fix',
  'refactor',
  'test-gen',
  'docker-repair',
  'ts-migrate',
  'py-package-repair',
]

const BUILTIN_SUITES: Record<BuiltinSuiteId, EvalSuite> = {
  'bug-fix': {
    version: 1,
    name: 'builtin-bug-fix',
    description:
      'Small bug-fixing benchmark. Each case asks UR to fix a known defect in a fresh worktree and verify with a test command.',
    cases: [
      {
        id: 'off-by-one',
        category: 'bug-fix',
        prompt:
          "You are in a fresh TypeScript repo. Create src/findIndex.ts containing a function that returns the index of a target in an array. It currently returns -1 for the last element because the loop stops too early. Fix the off-by-one bug, add a test file src/findIndex.test.ts using your preferred runner, and run the tests. Finish with VERDICT: PASS if tests pass, otherwise VERDICT: FAIL.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls findIndex.ts findIndex.test.ts && echo present)',
        },
      },
      {
        id: 'null-guard',
        category: 'bug-fix',
        prompt:
          "You are in a fresh JavaScript repo. Create src/greet.js with a greet(name) function. It currently crashes when name is null/undefined because it calls name.toUpperCase(). Add a null guard so it returns 'Hello, stranger' for missing input. Add a test file and run it. Finish with VERDICT: PASS if tests pass.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls greet.js greet.test.js && echo present)',
        },
      },
      {
        id: 'missing-await',
        category: 'bug-fix',
        prompt:
          'You are in a fresh TypeScript repo. Create src/fetcher.ts with an async fetchData() function that forgets to await a Promise, returning the Promise object instead of the resolved value. Fix it, add a test using a mocked Promise, and run the tests. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls fetcher.ts fetcher.test.ts && echo present)',
        },
      },
    ],
  },
  refactor: {
    version: 1,
    name: 'builtin-refactor',
    description:
      'Small refactoring benchmark. Each case asks UR to clean up code in a fresh worktree and keep tests green.',
    cases: [
      {
        id: 'extract-function',
        category: 'refactor',
        prompt:
          'You are in a fresh TypeScript repo. Create src/checkout.ts with a long calculateTotal(price, quantity, tax, discount) function that mixes subtotal, tax, and discount math inline. Refactor it by extracting helper functions (subtotal, taxAmount, discountAmount) while preserving behavior. Add tests and run them. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls checkout.ts checkout.test.ts && echo present)',
        },
      },
      {
        id: 'rename-fields',
        category: 'refactor',
        prompt:
          'You are in a fresh TypeScript repo. Create src/user.ts with an interface using abbreviated field names (fn, ln, em). Refactor to readable names (firstName, lastName, email) and update a small usage file. Add tests and run them. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls user.ts user.test.ts && echo present)',
        },
      },
      {
        id: 'remove-duplication',
        category: 'refactor',
        prompt:
          'You are in a fresh JavaScript repo. Create src/validators.js with three form validation functions that duplicate the same empty-check logic. Refactor to share a single isEmpty helper. Add tests and run them. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls validators.js validators.test.js && echo present)',
        },
      },
    ],
  },
  'test-gen': {
    version: 1,
    name: 'builtin-test-gen',
    description:
      'Small test-generation benchmark. Each case asks UR to read existing code and add tests.',
    cases: [
      {
        id: 'calc-tests',
        category: 'test-gen',
        prompt:
          'You are in a fresh TypeScript repo. Create src/calc.ts with add(a,b), subtract(a,b), multiply(a,b), and divide(a,b). Ask UR to read the file and add tests in src/calc.test.ts that cover normal cases, division by zero, and at least one negative-number case. Run the tests. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls calc.ts calc.test.ts && echo present)',
        },
      },
      {
        id: 'string-utils-tests',
        category: 'test-gen',
        prompt:
          'You are in a fresh JavaScript repo. Create src/strings.js with slugify(text) and truncate(text, max). Ask UR to add tests in src/strings.test.js covering empty strings, long strings, and non-alphanumeric input. Run the tests. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls strings.js strings.test.js && echo present)',
        },
      },
      {
        id: 'async-tests',
        category: 'test-gen',
        prompt:
          'You are in a fresh TypeScript repo. Create src/cache.ts with an async getOrFetch(key, fetcher) cache. Ask UR to add tests in src/cache.test.ts using mocked fetchers and covering cache hits, misses, and errors. Run the tests. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cd src && (ls cache.ts cache.test.ts && echo present)',
        },
      },
    ],
  },
  'docker-repair': {
    version: 1,
    name: 'builtin-docker-repair',
    description:
      'Small Docker repair benchmark. Each case asks UR to fix a broken Dockerfile in a fresh worktree.',
    cases: [
      {
        id: 'base-image-typo',
        category: 'docker-repair',
        prompt:
          "You are in a fresh repo with a broken Dockerfile that uses FROM node:22-sllm (typo). Fix the base image to node:22-slim, add a small src/index.js that prints 'ok', and make the image build. Run docker build -t test-repair . if Docker is available, otherwise check syntax with 'docker --version'. Finish with VERDICT: PASS if the Dockerfile is valid and index.js exists.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: "cat Dockerfile | grep -q 'FROM node:22-slim' && ls src/index.js",
        },
      },
      {
        id: 'missing-cmd',
        category: 'docker-repair',
        prompt:
          "You are in a fresh repo with a Dockerfile that copies files but has no CMD or ENTRYPOINT, so the container exits immediately. Add a CMD that runs node src/server.js, create src/server.js that listens on port 3000 and responds with 'hello', and verify the files exist. Finish with VERDICT: PASS.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'cat Dockerfile | grep -qE "CMD|ENTRYPOINT" && ls src/server.js',
        },
      },
      {
        id: 'cache-layer-order',
        category: 'docker-repair',
        prompt:
          'You are in a fresh repo with a Dockerfile that copies package.json after copying the entire source tree, ruining Docker layer caching. Reorder the instructions so dependencies are installed before source code is copied. Create package.json with a single dependency (e.g., leftpad) and src/index.js. Finish with VERDICT: PASS if the Dockerfile copies package.json before src/.',
        expect: {
          contains: ['VERDICT:'],
          testCommand:
            "cat Dockerfile | awk '/COPY package\\.json/{a=NR}/COPY src\\//{b=NR} END{exit !(a && b && a < b)}' && ls package.json src/index.js",
        },
      },
    ],
  },
  'ts-migrate': {
    version: 1,
    name: 'builtin-ts-migrate',
    description:
      'Small TypeScript migration benchmark. Each case asks UR to convert JavaScript to typed TypeScript.',
    cases: [
      {
        id: 'add-types',
        category: 'ts-migrate',
        prompt:
          'You are in a fresh repo. Create src/person.js with a function createPerson(name, age) that returns an object and a usage file. Ask UR to rename it to src/person.ts, add TypeScript interface Person { name: string; age: number }, annotate the function, and run npx tsc --noEmit (or a local tsc if available). Finish with VERDICT: PASS if no type errors are reported.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'ls src/person.ts',
        },
      },
      {
        id: 'null-types',
        category: 'ts-migrate',
        prompt:
          'You are in a fresh repo. Create src/config.js with getConfig(key) that may return undefined. Ask UR to migrate it to src/config.ts, add strict null checks via type annotations, and create a usage file that handles undefined. Run type check. Finish with VERDICT: PASS if types are sound.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'ls src/config.ts',
        },
      },
      {
        id: 'module-types',
        category: 'ts-migrate',
        prompt:
          'You are in a fresh repo. Create src/math.js with CommonJS exports (module.exports = { add, subtract }). Ask UR to migrate to src/math.ts using ESM exports, add TypeScript types, create src/math.test.ts, and run tests. Finish with VERDICT: PASS if tests pass.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: 'ls src/math.ts',
        },
      },
    ],
  },
  'py-package-repair': {
    version: 1,
    name: 'builtin-py-package-repair',
    description:
      'Small Python package repair benchmark. Each case asks UR to fix packaging metadata in a fresh worktree.',
    cases: [
      {
        id: 'missing-dep',
        category: 'py-package-repair',
        prompt:
          "You are in a fresh Python repo with a setup.py that installs a package but forgets install_requires=['requests']. Create src/mypkg/__init__.py that imports requests. Ask UR to fix setup.py, install the package in editable mode (or write the fix), and verify the import would work. Finish with VERDICT: PASS if setup.py references requests.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: "grep -q 'requests' setup.py",
        },
      },
      {
        id: 'missing-pyproject',
        category: 'py-package-repair',
        prompt:
          'You are in a fresh Python repo with only setup.py and no pyproject.toml. Ask UR to add a minimal pyproject.toml with build-system requires, project name, and version. Finish with VERDICT: PASS if pyproject.toml exists with [project] section.',
        expect: {
          contains: ['VERDICT:'],
          testCommand: "grep -q '\\[project\\]' pyproject.toml",
        },
      },
      {
        id: 'entrypoint',
        category: 'py-package-repair',
        prompt:
          "You are in a fresh Python repo with a CLI script src/mypkg/cli.py but no console_scripts entry point. Ask UR to fix setup.py or pyproject.toml so it exposes a 'mypkg' command, and create a minimal package structure. Finish with VERDICT: PASS if an entry point references mypkg.cli:main or similar.",
        expect: {
          contains: ['VERDICT:'],
          testCommand: "grep -qE 'console_scripts|mypkg.cli' setup.py pyproject.toml 2>/dev/null",
        },
      },
    ],
  },
}

export function listBuiltinSuiteIds(): BuiltinSuiteId[] {
  return [...BUILTIN_SUITE_IDS]
}

export function getBuiltinSuite(id: BuiltinSuiteId): EvalSuite | undefined {
  return BUILTIN_SUITES[id]
}

export function installBuiltinSuite(
  cwd: string,
  id: BuiltinSuiteId,
  options: { force?: boolean } = {},
): { path: string; created: boolean; suite?: EvalSuite } {
  const suite = getBuiltinSuite(id)
  if (!suite) {
    return { path: join(evalsDir(cwd), `${id}.json`), created: false }
  }
  const saved = saveSuite(cwd, suite, { force: options.force })
  return { path: saved.path, created: saved.created, suite }
}
