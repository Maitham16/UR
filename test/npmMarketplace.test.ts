import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearInstalledPluginsCache,
  loadInstalledPluginsV2,
} from '../src/utils/plugins/installedPluginsManager.js'
import { _test as marketplaceTest } from '../src/utils/plugins/marketplaceManager.js'
import { parseMarketplaceInput } from '../src/utils/plugins/parseMarketplaceInput.js'
import { clearPluginCache } from '../src/utils/plugins/pluginLoader.js'
import { MarketplaceSourceSchema } from '../src/utils/plugins/schemas.js'
import { isMarketplaceSourceSupportedByZipCache } from '../src/utils/plugins/zipCache.js'

const temporaryDirectories: string[] = []
const originalPluginCacheDir = process.env.UR_CODE_PLUGIN_CACHE_DIR

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  clearInstalledPluginsCache()
  if (originalPluginCacheDir === undefined) {
    delete process.env.UR_CODE_PLUGIN_CACHE_DIR
  } else {
    process.env.UR_CODE_PLUGIN_CACHE_DIR = originalPluginCacheDir
  }
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('npm marketplace source parsing', () => {
  test('parses unscoped and scoped packages with npm selectors', async () => {
    await expect(parseMarketplaceInput('npm:acme-catalog')).resolves.toEqual({
      source: 'npm',
      package: 'acme-catalog',
    })
    await expect(
      parseMarketplaceInput('npm:@acme/ur-marketplace@next'),
    ).resolves.toEqual({
      source: 'npm',
      package: '@acme/ur-marketplace',
      version: 'next',
    })
    await expect(
      parseMarketplaceInput('npm:@acme/ur-marketplace@^2.0.0'),
    ).resolves.toEqual({
      source: 'npm',
      package: '@acme/ur-marketplace',
      version: '^2.0.0',
    })
  })

  test('returns actionable errors for missing and malformed npm specs', async () => {
    expect(await parseMarketplaceInput('npm:')).toEqual({
      error:
        'NPM marketplace source is missing a package name. Use npm:package or npm:@scope/package@version.',
    })
    expect(await parseMarketplaceInput('npm:@acme/ur-marketplace@')).toEqual({
      error:
        "NPM marketplace version is empty in 'npm:@acme/ur-marketplace@'. Remove the trailing @ or provide a version, range, or dist-tag.",
    })
    expect(await parseMarketplaceInput('npm:Bad Package')).toEqual({
      error:
        "Invalid NPM marketplace source 'npm:Bad Package': Invalid npm package name format",
    })
  })

  test('schema supports pinned selectors and private registries', () => {
    expect(
      MarketplaceSourceSchema().parse({
        source: 'npm',
        package: '@acme/ur-marketplace',
        version: '^2.3.0',
        registry: 'https://registry.example.com',
      }),
    ).toEqual({
      source: 'npm',
      package: '@acme/ur-marketplace',
      version: '^2.3.0',
      registry: 'https://registry.example.com',
    })
  })

  test('is available in headless ZIP-cache reconciliation', () => {
    expect(
      isMarketplaceSourceSupportedByZipCache({
        source: 'npm',
        package: '@acme/ur-marketplace',
        version: 'latest',
      }),
    ).toBe(true)
  })
})

