import { logForDebugging } from './debug.js'

/** AWS short-term credentials format. */
export type AwsCredentials = {
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  Expiration?: string
}

/** Output from `aws sts get-session-token` or `aws sts assume-role`. */
export type AwsStsOutput = {
  Credentials: AwsCredentials
}

type AwsError = {
  name: string
}

export function isAwsCredentialsProviderError(err: unknown) {
  return (err as AwsError | undefined)?.name === 'CredentialsProviderError'
}

/** Typeguard to validate AWS STS assume-role output */
export function isValidAwsStsOutput(obj: unknown): obj is AwsStsOutput {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const output = obj as Record<string, unknown>

  // Check if Credentials exists and has required fields
  if (!output.Credentials || typeof output.Credentials !== 'object') {
    return false
  }

  const credentials = output.Credentials as Record<string, unknown>

  return (
    typeof credentials.AccessKeyId === 'string' &&
    typeof credentials.SecretAccessKey === 'string' &&
    typeof credentials.SessionToken === 'string' &&
    credentials.AccessKeyId.length > 0 &&
    credentials.SecretAccessKey.length > 0 &&
    credentials.SessionToken.length > 0
  )
}

/**
 * Throws if STS caller identity cannot be retrieved.
 * Disabled for external builds: AWS/Bedrock auth paths are not supported.
 */
export async function checkStsCallerIdentity(): Promise<void> {
  // No-op: local Ollama execution does not use AWS credentials.
}

/**
 * Clear AWS credential provider cache by forcing a refresh.
 * Disabled for external builds: AWS/Bedrock auth paths are not supported.
 */
export async function clearAwsIniCache(): Promise<void> {
  // No-op: local Ollama execution does not use AWS credentials.
}
