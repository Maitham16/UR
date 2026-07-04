import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const requiredPackageFiles = [
  'package.json',
  'bin/ur.js',
  'dist/cli.js',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'RELEASE.md',
  'SECURITY.md',
  'docs/USAGE.md',
  'docs/providers.md',
  'documentation/index.html',
  'plugins/core/README.md',
]

export const requiredSourceZipEntries = [
  'package.json',
  'bun.lock',
  'src/',
  'bin/',
  'scripts/',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
]

const forbiddenRules = [
  {
    label: 'dependency directory',
    test: path => /(^|\/)node_modules(\/|$)/.test(path),
  },
  {
    label: 'OS metadata',
    test: path =>
      path.endsWith('/.DS_Store') ||
      path === '.DS_Store' ||
      path === '__MACOSX' ||
      path.startsWith('__MACOSX/'),
  },
  {
    label: 'local environment file',
    test: path =>
      /(^|\/)\.env(?:\..*)?$/.test(path) &&
      path !== '.env.example' &&
      !path.endsWith('/.env.example'),
  },
  {
    label: 'temporary log',
    test: path =>
      /(^|\/)(npm-debug|yarn-debug|yarn-error|pnpm-debug|bun-debug)\.log/.test(path) ||
      /\.log$/.test(path),
  },
  {
    label: 'test output directory',
    test: path =>
      /(^|\/)(coverage|test-results|playwright-report|\.nyc_output)(\/|$)/.test(path),
  },
  {
    label: 'release cache directory',
    test: path =>
      /(^|\/)(\.cache|\.bun|\.npm|\.pnpm-store|\.yarn\/cache)(\/|$)/.test(path) ||
      /(^|\/)dist\/(?:\.cache|cache|tmp|temp)(\/|$)/.test(path),
  },
  {
    label: 'local temporary file',
    test: path =>
      /(^|\/)(tmp|temp)(\/|$)/.test(path) ||
      /\.(?:tmp|temp|swp|swo)$/.test(path) ||
      /~$/.test(path),
  },
  {
    label: 'local debug or trash artifact',
    test: path =>
      /(^|\/)(?:\.Trash|Trash)(\/|$)/.test(path) ||
      /(^|\/)(?:debug|trash)(?:[-_.][^/]*)?\.(?:json|log|txt|tmp)$/.test(path),
  },
  {
    label: 'TypeScript build cache',
    test: path => path.endsWith('.tsbuildinfo'),
  },
  {
    label: 'runtime binary',
    test: path => /(^|\/)(bun|node)(?:\.exe)?$/.test(path),
  },
  {
    label: 'local UR analysis/output directory',
    test: path =>
      /(^|\/)(\.ur-analysis|\.ur\/(?:cache|tmp|logs|background|runs|worktrees))(\/|$)/.test(path),
  },
  {
    label: 'nested release archive',
    test: path => /\.(?:tgz|tar\.gz|zip)$/.test(path),
  },
]

export function normalizeReleasePath(path) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^package\//, '')
}

export function normalizeArchiveRootPaths(paths) {
  const normalized = paths.map(normalizeReleasePath).filter(Boolean)
  const firstSegments = new Set(
    normalized
      .filter(path => path.includes('/'))
      .map(path => path.split('/')[0])
      .filter(Boolean),
  )
  const hasRootFile = normalized.some(path =>
    ['package.json', 'README.md', 'CHANGELOG.md', 'SECURITY.md'].includes(path),
  )
  if (hasRootFile || firstSegments.size !== 1) {
    return normalized
  }
  const [root] = [...firstSegments]
  return normalized.map(path =>
    path === root ? '' : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
  ).filter(Boolean)
}

export function releasePathViolations(paths) {
  const violations = []
  for (const rawPath of paths) {
    const path = normalizeReleasePath(rawPath)
    for (const rule of forbiddenRules) {
      if (rule.test(path)) {
        violations.push(`${path} (${rule.label})`)
        break
      }
    }
  }
  return violations
}

export function missingRequiredPackageFiles(paths) {
  const normalized = new Set(paths.map(normalizeReleasePath))
  return requiredPackageFiles.filter(path => !normalized.has(path))
}

export function missingRequiredSourceZipEntries(paths) {
  const normalized = normalizeArchiveRootPaths(paths)
  return requiredSourceZipEntries.filter(entry => {
    const cleanEntry = entry.replace(/\/$/, '')
    if (entry.endsWith('/')) {
      return !normalized.some(path => path === cleanEntry || path.startsWith(`${cleanEntry}/`))
    }
    return !normalized.includes(cleanEntry)
  })
}

export function tarballPaths(tarball) {
  const output = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  return output.split('\n').map(path => path.trim()).filter(Boolean)
}

function gitTrackedPaths(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

function walkSourcePaths(root) {
  const paths = []
  const pending = ['.']

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const absolute = join(root, current)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      const normalized = normalizeReleasePath(current)
      if (normalized !== '.') {
        paths.push(normalized)
        if (releasePathViolations([normalized]).length > 0) {
          continue
        }
      }
      for (const entry of readdirSync(absolute)) {
        pending.push(current === '.' ? entry : `${current}${sep}${entry}`)
      }
    } else if (stat.isFile()) {
      paths.push(normalizeReleasePath(relative(root, absolute)))
    }
  }

  return paths
}

export function sourceArchiveCandidatePaths(root) {
  if (existsSync(join(root, '.git'))) {
    try {
      return gitTrackedPaths(root)
    } catch {
      return walkSourcePaths(root)
    }
  }
  return walkSourcePaths(root)
}
