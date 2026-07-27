import { expect, test } from 'bun:test'
import { type Command, meetsAvailabilityRequirement } from '../src/commands.ts'
import installGitHubApp from '../src/commands/install-github-app/index.ts'
import {
  PROVIDER_IDS,
  getProviderDefinition,
} from '../src/services/providers/providerRegistry.ts'

/**
 * Regression guard for a gate that silently disabled nine commands.
 *
 * `isUsing3PServices()` was `getAPIProvider() !== 'firstParty'`, but
 * `getAPIProvider()` only ever returns 'ollama' or 'foundry' — it is a
 * request-shaping enum, not an auth signal. The comparison was therefore
 * always true, which unregistered /login and /logout, forced every
 * availability-gated command to fail its check, and reported every user as
 * `third_party` in `ur auth status`.
 */

// Mirrors the predicate in src/utils/auth.ts. Kept as a table so a provider
// added to the registry without an access classification fails loudly here.
function classify(id: (typeof PROVIDER_IDS)[number]): boolean {
  const provider = getProviderDefinition(id)
  if (provider.accessType === 'api') return true
  return provider.credentialType === 'cli-login'
}

test('vendor-credentialed providers are the only third-party ones', () => {
  const thirdParty = PROVIDER_IDS.filter(classify)
  const firstPartyOrLocal = PROVIDER_IDS.filter(id => !classify(id))

  // Local and self-hosted runtimes: the user holds the credentials, so UR's
  // own auth surface still applies.
  expect(firstPartyOrLocal).toEqual([
    'ollama',
    'subscription',
    'lmstudio',
    'llama.cpp',
    'vllm',
  ])
  expect(thirdParty).toContain('openai-api')
  expect(thirdParty).toContain('anthropic-api')
  expect(thirdParty).toContain('codex-cli')

  // The bug: a predicate that classifies everything as third-party.
  expect(thirdParty.length).toBeGreaterThan(0)
  expect(thirdParty.length).toBeLessThan(PROVIDER_IDS.length)
})

test('every registry provider has an access classification', () => {
  for (const id of PROVIDER_IDS) {
    const provider = getProviderDefinition(id)
    expect(['subscription', 'api', 'local', 'server']).toContain(
      provider.accessType,
    )
    expect(provider.credentialType).toBeTruthy()
  }
})

test('/install-github-app is reachable on every provider', () => {
  // It provisions a workflow and a repository secret rather than consuming
  // inference, and the key is entered by hand, so gating it behind a
  // subscription made it unreachable for local-provider users.
  // Widening to Command also asserts the command still satisfies the
  // interface after the field was dropped.
  const command: Command = installGitHubApp
  expect(command.availability).toBeUndefined()
  expect(meetsAvailabilityRequirement(command)).toBe(true)
  expect(installGitHubApp.isEnabled()).toBe(true)
  expect(command.name).toBe('install-github-app')
})

test('commands without an availability requirement skip the auth check', () => {
  expect(
    meetsAvailabilityRequirement({ name: 'x', description: 'x' } as never),
  ).toBe(true)
})