describe('npm marketplace materialization', () => {
  test('uses an isolated npm prefix and retains only the requested package', async () => {
    const root = await temporaryDirectory('ur-npm-marketplace-')
    const target = join(root, 'catalog-cache')
    const progress: string[] = []
    let invocation:
      | { file: string; args: string[]; useCwd: boolean | undefined }
      | undefined

    await marketplaceTest.cacheMarketplaceFromNpm(
      {
        source: 'npm',
        package: '@acme/ur-marketplace',
        version: 'next',
        registry: 'https://registry.example.com',
      },
      target,
      message => progress.push(message),
      async (file, args, options) => {
        invocation = { file, args, useCwd: options.useCwd }
        const prefixIndex = args.indexOf('--prefix')
        const staging = args[prefixIndex + 1]!
        const packageRoot = join(
          staging,
          'node_modules',
          '@acme',
          'ur-marketplace',
        )
        await mkdir(join(packageRoot, '.ur-plugin'), { recursive: true })
        await writeFile(
          join(packageRoot, '.ur-plugin', 'marketplace.json'),
          '{"name":"acme","owner":{"name":"Acme"},"plugins":[]}',
        )
        // A dependency in npm's staging tree must not become marketplace data.
        await mkdir(join(staging, 'node_modules', 'transitive-dependency'), {
          recursive: true,
        })
        return { stdout: '', stderr: '', code: 0 }
      },
    )

    expect(invocation?.file).toBe('npm')
    expect(invocation?.useCwd).toBe(false)
    expect(invocation?.args).toEqual(
      expect.arrayContaining([
        'install',
        '--ignore-scripts',
        '--no-save',
        '--package-lock=false',
        '--prefer-online',
        '--registry',
        'https://registry.example.com',
        '@acme/ur-marketplace@next',
      ]),
    )
    expect(
      await readFile(
        join(target, '.ur-plugin', 'marketplace.json'),
        'utf8',
      ),
    ).toContain('"name":"acme"')
    await expect(
      stat(join(target, 'node_modules', 'transitive-dependency')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(`${target}.staging`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(progress).toEqual([
      'Downloading npm marketplace package @acme/ur-marketplace@next',
      'NPM package downloaded, validating marketplace',
    ])
  })

  test('reports npm failures and removes staging state', async () => {
    const root = await temporaryDirectory('ur-npm-marketplace-failure-')
    const target = join(root, 'catalog-cache')

    await expect(
      marketplaceTest.cacheMarketplaceFromNpm(
        { source: 'npm', package: 'missing-catalog' },
        target,
        undefined,
        async () => ({
          stdout: '',
          stderr: '404 package not found',
          code: 1,
        }),
      ),
    ).rejects.toThrow(
      "Failed to download npm marketplace package 'missing-catalog': 404 package not found",
    )
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(`${target}.staging`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

describe('installed-plugin cache invalidation', () => {
  test('clearPluginCache reloads installed_plugins.json instead of retaining stale entries', async () => {
    const pluginDirectory = await temporaryDirectory('ur-installed-plugins-')
    process.env.UR_CODE_PLUGIN_CACHE_DIR = pluginDirectory
    const registryPath = join(pluginDirectory, 'installed_plugins.json')
    await mkdir(pluginDirectory, { recursive: true })

    await writeFile(
      registryPath,
      JSON.stringify({
        version: 2,
        plugins: {
          'before@catalog': [
            { scope: 'user', installPath: join(pluginDirectory, 'before') },
          ],
        },
      }),
    )
    clearInstalledPluginsCache()
    expect(loadInstalledPluginsV2().plugins['before@catalog']).toHaveLength(1)

    await writeFile(
      registryPath,
      JSON.stringify({
        version: 2,
        plugins: {
          'after@catalog': [
            { scope: 'user', installPath: join(pluginDirectory, 'after') },
          ],
        },
      }),
    )
    expect(loadInstalledPluginsV2().plugins['after@catalog']).toBeUndefined()

    clearPluginCache('npmMarketplace regression test')
    expect(loadInstalledPluginsV2().plugins['before@catalog']).toBeUndefined()
    expect(loadInstalledPluginsV2().plugins['after@catalog']).toHaveLength(1)
  })
})

describe('npm marketplace documentation contract', () => {
  test('user and technical docs describe the implemented source form', async () => {
    const repositoryRoot = join(import.meta.dir, '..')
    const files = [
      'README.md',
      'docs/plugins.md',
      'technical/08-skills-plugins-workflows.md',
      'documentation/app.js',
    ]
    for (const file of files) {
      const content = await readFile(join(repositoryRoot, file), 'utf8')
      expect(content, file).toContain('npm:')
    }
    const technical = await readFile(
      join(repositoryRoot, 'technical/08-skills-plugins-workflows.md'),
      'utf8',
    )
    expect(technical).toContain('.ur-plugin/marketplace.json')
    expect(technical).toContain('registry')
  })
})
