import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import {
  authAliasForProvider,
  getProviderDefinition,
  launchProviderAuth,
  PROVIDER_IDS,
  resolveProviderId,
  type ProviderId,
} from '../../services/providers/providerRegistry.js'
import {
  clearProviderApiKey,
  setProviderApiKey,
} from '../../services/providers/providerCredentials.js'
import {
  formatConnectionLine,
  getProviderConnection,
} from '../../services/providers/providerConnection.js'
import { readSecretFromStdin } from '../../utils/readSecretFromStdin.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set(['--key'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (withValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur connect status [--json]           Show connection status for every provider',
    '  ur connect <provider>                Connect (subscription: official login; API: prompts for a key)',
    '  ur connect <provider> --key <KEY>    Store an API key (or pipe it: echo $KEY | ur connect <provider>)',
    '  ur connect logout <provider>         Disconnect (clear stored key / CLI logout hint)',
    '',
    `Providers: ${PROVIDER_IDS.join(', ')}`,
  ].join('\n')
}

async function connectProvider(provider: ProviderId, keyFlag?: string): Promise<string> {
  const def = getProviderDefinition(provider)

  if (def.accessType === 'subscription') {
    const alias = authAliasForProvider(provider)
    if (alias === 'provider') {
      return `No official login is configured for ${provider}.`
    }
    const result = await launchProviderAuth(alias)
    return `${result.message}\nOnce logged in, ${def.displayName} runs via its official CLI. Select it with /model.`
  }

  if (def.envKey) {
    let key = keyFlag
    if (key === undefined) {
      try {
        key = await readSecretFromStdin({ label: 'API key' })
      } catch (error) {
        return error instanceof Error
          ? `Could not read API key: ${error.message}`
          : 'Could not read API key from stdin.'
      }
    }
    if (!key) {
      return [
        `${def.displayName} connects with an API key.`,
        `Provide it securely (not in shell history):`,
        `  echo $${def.envKey} | ur connect ${provider}`,
        `or: ur connect ${provider} --key <KEY>`,
        `The key is stored in your OS keychain and reused automatically.`,
      ].join('\n')
    }
    const saved = setProviderApiKey(provider, key)
    if (!saved.ok) return saved.message
    return `Connected ${def.displayName}. ${saved.message} You can now select it with /model.`
  }

  return `${def.displayName} needs a local endpoint, not a login. Set it with: ur config set base_url <url>`
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const action = positional[0] ?? 'status'

  if (action === 'status' || action === 'list') {
    const connections = await Promise.all(
      PROVIDER_IDS.map(id => getProviderConnection(id).catch(() => null)),
    )
    const ok = connections.filter(Boolean)
    if (json) {
      return { type: 'text', value: JSON.stringify(ok, null, 2) }
    }
    return { type: 'text', value: ok.map(c => `- ${formatConnectionLine(c!)}`).join('\n') }
  }

  if (action === 'logout' || action === 'disconnect') {
    const provider = resolveProviderId(positional[1] ?? '')
    if (!provider) return { type: 'text', value: usage() }
    const def = getProviderDefinition(provider)
    if (def.accessType === 'subscription') {
      return {
        type: 'text',
        value: `Log out of ${def.displayName} through its official CLI (e.g. its \`logout\` command). UR does not store its session.`,
      }
    }
    const cleared = clearProviderApiKey(provider)
    return { type: 'text', value: cleared.message }
  }

  const provider = resolveProviderId(action)
  if (!provider) {
    return { type: 'text', value: usage() }
  }
  return { type: 'text', value: await connectProvider(provider, option(tokens, '--key')) }
}
