/**
 * Sandbox types for the UR-Nexus SDK
 *
 * This file is the single source of truth for sandbox configuration types.
 * Both the SDK and the settings validation import from here.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

/**
 * Network configuration schema for sandbox.
 */
export const SandboxNetworkConfigSchema = lazySchema(() =>
  z
    .object({
      allowedDomains: z.array(z.string()).optional(),
      deniedDomains: z
        .array(z.string())
        .optional()
        .describe(
          'Domains that are always blocked, even when an allow pattern also matches.',
        ),
      strictAllowlist: z
        .boolean()
        .optional()
        .describe(
          'Deny destinations outside allowedDomains without prompting. Project and local settings cannot enable or disable this security boundary.',
        ),
      allowManagedDomainsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. ' +
            'User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources.',
        ),
      allowUnixSockets: z
        .array(z.string())
        .optional()
        .describe(
          'macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path).',
        ),
      allowAllUnixSockets: z
        .boolean()
        .optional()
        .describe(
          'If true, allow all Unix sockets (disables blocking on both platforms).',
        ),
      allowLocalBinding: z.boolean().optional(),
      httpProxyPort: z.number().optional(),
      socksProxyPort: z.number().optional(),
      tlsTerminate: z
        .object({
          caCertPath: z.string().optional(),
          caKeyPath: z.string().optional(),
          excludeDomains: z.array(z.string()).optional(),
          extraCaCertPaths: z.array(z.string()).optional(),
        })
        .refine(
          value =>
            (value.caCertPath === undefined) ===
            (value.caKeyPath === undefined),
          {
            message:
              'caCertPath and caKeyPath must be configured together',
          },
        )
        .optional()
        .describe(
          'Terminate TLS in the sandbox proxy so masked credentials can be substituted safely. An ephemeral per-session CA is generated when no CA pair is supplied.',
        ),
    })
    .optional(),
)

const CredentialModeSchema = z.enum(['deny', 'mask'])
const ExtractNoMatchSchema = z.enum(['warn', 'deny', 'error'])

const CredentialFileConfigSchema = z.object({
  path: z.string().min(1),
  mode: CredentialModeSchema,
  extract: z.string().optional(),
  onExtractNoMatch: ExtractNoMatchSchema.optional(),
  decode: z.literal('jwt').optional(),
  maskClaims: z.array(z.string().min(1)).min(1).optional(),
  maskDuplicates: z.boolean().optional(),
  injectHosts: z.array(z.string()).optional(),
})

const CredentialEnvVarConfigSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid environment variable name'),
  mode: CredentialModeSchema,
  extract: z.string().optional(),
  onExtractNoMatch: ExtractNoMatchSchema.optional(),
  decode: z.literal('jwt').optional(),
  maskClaims: z.array(z.string().min(1)).min(1).optional(),
  injectHosts: z.array(z.string()).optional(),
})

export const SandboxCredentialsConfigSchema = lazySchema(() =>
  z
    .object({
      files: z.array(CredentialFileConfigSchema).optional(),
      envVars: z.array(CredentialEnvVarConfigSchema).optional(),
      allowPlaintextInject: z.boolean().optional(),
      awsPairs: z
        .array(
          z
            .object({
              accessKeyIdVar: z.string(),
              secretAccessKeyVar: z.string(),
              sessionTokenVar: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
      sigv4: z
        .object({
          streaming: z.enum(['deny', 'passthrough']).optional(),
          presigned: z.enum(['deny', 'passthrough']).optional(),
          sigv4a: z.enum(['deny', 'passthrough']).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
)

/**
 * Filesystem configuration schema for sandbox.
 */
export const SandboxFilesystemConfigSchema = lazySchema(() =>
  z
    .object({
      allowWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to allow writing within the sandbox. ' +
            'Merged with paths from Edit(...) allow permission rules.',
        ),
      denyWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny writing within the sandbox. ' +
            'Merged with paths from Edit(...) deny permission rules.',
        ),
      denyRead: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny reading within the sandbox. ' +
            'Merged with paths from Read(...) deny permission rules.',
        ),
      allowRead: z
        .array(z.string())
        .optional()
        .describe(
          'Paths to re-allow reading within denyRead regions. ' +
            'Takes precedence over denyRead for matching paths.',
        ),
      allowManagedReadPathsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (set in managed settings), only allowRead paths from policySettings are used.',
        ),
    })
    .optional(),
)

/**
 * Sandbox settings schema.
 */
export const SandboxSettingsSchema = lazySchema(() =>
  z
    .object({
      enabled: z.boolean().optional(),
      failIfUnavailable: z
        .boolean()
        .optional()
        .describe(
          'Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start ' +
            '(missing dependencies, unsupported platform, or platform not in enabledPlatforms). ' +
            'When false (default), a warning is shown and commands run unsandboxed. ' +
            'Intended for managed-settings deployments that require sandboxing as a hard gate.',
        ),
      // Note: enabledPlatforms is an undocumented setting read via .passthrough()
      // It restricts sandboxing to specific platforms (e.g., ["macos"]).
      //
      // Added to unblock NVIDIA enterprise rollout: they want to enable
      // autoAllowBashIfSandboxed but only on macOS initially, since Linux/WSL
      // sandbox support is newer and less battle-tested. This allows them to
      // set enabledPlatforms: ["macos"] to disable sandbox (and auto-allow)
      // on other platforms until they're ready to expand.
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z
        .boolean()
        .optional()
        .describe(
          'Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. ' +
            'When false, the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed. ' +
            'Default: true.',
        ),
      network: SandboxNetworkConfigSchema(),
      filesystem: SandboxFilesystemConfigSchema(),
      credentials: SandboxCredentialsConfigSchema().optional(),
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
      enableWeakerNetworkIsolation: z
        .boolean()
        .optional()
        .describe(
          'macOS only: Allow access to com.apple.trustd.agent in the sandbox. ' +
            'Needed for Go-based CLI tools (gh, gcloud, terraform, etc.) to verify TLS certificates ' +
            'when using httpProxyPort with a MITM proxy and custom CA. ' +
            '**Reduces security** — opens a potential data exfiltration vector through the trustd service. Default: false',
        ),
      excludedCommands: z.array(z.string()).optional(),
      ripgrep: z
        .object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Custom ripgrep configuration for bundled ripgrep support'),
    })
    .passthrough(),
)

// Inferred types from schemas
export type SandboxSettings = z.infer<ReturnType<typeof SandboxSettingsSchema>>
export type SandboxNetworkConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxNetworkConfigSchema>>
>
export type SandboxFilesystemConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxFilesystemConfigSchema>>
>
export type SandboxCredentialsConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxCredentialsConfigSchema>>
>
export type SandboxIgnoreViolations = NonNullable<
  SandboxSettings['ignoreViolations']
>
