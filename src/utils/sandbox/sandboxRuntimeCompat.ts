/**
 * Stable import boundary for Anthropic's open-source sandbox runtime.
 *
 * Keeping this module means the rest of UR does not depend on the package's
 * filesystem layout, while using the maintained runtime for the parts that
 * must be security-correct: the network proxy, strict domain enforcement,
 * credential sentinels, TLS termination, JWT masking, and AWS SigV4
 * re-signing.
 */

export {
  SandboxManager,
  SandboxRuntimeConfigSchema,
  SandboxViolationStore,
} from '@anthropic-ai/sandbox-runtime'

export type {
  CredentialEnvVarConfig,
  CredentialFileConfig,
  CredentialsConfig,
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  IgnoreViolationsConfig,
  NetworkHostPattern,
  NetworkRestrictionConfig,
  SandboxAskCallback,
  SandboxDependencyCheck,
  SandboxRuntimeConfig,
  SandboxViolationEvent,
  WrapWithSandboxOptions,
} from '@anthropic-ai/sandbox-runtime'
