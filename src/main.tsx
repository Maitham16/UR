// These side-effects must run before all other imports:
// 1. profileCheckpoint marks entry before heavy module evaluation begins
// 2. startMdmRawRead fires MDM subprocesses (plutil/reg query) so they run in
//    parallel with the remaining ~135ms of imports below
// 3. startKeychainPrefetch fires both macOS keychain reads (OAuth + legacy API
//    key) in parallel — isRemoteManagedSettingsEligible() otherwise reads them
//    sequentially via sync spawn inside applySafeConfigEnvironmentVariables()
//    (~65ms on every macOS startup)
import { profileCheckpoint, profileReport } from './utils/startupProfiler.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_entry');
import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startMdmRawRead();
import { ensureKeychainPrefetchCompleted, startKeychainPrefetch } from './utils/secureStorage/keychainPrefetch.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startKeychainPrefetch();
import { feature } from 'bun:bundle';
import { Command as CommanderCommand, InvalidArgumentError, Option } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import mapValues from 'lodash-es/mapValues.js';
import pickBy from 'lodash-es/pickBy.js';
import uniqBy from 'lodash-es/uniqBy.js';
import React from 'react';
import { getOauthConfig } from './constants/oauth.js';
import { getRemoteSessionUrl } from './constants/product.js';
import { getSystemContext, getUserContext } from './context.js';
import { init, initializeTelemetryAfterTrust } from './entrypoints/init.js';
import { addToHistory } from './history.js';
import type { Root } from './ink.js';
import { launchRepl } from './replLauncher.js';
import { hasGrowthBookEnvOverride, initializeGrowthBook, refreshGrowthBookAfterAuthChange } from './services/analytics/growthbook.js';
import { fetchBootstrapData } from './services/api/bootstrap.js';
import { type DownloadResult, downloadSessionFiles, type FilesApiConfig, parseFileSpecs } from './services/api/filesApi.js';
import { prefetchPassesEligibility } from './services/api/referral.js';
import { prefetchOfficialMcpUrls } from './services/mcp/officialRegistry.js';
import type { McpSdkServerConfig, McpServerConfig, ScopedMcpServerConfig } from './services/mcp/types.js';
import { isPolicyAllowed, loadPolicyLimits, refreshPolicyLimits, waitForPolicyLimitsToLoad } from './services/policyLimits/index.js';
import { loadRemoteManagedSettings, refreshRemoteManagedSettings } from './services/remoteManagedSettings/index.js';
import type { ToolInputJSONSchema } from './Tool.js';
import type { LocalCommandModule } from './types/command.js';
import { createSyntheticOutputTool, isSyntheticOutputToolEnabled } from './tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { getTools } from './tools.js';
import { canUserConfigureAdvisor, getInitialAdvisorSetting, isAdvisorEnabled, isValidAdvisorModel, modelSupportsAdvisor } from './utils/advisor.js';
import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js';
import { count, uniq } from './utils/array.js';
import { installAsciicastRecorder } from './utils/asciicast.js';
import { getSubscriptionType, isURAISubscriber, prefetchAwsCredentialsAndBedRockInfoIfSafe, prefetchGcpCredentialsIfSafe, validateForceLoginOrg } from './utils/auth.js';
import { checkHasTrustDialogAccepted, getGlobalConfig, getRemoteControlAtStartup, isAutoUpdaterDisabled, saveGlobalConfig } from './utils/config.js';
import { seedEarlyInput, stopCapturingEarlyInput } from './utils/earlyInput.js';
import { getInitialEffortSetting, parseEffortValue } from './utils/effort.js';
import { getInitialFastModeSetting, isFastModeEnabled, prefetchFastModeStatus, resolveFastModeStatusFromCache } from './utils/fastMode.js';
import { applyConfigEnvironmentVariables } from './utils/managedEnv.js';
import { createSystemMessage, createUserMessage } from './utils/messages.js';
import { getPlatform } from './utils/platform.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
import { getSessionIngressAuthToken } from './utils/sessionIngressAuth.js';
import { settingsChangeDetector } from './utils/settings/changeDetector.js';
import { skillChangeDetector } from './utils/skills/skillChangeDetector.js';
import { jsonParse, writeFileSync_DEPRECATED } from './utils/slowOperations.js';
import { computeInitialTeamContext } from './utils/swarm/reconnection.js';
import { initializeWarningHandler } from './utils/warningHandler.js';
import { isWorktreeModeEnabled } from './utils/worktreeModeEnabled.js';

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () => require('./utils/teammate.js') as typeof import('./utils/teammate.js');
const getTeammatePromptAddendum = () => require('./utils/swarm/teammatePromptAddendum.js') as typeof import('./utils/swarm/teammatePromptAddendum.js');
const getTeammateModeSnapshot = () => require('./utils/swarm/backends/teammateModeSnapshot.js') as typeof import('./utils/swarm/backends/teammateModeSnapshot.js');
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for COORDINATOR_MODE
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE') ? require('./coordinator/coordinatorMode.js') as typeof import('./coordinator/coordinatorMode.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for KAIROS (assistant mode)
/* eslint-disable @typescript-eslint/no-require-imports */
const assistantModule = feature('KAIROS') ? require('./assistant/index.js') as typeof import('./assistant/index.js') : null;
const kairosGate = feature('KAIROS') ? require('./assistant/gate.js') as typeof import('./assistant/gate.js') : null;
import { relative, resolve } from 'path';
import { isAnalyticsDisabled } from 'src/services/analytics/config.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { initializeAnalyticsGates } from 'src/services/analytics/sink.js';
import { getOriginalCwd, getOfflineMode, setAdditionalDirectoriesForAgentMd, setIsRemoteMode, setMainLoopModelOverride, setMainThreadAgentType, setOfflineMode, setTeleportedSessionInfo } from './bootstrap/state.js';
import { filterCommandsForRemoteMode, getCommands } from './commands.js';
import type { StatsStore } from './context/stats.js';
import { launchAssistantInstallWizard, launchAssistantSessionChooser, launchInvalidSettingsDialog, launchResumeChooser, launchSnapshotUpdateDialog, launchTeleportRepoMismatchDialog, launchTeleportResumeWrapper } from './dialogLaunchers.js';
import { SHOW_CURSOR } from './ink/termio/dec.js';
import { exitWithError, exitWithMessage, getRenderContext, renderAndRun, showSetupDialog, showSetupScreens } from './interactiveHelpers.js';
import { initBuiltinPlugins } from './plugins/bundled/index.js';
/* eslint-enable @typescript-eslint/no-require-imports */
import { checkQuotaStatus } from './services/urAiLimits.js';
import { getMcpToolsCommandsAndResources, prefetchAllMcpResources } from './services/mcp/client.js';
import { VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES } from './services/plugins/pluginCliCommands.js';
import { initBundledSkills } from './skills/bundled/index.js';
import type { AgentColorName } from './tools/AgentTool/agentColorManager.js';
import { getActiveAgentsFromList, getAgentDefinitionsWithOverrides, isBuiltInAgent, isCustomAgent, parseAgentsFromJson } from './tools/AgentTool/loadAgentsDir.js';
import type { LogOption } from './types/logs.js';
import type { Message as MessageType } from './types/message.js';
import { assertMinVersion } from './utils/autoUpdater.js';
import { UR_IN_CHROME_SKILL_HINT, UR_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER } from './utils/urInChrome/prompt.js';
import { setupURInChrome, shouldAutoEnableURInChrome, shouldEnableURInChrome } from './utils/urInChrome/setup.js';
import { getContextWindowForModel } from './utils/context.js';
import { loadConversationForResume } from './utils/conversationRecovery.js';
import { buildDeepLinkBanner } from './utils/deepLink/banner.js';
import { hasNodeOption, isBareMode, isEnvTruthy, isInProtectedNamespace } from './utils/envUtils.js';
import { refreshExampleCommands } from './utils/exampleCommands.js';
import type { FpsMetrics } from './utils/fpsTracker.js';
import { getWorktreePaths } from './utils/getWorktreePaths.js';
import { findGitRoot, getBranch, getIsGit, getWorktreeCount } from './utils/git.js';
import { getGhAuthStatus } from './utils/github/ghAuthStatus.js';
import { safeParseJSON } from './utils/json.js';
import { logError } from './utils/log.js';
import { getModelDeprecationWarning } from './utils/model/deprecation.js';
import { getDefaultMainLoopModel, getUserSpecifiedModelSetting, normalizeModelStringForAPI, parseUserSpecifiedModel } from './utils/model/model.js';
import { ensureModelStringsInitialized } from './utils/model/modelStrings.js';
import { listOllamaModelNames, refreshOllamaModelMetadata } from './utils/model/ollamaModels.js';
import {
  discoverOllamaHosts,
  type DiscoveredHost,
} from './utils/model/ollamaDiscovery.js';
import {
  getOllamaBaseUrl,
  setOllamaBaseUrlOverride,
} from './utils/model/ollamaConfig.js';
import { getAPIProvider } from './utils/model/providers.js';
import { PERMISSION_MODES } from './utils/permissions/PermissionMode.js';
import { checkAndDisableBypassPermissions, getAutoModeEnabledStateIfCached, initializeToolPermissionContext, initialPermissionModeFromCLI, isDefaultPermissionModeAuto, parseToolListFromCLI, removeDangerousPermissions, stripDangerousPermissionsForAutoMode, verifyAutoModeGateAccess } from './utils/permissions/permissionSetup.js';
import { cleanupOrphanedPluginVersionsInBackground } from './utils/plugins/cacheUtils.js';
import { initializeVersionedPlugins } from './utils/plugins/installedPluginsManager.js';
import { getManagedPluginNames } from './utils/plugins/managedPlugins.js';
import { getGlobExclusionsForPluginCache } from './utils/plugins/orphanedPluginFilter.js';
import { getPluginSeedDirs } from './utils/plugins/pluginDirectories.js';
import { countFilesRoundedRg } from './utils/ripgrep.js';
import { processSessionStartHooks, processSetupHooks } from './utils/sessionStart.js';
import { cacheSessionTitle, getSessionIdFromLog, loadTranscriptFromFile, saveAgentSetting, saveMode, searchSessionsByCustomTitle, sessionIdExists } from './utils/sessionStorage.js';
import { ensureMdmSettingsLoaded } from './utils/settings/mdm/settings.js';
import {
  getInitialSettings,
  getManagedSettingsKeysForLogging,
  getSettingsForSource,
  getSettingsWithErrors,
  updateSettingsForSource,
} from './utils/settings/settings.js';
import { getActiveProviderSettings } from './services/providers/providerRegistry.js';
import { shouldRequireStartupModelSelection } from './services/providers/startupModelSelection.js';
import { resetSettingsCache } from './utils/settings/settingsCache.js';
import type { ValidationError } from './utils/settings/validation.js';
import { DEFAULT_TASKS_MODE_TASK_LIST_ID, TASK_STATUSES } from './utils/tasks.js';
import { logPluginLoadErrors, logPluginsEnabledForSession } from './utils/telemetry/pluginTelemetry.js';
import { logSkillsLoaded } from './utils/telemetry/skillLoadedEvent.js';
import { generateTempFilePath } from './utils/tempfile.js';
import { validateUuid } from './utils/uuid.js';
// Plugin startup checks are now handled non-blockingly in REPL.tsx

import { registerMcpAddCommand } from 'src/commands/mcp/addCommand.js';
import { registerMcpXaaIdpCommand } from 'src/commands/mcp/xaaIdpCommand.js';
import { logPermissionContextForAnts } from 'src/services/internalLogging.js';
import { fetchURAIMcpConfigsIfEligible } from 'src/services/mcp/urai.js';
import { clearServerCache } from 'src/services/mcp/client.js';
import { areMcpConfigsAllowedWithEnterpriseMcpConfig, dedupURAiMcpServers, doesEnterpriseMcpConfigExist, filterMcpServersByPolicy, getURCodeMcpConfigs, getMcpServerSignature, parseMcpConfig, parseMcpConfigFromFilePath } from 'src/services/mcp/config.js';
import { excludeCommandsByServer, excludeResourcesByServer } from 'src/services/mcp/utils.js';
import { isXaaEnabled } from 'src/services/mcp/xaaIdpLogin.js';
import { getRelevantTips } from 'src/services/tips/tipRegistry.js';
import { logContextMetrics } from 'src/utils/api.js';
import { UR_IN_CHROME_MCP_SERVER_NAME, isURInChromeMCPServer } from 'src/utils/urInChrome/common.js';
import { registerCleanup } from 'src/utils/cleanupRegistry.js';
import { eagerParseCliFlag } from 'src/utils/cliArgs.js';
import { createEmptyAttributionState } from 'src/utils/commitAttribution.js';
import { countConcurrentSessions, registerSession, updateSessionName } from 'src/utils/concurrentSessions.js';
import { getCwd } from 'src/utils/cwd.js';
import { logForDebugging, setHasFormattedOutput } from 'src/utils/debug.js';
import { errorMessage, getErrnoCode, isENOENT, TeleportOperationError, toError } from 'src/utils/errors.js';
import { getFsImplementation, safeResolvePath } from 'src/utils/fsOperations.js';
import { gracefulShutdown, gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { setAllHookEventsEnabled } from 'src/utils/hooks/hookEvents.js';
import { refreshModelCapabilities } from 'src/utils/model/modelCapabilities.js';
import { peekForStdinData, writeToStderr } from 'src/utils/process.js';
import { setCwd } from 'src/utils/Shell.js';
import { type ProcessedResume, processResumedConversation } from 'src/utils/sessionRestore.js';
import { parseSettingSourcesFlag } from 'src/utils/settings/constants.js';
import { plural } from 'src/utils/stringUtils.js';
import { type ChannelEntry, getInitialMainLoopModel, getIsNonInteractiveSession, getSdkBetas, getSessionId, getUserMsgOptIn, setAllowedChannels, setAllowedSettingSources, setChromeFlagOverride, setClientType, setCwdState, setDirectConnectServerUrl, setFlagSettingsPath, setInitialMainLoopModel, setInlinePlugins, setIsInteractive, setKairosActive, setOriginalCwd, setQuestionPreviewFormat, setSdkBetas, setSessionBypassPermissionsMode, setSessionPersistenceDisabled, setSessionSource, setUserMsgOptIn, switchSession } from './bootstrap/state.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER') ? require('./utils/permissions/autoModeState.js') as typeof import('./utils/permissions/autoModeState.js') : null;

// TeleportRepoMismatchDialog, TeleportResumeWrapper dynamically imported at call sites
import { migrateAutoUpdatesToSettings } from './migrations/migrateAutoUpdatesToSettings.js';
import { migrateBypassPermissionsAcceptedToSettings } from './migrations/migrateBypassPermissionsAcceptedToSettings.js';
import { migrateEnableAllProjectMcpServersToSettings } from './migrations/migrateEnableAllProjectMcpServersToSettings.js';
import { migrateFennecTomodelO } from './migrations/migrateFennecTomodelO.js';
import { migrateLegacymodelOToCurrent } from './migrations/migrateLegacymodelOToCurrent.js';
import { migratemodelOTomodelO1m } from './migrations/migratemodelOTomodelO1m.js';
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from './migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js';
import { migratemodelS1mTomodelS45 } from './migrations/migratemodelS1mTomodelS45.js';
import { migratemodelS45TomodelS46 } from './migrations/migratemodelS45TomodelS46.js';
import { resetAutoModeOptInForDefaultOffer } from './migrations/resetAutoModeOptInForDefaultOffer.js';
import { resetProTomodelODefault } from './migrations/resetProTomodelODefault.js';
import { createRemoteSessionConfig } from './remote/RemoteSessionManager.js';
/* eslint-enable @typescript-eslint/no-require-imports */
// teleportWithProgress dynamically imported at call site
import { createDirectConnectSession, DirectConnectError } from './server/createDirectConnectSession.js';
import { initializeLspServerManager } from './services/lsp/manager.js';
import { shouldEnablePromptSuggestion } from './services/PromptSuggestion/promptSuggestion.js';
import { ProviderFirstModelPicker } from './components/ProviderFirstModelPicker.js';
import { type AppState, getDefaultAppState, IDLE_SPECULATION_STATE } from './state/AppStateStore.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { createStore } from './state/store.js';
import { asSessionId } from './types/ids.js';
import { filterAllowedSdkBetas } from './utils/betas.js';
import { isInBundledMode, isRunningWithBun } from './utils/bundledMode.js';
import { logForDiagnosticsNoPII } from './utils/diagLogs.js';
import { filterExistingPaths, getKnownPathsForRepo } from './utils/githubRepoPathMapping.js';
import { clearPluginCache, loadAllPluginsCacheOnly } from './utils/plugins/pluginLoader.js';
import { migrateChangelogFromConfig } from './utils/releaseNotes.js';
import { SandboxManager } from './utils/sandbox/sandbox-adapter.js';
import { fetchSession, prepareApiRequest } from './utils/teleport/api.js';
import { checkOutTeleportedSessionBranch, processMessagesForTeleportResume, teleportToRemoteWithErrorHandling, validateGitState, validateSessionRepository } from './utils/teleport.js';
import { shouldEnableThinkingByDefault, type ThinkingConfig } from './utils/thinking.js';
import { initUser, resetUserCache } from './utils/user.js';
import { getTmuxInstallInstructions, isTmuxAvailable, parsePRReference } from './utils/worktree.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_imports_loaded');

/**
 * Log managed settings keys to Statsig for analytics.
 * This is called after init() completes to ensure settings are loaded
 * and environment variables are applied before model resolution.
 */
function logManagedSettings(): void {
  try {
    const policySettings = getSettingsForSource('policySettings');
    if (policySettings) {
      const allKeys = getManagedSettingsKeysForLogging(policySettings);
      logEvent('tengu_managed_settings_loaded', {
        keyCount: allKeys.length,
        keys: allKeys.join(',') as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  } catch {
    // Silently ignore errors - this is just for analytics
  }
}

// Check if running in debug/inspection mode
function isBeingDebugged() {
  const isBun = isRunningWithBun();

  // Check for inspect flags in process arguments (including all variants)
  const hasInspectArg = process.execArgv.some(arg => {
    if (isBun) {
      // Note: Bun has an issue with single-file executables where application arguments
      // This breaks use of --debug mode if we omit this branch
      // We're fine to skip that check, because Bun doesn't support Node.js legacy --debug or --debug-brk flags
      return /--inspect(-brk)?/.test(arg);
    } else {
      // In Node.js, check for both --inspect and legacy --debug flags
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg);
    }
  });

  // Check if NODE_OPTIONS contains inspect flags
  const hasInspectEnv = process.env.NODE_OPTIONS && /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS);

  // Check if inspector is available and active (indicates debugging)
  try {
    // Dynamic import would be better but is async - use global object instead
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspector = (global as any).require('inspector');
    const hasInspectorUrl = !!inspector.url();
    return hasInspectorUrl || hasInspectArg || hasInspectEnv;
  } catch {
    // Ignore error and fall back to argument detection
    return hasInspectArg || hasInspectEnv;
  }
}

// Exit if we detect node debugging or inspection
if (("external" as string) !== 'ant' && isBeingDebugged()) {
  // Use process.exit directly here since we're in the top-level code before imports
  // and gracefulShutdown is not yet available
  // eslint-disable-next-line custom-rules/no-top-level-side-effects
  process.exit(1);
}

/**
 * Per-session skill/plugin telemetry. Called from both the interactive path
 * and the headless -p path (before runHeadless) — both go through
 * main.tsx but branch before the interactive startup path, so it needs two
 * call sites here rather than one here + one in QueryEngine.
 */
function logSessionTelemetry(): void {
  const model = parseUserSpecifiedModel(getInitialMainLoopModel() ?? getDefaultMainLoopModel());
  void logSkillsLoaded(getCwd(), getContextWindowForModel(model, getSdkBetas()));
  void loadAllPluginsCacheOnly().then(({
    enabled,
    errors
  }) => {
    const managedNames = getManagedPluginNames();
    logPluginsEnabledForSession(enabled, managedNames, getPluginSeedDirs());
    logPluginLoadErrors(errors, managedNames);
  }).catch(err => logError(err));
}
function getCertEnvVarTelemetry(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (process.env.NODE_EXTRA_CA_CERTS) {
    result.has_node_extra_ca_certs = true;
  }
  if (process.env.UR_CODE_CLIENT_CERT) {
    result.has_client_cert = true;
  }
  if (hasNodeOption('--use-system-ca')) {
    result.has_use_system_ca = true;
  }
  if (hasNodeOption('--use-openssl-ca')) {
    result.has_use_openssl_ca = true;
  }
  return result;
}
async function logStartupTelemetry(): Promise<void> {
  if (isAnalyticsDisabled()) return;
  const [isGit, worktreeCount, ghAuthStatus] = await Promise.all([getIsGit(), getWorktreeCount(), getGhAuthStatus()]);
  logEvent('tengu_startup_telemetry', {
    is_git: isGit,
    worktree_count: worktreeCount,
    gh_auth_status: ghAuthStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sandbox_enabled: SandboxManager.isSandboxingEnabled(),
    are_unsandboxed_commands_allowed: SandboxManager.areUnsandboxedCommandsAllowed(),
    is_auto_bash_allowed_if_sandbox_enabled: SandboxManager.isAutoAllowBashIfSandboxedEnabled(),
    auto_updater_disabled: isAutoUpdaterDisabled(),
    prefers_reduced_motion: getInitialSettings().prefersReducedMotion ?? false,
    ...getCertEnvVarTelemetry()
  });
}

// @[MODEL LAUNCH]: Consider any migrations you may need for model strings. See migratemodelS1mTomodelS45.ts for an example.
// Bump this when adding a new sync migration so existing users re-run the set.
const CURRENT_MIGRATION_VERSION = 11;
function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings();
    migrateBypassPermissionsAcceptedToSettings();
    migrateEnableAllProjectMcpServersToSettings();
    resetProTomodelODefault();
    migratemodelS1mTomodelS45();
    migrateLegacymodelOToCurrent();
    migratemodelS45TomodelS46();
    migratemodelOTomodelO1m();
    migrateReplBridgeEnabledToRemoteControlAtStartup();
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer();
    }
    if (("external" as string) === 'ant') {
      migrateFennecTomodelO();
    }
    saveGlobalConfig(prev => prev.migrationVersion === CURRENT_MIGRATION_VERSION ? prev : {
      ...prev,
      migrationVersion: CURRENT_MIGRATION_VERSION
    });
  }
  // Async migration - fire and forget since it's non-blocking
  migrateChangelogFromConfig().catch(() => {
    // Silently ignore migration errors - will retry on next startup
  });
}

/**
 * Prefetch system context (including git status) only when it's safe to do so.
 * Git commands can execute arbitrary code via hooks and config (e.g., core.fsmonitor,
 * diff.external), so we must only run them after trust is established or in
 * non-interactive mode where trust is implicit.
 */
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession();

  // In non-interactive mode (--print), trust dialog is skipped and
  // execution is considered trusted (as documented in help text)
  if (isNonInteractiveSession) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_non_interactive');
    void getSystemContext();
    return;
  }

  // In interactive mode, only prefetch if trust has already been established
  const hasTrust = checkHasTrustDialogAccepted();
  if (hasTrust) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_has_trust');
    void getSystemContext();
  } else {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_skipped_no_trust');
  }
  // Otherwise, don't prefetch - wait for trust to be established first
}

/**
 * Start background prefetches and housekeeping that are NOT needed before first render.
 * These are deferred from setup() to reduce event loop contention and child process
 * spawning during the critical startup path.
 * Call this after the REPL has been rendered.
 */
export function startDeferredPrefetches(): void {
  // This function runs after first render, so it doesn't block the initial paint.
  // However, the spawned processes and async work still contend for CPU and event
  // loop time, which skews startup benchmarks (CPU profiles, time-to-first-render
  // measurements). Skip all of it when we're only measuring startup performance.
  if (isEnvTruthy(process.env.UR_CODE_EXIT_AFTER_FIRST_RENDER) ||
  // --bare: skip ALL prefetches. These are cache-warms for the REPL's
  // first-turn responsiveness (initUser, getUserContext, tips, countFiles,
  // modelCapabilities, change detectors). Scripted -p calls don't have a
  // "user is typing" window to hide this work in — it's pure overhead on
  // the critical path.
  isBareMode()) {
    return;
  }

  // Process-spawning prefetches (consumed at first API call, user is still typing)
  void initUser();
  void getUserContext();
  prefetchSystemContextIfSafe();
  void getRelevantTips();
  if (isEnvTruthy(process.env.UR_CODE_USE_BEDROCK) && !isEnvTruthy(process.env.UR_CODE_SKIP_BEDROCK_AUTH)) {
    void prefetchAwsCredentialsAndBedRockInfoIfSafe();
  }
  if (isEnvTruthy(process.env.UR_CODE_USE_VERTEX) && !isEnvTruthy(process.env.UR_CODE_SKIP_VERTEX_AUTH)) {
    void prefetchGcpCredentialsIfSafe();
  }
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), []);

  // Analytics and feature flag initialization
  void initializeAnalyticsGates();
  void prefetchOfficialMcpUrls();
  void refreshModelCapabilities();

  // File change detectors deferred from init() to unblock first render
  void settingsChangeDetector.initialize();
  if (!isBareMode()) {
    void skillChangeDetector.initialize();
  }

  // Event loop stall detector — logs when the main thread is blocked >500ms
  if (("external" as string) === 'ant') {
    void import('./utils/eventLoopStallDetector.js').then(m => m.startEventLoopStallDetector());
  }
}
function loadSettingsFromFlag(settingsFile: string): void {
  try {
    const trimmedSettings = settingsFile.trim();
    const looksLikeJson = trimmedSettings.startsWith('{') && trimmedSettings.endsWith('}');
    let settingsPath: string;
    if (looksLikeJson) {
      // It's a JSON string - validate and create temp file
      const parsedJson = safeParseJSON(trimmedSettings);
      if (!parsedJson) {
        process.stderr.write(chalk.red('Error: Invalid JSON provided to --settings\n'));
        process.exit(1);
      }

      // Create a temporary file and write the JSON to it.
      // Use a content-hash-based path instead of random UUID to avoid
      // busting the UR API prompt cache. The settings path ends up
      // in the Bash tool's sandbox denyWithinAllow list, which is part of
      // the tool description sent to the API. A random UUID per subprocess
      // changes the tool description on every query() call, invalidating
      // the cache prefix and causing a 12x input token cost penalty.
      // The content hash ensures identical settings produce the same path
      // across process boundaries (each SDK query() spawns a new process).
      settingsPath = generateTempFilePath('ur-settings', '.json', {
        contentHash: trimmedSettings
      });
      writeFileSync_DEPRECATED(settingsPath, trimmedSettings, 'utf8');
    } else {
      // It's a file path - resolve and validate by attempting to read
      const {
        resolvedPath: resolvedSettingsPath
      } = safeResolvePath(getFsImplementation(), settingsFile);
      try {
        readFileSync(resolvedSettingsPath, 'utf8');
      } catch (e) {
        if (isENOENT(e)) {
          process.stderr.write(chalk.red(`Error: Settings file not found: ${resolvedSettingsPath}\n`));
          process.exit(1);
        }
        throw e;
      }
      settingsPath = resolvedSettingsPath;
    }
    setFlagSettingsPath(settingsPath);
    resetSettingsCache();
  } catch (error) {
    if (error instanceof Error) {
      logError(error);
    }
    process.stderr.write(chalk.red(`Error processing settings: ${errorMessage(error)}\n`));
    process.exit(1);
  }
}
function loadSettingSourcesFromFlag(settingSourcesArg: string): void {
  try {
    const sources = parseSettingSourcesFlag(settingSourcesArg);
    setAllowedSettingSources(sources);
    resetSettingsCache();
  } catch (error) {
    if (error instanceof Error) {
      logError(error);
    }
    process.stderr.write(chalk.red(`Error processing --setting-sources: ${errorMessage(error)}\n`));
    process.exit(1);
  }
}

/**
 * Parse and load settings flags early, before init()
 * This ensures settings are filtered from the start of initialization
 */
function eagerLoadSettings(): void {
  profileCheckpoint('eagerLoadSettings_start');
  // Parse --settings flag early to ensure settings are loaded before init()
  const settingsFile = eagerParseCliFlag('--settings');
  if (settingsFile) {
    loadSettingsFromFlag(settingsFile);
  }

  // Parse --setting-sources flag early to control which sources are loaded
  const settingSourcesArg = eagerParseCliFlag('--setting-sources');
  if (settingSourcesArg !== undefined) {
    loadSettingSourcesFromFlag(settingSourcesArg);
  }
  profileCheckpoint('eagerLoadSettings_end');
}
function initializeEntrypoint(isNonInteractive: boolean): void {
  // Skip if already set (e.g., by SDK or other entrypoints)
  if (process.env.UR_CODE_ENTRYPOINT) {
    return;
  }
  const cliArgs = process.argv.slice(2);

  // Check for MCP serve command (handle flags before mcp serve, e.g., --debug mcp serve)
  const mcpIndex = cliArgs.indexOf('mcp');
  if (mcpIndex !== -1 && ['serve', 'serve-http'].includes(cliArgs[mcpIndex + 1] ?? '')) {
    process.env.UR_CODE_ENTRYPOINT = 'mcp';
    return;
  }
  const agUiIndex = cliArgs.indexOf('ag-ui');
  if (agUiIndex !== -1 && cliArgs[agUiIndex + 1] === 'serve') {
    process.env.UR_CODE_ENTRYPOINT = 'ag-ui';
    return;
  }
  if (isEnvTruthy(process.env.UR_CODE_ACTION)) {
    process.env.UR_CODE_ENTRYPOINT = 'ur-github-action';
    return;
  }

  // Note: 'local-agent' entrypoint is set by the local agent mode launcher
  // via UR_CODE_ENTRYPOINT env var (handled by early return above)

  // Set based on interactive status
  process.env.UR_CODE_ENTRYPOINT = isNonInteractive ? 'sdk-cli' : 'cli';
}

// Set by early argv processing when `ur open <url>` is detected (interactive mode only)
type PendingConnect = {
  url: string | undefined;
  authToken: string | undefined;
  dangerouslySkipPermissions: boolean;
};
const _pendingConnect: PendingConnect | undefined = feature('DIRECT_CONNECT') ? {
  url: undefined,
  authToken: undefined,
  dangerouslySkipPermissions: false
} : undefined;

// Set by early argv processing when `ur assistant [sessionId]` is detected
type PendingAssistantChat = {
  sessionId?: string;
  discover: boolean;
};
const _pendingAssistantChat: PendingAssistantChat | undefined = feature('KAIROS') ? {
  sessionId: undefined,
  discover: false
} : undefined;

// `ur ssh <host> [dir]` — parsed from argv early (same pattern as
// DIRECT_CONNECT above) so the main command path can pick it up and hand
// the REPL an SSH-backed session instead of a local one.
type PendingSSH = {
  host: string | undefined;
  cwd: string | undefined;
  permissionMode: string | undefined;
  dangerouslySkipPermissions: boolean;
  /** --local: spawn the child CLI directly, skip ssh/probe/deploy. e2e test mode. */
  local: boolean;
  /** Extra CLI args to forward to the remote CLI on initial spawn (--resume, -c). */
  extraCliArgs: string[];
};
const _pendingSSH: PendingSSH | undefined = feature('SSH_REMOTE') ? {
  host: undefined,
  cwd: undefined,
  permissionMode: undefined,
  dangerouslySkipPermissions: false,
  local: false,
  extraCliArgs: []
} : undefined;
export async function main() {
  profileCheckpoint('main_function_start');

  // SECURITY: Prevent Windows from executing commands from current directory
  // This must be set before ANY command execution to prevent PATH hijacking attacks
  // See: https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  process.env.NoDefaultCurrentDirectoryInExePath = '1';

  // Initialize warning handler early to catch warnings
  initializeWarningHandler();
  process.on('exit', () => {
    resetCursor();
  });
  process.on('SIGINT', () => {
    // In print mode, print.ts registers its own SIGINT handler that aborts
    // the in-flight query and calls gracefulShutdown; skip here to avoid
    // preempting it with a synchronous process.exit().
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return;
    }
    process.exit(0);
  });
  profileCheckpoint('main_warning_handler_initialized');

  // Check for cc:// or cc+unix:// URL in argv — rewrite so the main command
  // handles it, giving the full interactive TUI instead of a stripped-down subcommand.
  // For headless (-p), we rewrite to the internal `open` subcommand.
  if (feature('DIRECT_CONNECT')) {
    const rawCliArgs = process.argv.slice(2);
    const ccIdx = rawCliArgs.findIndex(a => a.startsWith('cc://') || a.startsWith('cc+unix://'));
    if (ccIdx !== -1 && _pendingConnect) {
      const ccUrl = rawCliArgs[ccIdx]!;
      const {
        parseConnectUrl
      } = await import('./server/parseConnectUrl.js');
      const parsed = parseConnectUrl(ccUrl);
      _pendingConnect.dangerouslySkipPermissions = rawCliArgs.includes('--dangerously-skip-permissions');
      if (rawCliArgs.includes('-p') || rawCliArgs.includes('--print')) {
        // Headless: rewrite to internal `open` subcommand
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions');
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1);
        }
        process.argv = [process.argv[0]!, process.argv[1]!, 'open', ccUrl, ...stripped];
      } else {
        // Interactive: strip cc:// URL and flags, run main command
        _pendingConnect.url = parsed.serverUrl;
        _pendingConnect.authToken = parsed.authToken;
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions');
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1);
        }
        process.argv = [process.argv[0]!, process.argv[1]!, ...stripped];
      }
    }
  }

  // Handle deep link URIs early — this is invoked by the OS protocol handler
  // and should bail out before full init since it only needs to parse the URI
  // and open a terminal.
  if (feature('LODESTONE')) {
    const handleUriIdx = process.argv.indexOf('--handle-uri');
    if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
      const {
        enableConfigs
      } = await import('./utils/config.js');
      enableConfigs();
      const uri = process.argv[handleUriIdx + 1]!;
      const {
        handleDeepLinkUri
      } = await import('./utils/deepLink/protocolHandler.js');
      const exitCode = await handleDeepLinkUri(uri);
      process.exit(exitCode);
    }

    // macOS URL handler: when LaunchServices launches our .app bundle, the
    // URL arrives via Apple Event (not argv). LaunchServices overwrites
    // __CFBundleIdentifier to the launching bundle's ID, which is a precise
    // positive signal — cheaper than importing and guessing with heuristics.
    if (process.platform === 'darwin' && process.env.__CFBundleIdentifier === 'com.urhq.ur-url-handler') {
      const {
        enableConfigs
      } = await import('./utils/config.js');
      enableConfigs();
      const {
        handleUrlSchemeLaunch
      } = await import('./utils/deepLink/protocolHandler.js');
      const urlSchemeResult = await handleUrlSchemeLaunch();
      process.exit(urlSchemeResult ?? 1);
    }
  }

  // `ur assistant [sessionId]` — stash and strip so the main
  // command handles it, giving the full interactive TUI. Position-0 only
  // (matching the ssh pattern below) — indexOf would false-positive on
  // `ur -p "explain assistant"`. Root-flag-before-subcommand
  // (e.g. `--debug assistant`) falls through to the stub, which
  // prints usage.
  if (feature('KAIROS') && _pendingAssistantChat) {
    const rawArgs = process.argv.slice(2);
    if (rawArgs[0] === 'assistant') {
      const nextArg = rawArgs[1];
      if (nextArg && !nextArg.startsWith('-')) {
        _pendingAssistantChat.sessionId = nextArg;
        rawArgs.splice(0, 2); // drop 'assistant' and sessionId
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
      } else if (!nextArg) {
        _pendingAssistantChat.discover = true;
        rawArgs.splice(0, 1); // drop 'assistant'
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
      }
      // else: `ur assistant --help` → fall through to stub
    }
  }

  // `ur ssh <host> [dir]` — strip from argv so the main command handler
  // runs (full interactive TUI), stash the host/dir for the REPL branch at
  // ~line 3720 to pick up. Headless (-p) mode not supported in v1: SSH
  // sessions need the local REPL to drive them (interrupt, permissions).
  if (feature('SSH_REMOTE') && _pendingSSH) {
    const rawCliArgs = process.argv.slice(2);
    // SSH-specific flags can appear before the host positional (e.g.
    // `ssh --permission-mode auto host /tmp` — standard POSIX flags-before-
    // positionals). Pull them all out BEFORE checking whether a host was
    // given, so `ur ssh --permission-mode auto host` and `ur ssh host
    // --permission-mode auto` are equivalent. The host check below only needs
    // to guard against `-h`/`--help` (which commander should handle).
    if (rawCliArgs[0] === 'ssh') {
      const localIdx = rawCliArgs.indexOf('--local');
      if (localIdx !== -1) {
        _pendingSSH.local = true;
        rawCliArgs.splice(localIdx, 1);
      }
      const dspIdx = rawCliArgs.indexOf('--dangerously-skip-permissions');
      if (dspIdx !== -1) {
        _pendingSSH.dangerouslySkipPermissions = true;
        rawCliArgs.splice(dspIdx, 1);
      }
      const pmIdx = rawCliArgs.indexOf('--permission-mode');
      if (pmIdx !== -1 && rawCliArgs[pmIdx + 1] && !rawCliArgs[pmIdx + 1]!.startsWith('-')) {
        _pendingSSH.permissionMode = rawCliArgs[pmIdx + 1];
        rawCliArgs.splice(pmIdx, 2);
      }
      const pmEqIdx = rawCliArgs.findIndex(a => a.startsWith('--permission-mode='));
      if (pmEqIdx !== -1) {
        _pendingSSH.permissionMode = rawCliArgs[pmEqIdx]!.split('=')[1];
        rawCliArgs.splice(pmEqIdx, 1);
      }
      // Forward session-resume + model flags to the remote CLI's initial spawn.
      // --continue/-c and --resume <uuid> operate on the REMOTE session history
      // (which persists under the remote's ~/.ur/projects/<cwd>/).
      // --model controls which model the remote uses.
      const extractFlag = (flag: string, opts: {
        hasValue?: boolean;
        as?: string;
      } = {}) => {
        const i = rawCliArgs.indexOf(flag);
        if (i !== -1) {
          _pendingSSH.extraCliArgs.push(opts.as ?? flag);
          const val = rawCliArgs[i + 1];
          if (opts.hasValue && val && !val.startsWith('-')) {
            _pendingSSH.extraCliArgs.push(val);
            rawCliArgs.splice(i, 2);
          } else {
            rawCliArgs.splice(i, 1);
          }
        }
        const eqI = rawCliArgs.findIndex(a => a.startsWith(`${flag}=`));
        if (eqI !== -1) {
          _pendingSSH.extraCliArgs.push(opts.as ?? flag, rawCliArgs[eqI]!.slice(flag.length + 1));
          rawCliArgs.splice(eqI, 1);
        }
      };
      extractFlag('-c', {
        as: '--continue'
      });
      extractFlag('--continue');
      extractFlag('--resume', {
        hasValue: true
      });
      extractFlag('--model', {
        hasValue: true
      });
    }
    // After pre-extraction, any remaining dash-arg at [1] is either -h/--help
    // (commander handles) or an unknown-to-ssh flag (fall through to commander
    // so it surfaces a proper error). Only a non-dash arg is the host.
    if (rawCliArgs[0] === 'ssh' && rawCliArgs[1] && !rawCliArgs[1].startsWith('-')) {
      _pendingSSH.host = rawCliArgs[1];
      // Optional positional cwd.
      let consumed = 2;
      if (rawCliArgs[2] && !rawCliArgs[2].startsWith('-')) {
        _pendingSSH.cwd = rawCliArgs[2];
        consumed = 3;
      }
      const rest = rawCliArgs.slice(consumed);

      // Headless (-p) mode is not supported with SSH in v1 — reject early
      // so the flag doesn't silently cause local execution.
      if (rest.includes('-p') || rest.includes('--print')) {
        process.stderr.write('Error: headless (-p/--print) mode is not supported with ur ssh\n');
        gracefulShutdownSync(1);
        return;
      }

      // Rewrite argv so the main command sees remaining flags but not `ssh`.
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
    }
  }

  // Check for -p/--print and --init-only flags early to set isInteractiveSession before init()
  // This is needed because telemetry initialization calls auth functions that need this flag
  const cliArgs = process.argv.slice(2);
  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');
  const hasInitOnlyFlag = cliArgs.includes('--init-only');
  const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'));
  const isNonInteractive = hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;

  // Stop capturing early input for non-interactive modes
  if (isNonInteractive) {
    stopCapturingEarlyInput();
  }

  // Set simplified tracking fields
  const isInteractive = !isNonInteractive;
  setIsInteractive(isInteractive);

  // Initialize entrypoint based on mode - needs to be set before any event is logged
  initializeEntrypoint(isNonInteractive);

  // Determine client type
  const clientType = (() => {
    if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action';
    if (process.env.UR_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript';
    if (process.env.UR_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python';
    if (process.env.UR_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli';
    if (process.env.UR_CODE_ENTRYPOINT === 'ur-vscode') return 'ur-vscode';
    if (process.env.UR_CODE_ENTRYPOINT === 'local-agent') return 'local-agent';
    if (process.env.UR_CODE_ENTRYPOINT === 'ur-desktop') return 'ur-desktop';

    // Check if session-ingress token is provided (indicates remote session)
    const hasSessionIngressToken = process.env.UR_CODE_SESSION_ACCESS_TOKEN || process.env.UR_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR;
    if (process.env.UR_CODE_ENTRYPOINT === 'remote' || hasSessionIngressToken) {
      return 'remote';
    }
    return 'cli';
  })();
  setClientType(clientType);
  const previewFormat = process.env.UR_CODE_QUESTION_PREVIEW_FORMAT;
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat);
  } else if (!clientType.startsWith('sdk-') &&
  // Desktop and CCR pass previewFormat via toolConfig; when the feature is
  // gated off they pass undefined — don't override that with markdown.
  clientType !== 'ur-desktop' && clientType !== 'local-agent' && clientType !== 'remote') {
    setQuestionPreviewFormat('markdown');
  }

  // Tag sessions created via `ur remote-control` so the backend can identify them
  if (process.env.UR_CODE_ENVIRONMENT_KIND === 'bridge') {
    setSessionSource('remote-control');
  }
  profileCheckpoint('main_client_type_determined');

  // Parse and load settings flags early, before init()
  eagerLoadSettings();
  profileCheckpoint('main_before_run');
  await run();
  profileCheckpoint('main_after_run');
}
async function getInputPrompt(prompt: string, inputFormat: 'text' | 'stream-json'): Promise<string | AsyncIterable<string>> {
  if (!process.stdin.isTTY &&
  // Input hijacking breaks MCP.
  !process.argv.includes('mcp')) {
    if (inputFormat === 'stream-json') {
      return process.stdin;
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    const onData = (chunk: string) => {
      data += chunk;
    };
    process.stdin.on('data', onData);
    // If no data arrives in 3s, stop waiting and warn. Stdin is likely an
    // inherited pipe from a parent that isn't writing (subprocess spawned
    // without explicit stdin handling). 3s covers slow producers like curl,
    // jq on large files, python with import overhead. The warning makes
    // silent data loss visible for the rare producer that's slower still.
    const timedOut = await peekForStdinData(process.stdin, 3000);
    process.stdin.off('data', onData);
    if (timedOut) {
      process.stderr.write('Warning: no stdin data received in 3s, proceeding without it. ' + 'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n');
    }
    return [prompt, data].filter(Boolean).join('\n');
  }
  return prompt;
}
async function run(): Promise<CommanderCommand> {
  profileCheckpoint('run_function_start');

  // Create help config that sorts options by long option name.
  // Commander supports compareOptions at runtime but @commander-js/extra-typings
  // doesn't include it in the type definitions, so we use Object.assign to add it.
  function createSortedHelpConfig(): {
    sortSubcommands: true;
    sortOptions: true;
  } {
    const getOptionSortKey = (opt: Option): string => opt.long?.replace(/^--/, '') ?? opt.short?.replace(/^-/, '') ?? '';
    return Object.assign({
      sortSubcommands: true,
      sortOptions: true
    } as const, {
      compareOptions: (a: Option, b: Option) => getOptionSortKey(a).localeCompare(getOptionSortKey(b))
    });
  }
  const program = new CommanderCommand().configureHelp(createSortedHelpConfig()).enablePositionalOptions();
  profileCheckpoint('run_commander_initialized');

  // Use preAction hook to run initialization only when executing a command,
  // not when displaying help. This avoids the need for env variable signaling.
  program.hook('preAction', async thisCommand => {
    profileCheckpoint('preAction_start');
    // Await async subprocess loads started at module evaluation (lines 12-20).
    // Nearly free — subprocesses complete during the ~135ms of imports above.
    // Must resolve before init() which triggers the first settings read
    // (applySafeConfigEnvironmentVariables → getSettingsForSource('policySettings')
    // → isRemoteManagedSettingsEligible → sync keychain reads otherwise ~65ms).
    await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()]);
    profileCheckpoint('preAction_after_mdm');
    await init();
    profileCheckpoint('preAction_after_init');

    // process.title on Windows sets the console title directly; on POSIX,
    // terminal shell integration may mirror the process name to the tab.
    // After init() so settings.json env can also gate this (gh-4765).
    if (!isEnvTruthy(process.env.UR_CODE_DISABLE_TERMINAL_TITLE)) {
      process.title = 'ur';
    }

    // Attach logging sinks so subcommand handlers can use logEvent/logError.
    // Before PR #11106 logEvent dispatched directly; after, events queue until
    // a sink attaches. setup() attaches sinks for the default command, but
    // subcommands (doctor, mcp, plugin, auth) never call setup() and would
    // silently drop events on process.exit(). Both inits are idempotent.
    const {
      initSinks
    } = await import('./utils/sinks.js');
    initSinks();
    profileCheckpoint('preAction_after_sinks');

    // gh-33508: --plugin-dir is a top-level program option. The default
    // action reads it from its own options destructure, but subcommands
    // (plugin list, plugin install, mcp *) have their own actions and
    // never see it. Wire it up here so getInlinePlugins() works everywhere.
    // thisCommand.opts() is typed {} here because this hook is attached
    // before .option('--plugin-dir', ...) in the chain — extra-typings
    // builds the type as options are added. Narrow with a runtime guard;
    // the collect accumulator + [] default guarantee string[] in practice.
    const pluginDir = thisCommand.getOptionValue('pluginDir');
    if (Array.isArray(pluginDir) && pluginDir.length > 0 && pluginDir.every(p => typeof p === 'string')) {
      setInlinePlugins(pluginDir);
      clearPluginCache('preAction: --plugin-dir inline plugins');
    }
    runMigrations();
    profileCheckpoint('preAction_after_migrations');

    // Load remote managed settings for enterprise customers (non-blocking)
    // Fails open - if fetch fails, continues without remote settings
    // Settings are applied via hot-reload when they arrive
    // Must happen after init() to ensure config reading is allowed
    void loadRemoteManagedSettings();
    void loadPolicyLimits();
    profileCheckpoint('preAction_after_remote_settings');

    // Load settings sync (non-blocking, fail-open)
    // CLI: uploads local settings to remote (CCR download is handled by print.ts)
    if (feature('UPLOAD_USER_SETTINGS')) {
      void import('./services/settingsSync/index.js').then(m => m.uploadUserSettingsInBackground());
    }
    profileCheckpoint('preAction_after_settings_sync');
  });
  program.name('ur').description(`UR-Nexus — autonomous engineering workflow engine (plan, execute, test, verify, document, benchmark, reproduce). Starts an interactive session by default; use -p/--print for non-interactive output.`).argument('[prompt]', 'Your prompt', String)
  // Subcommands inherit helpOption via commander's copyInheritedSettings —
  // setting it once here covers mcp, plugin, auth, and all other subcommands.
  .helpOption('-h, --help', 'Display help for command').option('-d, --debug [filter]', 'Enable debug mode with optional category filtering (e.g., "api,hooks" or "!1p,!file")', (_value: string | true) => {
    // If value is provided, it will be the filter string
    // If not provided but flag is present, value will be true
    // The actual filtering is handled in debug.ts by parsing process.argv
    return true;
  }).addOption(new Option('--debug-to-stderr', 'Enable debug mode (to stderr)').argParser(Boolean).hideHelp()).option('--debug-file <path>', 'Write debug logs to a specific file path (implicitly enables debug mode)', () => true).option('--verbose', 'Override verbose mode setting from config', () => true).option('-p, --print', 'Print response and exit (useful for pipes). Note: The workspace trust dialog is skipped when UR is run with the -p mode. Only use this flag in directories you trust.', () => true).option('--bare', 'Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and UR.md auto-discovery. Sets UR_CODE_SIMPLE=1. Model execution always uses the local Ollama backend. Skills still resolve via /skill-name. Explicitly provide context via: --system-prompt[-file], --append-system-prompt[-file], --add-dir (UR.md dirs), --mcp-config, --settings, --agents, --plugin-dir.', () => true).addOption(new Option('--init', 'Run Setup hooks with init trigger, then continue').hideHelp()).addOption(new Option('--init-only', 'Run Setup and SessionStart:startup hooks, then exit').hideHelp()).addOption(new Option('--maintenance', 'Run Setup hooks with maintenance trigger, then continue').hideHelp()).addOption(new Option('--output-format <format>', 'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)').choices(['text', 'json', 'stream-json'])).addOption(new Option('--json-schema <schema>', 'JSON Schema for structured output validation. ' + 'Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}').argParser(String)).option('--include-hook-events', 'Include all hook lifecycle events in the output stream (only works with --output-format=stream-json)', () => true).option('--include-partial-messages', 'Include partial message chunks as they arrive (only works with --print and --output-format=stream-json)', () => true).addOption(new Option('--input-format <format>', 'Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input)').choices(['text', 'stream-json'])).option('--mcp-debug', '[DEPRECATED. Use --debug instead] Enable MCP debug mode (shows MCP server errors)', () => true).option('--dangerously-skip-permissions', 'Bypass all permission checks. Recommended only for sandboxes with no internet access.', () => true).option('--allow-dangerously-skip-permissions', 'Enable bypassing all permission checks as an option, without it being enabled by default. Recommended only for sandboxes with no internet access.', () => true).addOption(new Option('--thinking <mode>', 'Thinking mode: enabled (equivalent to adaptive), disabled').choices(['enabled', 'adaptive', 'disabled']).hideHelp()).addOption(new Option('--max-thinking-tokens <tokens>', '[DEPRECATED. Use --thinking instead for newer models] Maximum number of thinking tokens (only works with --print)').argParser(Number).hideHelp()).addOption(new Option('--max-turns <turns>', 'Maximum number of agentic turns in non-interactive mode. This will early exit the conversation after the specified number of turns. (only works with --print)').argParser(Number).hideHelp()).addOption(new Option('--max-budget-usd <amount>', 'Maximum dollar amount to spend on API calls (only works with --print)').argParser(value => {
    const amount = Number(value);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('--max-budget-usd must be a positive number greater than 0');
    }
    return amount;
  })).addOption(new Option('--task-budget <tokens>', 'API-side task budget in tokens (output_config.task_budget)').argParser(value => {
    const tokens = Number(value);
    if (isNaN(tokens) || tokens <= 0 || !Number.isInteger(tokens)) {
      throw new Error('--task-budget must be a positive integer');
    }
    return tokens;
  }).hideHelp()).option('--replay-user-messages', 'Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)', () => true).addOption(new Option('--enable-auth-status', 'Enable auth status messages in SDK mode').default(false).hideHelp()).option('--allowedTools, --allowed-tools <tools...>', 'Comma or space-separated list of tool names to allow (e.g. "Bash(git:*) Edit")').option('--tools <tools...>', 'Specify the list of available tools from the built-in set. Use "" to disable all tools, "default" to use all tools, or specify tool names (e.g. "Bash,Edit,Read").').option('--disallowedTools, --disallowed-tools <tools...>', 'Comma or space-separated list of tool names to deny (e.g. "Bash(git:*) Edit")').option('--mcp-config <configs...>', 'Load MCP servers from JSON files or strings (space-separated)').addOption(new Option('--permission-prompt-tool <tool>', 'MCP tool to use for permission prompts (only works with --print)').argParser(String).hideHelp()).addOption(new Option('--system-prompt <prompt>', 'System prompt to use for the session').argParser(String)).addOption(new Option('--system-prompt-file <file>', 'Read system prompt from a file').argParser(String).hideHelp()).addOption(new Option('--append-system-prompt <prompt>', 'Append a system prompt to the default system prompt').argParser(String)).addOption(new Option('--append-system-prompt-file <file>', 'Read system prompt from a file and append to the default system prompt').argParser(String).hideHelp()).addOption(new Option('--permission-mode <mode>', 'Permission mode to use for the session').argParser(String).choices(PERMISSION_MODES)).option('-c, --continue', 'Continue the most recent conversation in the current directory', () => true).option('-r, --resume [value]', 'Resume a conversation by session ID, or open interactive picker with optional search term', value => value || true).option('--fork-session', 'When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)', () => true).addOption(new Option('--prefill <text>', 'Pre-fill the prompt input with text without submitting it').hideHelp()).addOption(new Option('--deep-link-origin', 'Signal that this session was launched from a deep link').hideHelp()).addOption(new Option('--deep-link-repo <slug>', 'Repo slug the deep link ?repo= parameter resolved to the current cwd').hideHelp()).addOption(new Option('--deep-link-last-fetch <ms>', 'FETCH_HEAD mtime in epoch ms, precomputed by the deep link trampoline').argParser(v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }).hideHelp()).option('--from-pr [value]', 'Resume a session linked to a PR by PR number/URL, or open interactive picker with optional search term', value => value || true).option('--no-session-persistence', 'Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)').addOption(new Option('--resume-session-at <message id>', 'When resuming, only messages up to and including the assistant message with <message.id> (use with --resume in print mode)').argParser(String).hideHelp()).addOption(new Option('--rewind-files <user-message-id>', 'Restore files to state at the specified user message and exit (requires --resume)').hideHelp())
  // @[MODEL LAUNCH]: Update the example model ID in the --model help text.
  .option('--model <model>', `Local Ollama app model for the current session (for example, 'qwen3-coder:480b-cloud' or 'qwen2.5-coder:latest').`).addOption(new Option('--effort <level>', `Effort level for the current session (low, medium, high, max)`).argParser((rawValue: string) => {
    const value = rawValue.toLowerCase();
    const allowed = ['low', 'medium', 'high', 'max'];
    if (!allowed.includes(value)) {
      throw new InvalidArgumentError(`It must be one of: ${allowed.join(', ')}`);
    }
    return value;
  })).option('--agent <agent>', `Agent for the current session. Overrides the 'agent' setting.`).option('--betas <betas...>', 'Beta headers to include in API requests (API key users only)').option('--fallback-model <model>', 'Enable automatic fallback to specified model when default model is overloaded (only works with --print)').addOption(new Option('--workload <tag>', 'Workload tag for billing-header attribution (cc_workload). Process-scoped; set by SDK daemon callers that spawn subprocesses for cron work. (only works with --print)').hideHelp()).option('--settings <file-or-json>', 'Path to a settings JSON file or a JSON string to load additional settings from').option('--add-dir <directories...>', 'Additional directories to allow tool access to').option('--ide', 'Automatically connect to IDE on startup if exactly one valid IDE is available', () => true).option('--strict-mcp-config', 'Only use MCP servers from --mcp-config, ignoring all other MCP configurations', () => true).option('--session-id <uuid>', 'Use a specific session ID for the conversation (must be a valid UUID)').option('-n, --name <name>', 'Set a display name for this session (shown in /resume and terminal title)').option('--agents <json>', 'JSON object defining custom agents (e.g. \'{"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}\')').option('--setting-sources <sources>', 'Comma-separated list of setting sources to load (user, project, local).')
  .option('--discover-ollama', 'Discover Ollama servers on the local network and choose one at startup')
  .option('--ollama-host <url>', 'Use a specific Ollama server URL for this session (overrides settings and environment)')
  .option('--offline', 'Offline / local-first mode: disable cloud APIs, telemetry, auto-updates, remote control, and web-dependent commands. Local Ollama and filesystem tools still work.')
  // gh-33508: <paths...> (variadic) consumed everything until the next
  // --flag. `ur --plugin-dir /path mcp add --transport http` swallowed
  // `mcp` and `add` as paths, then choked on --transport as an unknown
  // top-level option. Single-value + collect accumulator means each
  // --plugin-dir takes exactly one arg; repeat the flag for multiple dirs.
  .option('--plugin-dir <path>', 'Load plugins from a directory for this session only (repeatable: --plugin-dir A --plugin-dir B)', (val: string, prev: string[]) => [...prev, val], [] as string[]).option('--disable-slash-commands', 'Disable all skills', () => true).option('--chrome', 'Enable UR in Chrome integration').option('--no-chrome', 'Disable UR in Chrome integration').option('--file <specs...>', 'File resources to download at startup. Format: file_id:relative_path (e.g., --file file_abc:doc.txt file_def:img.png)').action(async (prompt, options) => {
    profileCheckpoint('action_handler_start');

    // --bare = one-switch minimal mode. Sets SIMPLE so all the existing
    // gates fire (UR.md, skills, hooks inside executeHooks, agent
    // dir-walk). Must be set before setup() / any of the gated work runs.
    if ((options as {
      bare?: boolean;
    }).bare) {
      process.env.UR_CODE_SIMPLE = '1';
    }

    // --offline = local-first mode. Disable cloud APIs, telemetry,
    // auto-updates, remote control, and web-dependent commands early.
    if ((options as {
      offline?: boolean;
    }).offline) {
      setOfflineMode(true);
      process.env.UR_OFFLINE = '1';
    }

    // Ignore "code" as a prompt - treat it the same as no prompt
    if (prompt === 'code') {
      logEvent('tengu_code_prompt_ignored', {});
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.warn(chalk.yellow('Tip: You can launch UR with just `ur`'));
      prompt = undefined;
    }

    // Log event for any single-word prompt
    if (prompt && typeof prompt === 'string' && !/\s/.test(prompt) && prompt.length > 0) {
      logEvent('tengu_single_word_prompt', {
        length: prompt.length
      });
    }

    // Assistant mode: when .ur/settings.json has assistant: true AND
    // the tengu_kairos GrowthBook gate is on, force brief on. Permission
    // mode is left to the user — settings defaultMode or --permission-mode
    // apply as normal. REPL-typed messages already default to 'next'
    // priority (messageQueueManager.enqueue) so they drain mid-turn between
    // tool calls. SendUserMessage (BriefTool) is enabled via the brief env
    // var. SleepTool stays disabled (its isEnabled() gates on proactive).
    // kairosEnabled is computed once here and reused at the
    // getAssistantSystemPromptAddendum() call site further down.
    //
    // Trust gate: .ur/settings.json is attacker-controllable in an
    // untrusted clone. We run ~1000 lines before showSetupScreens() shows
    // the trust dialog, and by then we've already appended
    // .ur/agents/assistant.md to the system prompt. Refuse to activate
    // until the directory has been explicitly trusted.
    let kairosEnabled = false;
    let assistantTeamContext: Awaited<ReturnType<NonNullable<typeof assistantModule>['initializeAssistantTeam']>> | undefined;
    if (feature('KAIROS') && (options as {
      assistant?: boolean;
    }).assistant && assistantModule) {
      // --assistant (Agent SDK daemon mode): force the latch before
      // isAssistantMode() runs below. The daemon has already checked
      // entitlement — don't make the child re-check tengu_kairos.
      assistantModule.markAssistantForced();
    }
    if (feature('KAIROS') && assistantModule?.isAssistantMode() &&
    // Spawned teammates share the leader's cwd + settings.json, so
    // isAssistantMode() is true for them too. --agent-id being set
    // means we ARE a spawned teammate (extractTeammateOptions runs
    // ~170 lines later so check the raw commander option) — don't
    // re-init the team or override teammateMode/proactive/brief.
    !(options as {
      agentId?: unknown;
    }).agentId && kairosGate) {
      if (!checkHasTrustDialogAccepted()) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.warn(chalk.yellow('Assistant mode disabled: directory is not trusted. Accept the trust dialog and restart.'));
      } else {
        // Blocking gate check — returns cached `true` instantly; if disk
        // cache is false/missing, lazily inits GrowthBook and fetches fresh
        // (max ~5s). --assistant skips the gate entirely (daemon is
        // pre-entitled).
        kairosEnabled = assistantModule.isAssistantForced() || (await kairosGate.isKairosEnabled());
        if (kairosEnabled) {
          const opts = options as {
            brief?: boolean;
          };
          opts.brief = true;
          setKairosActive(true);
          // Pre-seed an in-process team so Agent(name: "foo") spawns
          // teammates without TeamCreate. Must run BEFORE setup() captures
          // the teammateMode snapshot (initializeAssistantTeam calls
          // setCliTeammateModeOverride internally).
          assistantTeamContext = await assistantModule.initializeAssistantTeam();
        }
      }
    }
    const {
      debug = false,
      debugToStderr = false,
      dangerouslySkipPermissions,
      allowDangerouslySkipPermissions = false,
      tools: baseTools = [],
      allowedTools = [],
      disallowedTools = [],
      mcpConfig = [],
      permissionMode: permissionModeCli,
      addDir = [],
      fallbackModel,
      betas = [],
      ide = false,
      sessionId,
      includeHookEvents,
      includePartialMessages
    } = options;
    if (options.prefill) {
      seedEarlyInput(options.prefill);
    }

    // Promise for file downloads - started early, awaited before REPL renders
    let fileDownloadPromise: Promise<DownloadResult[]> | undefined;
    const agentsJson = options.agents;
    const agentCli = options.agent;
    if (feature('BG_SESSIONS') && agentCli) {
      process.env.UR_CODE_AGENT = agentCli;
    }

    // NOTE: LSP manager initialization is intentionally deferred until after
    // the trust dialog is accepted. This prevents plugin LSP servers from
    // executing code in untrusted directories before user consent.

    // Extract these separately so they can be modified if needed
    let outputFormat = options.outputFormat;
    let inputFormat = options.inputFormat;
    let verbose = options.verbose ?? getGlobalConfig().verbose;
    let print = options.print;
    const init = options.init ?? false;
    const initOnly = options.initOnly ?? false;
    const maintenance = options.maintenance ?? false;

    // Extract disable slash commands flag
    const disableSlashCommands = options.disableSlashCommands || false;

    // Extract tasks mode options (ant-only)
    const tasksOption = ("external" as string) === 'ant' && (options as {
      tasks?: boolean | string;
    }).tasks;
    const taskListId = tasksOption ? typeof tasksOption === 'string' ? tasksOption : DEFAULT_TASKS_MODE_TASK_LIST_ID : undefined;
    if (("external" as string) === 'ant' && taskListId) {
      process.env.UR_CODE_TASK_LIST_ID = taskListId;
    }

    // Extract worktree option
    // worktree can be true (flag without value) or a string (custom name or PR reference)
    const worktreeOption = isWorktreeModeEnabled() ? (options as {
      worktree?: boolean | string;
    }).worktree : undefined;
    let worktreeName = typeof worktreeOption === 'string' ? worktreeOption : undefined;
    const worktreeEnabled = worktreeOption !== undefined;

    // Check if worktree name is a PR reference (#N or GitHub PR URL)
    let worktreePRNumber: number | undefined;
    if (worktreeName) {
      const prNum = parsePRReference(worktreeName);
      if (prNum !== null) {
        worktreePRNumber = prNum;
        worktreeName = undefined; // slug will be generated in setup()
      }
    }

    // Extract tmux option (requires --worktree)
    const tmuxEnabled = isWorktreeModeEnabled() && (options as {
      tmux?: boolean;
    }).tmux === true;

    // Validate tmux option
    if (tmuxEnabled) {
      if (!worktreeEnabled) {
        process.stderr.write(chalk.red('Error: --tmux requires --worktree\n'));
        process.exit(1);
      }
      if (getPlatform() === 'windows') {
        process.stderr.write(chalk.red('Error: --tmux is not supported on Windows\n'));
        process.exit(1);
      }
      if (!(await isTmuxAvailable())) {
        process.stderr.write(chalk.red(`Error: tmux is not installed.\n${getTmuxInstallInstructions()}\n`));
        process.exit(1);
      }
    }

    // Extract teammate options (for tmux-spawned agents)
    // Declared outside the if block so it's accessible later for system prompt addendum
    let storedTeammateOpts: TeammateOptions | undefined;
    if (isAgentSwarmsEnabled()) {
      // Extract agent identity options (for tmux-spawned agents)
      // These replace the UR_CODE_* environment variables
      const teammateOpts = extractTeammateOptions(options);
      storedTeammateOpts = teammateOpts;

      // If any teammate identity option is provided, all three required ones must be present
      const hasAnyTeammateOpt = teammateOpts.agentId || teammateOpts.agentName || teammateOpts.teamName;
      const hasAllRequiredTeammateOpts = teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName;
      if (hasAnyTeammateOpt && !hasAllRequiredTeammateOpts) {
        process.stderr.write(chalk.red('Error: --agent-id, --agent-name, and --team-name must all be provided together\n'));
        process.exit(1);
      }

      // If teammate identity is provided via CLI, set up dynamicTeamContext
      if (teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName) {
        getTeammateUtils().setDynamicTeamContext?.({
          agentId: teammateOpts.agentId,
          agentName: teammateOpts.agentName,
          teamName: teammateOpts.teamName,
          color: teammateOpts.agentColor,
          planModeRequired: teammateOpts.planModeRequired ?? false,
          parentSessionId: teammateOpts.parentSessionId
        });
      }

      // Set teammate mode CLI override if provided
      // This must be done before setup() captures the snapshot
      if (teammateOpts.teammateMode) {
        getTeammateModeSnapshot().setCliTeammateModeOverride?.(teammateOpts.teammateMode);
      }
    }

    // Extract remote sdk options
    const sdkUrl = (options as {
      sdkUrl?: string;
    }).sdkUrl ?? undefined;

    // Allow env var to enable partial messages (used by sandbox gateway for baku)
    const effectiveIncludePartialMessages = includePartialMessages || isEnvTruthy(process.env.UR_CODE_INCLUDE_PARTIAL_MESSAGES);

    // Enable all hook event types when explicitly requested via SDK option
    // or when running in UR_CODE_REMOTE mode (CCR needs them).
    // Without this, only SessionStart and Setup events are emitted.
    if (includeHookEvents || isEnvTruthy(process.env.UR_CODE_REMOTE)) {
      setAllHookEventsEnabled(true);
    }

    // Auto-set input/output formats, verbose mode, and print mode when SDK URL is provided
    if (sdkUrl) {
      // If SDK URL is provided, automatically use stream-json formats unless explicitly set
      if (!inputFormat) {
        inputFormat = 'stream-json';
      }
      if (!outputFormat) {
        outputFormat = 'stream-json';
      }
      // Auto-enable verbose mode unless explicitly disabled or already set
      if (options.verbose === undefined) {
        verbose = true;
      }
      // Auto-enable print mode unless explicitly disabled
      if (!options.print) {
        print = true;
      }
    }

    // Extract teleport option
    const teleport = (options as {
      teleport?: string | true;
    }).teleport ?? null;

    // Extract remote option (can be true if no description provided, or a string)
    const remoteOption = (options as {
      remote?: string | true;
    }).remote;
    const remote = remoteOption === true ? '' : remoteOption ?? null;

    // Extract --remote-control / --rc flag (enable bridge in interactive session)
    let remoteControlOption = (options as {
      remoteControl?: string | true;
    }).remoteControl ?? (options as {
      rc?: string | true;
    }).rc;
    // Actual bridge check is deferred to after showSetupScreens() so that
    // trust is established and GrowthBook has auth headers.
    let remoteControl = false;
    const remoteControlName = typeof remoteControlOption === 'string' && remoteControlOption.length > 0 ? remoteControlOption : undefined;

    // Offline mode conflicts with remote/bridge/cloud features.
    if (getOfflineMode() && (remote !== null || remoteControlOption !== undefined)) {
      process.stderr.write(chalk.yellow('Offline mode is active; --remote/--rc flags are ignored.\n'));
      remoteControlOption = undefined;
    }

    // Validate session ID if provided
    if (sessionId) {
      // Check for conflicting flags
      // --session-id can be used with --continue or --resume when --fork-session is also provided
      // (to specify a custom ID for the forked session)
      if ((options.continue || options.resume) && !options.forkSession) {
        process.stderr.write(chalk.red('Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.\n'));
        process.exit(1);
      }

      // When --sdk-url is provided (bridge/remote mode), the session ID is a
      // server-assigned tagged ID (e.g. "session_local_01...") rather than a
      // UUID. Skip UUID validation and local existence checks in that case.
      if (!sdkUrl) {
        const validatedSessionId = validateUuid(sessionId);
        if (!validatedSessionId) {
          process.stderr.write(chalk.red('Error: Invalid session ID. Must be a valid UUID.\n'));
          process.exit(1);
        }

        // Check if session ID already exists
        if (sessionIdExists(validatedSessionId)) {
          process.stderr.write(chalk.red(`Error: Session ID ${validatedSessionId} is already in use.\n`));
          process.exit(1);
        }
      }
    }

    // Download file resources if specified via --file flag
    const fileSpecs = (options as {
      file?: string[];
    }).file;
    if (fileSpecs && fileSpecs.length > 0) {
      // Get session ingress token (provided by EnvManager via UR_CODE_SESSION_ACCESS_TOKEN)
      const sessionToken = getSessionIngressAuthToken();
      if (!sessionToken) {
        process.stderr.write(chalk.red('Error: Session token required for file downloads. UR_CODE_SESSION_ACCESS_TOKEN must be set.\n'));
        process.exit(1);
      }

      // Resolve session ID: prefer remote session ID, fall back to internal session ID
      const fileSessionId = process.env.UR_CODE_REMOTE_SESSION_ID || getSessionId();
      const files = parseFileSpecs(fileSpecs);
      if (files.length > 0) {
        // Use URHQ_BASE_URL if set (by EnvManager), otherwise use OAuth config
        // This ensures consistency with session ingress API in all environments
        const config: FilesApiConfig = {
          baseUrl: process.env.URHQ_BASE_URL || getOauthConfig().BASE_API_URL,
          oauthToken: sessionToken,
          sessionId: fileSessionId
        };

        // Start download without blocking startup - await before REPL renders
        fileDownloadPromise = downloadSessionFiles(files, config);
      }
    }

    // Get isNonInteractiveSession from state (was set before init())
    const isNonInteractiveSession = getIsNonInteractiveSession();

    // Validate that fallback model is different from main model
    if (fallbackModel && options.model && fallbackModel === options.model) {
      process.stderr.write(chalk.red('Error: Fallback model cannot be the same as the main model. Please specify a different model for --fallback-model.\n'));
      process.exit(1);
    }

    // Handle system prompt options
    let systemPrompt = options.systemPrompt;
    if (options.systemPromptFile) {
      if (options.systemPrompt) {
        process.stderr.write(chalk.red('Error: Cannot use both --system-prompt and --system-prompt-file. Please use only one.\n'));
        process.exit(1);
      }
      try {
        const filePath = resolve(options.systemPromptFile);
        systemPrompt = readFileSync(filePath, 'utf8');
      } catch (error) {
        const code = getErrnoCode(error);
        if (code === 'ENOENT') {
          process.stderr.write(chalk.red(`Error: System prompt file not found: ${resolve(options.systemPromptFile)}\n`));
          process.exit(1);
        }
        process.stderr.write(chalk.red(`Error reading system prompt file: ${errorMessage(error)}\n`));
        process.exit(1);
      }
    }

    // Handle append system prompt options
    let appendSystemPrompt = options.appendSystemPrompt;
    if (options.appendSystemPromptFile) {
      if (options.appendSystemPrompt) {
        process.stderr.write(chalk.red('Error: Cannot use both --append-system-prompt and --append-system-prompt-file. Please use only one.\n'));
        process.exit(1);
      }
      try {
        const filePath = resolve(options.appendSystemPromptFile);
        appendSystemPrompt = readFileSync(filePath, 'utf8');
      } catch (error) {
        const code = getErrnoCode(error);
        if (code === 'ENOENT') {
          process.stderr.write(chalk.red(`Error: Append system prompt file not found: ${resolve(options.appendSystemPromptFile)}\n`));
          process.exit(1);
        }
        process.stderr.write(chalk.red(`Error reading append system prompt file: ${errorMessage(error)}\n`));
        process.exit(1);
      }
    }

    // Add teammate-specific system prompt addendum for tmux teammates
    if (isAgentSwarmsEnabled() && storedTeammateOpts?.agentId && storedTeammateOpts?.agentName && storedTeammateOpts?.teamName) {
      const addendum = getTeammatePromptAddendum().TEAMMATE_SYSTEM_PROMPT_ADDENDUM;
      appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${addendum}` : addendum;
    }
    const {
      mode: permissionMode,
      notification: permissionModeNotification
    } = initialPermissionModeFromCLI({
      permissionModeCli,
      dangerouslySkipPermissions
    });

    // Store session bypass permissions mode for trust dialog check
    setSessionBypassPermissionsMode(permissionMode === 'bypassPermissions');
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      // autoModeFlagCli is the "did the user intend auto this session" signal.
      // Set when: --enable-auto-mode, --permission-mode auto, resolved mode
      // is auto, OR settings defaultMode is auto but the gate denied it
      // (permissionMode resolved to default with no explicit CLI override).
      // Used by verifyAutoModeGateAccess to decide whether to notify on
      // auto-unavailable, and by tengu_auto_mode_config opt-in carousel.
      if ((options as {
        enableAutoMode?: boolean;
      }).enableAutoMode || permissionModeCli === 'auto' || permissionMode === 'auto' || !permissionModeCli && isDefaultPermissionModeAuto()) {
        autoModeStateModule?.setAutoModeFlagCli(true);
      }
    }

    // Parse the MCP config files/strings if provided
    let dynamicMcpConfig: Record<string, ScopedMcpServerConfig> = {};
    if (mcpConfig && mcpConfig.length > 0) {
      // Process mcpConfig array
      const processedConfigs = mcpConfig.map(config => config.trim()).filter(config => config.length > 0);
      let allConfigs: Record<string, McpServerConfig> = {};
      const allErrors: ValidationError[] = [];
      for (const configItem of processedConfigs) {
        let configs: Record<string, McpServerConfig> | null = null;
        let errors: ValidationError[] = [];

        // First try to parse as JSON string
        const parsedJson = safeParseJSON(configItem);
        if (parsedJson) {
          const result = parseMcpConfig({
            configObject: parsedJson,
            filePath: 'command line',
            expandVars: true,
            scope: 'dynamic'
          });
          if (result.config) {
            configs = result.config.mcpServers;
          } else {
            errors = result.errors;
          }
        } else {
          // Try as file path
          const configPath = resolve(configItem);
          const result = parseMcpConfigFromFilePath({
            filePath: configPath,
            expandVars: true,
            scope: 'dynamic'
          });
          if (result.config) {
            configs = result.config.mcpServers;
          } else {
            errors = result.errors;
          }
        }
        if (errors.length > 0) {
          allErrors.push(...errors);
        } else if (configs) {
          // Merge configs, later ones override earlier ones
          allConfigs = {
            ...allConfigs,
            ...configs
          };
        }
      }
      if (allErrors.length > 0) {
        const formattedErrors = allErrors.map(err => `${err.path ? err.path + ': ' : ''}${err.message}`).join('\n');
        logForDebugging(`--mcp-config validation failed (${allErrors.length} errors): ${formattedErrors}`, {
          level: 'error'
        });
        process.stderr.write(`Error: Invalid MCP configuration:\n${formattedErrors}\n`);
        process.exit(1);
      }
      if (Object.keys(allConfigs).length > 0) {
        // SDK hosts (Nest/Desktop) own their server naming and may reuse
        // built-in names — skip reserved-name checks for type:'sdk'.
        const nonSdkConfigNames = Object.entries(allConfigs).filter(([, config]) => config.type !== 'sdk').map(([name]) => name);
        let reservedNameError: string | null = null;
        if (nonSdkConfigNames.some(isURInChromeMCPServer)) {
          reservedNameError = `Invalid MCP configuration: "${UR_IN_CHROME_MCP_SERVER_NAME}" is a reserved MCP name.`;
        } else if (feature('CHICAGO_MCP')) {
          const {
            isComputerUseMCPServer,
            COMPUTER_USE_MCP_SERVER_NAME
          } = await import('src/utils/computerUse/common.js');
          if (nonSdkConfigNames.some(isComputerUseMCPServer)) {
            reservedNameError = `Invalid MCP configuration: "${COMPUTER_USE_MCP_SERVER_NAME}" is a reserved MCP name.`;
          }
        }
        if (reservedNameError) {
          // stderr+exit(1) — a throw here becomes a silent unhandled
          // rejection in stream-json mode (void main() in cli.tsx).
          process.stderr.write(`Error: ${reservedNameError}\n`);
          process.exit(1);
        }

        // Add dynamic scope to all configs. type:'sdk' entries pass through
        // unchanged — they're extracted into sdkMcpConfigs downstream and
        // passed to print.ts. The Python SDK relies on this path (it doesn't
        // send sdkMcpServers in the initialize message). Dropping them here
        // broke Coworker (inc-5122). The policy filter below already exempts
        // type:'sdk', and the entries are inert without an SDK transport on
        // stdin, so there's no bypass risk from letting them through.
        const scopedConfigs = mapValues(allConfigs, config => ({
          ...config,
          scope: 'dynamic' as const
        }));

        // Enforce managed policy (allowedMcpServers / deniedMcpServers) on
        // --mcp-config servers. Without this, the CLI flag bypasses the
        // enterprise allowlist that user/project/local configs go through in
        // getURCodeMcpConfigs — callers spread dynamicMcpConfig back on
        // top of filtered results. Filter here at the source so all
        // downstream consumers see the policy-filtered set.
        const {
          allowed,
          blocked
        } = filterMcpServersByPolicy(scopedConfigs);
        if (blocked.length > 0) {
          process.stderr.write(`Warning: MCP ${plural(blocked.length, 'server')} blocked by enterprise policy: ${blocked.join(', ')}\n`);
        }
        dynamicMcpConfig = {
          ...dynamicMcpConfig,
          ...allowed
        };
      }
    }

    // Extract UR in Chrome option and enforce ur.ai subscriber check (unless user is ant)
    const chromeOpts = options as {
      chrome?: boolean;
    };
    // Store the explicit CLI flag so teammates can inherit it
    setChromeFlagOverride(chromeOpts.chrome);
    const enableURInChrome = shouldEnableURInChrome(chromeOpts.chrome) && (("external" as string) === 'ant' || isURAISubscriber());
    const autoEnableURInChrome = !enableURInChrome && shouldAutoEnableURInChrome();
    if (enableURInChrome) {
      const platform = getPlatform();
      try {
        logEvent('tengu_ur_in_chrome_setup', {
          platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        const {
          mcpConfig: chromeMcpConfig,
          allowedTools: chromeMcpTools,
          systemPrompt: chromeSystemPrompt
        } = setupURInChrome();
        dynamicMcpConfig = {
          ...dynamicMcpConfig,
          ...chromeMcpConfig
        };
        allowedTools.push(...chromeMcpTools);
        if (chromeSystemPrompt) {
          appendSystemPrompt = appendSystemPrompt ? `${chromeSystemPrompt}\n\n${appendSystemPrompt}` : chromeSystemPrompt;
        }
      } catch (error) {
        logEvent('tengu_ur_in_chrome_setup_failed', {
          platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        logForDebugging(`[UR in Chrome] Error: ${error}`);
        logError(error);
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(`Error: Failed to run with UR in Chrome.`);
        process.exit(1);
      }
    } else if (autoEnableURInChrome) {
      try {
        const {
          mcpConfig: chromeMcpConfig
        } = setupURInChrome();
        dynamicMcpConfig = {
          ...dynamicMcpConfig,
          ...chromeMcpConfig
        };
        const hint = feature('WEB_BROWSER_TOOL') && typeof Bun !== 'undefined' && 'WebView' in Bun ? UR_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER : UR_IN_CHROME_SKILL_HINT;
        appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${hint}` : hint;
      } catch (error) {
        // Silently skip any errors for the auto-enable
        logForDebugging(`[UR in Chrome] Error (auto-enable): ${error}`);
      }
    }

    // Extract strict MCP config flag
    const strictMcpConfig = options.strictMcpConfig || false;

    // Check if enterprise MCP configuration exists. When it does, only allow dynamic MCP
    // configs that contain special server types (sdk)
    if (doesEnterpriseMcpConfigExist()) {
      if (strictMcpConfig) {
        process.stderr.write(chalk.red('You cannot use --strict-mcp-config when an enterprise MCP config is present'));
        process.exit(1);
      }

      // For --mcp-config, allow if all servers are internal types (sdk)
      if (dynamicMcpConfig && !areMcpConfigsAllowedWithEnterpriseMcpConfig(dynamicMcpConfig)) {
        process.stderr.write(chalk.red('You cannot dynamically configure MCP servers when an enterprise MCP config is present'));
        process.exit(1);
      }
    }

    // chicago MCP: guarded Computer Use (app allowlist + frontmost gate +
    // SCContentFilter screenshots). Ant-only, GrowthBook-gated — failures
    // are silent (this is dogfooding). Platform + interactive checks inline
    // so non-macOS / print-mode ants skip the heavy computer-use import
    // entirely. gates.js is light.
    //
    // Placed AFTER the enterprise-MCP-config check: that check rejects any
    // dynamicMcpConfig entry with `type !== 'sdk'`, and our config is
    // `type: 'stdio'`. An enterprise-config ant with the GB gate on would
    // otherwise process.exit(1). Chrome has the same latent issue but has
    // shipped without incident; chicago places itself correctly.
    if (feature('CHICAGO_MCP') && getPlatform() === 'macos' && !getIsNonInteractiveSession()) {
      try {
        const {
          getChicagoEnabled
        } = await import('src/utils/computerUse/gates.js');
        if (getChicagoEnabled()) {
          const {
            setupComputerUseMCP
          } = await import('src/utils/computerUse/setup.js');
          const {
            mcpConfig,
            allowedTools: cuTools
          } = setupComputerUseMCP();
          dynamicMcpConfig = {
            ...dynamicMcpConfig,
            ...mcpConfig
          };
          allowedTools.push(...cuTools);
        }
      } catch (error) {
        logForDebugging(`[Computer Use MCP] Setup failed: ${errorMessage(error)}`);
      }
    }

    // Store additional directories for UR.md loading (controlled by env var)
    setAdditionalDirectoriesForAgentMd(addDir);

    // Channel server allowlist from --channels flag — servers whose
    // inbound push notifications should register this session. The option
    // is added inside a feature() block so TS doesn't know about it
    // on the options type — same pattern as --assistant at main.tsx:1824.
    // devChannels is deferred: showSetupScreens shows a confirmation dialog
    // and only appends to allowedChannels on accept.
    let devChannels: ChannelEntry[] | undefined;
    if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
      // Parse plugin:name@marketplace / server:Y tags into typed entries.
      // Tag decides trust model downstream: plugin-kind hits marketplace
      // verification + GrowthBook allowlist, server-kind always fails
      // allowlist (schema is plugin-only) unless dev flag is set.
      // Untagged or marketplace-less plugin entries are hard errors —
      // silently not-matching in the gate would look like channels are
      // "on" but nothing ever fires.
      const parseChannelEntries = (raw: string[], flag: string): ChannelEntry[] => {
        const entries: ChannelEntry[] = [];
        const bad: string[] = [];
        for (const c of raw) {
          if (c.startsWith('plugin:')) {
            const rest = c.slice(7);
            const at = rest.indexOf('@');
            if (at <= 0 || at === rest.length - 1) {
              bad.push(c);
            } else {
              entries.push({
                kind: 'plugin',
                name: rest.slice(0, at),
                marketplace: rest.slice(at + 1)
              });
            }
          } else if (c.startsWith('server:') && c.length > 7) {
            entries.push({
              kind: 'server',
              name: c.slice(7)
            });
          } else {
            bad.push(c);
          }
        }
        if (bad.length > 0) {
          process.stderr.write(chalk.red(`${flag} entries must be tagged: ${bad.join(', ')}\n` + `  plugin:<name>@<marketplace>  — plugin-provided channel (allowlist enforced)\n` + `  server:<name>                — manually configured MCP server\n`));
          process.exit(1);
        }
        return entries;
      };
      const channelOpts = options as {
        channels?: string[];
        dangerouslyLoadDevelopmentChannels?: string[];
      };
      const rawChannels = channelOpts.channels;
      const rawDev = channelOpts.dangerouslyLoadDevelopmentChannels;
      // Always parse + set. ChannelsNotice reads getAllowedChannels() and
      // renders the appropriate branch (disabled/noAuth/policyBlocked/
      // listening) in the startup screen. gateChannelServer() enforces.
      // --channels works in both interactive and print/SDK modes; dev-channels
      // stays interactive-only (requires a confirmation dialog).
      let channelEntries: ChannelEntry[] = [];
      if (rawChannels && rawChannels.length > 0) {
        channelEntries = parseChannelEntries(rawChannels, '--channels');
        setAllowedChannels(channelEntries);
      }
      if (!isNonInteractiveSession) {
        if (rawDev && rawDev.length > 0) {
          devChannels = parseChannelEntries(rawDev, '--dangerously-load-development-channels');
        }
      }
      // Flag-usage telemetry. Plugin identifiers are logged (same tier as
      // tengu_plugin_installed — public-registry-style names); server-kind
      // names are not (MCP-server-name tier, opt-in-only elsewhere).
      // Per-server gate outcomes land in tengu_mcp_channel_gate once
      // servers connect. Dev entries go through a confirmation dialog after
      // this — dev_plugins captures what was typed, not what was accepted.
      if (channelEntries.length > 0 || (devChannels?.length ?? 0) > 0) {
        const joinPluginIds = (entries: ChannelEntry[]) => {
          const ids = entries.flatMap(e => e.kind === 'plugin' ? [`${e.name}@${e.marketplace}`] : []);
          return ids.length > 0 ? ids.sort().join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS : undefined;
        };
        logEvent('tengu_mcp_channel_flags', {
          channels_count: channelEntries.length,
          dev_count: devChannels?.length ?? 0,
          plugins: joinPluginIds(channelEntries),
          dev_plugins: joinPluginIds(devChannels ?? [])
        });
      }
    }

    // SDK opt-in for SendUserMessage via --tools. All sessions require
    // explicit opt-in; listing it in --tools signals intent. Runs BEFORE
    // initializeToolPermissionContext so getToolsForDefaultPreset() sees
    // the tool as enabled when computing the base-tools disallow filter.
    // Conditional require avoids leaking the tool-name string into
    // external builds.
    if ((feature('KAIROS') || feature('KAIROS_BRIEF')) && baseTools.length > 0) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        BRIEF_TOOL_NAME,
        LEGACY_BRIEF_TOOL_NAME
      } = require('./tools/BriefTool/prompt.js') as typeof import('./tools/BriefTool/prompt.js');
      const {
        isBriefEntitled
      } = require('./tools/BriefTool/BriefTool.js') as typeof import('./tools/BriefTool/BriefTool.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const parsed = parseToolListFromCLI(baseTools);
      if ((parsed.includes(BRIEF_TOOL_NAME) || parsed.includes(LEGACY_BRIEF_TOOL_NAME)) && isBriefEntitled()) {
        setUserMsgOptIn(true);
      }
    }

    // This await replaces blocking existsSync/statSync calls that were already in
    // the startup path. Wall-clock time is unchanged; we just yield to the event
    // loop during the fs I/O instead of blocking it. See #19661.
    const initResult = await initializeToolPermissionContext({
      allowedToolsCli: allowedTools,
      disallowedToolsCli: disallowedTools,
      baseToolsCli: baseTools,
      permissionMode,
      allowDangerouslySkipPermissions,
      addDirs: addDir
    });
    let toolPermissionContext = initResult.toolPermissionContext;
    const {
      warnings,
      dangerousPermissions,
      overlyBroadBashPermissions
    } = initResult;

    // Handle overly broad shell allow rules for ant users (Bash(*), PowerShell(*))
    if (("external" as string) === 'ant' && overlyBroadBashPermissions.length > 0) {
      for (const permission of overlyBroadBashPermissions) {
        logForDebugging(`Ignoring overly broad shell permission ${permission.ruleDisplay} from ${permission.sourceDisplay}`);
      }
      toolPermissionContext = removeDangerousPermissions(toolPermissionContext, overlyBroadBashPermissions);
    }
    if (feature('TRANSCRIPT_CLASSIFIER') && dangerousPermissions.length > 0) {
      toolPermissionContext = stripDangerousPermissionsForAutoMode(toolPermissionContext);
    }

    // Print any warnings from initialization
    warnings.forEach(warning => {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(warning);
    });
    void assertMinVersion();

    // ur.ai config fetch: -p mode only (interactive uses useManageMCPConnections
    // two-phase loading). Kicked off here to overlap with setup(); awaited
    // before runHeadless so single-turn -p sees connectors. Skipped under
    // enterprise/strict MCP to preserve policy boundaries.
    const uraiConfigPromise: Promise<Record<string, ScopedMcpServerConfig>> = isNonInteractiveSession && !strictMcpConfig && !doesEnterpriseMcpConfigExist() &&
    // --bare / SIMPLE: skip ur.ai proxy servers (datadog, Gmail,
    // Slack, BigQuery, PubMed — 6-14s each to connect). Scripted calls
    // that need MCP pass --mcp-config explicitly.
    !isBareMode() ? fetchURAIMcpConfigsIfEligible().then(configs => {
      const {
        allowed,
        blocked
      } = filterMcpServersByPolicy(configs);
      if (blocked.length > 0) {
        process.stderr.write(`Warning: ur.ai MCP ${plural(blocked.length, 'server')} blocked by enterprise policy: ${blocked.join(', ')}\n`);
      }
      return allowed;
    }) : Promise.resolve({});

    // Kick off MCP config loading early (safe - just reads files, no execution).
    // Both interactive and -p use getURCodeMcpConfigs (local file reads only).
    // The local promise is awaited later (before prefetchAllMcpResources) to
    // overlap config I/O with setup(), commands loading, and trust dialog.
    logForDebugging('[STARTUP] Loading MCP configs...');
    const mcpConfigStart = Date.now();
    let mcpConfigResolvedMs: number | undefined;
    // --bare skips auto-discovered MCP (.mcp.json, user settings, plugins) —
    // only explicit --mcp-config works. dynamicMcpConfig is spread onto
    // allMcpConfigs downstream so it survives this skip.
    const mcpConfigPromise = (strictMcpConfig || isBareMode() ? Promise.resolve({
      servers: {} as Record<string, ScopedMcpServerConfig>
    }) : getURCodeMcpConfigs(dynamicMcpConfig)).then(result => {
      mcpConfigResolvedMs = Date.now() - mcpConfigStart;
      return result;
    });

    // NOTE: We do NOT call prefetchAllMcpResources here - that's deferred until after trust dialog

    if (inputFormat && inputFormat !== 'text' && inputFormat !== 'stream-json') {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(`Error: Invalid input format "${inputFormat}".`);
      process.exit(1);
    }
    if (inputFormat === 'stream-json' && outputFormat !== 'stream-json') {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(`Error: --input-format=stream-json requires output-format=stream-json.`);
      process.exit(1);
    }

    // Validate sdkUrl is only used with appropriate formats (formats are auto-set above)
    if (sdkUrl) {
      if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(`Error: --sdk-url requires both --input-format=stream-json and --output-format=stream-json.`);
        process.exit(1);
      }
    }

    // Validate replayUserMessages is only used with stream-json formats
    if (options.replayUserMessages) {
      if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(`Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.`);
        process.exit(1);
      }
    }

    // Validate includePartialMessages is only used with print mode and stream-json output
    if (effectiveIncludePartialMessages) {
      if (!isNonInteractiveSession || outputFormat !== 'stream-json') {
        writeToStderr(`Error: --include-partial-messages requires --print and --output-format=stream-json.`);
        process.exit(1);
      }
    }

    // Validate --no-session-persistence is only used with print mode
    if (options.sessionPersistence === false && !isNonInteractiveSession) {
      writeToStderr(`Error: --no-session-persistence can only be used with --print mode.`);
      process.exit(1);
    }
    const effectivePrompt = prompt || '';
    let inputPrompt = await getInputPrompt(effectivePrompt, (inputFormat ?? 'text') as 'text' | 'stream-json');
    profileCheckpoint('action_after_input_prompt');

    // Activate proactive mode BEFORE getTools() so SleepTool.isEnabled()
    // (which returns isProactiveActive()) passes and Sleep is included.
    // The later REPL-path maybeActivateProactive() calls are idempotent.
    maybeActivateProactive(options);
    let tools = getTools(toolPermissionContext);

    // Apply coordinator mode tool filtering for headless path
    // (mirrors useMergedTools.ts filtering for REPL/interactive path)
    if (feature('COORDINATOR_MODE') && isEnvTruthy(process.env.UR_CODE_COORDINATOR_MODE)) {
      const {
        applyCoordinatorToolFilter
      } = await import('./utils/toolPool.js');
      tools = applyCoordinatorToolFilter(tools);
    }
    profileCheckpoint('action_tools_loaded');
    let jsonSchema: ToolInputJSONSchema | undefined;
    if (isSyntheticOutputToolEnabled({
      isNonInteractiveSession
    }) && options.jsonSchema) {
      jsonSchema = jsonParse(options.jsonSchema) as ToolInputJSONSchema;
    }
    if (jsonSchema) {
      const syntheticOutputResult = createSyntheticOutputTool(jsonSchema);
      if ('tool' in syntheticOutputResult) {
        // Add SyntheticOutputTool to the tools array AFTER getTools() filtering.
        // This tool is excluded from normal filtering (see tools.ts) because it's
        // an implementation detail for structured output, not a user-controlled tool.
        tools = [...tools, syntheticOutputResult.tool];
        logEvent('tengu_structured_output_enabled', {
          schema_property_count: Object.keys(jsonSchema.properties as Record<string, unknown> || {}).length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          has_required_fields: Boolean(jsonSchema.required) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      } else {
        logEvent('tengu_structured_output_failure', {
          error: 'Invalid JSON schema' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
    }

    // IMPORTANT: setup() must be called before any other code that depends on the cwd or worktree setup
    profileCheckpoint('action_before_setup');
    logForDebugging('[STARTUP] Running setup()...');
    const setupStart = Date.now();
    const {
      setup
    } = await import('./setup.js');
    const messagingSocketPath = feature('UDS_INBOX') ? (options as {
      messagingSocketPath?: string;
    }).messagingSocketPath : undefined;
    // Parallelize setup() with commands+agents loading. setup()'s ~28ms is
    // mostly startUdsMessaging (socket bind, ~20ms) — not disk-bound, so it
    // doesn't contend with getCommands' file reads. Gated on !worktreeEnabled
    // since --worktree makes setup() process.chdir() (setup.ts:203), and
    // commands/agents need the post-chdir cwd.
    const preSetupCwd = getCwd();
    // Register bundled skills/plugins before kicking getCommands() — they're
    // pure in-memory array pushes (<1ms, zero I/O) that getBundledSkills()
    // reads synchronously. Previously ran inside setup() after ~20ms of
    // await points, so the parallel getCommands() memoized an empty list.
    if (process.env.UR_CODE_ENTRYPOINT !== 'local-agent') {
      initBuiltinPlugins();
      initBundledSkills();
    }
    const setupPromise = setup(preSetupCwd, permissionMode, allowDangerouslySkipPermissions, worktreeEnabled, worktreeName, tmuxEnabled, sessionId ? validateUuid(sessionId) : undefined, worktreePRNumber, messagingSocketPath);
    const commandsPromise = worktreeEnabled ? null : getCommands(preSetupCwd);
    const agentDefsPromise = worktreeEnabled ? null : getAgentDefinitionsWithOverrides(preSetupCwd);
    // Suppress transient unhandledRejection if these reject during the
    // ~28ms setupPromise await before Promise.all joins them below.
    commandsPromise?.catch(() => {});
    agentDefsPromise?.catch(() => {});
    await setupPromise;
    logForDebugging(`[STARTUP] setup() completed in ${Date.now() - setupStart}ms`);
    profileCheckpoint('action_after_setup');

    // Replay user messages into stream-json only when the socket was
    // explicitly requested. The auto-generated socket is passive — it
    // lets tools inject if they want to, but turning it on by default
    // shouldn't reshape stream-json for SDK consumers who never touch it.
    // Callers who inject and also want those injections visible in the
    // stream pass --messaging-socket-path explicitly (or --replay-user-messages).
    let effectiveReplayUserMessages = !!options.replayUserMessages;
    if (feature('UDS_INBOX')) {
      if (!effectiveReplayUserMessages && outputFormat === 'stream-json') {
        effectiveReplayUserMessages = !!(options as {
          messagingSocketPath?: string;
        }).messagingSocketPath;
      }
    }
    if (getIsNonInteractiveSession()) {
      // Apply full merged settings env now (including project-scoped
      // .ur/settings.json PATH/GIT_DIR/GIT_WORK_TREE) so gitExe() and
      // the git spawn below see it. Trust is implicit in -p mode; the
      // docstring at managedEnv.ts:96-97 says this applies "potentially
      // dangerous environment variables such as LD_PRELOAD, PATH" from all
      // sources. The later call in the isNonInteractiveSession block below
      // is idempotent (Object.assign, configureGlobalAgents ejects prior
      // interceptor) and picks up any plugin-contributed env after plugin
      // init. Project settings are already loaded here:
      // applySafeConfigEnvironmentVariables in init() called
      // getSettings_DEPRECATED at managedEnv.ts:86 which merges all enabled
      // sources including projectSettings/localSettings.
      applyConfigEnvironmentVariables();

      // Spawn git status/log/branch now so the subprocess execution overlaps
      // with the getCommands await below and startDeferredPrefetches. After
      // setup() so cwd is final (setup.ts:254 may process.chdir(worktreePath)
      // for --worktree) and after the applyConfigEnvironmentVariables above
      // so PATH/GIT_DIR/GIT_WORK_TREE from all sources (trusted + project)
      // are applied. getSystemContext is memoized; the
      // prefetchSystemContextIfSafe call in startDeferredPrefetches becomes
      // a cache hit. The microtask from await getIsGit() drains at the
      // getCommands Promise.all await below. Trust is implicit in -p mode
      // (same gate as prefetchSystemContextIfSafe).
      void getSystemContext();
      // Kick getUserContext now too — its first await (fs.readFile in
      // getMemoryFiles) yields naturally, so the UR.md directory walk
      // runs during the ~280ms overlap window before the context
      // Promise.all join in print.ts. The void getUserContext() in
      // startDeferredPrefetches becomes a memoize cache-hit.
      void getUserContext();
      // Kick ensureModelStringsInitialized now — for Bedrock this triggers
      // a 100-200ms profile fetch that was awaited serially at
      // print.ts:739. updateBedrockModelStrings is sequential()-wrapped so
      // the await joins the in-flight fetch. Non-Bedrock is a sync
      // early-return (zero-cost).
      void ensureModelStringsInitialized();
    }

    // Apply --name: cache-only so no orphan file is created before the
    // session ID is finalized by --continue/--resume. materializeSessionFile
    // persists it on the first user message; REPL's useTerminalTitle reads it
    // via getCurrentSessionTitle.
    const sessionNameArg = options.name?.trim();
    if (sessionNameArg) {
      cacheSessionTitle(sessionNameArg);
    }

    // Ant model aliases (capybara-fast etc.) resolve via the
    // tengu_ant_model_override GrowthBook flag. _CACHED_MAY_BE_STALE reads
    // disk synchronously; disk is populated by a fire-and-forget write. On a
    // cold cache, parseUserSpecifiedModel returns the unresolved alias, the
    // API 404s, and -p exits before the async write lands — crashloop on
    // fresh pods. Awaiting init here populates the in-memory payload map that
    // _CACHED_MAY_BE_STALE now checks first. Gated so the warm path stays
    // non-blocking:
    //  - explicit model via --model or URHQ_MODEL (both feed alias resolution)
    //  - no env override (which short-circuits _CACHED_MAY_BE_STALE before disk)
    //  - flag absent from disk (== null also catches pre-#22279 poisoned null)
    const explicitModel = options.model || process.env.URHQ_MODEL;
    if (("external" as string) === 'ant' && explicitModel && explicitModel !== 'default' && !hasGrowthBookEnvOverride('tengu_ant_model_override') && getGlobalConfig().cachedGrowthBookFeatures?.['tengu_ant_model_override'] == null) {
      await initializeGrowthBook();
    }

    // Special case the default model with the null keyword
    // NOTE: Model resolution happens after setup() to ensure trust is established before AWS auth
    const userSpecifiedModel = options.model === 'default' ? getDefaultMainLoopModel() : options.model;
    const userSpecifiedFallbackModel = fallbackModel === 'default' ? getDefaultMainLoopModel() : fallbackModel;

    // Reuse preSetupCwd unless setup() chdir'd (worktreeEnabled). Saves a
    // getCwd() syscall in the common path.
    const currentCwd = worktreeEnabled ? getCwd() : preSetupCwd;
    logForDebugging('[STARTUP] Loading commands and agents...');
    const commandsStart = Date.now();
    // Join the promises kicked before setup() (or start fresh if
    // worktreeEnabled gated the early kick). Both memoized by cwd.
    const [commands, agentDefinitionsResult] = await Promise.all([commandsPromise ?? getCommands(currentCwd), agentDefsPromise ?? getAgentDefinitionsWithOverrides(currentCwd)]);
    logForDebugging(`[STARTUP] Commands and agents loaded in ${Date.now() - commandsStart}ms`);
    profileCheckpoint('action_commands_loaded');

    // Parse CLI agents if provided via --agents flag
    let cliAgents: typeof agentDefinitionsResult.activeAgents = [];
    if (agentsJson) {
      try {
        const parsedAgents = safeParseJSON(agentsJson);
        if (parsedAgents) {
          cliAgents = parseAgentsFromJson(parsedAgents, 'flagSettings');
        }
      } catch (error) {
        logError(error);
      }
    }

    // Merge CLI agents with existing ones
    const allAgents = [...agentDefinitionsResult.allAgents, ...cliAgents];
    const agentDefinitions = {
      ...agentDefinitionsResult,
      allAgents,
      activeAgents: getActiveAgentsFromList(allAgents)
    };

    // Look up main thread agent from CLI flag or settings
    const agentSetting = agentCli ?? getInitialSettings().agent;
    let mainThreadAgentDefinition: (typeof agentDefinitions.activeAgents)[number] | undefined;
    if (agentSetting) {
      mainThreadAgentDefinition = agentDefinitions.activeAgents.find(agent => agent.agentType === agentSetting);
      if (!mainThreadAgentDefinition) {
        logForDebugging(`Warning: agent "${agentSetting}" not found. ` + `Available agents: ${agentDefinitions.activeAgents.map(a => a.agentType).join(', ')}. ` + `Using default behavior.`);
      }
    }

    // Store the main thread agent type in bootstrap state so hooks can access it
    setMainThreadAgentType(mainThreadAgentDefinition?.agentType);

    // Log agent flag usage — only log agent name for built-in agents to avoid leaking custom agent names
    if (mainThreadAgentDefinition) {
      logEvent('tengu_agent_flag', {
        agentType: isBuiltInAgent(mainThreadAgentDefinition) ? mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS : 'custom' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(agentCli && {
          source: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        })
      });
    }

    // Persist agent setting to session transcript for resume view display and restoration
    if (mainThreadAgentDefinition?.agentType) {
      saveAgentSetting(mainThreadAgentDefinition.agentType);
    }

    // Apply the agent's system prompt for non-interactive sessions
    // (interactive mode uses buildEffectiveSystemPrompt instead)
    if (isNonInteractiveSession && mainThreadAgentDefinition && !systemPrompt && !isBuiltInAgent(mainThreadAgentDefinition)) {
      const agentSystemPrompt = mainThreadAgentDefinition.getSystemPrompt();
      if (agentSystemPrompt) {
        systemPrompt = agentSystemPrompt;
      }
    }

    // initialPrompt goes first so its slash command (if any) is processed;
    // user-provided text becomes trailing context.
    // Only concatenate when inputPrompt is a string. When it's an
    // AsyncIterable (SDK stream-json mode), template interpolation would
    // call .toString() producing "[object Object]". The AsyncIterable case
    // is handled in print.ts via structuredIO.prependUserMessage().
    if (mainThreadAgentDefinition?.initialPrompt) {
      if (typeof inputPrompt === 'string') {
        inputPrompt = inputPrompt ? `${mainThreadAgentDefinition.initialPrompt}\n\n${inputPrompt}` : mainThreadAgentDefinition.initialPrompt;
      } else if (!inputPrompt) {
        inputPrompt = mainThreadAgentDefinition.initialPrompt;
      }
    }

    // Compute effective model early so hooks can run in parallel with MCP
    // If user didn't specify a model but agent has one, use the agent's model
    let effectiveModel = userSpecifiedModel;
    if (!effectiveModel && mainThreadAgentDefinition?.model && mainThreadAgentDefinition.model !== 'inherit') {
      effectiveModel = parseUserSpecifiedModel(mainThreadAgentDefinition.model);
    }
    setMainLoopModelOverride(effectiveModel);

    const requiresStartupModelSelection = shouldRequireStartupModelSelection({
      explicitModels: [
        options.model,
        process.env.URHQ_MODEL,
        process.env.OLLAMA_MODEL,
        process.env.UR_MODEL,
        mainThreadAgentDefinition?.model === 'inherit'
          ? undefined
          : mainThreadAgentDefinition?.model,
      ],
      workspaceSettings: [
        getSettingsForSource('projectSettings'),
        getSettingsForSource('localSettings'),
        getSettingsForSource('flagSettings'),
        getSettingsForSource('policySettings'),
      ],
      isResume: Boolean(
        options.continue ||
          options.resume ||
          options.fromPr ||
          teleport ||
          remote !== null,
      ),
      skipsModelExecution: initOnly,
    });

    if (requiresStartupModelSelection && isNonInteractiveSession) {
      process.stderr.write(
        chalk.red(
          'Error: No model has been selected for this workspace. Run `ur` interactively to choose a provider and model, or pass `--model <model>` for this run.\n',
        ),
      );
      process.exit(1);
    }

    // Warm the installed-model list so adaptive routing can pick the best
    // coder/fast model before the initial model is resolved.
    if (
      !requiresStartupModelSelection &&
      getAPIProvider() === 'ollama' &&
      !getUserSpecifiedModelSetting()
    ) {
      await listOllamaModelNames(AbortSignal.timeout(750)).catch(() => {});
    }

    // The model is finalized after interactive setup so a fresh workspace can
    // make an explicit provider/model choice before any model-dependent work.
    let initialMainLoopModel = getInitialMainLoopModel();
    let resolvedInitialModel: ReturnType<typeof parseUserSpecifiedModel> | undefined;
    let advisorModel: string | undefined;

    // For tmux teammates with --agent-type, append the custom agent's prompt
    if (isAgentSwarmsEnabled() && storedTeammateOpts?.agentId && storedTeammateOpts?.agentName && storedTeammateOpts?.teamName && storedTeammateOpts?.agentType) {
      // Look up the custom agent definition
      const customAgent = agentDefinitions.activeAgents.find(a => a.agentType === storedTeammateOpts.agentType);
      if (customAgent) {
        // Get the prompt - need to handle both built-in and custom agents
        let customPrompt: string | undefined;
        if (customAgent.source === 'built-in') {
          // Built-in agents have getSystemPrompt that takes toolUseContext
          // We can't access full toolUseContext here, so skip for now
          logForDebugging(`[teammate] Built-in agent ${storedTeammateOpts.agentType} - skipping custom prompt (not supported)`);
        } else {
          // Custom agents have getSystemPrompt that takes no args
          customPrompt = customAgent.getSystemPrompt();
        }

        // Log agent memory loaded event for tmux teammates
        if (customAgent.memory) {
          logEvent('tengu_agent_memory_loaded', {
            ...(("external" as string) === 'ant' && {
              agent_type: customAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            }),
            scope: customAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'teammate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
        }
        if (customPrompt) {
          const customInstructions = `\n# Custom Agent Instructions\n${customPrompt}`;
          appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${customInstructions}` : customInstructions;
        }
      } else {
        logForDebugging(`[teammate] Custom agent ${storedTeammateOpts.agentType} not found in available agents`);
      }
    }
    maybeActivateBrief(options);
    // defaultView: 'chat' is a persisted opt-in — check entitlement and set
    // userMsgOptIn so the tool + prompt section activate. Interactive-only:
    // defaultView is a display preference; SDK sessions have no display, and
    // the assistant installer writes defaultView:'chat' to settings.local.json
    // which would otherwise leak into --print sessions in the same directory.
    // Runs right after maybeActivateBrief() so all startup opt-in paths fire
    // BEFORE any isBriefEnabled() read below (proactive prompt's
    // briefVisibility). A persisted 'chat' after a GB kill-switch falls
    // through (entitlement fails).
    if ((feature('KAIROS') || feature('KAIROS_BRIEF')) && !getIsNonInteractiveSession() && !getUserMsgOptIn() && getInitialSettings().defaultView === 'chat') {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        isBriefEntitled
      } = require('./tools/BriefTool/BriefTool.js') as typeof import('./tools/BriefTool/BriefTool.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (isBriefEntitled()) {
        setUserMsgOptIn(true);
      }
    }
    // Coordinator mode has its own system prompt and filters out Sleep, so
    // the generic proactive prompt would tell it to call a tool it can't
    // access and conflict with delegation instructions.
    if ((feature('PROACTIVE') || feature('KAIROS')) && ((options as {
      proactive?: boolean;
    }).proactive || isEnvTruthy(process.env.UR_CODE_PROACTIVE)) && !coordinatorModeModule?.isCoordinatorMode()) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const briefVisibility = feature('KAIROS') || feature('KAIROS_BRIEF') ? (require('./tools/BriefTool/BriefTool.js') as typeof import('./tools/BriefTool/BriefTool.js')).isBriefEnabled() ? 'Call SendUserMessage at checkpoints to mark where things stand.' : 'The user will see any text you output.' : 'The user will see any text you output.';
      /* eslint-enable @typescript-eslint/no-require-imports */
      const proactivePrompt = `\n# Proactive Mode\n\nYou are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions.\n\nStart by briefly greeting the user.\n\nYou will receive periodic <tick> prompts. These are check-ins. Do whatever seems most useful, or call Sleep if there's nothing to do. ${briefVisibility}`;
      appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${proactivePrompt}` : proactivePrompt;
    }
    if (feature('KAIROS') && kairosEnabled && assistantModule) {
      const assistantAddendum = assistantModule.getAssistantSystemPromptAddendum();
      appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${assistantAddendum}` : assistantAddendum;
    }

    // Ink root is only needed for interactive sessions — patchConsole in the
    // Ink constructor would swallow console output in headless mode.
    let root!: Root;
    let getFpsMetrics!: () => FpsMetrics | undefined;
    let stats!: StatsStore;

    // Show setup screens after commands are loaded
    if (!isNonInteractiveSession) {
      const ctx = getRenderContext(false);
      getFpsMetrics = ctx.getFpsMetrics;
      stats = ctx.stats;
      // Install asciicast recorder before Ink mounts (ant-only, opt-in via UR_CODE_TERMINAL_RECORDING=1)
      if (("external" as string) === 'ant') {
        installAsciicastRecorder();
      }
      const {
        createRoot
      } = await import('./ink.js');
      root = await createRoot(ctx.renderOptions);

      // Log startup time now, before any blocking dialog renders. Logging
      // from REPL's first render (the old location) included however long
      // the user sat on trust/OAuth/onboarding/resume-picker — p99 was ~70s
      // dominated by dialog-wait time, not code-path startup.
      logEvent('tengu_timer', {
        event: 'startup' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs: Math.round(process.uptime() * 1000)
      });
      logForDebugging('[STARTUP] Running showSetupScreens()...');
      const setupScreensStart = Date.now();
      const onboardingShown = await showSetupScreens(root, permissionMode, allowDangerouslySkipPermissions, commands, enableURInChrome, devChannels);
      logForDebugging(`[STARTUP] showSetupScreens() completed in ${Date.now() - setupScreensStart}ms`);

      // Now that trust is established and GrowthBook has auth headers,
      // resolve the --remote-control / --rc entitlement gate.
      if (feature('BRIDGE_MODE') && remoteControlOption !== undefined && !getOfflineMode()) {
        const {
          getBridgeDisabledReason
        } = await import('./bridge/bridgeEnabled.js');
        const disabledReason = await getBridgeDisabledReason();
        remoteControl = disabledReason === null;
        if (disabledReason) {
          process.stderr.write(chalk.yellow(`${disabledReason}\n--rc flag ignored.\n`));
        }
      }

      // Agent memory snapshot updates are internal-only and not shipped in external builds.
      // The launcher always returns 'keep', so we just clear any pending update state.
      if (feature('AGENT_MEMORY_SNAPSHOT') && mainThreadAgentDefinition && isCustomAgent(mainThreadAgentDefinition) && mainThreadAgentDefinition.memory && mainThreadAgentDefinition.pendingSnapshotUpdate) {
        mainThreadAgentDefinition.pendingSnapshotUpdate = undefined;
      }

      // Skip executing /login if we just completed onboarding for it
      if (onboardingShown && prompt?.trim().toLowerCase() === '/login') {
        prompt = '';
      }
      if (onboardingShown) {
        // Refresh auth-dependent services now that the user has logged in during onboarding.
        // Keep in sync with the post-login logic in src/commands/login.tsx
        void refreshRemoteManagedSettings();
        void refreshPolicyLimits();
        // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
        resetUserCache();
        // Refresh GrowthBook after login to get updated feature flags (e.g., for ur.ai MCPs)
        refreshGrowthBookAfterAuthChange();
        // Clear any stale trusted device token then enroll for Remote Control.
        // Both self-gate on tengu_sessions_elevated_auth_enforcement internally
        // — enrollTrustedDevice() via checkGate_CACHED_OR_BLOCKING (awaits
        // the GrowthBook reinit above), clearTrustedDeviceToken() via the
        // sync cached check (acceptable since clear is idempotent).
        void import('./bridge/trustedDevice.js').then(m => {
          m.clearTrustedDeviceToken();
          return m.enrollTrustedDevice();
        });
      }

      // Validate that the active token's org matches forceLoginOrgUUID (if set
      // in managed settings). Runs after onboarding so managed settings and
      // login state are fully loaded.
      const orgValidation = await validateForceLoginOrg();
      if (!orgValidation.valid) {
        await exitWithError(root, (orgValidation as { valid: false; message: string }).message);
      }

      // Discover and choose an Ollama host when requested. Show after setup
      // screens so the user isn't interrupted before trust/onboarding.
      //
      // `--discover-ollama` is session-only: it shows the picker every time, but
      // it does NOT write the choice to settings. Plain `ur` continues to use
      // localhost unless the user explicitly sets `ollama.host` or `OLLAMA_HOST`.
      if (getAPIProvider() === 'ollama') {
        const ollamaHostOverride = (options as { ollamaHost?: string }).ollamaHost
        if (ollamaHostOverride) {
          setOllamaBaseUrlOverride(ollamaHostOverride)
        }
        const discoverFlag = (options as { discoverOllama?: boolean }).discoverOllama
        const lanDiscoverySetting = getSettingsForSource('userSettings')?.ollama?.lanDiscovery
        if (discoverFlag || lanDiscoverySetting) {
          const discovered = await discoverOllamaHosts({
            signal: AbortSignal.timeout(8_000),
          }).catch(() => [] as DiscoveredHost[])
          if (discovered.length > 0 || lanDiscoverySetting) {
            const currentHost = getOllamaBaseUrl()
            const {
              OllamaHostPicker
            } = await import('./components/OllamaHostPicker.js');
            const chosenHost = await showSetupDialog<string | null>(root, done => (
              <OllamaHostPicker
                discovered={discovered}
                currentHost={currentHost}
                onSelect={done}
              />
            ))
            setOllamaBaseUrlOverride(chosenHost)
            // Note: we intentionally do NOT persist the picked host. Discovery
            // is a session-level convenience; persistent host configuration
            // should be set explicitly via settings or OLLAMA_HOST.
          }
        }
      }
    }

    // If gracefulShutdown was initiated (e.g., user rejected trust dialog),
    // process.exitCode will be set. Skip all subsequent operations that could
    // trigger code execution before the process exits (e.g. we don't want apiKeyHelper
    // to run if trust was not established).
    if (process.exitCode !== undefined) {
      logForDebugging('Graceful shutdown initiated, skipping further initialization');
      return;
    }

    // Initialize LSP manager AFTER trust is established (or in non-interactive mode
    // where trust is implicit). This prevents plugin LSP servers from executing
    // code in untrusted directories before user consent.
    // Must be after inline plugins are set (if any) so --plugin-dir LSP servers are included.
    initializeLspServerManager();

    // Show settings validation errors after trust is established
    // MCP config errors don't block settings from loading, so exclude them
    if (!isNonInteractiveSession) {
      const {
        errors
      } = getSettingsWithErrors();
      const nonMcpErrors = errors.filter(e => !e.mcpErrorMetadata);
      if (nonMcpErrors.length > 0) {
        await launchInvalidSettingsDialog(root, {
          settingsErrors: nonMcpErrors,
          onExit: () => gracefulShutdownSync(1)
        });
      }
    }

    if (requiresStartupModelSelection) {
      const selectedModel = await showSetupDialog<string>(root, done => (
        <ProviderFirstModelPicker
          initial={null}
          headerText="Choose a provider and model for this workspace. The validated choice is saved locally before the first session starts."
          onSelect={model => {
            if (model) done(model);
          }}
        />
      ));
      effectiveModel = selectedModel;
      setMainLoopModelOverride(selectedModel);
    }

    // From this point onward every model-executing path has either an
    // explicit choice, a workspace/policy choice, or a restored session.
    setInitialMainLoopModel(getUserSpecifiedModelSetting() || null);
    initialMainLoopModel = getInitialMainLoopModel();
    resolvedInitialModel = parseUserSpecifiedModel(
      initialMainLoopModel ?? getDefaultMainLoopModel(),
    );
    await refreshOllamaModelMetadata(resolvedInitialModel, {
      timeoutMs: 750,
    });

    if (isAdvisorEnabled()) {
      const advisorOption = canUserConfigureAdvisor()
        ? (options as { advisor?: string }).advisor
        : undefined;
      if (advisorOption) {
        logForDebugging(`[AdvisorTool] --advisor ${advisorOption}`);
        if (!modelSupportsAdvisor(resolvedInitialModel)) {
          process.stderr.write(
            chalk.red(
              `Error: The model "${resolvedInitialModel}" does not support the advisor tool.\n`,
            ),
          );
          process.exit(1);
        }
        const normalizedAdvisorModel = normalizeModelStringForAPI(
          parseUserSpecifiedModel(advisorOption),
        );
        if (!isValidAdvisorModel(normalizedAdvisorModel)) {
          process.stderr.write(
            chalk.red(
              `Error: The model "${advisorOption}" cannot be used as an advisor.\n`,
            ),
          );
          process.exit(1);
        }
      }
      advisorModel = canUserConfigureAdvisor()
        ? advisorOption ?? getInitialAdvisorSetting()
        : advisorOption;
      if (advisorModel) {
        logForDebugging(`[AdvisorTool] Advisor model: ${advisorModel}`);
      }
    }

    // Check quota status, fast mode, passes eligibility, and bootstrap data
    // after trust is established. These make API calls which could trigger
    // apiKeyHelper execution.
    // --bare / SIMPLE: skip — these are cache-warms for the REPL's
    // first-turn responsiveness (quota, passes, fastMode, bootstrap data). Fast
    // mode doesn't apply to the Agent SDK anyway (see getFastModeUnavailableReason).
    const bgRefreshThrottleMs = getFeatureValue_CACHED_MAY_BE_STALE('tengu_cicada_nap_ms', 0);
    const lastPrefetched = getGlobalConfig().startupPrefetchedAt ?? 0;
    const skipStartupPrefetches = isBareMode() || bgRefreshThrottleMs > 0 && Date.now() - lastPrefetched < bgRefreshThrottleMs;
    if (!skipStartupPrefetches) {
      const lastPrefetchedInfo = lastPrefetched > 0 ? ` last ran ${Math.round((Date.now() - lastPrefetched) / 1000)}s ago` : '';
      logForDebugging(`Starting background startup prefetches${lastPrefetchedInfo}`);
      checkQuotaStatus().catch(error => logError(error));

      // Fetch bootstrap data from the server and update all cache values.
      void fetchBootstrapData();

      // TODO: Consolidate other prefetches into a single bootstrap request.
      void prefetchPassesEligibility();
      if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_miraculo_the_bard', false)) {
        void prefetchFastModeStatus();
      } else {
        // Kill switch skips the network call, not org-policy enforcement.
        // Resolve from cache so orgStatus doesn't stay 'pending' (which
        // getFastModeUnavailableReason treats as permissive).
        resolveFastModeStatusFromCache();
      }
      if (bgRefreshThrottleMs > 0) {
        saveGlobalConfig(current => ({
          ...current,
          startupPrefetchedAt: Date.now()
        }));
      }
    } else {
      logForDebugging(`Skipping startup prefetches, last ran ${Math.round((Date.now() - lastPrefetched) / 1000)}s ago`);
      // Resolve fast mode org status from cache (no network)
      resolveFastModeStatusFromCache();
    }
    if (!isNonInteractiveSession) {
      void refreshExampleCommands(); // Pre-fetch example commands (runs git log, no API call)
    }

    // Resolve MCP configs (started early, overlaps with setup/trust dialog work)
    const {
      servers: existingMcpConfigs
    } = await mcpConfigPromise;
    logForDebugging(`[STARTUP] MCP configs resolved in ${mcpConfigResolvedMs}ms (awaited at +${Date.now() - mcpConfigStart}ms)`);
    // CLI flag (--mcp-config) should override file-based configs, matching settings precedence
    const allMcpConfigs = {
      ...existingMcpConfigs,
      ...dynamicMcpConfig
    };

    // Separate SDK configs from regular MCP configs
    const sdkMcpConfigs: Record<string, McpSdkServerConfig> = {};
    const regularMcpConfigs: Record<string, ScopedMcpServerConfig> = {};
    for (const [name, config] of Object.entries(allMcpConfigs)) {
      const typedConfig = config as ScopedMcpServerConfig | McpSdkServerConfig;
      if (typedConfig.type === 'sdk') {
        sdkMcpConfigs[name] = typedConfig as McpSdkServerConfig;
      } else {
        regularMcpConfigs[name] = typedConfig as ScopedMcpServerConfig;
      }
    }
    profileCheckpoint('action_mcp_configs_loaded');

    // Prefetch MCP resources after trust dialog (this is where execution happens).
    // Interactive mode only: print mode defers connects until headlessStore exists
    // and pushes per-server (below), so ToolSearch's pending-client handling works
    // and one slow server doesn't block the batch.
    const localMcpPromise = isNonInteractiveSession ? Promise.resolve({
      clients: [],
      tools: [],
      commands: []
    }) : prefetchAllMcpResources(regularMcpConfigs);
    const uraiMcpPromise = isNonInteractiveSession ? Promise.resolve({
      clients: [],
      tools: [],
      commands: []
    }) : uraiConfigPromise.then(configs => Object.keys(configs).length > 0 ? prefetchAllMcpResources(configs) : {
      clients: [],
      tools: [],
      commands: []
    });
    // Merge with dedup by name: each prefetchAllMcpResources call independently
    // adds helper tools (ListMcpResourcesTool, ReadMcpResourceTool) via
    // local dedup flags, so merging two calls can yield duplicates. print.ts
    // already uniqBy's the final tool pool, but dedup here keeps appState clean.
    const mcpPromise = Promise.all([localMcpPromise, uraiMcpPromise]).then(([local, urai]) => ({
      clients: [...local.clients, ...urai.clients],
      tools: uniqBy([...local.tools, ...urai.tools], 'name'),
      commands: uniqBy([...local.commands, ...urai.commands], 'name')
    }));

    // Start hooks early so they run in parallel with MCP connections.
    // Skip for initOnly/init/maintenance (handled separately), non-interactive
    // (handled via setupTrigger), and resume/continue (conversationRecovery.ts
    // fires 'resume' instead — without this guard, hooks fire TWICE on /resume
    // and the second systemMessage clobbers the first. gh-30825)
    const hooksPromise = initOnly || init || maintenance || isNonInteractiveSession || options.continue || options.resume ? null : processSessionStartHooks('startup', {
      agentType: mainThreadAgentDefinition?.agentType,
      model: resolvedInitialModel
    });

    // MCP never blocks REPL render OR turn 1 TTFT. useManageMCPConnections
    // populates appState.mcp async as servers connect (connectToServer is
    // memoized — the prefetch calls above and the hook converge on the same
    // connections). getToolUseContext reads store.getState() fresh via
    // computeTools(), so turn 1 sees whatever's connected by query time.
    // Slow servers populate for turn 2+. Matches interactive-no-prompt
    // behavior. Print mode: per-server push into headlessStore (below).
    const hookMessages: Awaited<NonNullable<typeof hooksPromise>> = [];
    // Suppress transient unhandledRejection — the prefetch warms the
    // memoized connectToServer cache but nobody awaits it in interactive.
    mcpPromise.catch(() => {});
    const mcpClients: Awaited<typeof mcpPromise>['clients'] = [];
    const mcpTools: Awaited<typeof mcpPromise>['tools'] = [];
    const mcpCommands: Awaited<typeof mcpPromise>['commands'] = [];
    let thinkingEnabled = shouldEnableThinkingByDefault();
    let thinkingConfig: ThinkingConfig = thinkingEnabled !== false ? {
      type: 'adaptive'
    } : {
      type: 'disabled'
    };
    if (options.thinking === 'adaptive' || options.thinking === 'enabled') {
      thinkingEnabled = true;
      thinkingConfig = {
        type: 'adaptive'
      };
    } else if (options.thinking === 'disabled') {
      thinkingEnabled = false;
      thinkingConfig = {
        type: 'disabled'
      };
    } else {
      const maxThinkingTokens = process.env.MAX_THINKING_TOKENS ? parseInt(process.env.MAX_THINKING_TOKENS, 10) : options.maxThinkingTokens;
      if (maxThinkingTokens !== undefined) {
        if (maxThinkingTokens > 0) {
          thinkingEnabled = true;
          thinkingConfig = {
            type: 'enabled',
            budgetTokens: maxThinkingTokens
          };
        } else if (maxThinkingTokens === 0) {
          thinkingEnabled = false;
          thinkingConfig = {
            type: 'disabled'
          };
        }
      }
    }
    logForDiagnosticsNoPII('info', 'started', {
      version: MACRO.VERSION,
      is_native_binary: isInBundledMode()
    });
    registerCleanup(async () => {
      logForDiagnosticsNoPII('info', 'exited');
    });
    void logTenguInit({
      hasInitialPrompt: Boolean(prompt),
      hasStdin: Boolean(inputPrompt),
      verbose,
      debug,
      debugToStderr,
      print: print ?? false,
      outputFormat: outputFormat ?? 'text',
      inputFormat: inputFormat ?? 'text',
      numAllowedTools: allowedTools.length,
      numDisallowedTools: disallowedTools.length,
      mcpClientCount: Object.keys(allMcpConfigs).length,
      worktreeEnabled,
      skipWebFetchPreflight: getInitialSettings().skipWebFetchPreflight,
      githubActionInputs: process.env.GITHUB_ACTION_INPUTS,
      dangerouslySkipPermissionsPassed: dangerouslySkipPermissions ?? false,
      permissionMode,
      modeIsBypass: permissionMode === 'bypassPermissions',
      allowDangerouslySkipPermissionsPassed: allowDangerouslySkipPermissions,
      systemPromptFlag: systemPrompt ? options.systemPromptFile ? 'file' : 'flag' : undefined,
      appendSystemPromptFlag: appendSystemPrompt ? options.appendSystemPromptFile ? 'file' : 'flag' : undefined,
      thinkingConfig,
      assistantActivationPath: feature('KAIROS') && kairosEnabled ? assistantModule?.getAssistantActivationPath() : undefined
    });

    // Log context metrics once at initialization
    void logContextMetrics(regularMcpConfigs, toolPermissionContext);
    void logPermissionContextForAnts(null, 'initialization');
    logManagedSettings();

    // Register PID file for concurrent-session detection (~/.ur/sessions/)
    // and fire multi-clauding telemetry. Lives here (not init.ts) so only the
    // REPL path registers — not subcommands like `ur doctor`. Chained:
    // count must run after register's write completes or it misses our own file.
    void registerSession().then(registered => {
      if (!registered) return;
      if (sessionNameArg) {
        void updateSessionName(sessionNameArg);
      }
      void countConcurrentSessions().then(count => {
        if (count >= 2) {
          logEvent('tengu_concurrent_sessions', {
            num_sessions: count
          });
        }
      });
    });

    // Initialize versioned plugins system (triggers V1→V2 migration if
    // needed). Then run orphan GC, THEN warm the Grep/Glob exclusion cache.
    // Sequencing matters: the warmup scans disk for .orphaned_at markers,
    // so it must see the GC's Pass 1 (remove markers from reinstalled
    // versions) and Pass 2 (stamp unmarked orphans) already applied. The
    // warm also lands before autoupdate (fires on first submit in REPL)
    // can orphan this session's active version underneath us.
    // --bare / SIMPLE: skip plugin version sync + orphan cleanup. These
    // are install/upgrade bookkeeping that scripted calls don't need —
    // the next interactive session will reconcile. The await here was
    // blocking -p on a marketplace round-trip.
    if (isBareMode()) {
      // skip — no-op
    } else if (isNonInteractiveSession) {
      // In headless mode, await to ensure plugin sync completes before CLI exits
      await initializeVersionedPlugins();
      profileCheckpoint('action_after_plugins_init');
      void cleanupOrphanedPluginVersionsInBackground().then(() => getGlobExclusionsForPluginCache());
    } else {
      // In interactive mode, fire-and-forget — this is purely bookkeeping
      // that doesn't affect runtime behavior of the current session
      void initializeVersionedPlugins().then(async () => {
        profileCheckpoint('action_after_plugins_init');
        await cleanupOrphanedPluginVersionsInBackground();
        void getGlobExclusionsForPluginCache();
      });
    }
    const setupTrigger = initOnly || init ? 'init' : maintenance ? 'maintenance' : null;
    if (initOnly) {
      applyConfigEnvironmentVariables();
      await processSetupHooks('init', {
        forceSyncExecution: true
      });
      await processSessionStartHooks('startup', {
        forceSyncExecution: true
      });
      gracefulShutdownSync(0);
      return;
    }

    // --print mode
    if (isNonInteractiveSession) {
      if (outputFormat === 'stream-json' || outputFormat === 'json') {
        setHasFormattedOutput(true);
      }

      // Apply full environment variables in print mode since trust dialog is bypassed
      // This includes potentially dangerous environment variables from untrusted sources
      // but print mode is considered trusted (as documented in help text)
      applyConfigEnvironmentVariables();

      // Initialize telemetry after env vars are applied so OTEL endpoint env vars and
      // otelHeadersHelper (which requires trust to execute) are available.
      initializeTelemetryAfterTrust();

      // Kick SessionStart hooks now so the subprocess spawn overlaps with
      // MCP connect + plugin init + print.ts import below. loadInitialMessages
      // joins this at print.ts:4397. Guarded same as loadInitialMessages —
      // continue/resume/teleport paths don't fire startup hooks (or fire them
      // conditionally inside the resume branch, where this promise is
      // undefined and the ?? fallback runs). Also skip when setupTrigger is
      // set — those paths run setup hooks first (print.ts:544), and session
      // start hooks must wait until setup completes.
      const sessionStartHooksPromise = options.continue || options.resume || teleport || setupTrigger ? undefined : processSessionStartHooks('startup');
      // Suppress transient unhandledRejection if this rejects before
      // loadInitialMessages awaits it. Downstream await still observes the
      // rejection — this just prevents the spurious global handler fire.
      sessionStartHooksPromise?.catch(() => {});
      profileCheckpoint('before_validateForceLoginOrg');
      // Validate org restriction for non-interactive sessions
      const orgValidation = await validateForceLoginOrg();
      if (!orgValidation.valid) {
        process.stderr.write((orgValidation as { valid: false; message: string }).message + '\n');
        process.exit(1);
      }

      // Headless mode supports all prompt commands and some local commands
      // If disableSlashCommands is true, return empty array
      const commandsHeadless = disableSlashCommands ? [] : commands.filter(command => command.type === 'prompt' && !command.disableNonInteractive || command.type === 'local' && command.supportsNonInteractive);
      const defaultState = getDefaultAppState();
      const headlessInitialState: AppState = {
        ...defaultState,
        mcp: {
          ...defaultState.mcp,
          clients: mcpClients,
          commands: mcpCommands,
          tools: mcpTools
        },
        toolPermissionContext,
        effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
        ...(isFastModeEnabled() && {
          fastMode: getInitialFastModeSetting(effectiveModel ?? null)
        }),
        ...(isAdvisorEnabled() && advisorModel && {
          advisorModel
        }),
        // kairosEnabled gates the async fire-and-forget path in
        // executeForkedSlashCommand (processSlashCommand.tsx:132) and
        // AgentTool's shouldRunAsync. The REPL initialState sets this at
        // ~3459; headless was defaulting to false, so the daemon child's
        // scheduled tasks and Agent-tool calls ran synchronously — N
        // overdue cron tasks on spawn = N serial subagent turns blocking
        // user input. Computed at :1620, well before this branch.
        ...(feature('KAIROS') ? {
          kairosEnabled
        } : {})
      };

      // Init app state
      const headlessStore = createStore(headlessInitialState, onChangeAppState);

      // Check if bypassPermissions should be disabled based on Statsig gate
      // This runs in parallel to the code below, to avoid blocking the main loop.
      if (toolPermissionContext.mode === 'bypassPermissions' || allowDangerouslySkipPermissions) {
        void checkAndDisableBypassPermissions(toolPermissionContext);
      }

      // Async check of auto mode gate — corrects state and disables auto if needed.
      // Gated on TRANSCRIPT_CLASSIFIER (not USER_TYPE) so GrowthBook kill switch runs for external builds too.
      if (feature('TRANSCRIPT_CLASSIFIER')) {
        void verifyAutoModeGateAccess(toolPermissionContext, headlessStore.getState().fastMode).then(({
          updateContext
        }) => {
          headlessStore.setState(prev => {
            const nextCtx = updateContext(prev.toolPermissionContext);
            if (nextCtx === prev.toolPermissionContext) return prev;
            return {
              ...prev,
              toolPermissionContext: nextCtx
            };
          });
        });
      }

      // Set global state for session persistence
      if (options.sessionPersistence === false) {
        setSessionPersistenceDisabled(true);
      }

      // Store SDK betas in global state for context window calculation
      // Only store allowed betas (filters by allowlist and subscriber status)
      setSdkBetas(filterAllowedSdkBetas(betas));

      // Print-mode MCP: per-server incremental push into headlessStore.
      // Mirrors useManageMCPConnections — push pending first (so ToolSearch's
      // pending-check at ToolSearchTool.ts:334 sees them), then replace with
      // connected/failed as each server settles.
      const connectMcpBatch = (configs: Record<string, ScopedMcpServerConfig>, label: string): Promise<void> => {
        if (Object.keys(configs).length === 0) return Promise.resolve();
        headlessStore.setState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: [...prev.mcp.clients, ...Object.entries(configs).map(([name, config]) => ({
              name,
              type: 'pending' as const,
              config
            }))]
          }
        }));
        return getMcpToolsCommandsAndResources(({
          client,
          tools,
          commands
        }) => {
          headlessStore.setState(prev => ({
            ...prev,
            mcp: {
              ...prev.mcp,
              clients: prev.mcp.clients.some(c => c.name === client.name) ? prev.mcp.clients.map(c => c.name === client.name ? client : c) : [...prev.mcp.clients, client],
              tools: uniqBy([...prev.mcp.tools, ...tools], 'name'),
              commands: uniqBy([...prev.mcp.commands, ...commands], 'name')
            }
          }));
        }, configs).catch(err => logForDebugging(`[MCP] ${label} connect error: ${err}`));
      };
      // Await all MCP configs — print mode is often single-turn, so
      // "late-connecting servers visible next turn" doesn't help. SDK init
      // message and turn-1 tool list both need configured MCP tools present.
      // Zero-server case is free via the early return in connectMcpBatch.
      // Connectors parallelize inside getMcpToolsCommandsAndResources
      // (processBatched with Promise.all). ur.ai is awaited too — its
      // fetch was kicked off early (line ~2558) so only residual time blocks
      // here. --bare skips ur.ai entirely for perf-sensitive scripts.
      profileCheckpoint('before_connectMcp');
      await connectMcpBatch(regularMcpConfigs, 'regular');
      profileCheckpoint('after_connectMcp');
      // Dedup: suppress plugin MCP servers that duplicate a ur.ai
      // connector (connector wins), then connect ur.ai servers.
      // Bounded wait — #23725 made this blocking so single-turn -p sees
      // connectors, but with 40+ slow connectors tengu_startup_perf p99
      // climbed to 76s. If fetch+connect doesn't finish in time, proceed;
      // the promise keeps running and updates headlessStore in the
      // background so turn 2+ still sees connectors.
      const UR_AI_MCP_TIMEOUT_MS = 5_000;
      const uraiConnect = uraiConfigPromise.then(uraiConfigs => {
        if (Object.keys(uraiConfigs).length > 0) {
          const uraiSigs = new Set<string>();
          for (const config of Object.values(uraiConfigs)) {
            const sig = getMcpServerSignature(config);
            if (sig) uraiSigs.add(sig);
          }
          const suppressed = new Set<string>();
          for (const [name, config] of Object.entries(regularMcpConfigs)) {
            if (!name.startsWith('plugin:')) continue;
            const sig = getMcpServerSignature(config);
            if (sig && uraiSigs.has(sig)) suppressed.add(name);
          }
          if (suppressed.size > 0) {
            logForDebugging(`[MCP] Lazy dedup: suppressing ${suppressed.size} plugin server(s) that duplicate ur.ai connectors: ${[...suppressed].join(', ')}`);
            // Disconnect before filtering from state. Only connected
            // servers need cleanup — clearServerCache on a never-connected
            // server triggers a real connect just to kill it (memoize
            // cache-miss path, see useManageMCPConnections.ts:870).
            for (const c of headlessStore.getState().mcp.clients) {
              if (!suppressed.has(c.name) || c.type !== 'connected') continue;
              c.client.onclose = undefined;
              void clearServerCache(c.name, c.config).catch(() => {});
            }
            headlessStore.setState(prev => {
              let {
                clients,
                tools,
                commands,
                resources
              } = prev.mcp;
              clients = clients.filter(c => !suppressed.has(c.name));
              tools = tools.filter(t => !t.mcpInfo || !suppressed.has(t.mcpInfo.serverName));
              for (const name of suppressed) {
                commands = excludeCommandsByServer(commands, name);
                resources = excludeResourcesByServer(resources, name);
              }
              return {
                ...prev,
                mcp: {
                  ...prev.mcp,
                  clients,
                  tools,
                  commands,
                  resources
                }
              };
            });
          }
        }
        // Suppress ur.ai connectors that duplicate an enabled
        // manual server (URL-signature match). Plugin dedup above only
        // handles `plugin:*` keys; this catches manual `.mcp.json` entries.
        // plugin:* must be excluded here — step 1 already suppressed
        // those (ur.ai wins); leaving them in suppresses the
        // connector too, and neither survives (gh-39974).
        const nonPluginConfigs = pickBy(regularMcpConfigs, (_, n) => !n.startsWith('plugin:'));
        const {
          servers: dedupedURAi
        } = dedupURAiMcpServers(uraiConfigs, nonPluginConfigs);
        return connectMcpBatch(dedupedURAi, 'urai');
      });
      let uraiTimer: ReturnType<typeof setTimeout> | undefined;
      const uraiTimedOut = await Promise.race([uraiConnect.then(() => false), new Promise<boolean>(resolve => {
        uraiTimer = setTimeout(r => r(true), UR_AI_MCP_TIMEOUT_MS, resolve);
      })]);
      if (uraiTimer) clearTimeout(uraiTimer);
      if (uraiTimedOut) {
        logForDebugging(`[MCP] ur.ai connectors not ready after ${UR_AI_MCP_TIMEOUT_MS}ms — proceeding; background connection continues`);
      }
      profileCheckpoint('after_connectMcp_urai');

      // In headless mode, start deferred prefetches immediately (no user typing delay)
      // --bare / SIMPLE: startDeferredPrefetches early-returns internally.
      // backgroundHousekeeping (initExtractMemories, pruneShellSnapshots,
      // cleanupOldMessageFiles) and sdkHeapDumpMonitor are all bookkeeping
      // that scripted calls don't need — the next interactive session reconciles.
      if (!isBareMode()) {
        startDeferredPrefetches();
        void import('./utils/backgroundHousekeeping.js').then(m => m.startBackgroundHousekeeping());
        if (("external" as string) === 'ant') {
          void import('./utils/sdkHeapDumpMonitor.js').then(m => m.startSdkMemoryMonitor());
        }
      }
      logSessionTelemetry();
      profileCheckpoint('before_print_import');
      const {
        runHeadless
      } = await import('src/cli/print.js');
      profileCheckpoint('after_print_import');
      await runHeadless(inputPrompt, () => headlessStore.getState(), headlessStore.setState, commandsHeadless, tools, sdkMcpConfigs, agentDefinitions.activeAgents, {
        continue: options.continue,
        resume: options.resume,
        verbose: verbose,
        outputFormat: outputFormat,
        jsonSchema,
        permissionPromptToolName: options.permissionPromptTool,
        allowedTools,
        thinkingConfig,
        maxTurns: options.maxTurns,
        maxBudgetUsd: options.maxBudgetUsd,
        taskBudget: options.taskBudget ? {
          total: options.taskBudget
        } : undefined,
        systemPrompt,
        appendSystemPrompt,
        userSpecifiedModel: effectiveModel,
        fallbackModel: userSpecifiedFallbackModel,
        teleport,
        sdkUrl,
        replayUserMessages: effectiveReplayUserMessages,
        includePartialMessages: effectiveIncludePartialMessages,
        forkSession: options.forkSession || false,
        resumeSessionAt: options.resumeSessionAt || undefined,
        rewindFiles: options.rewindFiles,
        enableAuthStatus: options.enableAuthStatus,
        agent: agentCli,
        workload: options.workload,
        setupTrigger: setupTrigger ?? undefined,
        sessionStartHooksPromise
      });
      return;
    }

    // Log model config at startup
    logEvent('tengu_startup_manual_model_config', {
      cli_flag: options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      env_var: process.env.URHQ_MODEL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      settings_file: (getInitialSettings() || {}).model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      subscriptionType: getSubscriptionType() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      agent: agentSetting as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });

    // Get deprecation warning for the initial model (resolvedInitialModel computed earlier for hooks parallelization)
    const deprecationWarning = getModelDeprecationWarning(resolvedInitialModel);

    // Build initial notification queue
    const initialNotifications: Array<{
      key: string;
      text: string;
      color?: 'warning';
      priority: 'high';
    }> = [];
    if (permissionModeNotification) {
      initialNotifications.push({
        key: 'permission-mode-notification',
        text: permissionModeNotification,
        priority: 'high'
      });
    }
    if (deprecationWarning) {
      initialNotifications.push({
        key: 'model-deprecation-warning',
        text: deprecationWarning,
        color: 'warning',
        priority: 'high'
      });
    }
    if (overlyBroadBashPermissions.length > 0) {
      const displayList = uniq(overlyBroadBashPermissions.map(p => p.ruleDisplay));
      const displays = displayList.join(', ');
      const sources = uniq(overlyBroadBashPermissions.map(p => p.sourceDisplay)).join(', ');
      const n = displayList.length;
      initialNotifications.push({
        key: 'overly-broad-bash-notification',
        text: `${displays} allow ${plural(n, 'rule')} from ${sources} ${plural(n, 'was', 'were')} ignored \u2014 not available for Ants, please use auto-mode instead`,
        color: 'warning',
        priority: 'high'
      });
    }
    const effectiveToolPermissionContext = {
      ...toolPermissionContext,
      mode: isAgentSwarmsEnabled() && getTeammateUtils().isPlanModeRequired() ? 'plan' as const : toolPermissionContext.mode
    };
    // All startup opt-in paths (--tools, --brief, defaultView) have fired
    // above; initialIsBriefOnly just reads the resulting state.
    const initialIsBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ? getUserMsgOptIn() : false;
    const fullRemoteControl = remoteControl || getRemoteControlAtStartup() || kairosEnabled;
    let ccrMirrorEnabled = false;
    if (feature('CCR_MIRROR') && !fullRemoteControl) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        isCcrMirrorEnabled
      } = require('./bridge/bridgeEnabled.js') as typeof import('./bridge/bridgeEnabled.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      ccrMirrorEnabled = isCcrMirrorEnabled();
    }
    const initialSettings = getInitialSettings();
    const initialState: AppState = {
      settings: initialSettings,
      provider: getActiveProviderSettings(initialSettings),
      tasks: {},
      agentNameRegistry: new Map(),
      verbose: verbose ?? getGlobalConfig().verbose ?? false,
      mainLoopModel: initialMainLoopModel,
      mainLoopModelForSession: null,
      isBriefOnly: initialIsBriefOnly,
      expandedView: getGlobalConfig().showSpinnerTree ? 'teammates' : getGlobalConfig().showExpandedTodos ? 'tasks' : 'none',
      showTeammateMessagePreview: isAgentSwarmsEnabled() ? false : undefined,
      selectedIPAgentIndex: -1,
      coordinatorTaskIndex: -1,
      viewSelectionMode: 'none',
      footerSelection: null,
      toolPermissionContext: effectiveToolPermissionContext,
      agent: mainThreadAgentDefinition?.agentType,
      agentDefinitions,
      mcp: {
        clients: [],
        tools: [],
        commands: [],
        resources: {},
        pluginReconnectKey: 0
      },
      plugins: {
        enabled: [],
        disabled: [],
        commands: [],
        errors: [],
        installationStatus: {
          marketplaces: [],
          plugins: []
        },
        needsRefresh: false
      },
      statusLineText: undefined,
      kairosEnabled,
      remoteSessionUrl: undefined,
      remoteConnectionStatus: 'connecting',
      remoteBackgroundTaskCount: 0,
      replBridgeEnabled: fullRemoteControl || ccrMirrorEnabled,
      replBridgeExplicit: remoteControl,
      replBridgeOutboundOnly: ccrMirrorEnabled,
      replBridgeConnected: false,
      replBridgeSessionActive: false,
      replBridgeReconnecting: false,
      replBridgeConnectUrl: undefined,
      replBridgeSessionUrl: undefined,
      replBridgeEnvironmentId: undefined,
      replBridgeSessionId: undefined,
      replBridgeError: undefined,
      replBridgeInitialName: remoteControlName,
      showRemoteCallout: false,
      notifications: {
        current: null,
        queue: initialNotifications
      },
      elicitation: {
        queue: []
      },
      todos: {},
      remoteAgentTaskSuggestions: [],
      fileHistory: {
        snapshots: [],
        trackedFiles: new Set(),
        snapshotSequence: 0
      },
      attribution: createEmptyAttributionState(),
      thinkingEnabled,
      promptSuggestionEnabled: shouldEnablePromptSuggestion(),
      sessionHooks: new Map(),
      inbox: {
        messages: []
      },
      promptSuggestion: {
        text: null,
        promptId: null,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: null
      },
      speculation: IDLE_SPECULATION_STATE,
      speculationSessionTimeSavedMs: 0,
      skillImprovement: {
        suggestion: null
      },
      workerSandboxPermissions: {
        queue: [],
        selectedIndex: 0
      },
      pendingWorkerRequest: null,
      pendingSandboxRequest: null,
      authVersion: 0,
      initialMessage: inputPrompt ? {
        message: createUserMessage({
          content: String(inputPrompt)
        })
      } : null,
      effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
      activeOverlays: new Set<string>(),
      fastMode: getInitialFastModeSetting(resolvedInitialModel),
      ...(isAdvisorEnabled() && advisorModel && {
        advisorModel
      }),
      // Compute teamContext synchronously to avoid useEffect setState during render.
      // KAIROS: assistantTeamContext takes precedence — set earlier in the
      // KAIROS block so Agent(name: "foo") can spawn in-process teammates
      // without TeamCreate. computeInitialTeamContext() is for tmux-spawned
      // teammates reading their own identity, not the assistant-mode leader.
      teamContext: feature('KAIROS') ? assistantTeamContext ?? computeInitialTeamContext?.() : computeInitialTeamContext?.()
    };

    // Add CLI initial prompt to history
    if (inputPrompt) {
      addToHistory(String(inputPrompt));
    }
    const initialTools = mcpTools;

    // Increment numStartups synchronously — first-render readers like
    // shouldShowEffortCallout (via useState initializer) need the updated
    // value before setImmediate fires. Defer only telemetry.
    saveGlobalConfig(current => ({
      ...current,
      numStartups: (current.numStartups ?? 0) + 1
    }));
    setImmediate(() => {
      void logStartupTelemetry();
      logSessionTelemetry();
    });

    // Set up per-turn session environment data uploader (ant-only build).
    // Default-enabled for all ant users when working in an UR-owned
    // repo. Captures git/filesystem state (NOT transcripts) at each turn so
    // environments can be recreated at any user message index. Gating:
    //   - Build-time: this import is stubbed in external builds.
    //   - Safety: UR_CODE_DISABLE_SESSION_DATA_UPLOAD=1 bypasses (tests set this).
    // Import is dynamic + async to avoid adding startup latency.
    const sessionUploaderPromise = ("external" as string) === 'ant' ? import('./utils/sessionDataUploader.js') : null;

    // Defer session uploader resolution to the onTurnComplete callback to avoid
    // adding a new top-level await in main.tsx (performance-critical path).
    // The per-turn auth logic in sessionDataUploader.ts handles unauthenticated
    // state gracefully (re-checks each turn, so auth recovery mid-session works).
    const uploaderReady = sessionUploaderPromise ? sessionUploaderPromise.then(mod => mod.createSessionTurnUploader()).catch(() => null) : null;
    const sessionConfig = {
      debug: debug || debugToStderr,
      commands: [...commands, ...mcpCommands],
      initialTools,
      mcpClients,
      autoConnectIdeFlag: ide,
      mainThreadAgentDefinition,
      disableSlashCommands,
      dynamicMcpConfig,
      strictMcpConfig,
      systemPrompt,
      appendSystemPrompt,
      taskListId,
      thinkingConfig,
      ...(uploaderReady && {
        onTurnComplete: (messages: MessageType[]) => {
          void uploaderReady.then(uploader => uploader?.(messages));
        }
      })
    };

    // Shared context for processResumedConversation calls
    const resumeContext = {
      modeApi: coordinatorModeModule,
      mainThreadAgentDefinition,
      agentDefinitions,
      currentCwd,
      cliAgents,
      initialState
    };
    if (options.continue) {
      // Continue the most recent conversation directly
      let resumeSucceeded = false;
      try {
        const resumeStart = performance.now();

        // Clear stale caches before resuming to ensure fresh file/skill discovery
        const {
          clearSessionCaches
        } = await import('./commands/clear/caches.js');
        clearSessionCaches();
        const result = await loadConversationForResume(undefined /* sessionId */, undefined /* sourceFile */);
        if (!result) {
          logEvent('tengu_continue', {
            success: false
          });
          return await exitWithError(root, 'No conversation found to continue');
        }
        const loaded = await processResumedConversation(result, {
          forkSession: !!options.forkSession,
          includeAttribution: true,
          transcriptPath: result.fullPath
        }, resumeContext);
        if (loaded.restoredAgentDef) {
          mainThreadAgentDefinition = loaded.restoredAgentDef;
        }
        maybeActivateProactive(options);
        maybeActivateBrief(options);
        logEvent('tengu_continue', {
          success: true,
          resume_duration_ms: Math.round(performance.now() - resumeStart)
        });
        resumeSucceeded = true;
        await launchRepl(root, {
          getFpsMetrics,
          stats,
          initialState: loaded.initialState
        }, {
          ...sessionConfig,
          mainThreadAgentDefinition: loaded.restoredAgentDef ?? mainThreadAgentDefinition,
          initialMessages: loaded.messages,
          initialFileHistorySnapshots: loaded.fileHistorySnapshots,
          initialContentReplacements: loaded.contentReplacements,
          initialAgentName: loaded.agentName,
          initialAgentColor: loaded.agentColor
        }, renderAndRun);
      } catch (error) {
        if (!resumeSucceeded) {
          logEvent('tengu_continue', {
            success: false
          });
        }
        logError(error);
        process.exit(1);
      }
    } else if (feature('DIRECT_CONNECT') && _pendingConnect?.url) {
      // `ur connect <url>` — full interactive TUI connected to a remote server
      let directConnectConfig;
      try {
        const session = await createDirectConnectSession({
          serverUrl: _pendingConnect.url,
          authToken: _pendingConnect.authToken,
          cwd: getOriginalCwd(),
          dangerouslySkipPermissions: _pendingConnect.dangerouslySkipPermissions
        });
        if (session.workDir) {
          setOriginalCwd(session.workDir);
          setCwdState(session.workDir);
        }
        setDirectConnectServerUrl(_pendingConnect.url);
        directConnectConfig = session.config;
      } catch (err) {
        return await exitWithError(root, err instanceof DirectConnectError ? err.message : String(err), () => gracefulShutdown(1));
      }
      const connectInfoMessage = createSystemMessage(`Connected to server at ${_pendingConnect.url}\nSession: ${directConnectConfig.sessionId}`, 'info');
      await launchRepl(root, {
        getFpsMetrics,
        stats,
        initialState
      }, {
        debug: debug || debugToStderr,
        commands,
        initialTools: [],
        initialMessages: [connectInfoMessage],
        mcpClients: [],
        autoConnectIdeFlag: ide,
        mainThreadAgentDefinition,
        disableSlashCommands,
        directConnectConfig,
        thinkingConfig
      }, renderAndRun);
      return;
    } else if (feature('SSH_REMOTE') && _pendingSSH?.host) {
      // `ur ssh <host> [dir]` — probe remote, deploy binary if needed,
      // spawn ssh with unix-socket -R forward to a local auth proxy, hand
      // the REPL an SSHSession. Tools run remotely, UI renders locally.
      // `--local` skips probe/deploy/ssh and spawns the current binary
      // directly with the same env — e2e test of the proxy/auth plumbing.
      const {
        createSSHSession,
        createLocalSSHSession,
        SSHSessionError
      } = await import('./ssh/createSSHSession.js');
      let sshSession;
      try {
        if (_pendingSSH.local) {
          process.stderr.write('Starting local ssh-proxy test session...\n');
          sshSession = createLocalSSHSession({
            cwd: _pendingSSH.cwd,
            permissionMode: _pendingSSH.permissionMode,
            dangerouslySkipPermissions: _pendingSSH.dangerouslySkipPermissions
          });
        } else {
          process.stderr.write(`Connecting to ${_pendingSSH.host}…\n`);
          // In-place progress: \r + EL0 (erase to end of line). Final \n on
          // success so the next message lands on a fresh line. No-op when
          // stderr isn't a TTY (piped/redirected) — \r would just emit noise.
          const isTTY = process.stderr.isTTY;
          let hadProgress = false;
          sshSession = await createSSHSession({
            host: _pendingSSH.host,
            cwd: _pendingSSH.cwd,
            localVersion: MACRO.VERSION,
            permissionMode: _pendingSSH.permissionMode,
            dangerouslySkipPermissions: _pendingSSH.dangerouslySkipPermissions,
            extraCliArgs: _pendingSSH.extraCliArgs
          }, isTTY ? {
            onProgress: msg => {
              hadProgress = true;
              process.stderr.write(`\r  ${msg}\x1b[K`);
            }
          } : {});
          if (hadProgress) process.stderr.write('\n');
        }
        setOriginalCwd(sshSession.remoteCwd);
        setCwdState(sshSession.remoteCwd);
        setDirectConnectServerUrl(_pendingSSH.local ? 'local' : _pendingSSH.host);
      } catch (err) {
        return await exitWithError(root, err instanceof SSHSessionError ? err.message : String(err), () => gracefulShutdown(1));
      }
      const sshInfoMessage = createSystemMessage(_pendingSSH.local ? `Local ssh-proxy test session\ncwd: ${sshSession.remoteCwd}\nAuth: unix socket → local proxy` : `SSH session to ${_pendingSSH.host}\nRemote cwd: ${sshSession.remoteCwd}\nAuth: unix socket -R → local proxy`, 'info');
      await launchRepl(root, {
        getFpsMetrics,
        stats,
        initialState
      }, {
        debug: debug || debugToStderr,
        commands,
        initialTools: [],
        initialMessages: [sshInfoMessage],
        mcpClients: [],
        autoConnectIdeFlag: ide,
        mainThreadAgentDefinition,
        disableSlashCommands,
        sshSession,
        thinkingConfig
      }, renderAndRun);
      return;
    } else if (feature('KAIROS') && _pendingAssistantChat && (_pendingAssistantChat.sessionId || _pendingAssistantChat.discover)) {
      // `ur assistant [sessionId]` — REPL as a pure viewer client
      // of a remote assistant session. The agentic loop runs remotely; this
      // process streams live events and POSTs messages. History is lazy-
      // loaded by useAssistantHistory on scroll-up (no blocking fetch here).
      const {
        discoverAssistantSessions
      } = await import('./assistant/sessionDiscovery.js');
      let targetSessionId = _pendingAssistantChat.sessionId;

      // Discovery flow — list bridge environments, filter sessions
      if (!targetSessionId) {
        let sessions;
        try {
          sessions = await discoverAssistantSessions();
        } catch (e) {
          return await exitWithError(root, `Failed to discover sessions: ${e instanceof Error ? e.message : e}`, () => gracefulShutdown(1));
        }
        if (sessions.length === 0) {
          let installedDir: string | null;
          try {
            installedDir = await launchAssistantInstallWizard(root);
          } catch (e) {
            return await exitWithError(root, `Assistant installation failed: ${e instanceof Error ? e.message : e}`, () => gracefulShutdown(1));
          }
          if (installedDir === null) {
            await gracefulShutdown(0);
            process.exit(0);
          }
          // The daemon needs a few seconds to spin up its worker and
          // establish a bridge session before discovery will find it.
          return await exitWithMessage(root, `Assistant installed in ${installedDir}. The daemon is starting up — run \`ur assistant\` again in a few seconds to connect.`, {
            exitCode: 0,
            beforeExit: () => gracefulShutdown(0)
          });
        }
        if (sessions.length === 1) {
          targetSessionId = sessions[0]!.id;
        } else {
          const picked = await launchAssistantSessionChooser(root, {
            sessions
          });
          if (!picked) {
            await gracefulShutdown(0);
            process.exit(0);
          }
          targetSessionId = picked;
        }
      }

      // Auth — call prepareApiRequest() once for orgUUID, but use a
      // getAccessToken closure for the token so reconnects get fresh tokens.
      const {
        checkAndRefreshOAuthTokenIfNeeded,
        getURAIOAuthTokens
      } = await import('./utils/auth.js');
      await checkAndRefreshOAuthTokenIfNeeded();
      let apiCreds;
      try {
        apiCreds = await prepareApiRequest();
      } catch (e) {
        return await exitWithError(root, `Error: ${e instanceof Error ? e.message : 'Failed to authenticate'}`, () => gracefulShutdown(1));
      }
      const getAccessToken = (): string => getURAIOAuthTokens()?.accessToken ?? apiCreds.accessToken;

      // Brief mode activation: setKairosActive(true) satisfies BOTH opt-in
      // and entitlement for isBriefEnabled() (BriefTool.ts:124-132).
      setKairosActive(true);
      setUserMsgOptIn(true);
      setIsRemoteMode(true);
      const remoteSessionConfig = createRemoteSessionConfig(targetSessionId, getAccessToken, apiCreds.orgUUID, /* hasInitialPrompt */false, /* viewerOnly */true);
      const infoMessage = createSystemMessage(`Attached to assistant session ${targetSessionId.slice(0, 8)}…`, 'info');
      const assistantInitialState: AppState = {
        ...initialState,
        isBriefOnly: true,
        kairosEnabled: false,
        replBridgeEnabled: false
      };
      const remoteCommands = filterCommandsForRemoteMode(commands);
      await launchRepl(root, {
        getFpsMetrics,
        stats,
        initialState: assistantInitialState
      }, {
        debug: debug || debugToStderr,
        commands: remoteCommands,
        initialTools: [],
        initialMessages: [infoMessage],
        mcpClients: [],
        autoConnectIdeFlag: ide,
        mainThreadAgentDefinition,
        disableSlashCommands,
        remoteSessionConfig,
        thinkingConfig
      }, renderAndRun);
      return;
    } else if (options.resume || options.fromPr || teleport || remote !== null) {
      // Handle resume flow - from file (ant-only), session ID, or interactive selector

      // Clear stale caches before resuming to ensure fresh file/skill discovery
      const {
        clearSessionCaches
      } = await import('./commands/clear/caches.js');
      clearSessionCaches();
      let messages: MessageType[] | null = null;
      let processedResume: ProcessedResume | undefined = undefined;
      let maybeSessionId = validateUuid(options.resume);
      let searchTerm: string | undefined = undefined;
      // Store full LogOption when found by custom title (for cross-worktree resume)
      let matchedLog: LogOption | null = null;
      // PR filter for --from-pr flag
      let filterByPr: boolean | number | string | undefined = undefined;

      // Handle --from-pr flag
      if (options.fromPr) {
        if (options.fromPr === true) {
          // Show all sessions with linked PRs
          filterByPr = true;
        } else if (typeof options.fromPr === 'string') {
          // Could be a PR number or URL
          filterByPr = options.fromPr;
        }
      }

      // If resume value is not a UUID, try exact match by custom title first
      if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
        const trimmedValue = options.resume.trim();
        if (trimmedValue) {
          const matches = await searchSessionsByCustomTitle(trimmedValue, {
            exact: true
          });
          if (matches.length === 1) {
            // Exact match found - store full LogOption for cross-worktree resume
            matchedLog = matches[0]!;
            maybeSessionId = getSessionIdFromLog(matchedLog) ?? null;
          } else {
            // No match or multiple matches - use as search term for picker
            searchTerm = trimmedValue;
          }
        }
      }

      // --remote and --teleport both create/resume UR Web (CCR) sessions.
      // Remote Control (--rc) is a separate feature gated in initReplBridge.ts.
      if (remote !== null || teleport) {
        await waitForPolicyLimitsToLoad();
        if (!isPolicyAllowed('allow_remote_sessions')) {
          return await exitWithError(root, "Error: Remote sessions are disabled by your organization's policy.", () => gracefulShutdown(1));
        }
      }
      if (remote !== null) {
        // Create remote session (optionally with initial prompt)
        const hasInitialPrompt = remote.length > 0;

        // Check if TUI mode is enabled - description is only optional in TUI mode
        const isRemoteTuiEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_remote_backend', false);
        if (!isRemoteTuiEnabled && !hasInitialPrompt) {
          return await exitWithError(root, 'Error: --remote requires a description.\nUsage: ur --remote "your task description"', () => gracefulShutdown(1));
        }
        logEvent('tengu_remote_create_session', {
          has_initial_prompt: String(hasInitialPrompt) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });

        // Pass current branch so CCR clones the repo at the right revision
        const currentBranch = await getBranch();
        const createdSession = await teleportToRemoteWithErrorHandling(root, hasInitialPrompt ? remote : null, new AbortController().signal, currentBranch || undefined);
        if (!createdSession) {
          logEvent('tengu_remote_create_session_error', {
            error: 'unable_to_create_session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          return await exitWithError(root, 'Error: Unable to create remote session', () => gracefulShutdown(1));
        }
        logEvent('tengu_remote_create_session_success', {
          session_id: createdSession.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });

        // Check if new remote TUI mode is enabled via feature gate
        if (!isRemoteTuiEnabled) {
          // Original behavior: print session info and exit
          process.stdout.write(`Created remote session: ${createdSession.title}\n`);
          process.stdout.write(`View: ${getRemoteSessionUrl(createdSession.id)}?m=0\n`);
          process.stdout.write(`Resume with: ur --teleport ${createdSession.id}\n`);
          await gracefulShutdown(0);
          process.exit(0);
        }

        // New behavior: start local TUI with CCR engine
        // Mark that we're in remote mode for command visibility
        setIsRemoteMode(true);
        switchSession(asSessionId(createdSession.id));

        // Get OAuth credentials for remote session
        let apiCreds: {
          accessToken: string;
          orgUUID: string;
        };
        try {
          apiCreds = await prepareApiRequest();
        } catch (error) {
          logError(toError(error));
          return await exitWithError(root, `Error: ${errorMessage(error) || 'Failed to authenticate'}`, () => gracefulShutdown(1));
        }

        // Create remote session config for the REPL
        const {
          getURAIOAuthTokens: getTokensForRemote
        } = await import('./utils/auth.js');
        const getAccessTokenForRemote = (): string => getTokensForRemote()?.accessToken ?? apiCreds.accessToken;
        const remoteSessionConfig = createRemoteSessionConfig(createdSession.id, getAccessTokenForRemote, apiCreds.orgUUID, hasInitialPrompt);

        // Add remote session info as initial system message
        const remoteSessionUrl = `${getRemoteSessionUrl(createdSession.id)}?m=0`;
        const remoteInfoMessage = createSystemMessage(`/remote-control is active. Code in CLI or at ${remoteSessionUrl}`, 'info');

        // Create initial user message from the prompt if provided (CCR echoes it back but we ignore that)
        const initialUserMessage = hasInitialPrompt ? createUserMessage({
          content: remote
        }) : null;

        // Set remote session URL in app state for footer indicator
        const remoteInitialState = {
          ...initialState,
          remoteSessionUrl
        };

        // Pre-filter commands to only include remote-safe ones.
        // CCR's init response may further refine the list (via handleRemoteInit in REPL).
        const remoteCommands = filterCommandsForRemoteMode(commands);
        await launchRepl(root, {
          getFpsMetrics,
          stats,
          initialState: remoteInitialState
        }, {
          debug: debug || debugToStderr,
          commands: remoteCommands,
          initialTools: [],
          initialMessages: initialUserMessage ? [remoteInfoMessage, initialUserMessage] : [remoteInfoMessage],
          mcpClients: [],
          autoConnectIdeFlag: ide,
          mainThreadAgentDefinition,
          disableSlashCommands,
          remoteSessionConfig,
          thinkingConfig
        }, renderAndRun);
        return;
      } else if (teleport) {
        if (teleport === true || teleport === '') {
          // Interactive mode: show task selector and handle resume
          logEvent('tengu_teleport_interactive_mode', {});
          logForDebugging('selectAndResumeTeleportTask: Starting teleport flow...');
          const teleportResult = await launchTeleportResumeWrapper(root);
          if (!teleportResult) {
            // User cancelled or error occurred
            await gracefulShutdown(0);
            process.exit(0);
          }
          const {
            branchError
          } = await checkOutTeleportedSessionBranch(teleportResult.branch);
          messages = processMessagesForTeleportResume(teleportResult.log, branchError);
        } else if (typeof teleport === 'string') {
          logEvent('tengu_teleport_resume_session', {
            mode: 'direct' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          try {
            // First, fetch session and validate repository before checking git state
            const sessionData = await fetchSession(teleport);
            const repoValidation = await validateSessionRepository(sessionData);

            // Handle repo mismatch or not in repo cases
            if (repoValidation.status === 'mismatch' || repoValidation.status === 'not_in_repo') {
              const sessionRepo = repoValidation.sessionRepo;
              if (sessionRepo) {
                // Check for known paths
                const knownPaths = getKnownPathsForRepo(sessionRepo);
                const existingPaths = await filterExistingPaths(knownPaths);
                if (existingPaths.length > 0) {
                  // Show directory switch dialog
                  const selectedPath = await launchTeleportRepoMismatchDialog(root, {
                    targetRepo: sessionRepo,
                    initialPaths: existingPaths
                  });
                  if (selectedPath) {
                    // Change to the selected directory
                    process.chdir(selectedPath);
                    setCwd(selectedPath);
                    setOriginalCwd(selectedPath);
                  } else {
                    // User cancelled
                    await gracefulShutdown(0);
                  }
                } else {
                  // No known paths - show original error
                  throw new TeleportOperationError(`You must run ur --teleport ${teleport} from a checkout of ${sessionRepo}.`, chalk.red(`You must run ur --teleport ${teleport} from a checkout of ${chalk.bold(sessionRepo)}.\n`));
                }
              }
            } else if (repoValidation.status === 'error') {
              throw new TeleportOperationError(repoValidation.errorMessage || 'Failed to validate session', chalk.red(`Error: ${repoValidation.errorMessage || 'Failed to validate session'}\n`));
            }
            await validateGitState();

            // Use progress UI for teleport
            const {
              teleportWithProgress
            } = await import('./components/TeleportProgress.js');
            const result = await teleportWithProgress(root, teleport);
            // Track teleported session for reliability logging
            setTeleportedSessionInfo({
              sessionId: teleport
            });
            messages = result.messages;
          } catch (error) {
            if (error instanceof TeleportOperationError) {
              process.stderr.write(error.formattedMessage + '\n');
            } else {
              logError(error);
              process.stderr.write(chalk.red(`Error: ${errorMessage(error)}\n`));
            }
            await gracefulShutdown(1);
          }
        }
      }
      if (("external" as string) === 'ant') {
        if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
          // Check for ccshare URL (e.g. https://go/ccshare/boris-20260311-211036)
          const {
            parseCcshareId,
            loadCcshare
          } = await import('./utils/ccshareResume.js');
          const ccshareId = parseCcshareId(options.resume);
          if (ccshareId) {
            try {
              const resumeStart = performance.now();
              const logOption = await loadCcshare(ccshareId);
              const result = await loadConversationForResume(logOption, undefined);
              if (result) {
                processedResume = await processResumedConversation(result, {
                  forkSession: true,
                  transcriptPath: result.fullPath
                }, resumeContext);
                if (processedResume.restoredAgentDef) {
                  mainThreadAgentDefinition = processedResume.restoredAgentDef;
                }
                logEvent('tengu_session_resumed', {
                  entrypoint: 'ccshare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  success: true,
                  resume_duration_ms: Math.round(performance.now() - resumeStart)
                });
              } else {
                logEvent('tengu_session_resumed', {
                  entrypoint: 'ccshare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  success: false
                });
              }
            } catch (error) {
              logEvent('tengu_session_resumed', {
                entrypoint: 'ccshare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: false
              });
              logError(error);
              await exitWithError(root, `Unable to resume from ccshare: ${errorMessage(error)}`, () => gracefulShutdown(1));
            }
          } else {
            const resolvedPath = resolve(options.resume);
            try {
              const resumeStart = performance.now();
              let logOption;
              try {
                // Attempt to load as a transcript file; ENOENT falls through to session-ID handling
                logOption = await loadTranscriptFromFile(resolvedPath);
              } catch (error) {
                if (!isENOENT(error)) throw error;
                // ENOENT: not a file path — fall through to session-ID handling
              }
              if (logOption) {
                const result = await loadConversationForResume(logOption, undefined /* sourceFile */);
                if (result) {
                  processedResume = await processResumedConversation(result, {
                    forkSession: !!options.forkSession,
                    transcriptPath: result.fullPath
                  }, resumeContext);
                  if (processedResume.restoredAgentDef) {
                    mainThreadAgentDefinition = processedResume.restoredAgentDef;
                  }
                  logEvent('tengu_session_resumed', {
                    entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    success: true,
                    resume_duration_ms: Math.round(performance.now() - resumeStart)
                  });
                } else {
                  logEvent('tengu_session_resumed', {
                    entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    success: false
                  });
                }
              }
            } catch (error) {
              logEvent('tengu_session_resumed', {
                entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: false
              });
              logError(error);
              await exitWithError(root, `Unable to load transcript from file: ${options.resume}`, () => gracefulShutdown(1));
            }
          }
        }
      }

      // If not loaded as a file, try as session ID
      if (maybeSessionId) {
        // Resume specific session by ID
        const sessionId = maybeSessionId;
        try {
          const resumeStart = performance.now();
          // Use matchedLog if available (for cross-worktree resume by custom title)
          // Otherwise fall back to sessionId string (for direct UUID resume)
          const result = await loadConversationForResume(matchedLog ?? sessionId, undefined);
          if (!result) {
            logEvent('tengu_session_resumed', {
              entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              success: false
            });
            return await exitWithError(root, `No conversation found with session ID: ${sessionId}`);
          }
          const fullPath = matchedLog?.fullPath ?? result.fullPath;
          processedResume = await processResumedConversation(result, {
            forkSession: !!options.forkSession,
            sessionIdOverride: sessionId,
            transcriptPath: fullPath
          }, resumeContext);
          if (processedResume.restoredAgentDef) {
            mainThreadAgentDefinition = processedResume.restoredAgentDef;
          }
          logEvent('tengu_session_resumed', {
            entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            success: true,
            resume_duration_ms: Math.round(performance.now() - resumeStart)
          });
        } catch (error) {
          logEvent('tengu_session_resumed', {
            entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            success: false
          });
          logError(error);
          await exitWithError(root, `Failed to resume session ${sessionId}`);
        }
      }

      // Await file downloads before rendering REPL (files must be available)
      if (fileDownloadPromise) {
        try {
          const results = await fileDownloadPromise;
          const failedCount = count(results, r => !r.success);
          if (failedCount > 0) {
            process.stderr.write(chalk.yellow(`Warning: ${failedCount}/${results.length} file(s) failed to download.\n`));
          }
        } catch (error) {
          return await exitWithError(root, `Error downloading files: ${errorMessage(error)}`);
        }
      }

      // If we have a processed resume or teleport messages, render the REPL
      const resumeData = processedResume ?? (Array.isArray(messages) ? {
        messages,
        fileHistorySnapshots: undefined,
        agentName: undefined,
        agentColor: undefined as AgentColorName | undefined,
        restoredAgentDef: mainThreadAgentDefinition,
        initialState,
        contentReplacements: undefined
      } : undefined);
      if (resumeData) {
        maybeActivateProactive(options);
        maybeActivateBrief(options);
        await launchRepl(root, {
          getFpsMetrics,
          stats,
          initialState: resumeData.initialState
        }, {
          ...sessionConfig,
          mainThreadAgentDefinition: resumeData.restoredAgentDef ?? mainThreadAgentDefinition,
          initialMessages: resumeData.messages,
          initialFileHistorySnapshots: resumeData.fileHistorySnapshots,
          initialContentReplacements: resumeData.contentReplacements,
          initialAgentName: resumeData.agentName,
          initialAgentColor: resumeData.agentColor
        }, renderAndRun);
      } else {
        // Show interactive selector (includes same-repo worktrees)
        // Note: ResumeConversation loads logs internally to ensure proper GC after selection
        await launchResumeChooser(root, {
          getFpsMetrics,
          stats,
          initialState
        }, getWorktreePaths(getOriginalCwd()), {
          ...sessionConfig,
          initialSearchQuery: searchTerm,
          forkSession: options.forkSession,
          filterByPr
        });
      }
    } else {
      // Pass unresolved hooks promise to REPL so it can render immediately
      // instead of blocking ~500ms waiting for SessionStart hooks to finish.
      // REPL will inject hook messages when they resolve and await them before
      // the first API call so the model always sees hook context.
      const pendingHookMessages = hooksPromise && hookMessages.length === 0 ? hooksPromise : undefined;
      profileCheckpoint('action_after_hooks');
      maybeActivateProactive(options);
      maybeActivateBrief(options);
      // Persist the current mode for fresh sessions so future resumes know what mode was used
      if (feature('COORDINATOR_MODE')) {
        saveMode(coordinatorModeModule?.isCoordinatorMode() ? 'coordinator' : 'normal');
      }

      // If launched via a deep link, show a provenance banner so the user
      // knows the session originated externally. Linux xdg-open and
      // browsers with "always allow" set dispatch the link with no OS-level
      // confirmation, so this is the only signal the user gets that the
      // prompt — and the working directory / UR.md it implies — came
      // from an external source rather than something they typed.
      let deepLinkBanner: ReturnType<typeof createSystemMessage> | null = null;
      if (feature('LODESTONE')) {
        if (options.deepLinkOrigin) {
          logEvent('tengu_deep_link_opened', {
            has_prefill: Boolean(options.prefill),
            has_repo: Boolean(options.deepLinkRepo)
          });
          deepLinkBanner = createSystemMessage(buildDeepLinkBanner({
            cwd: getCwd(),
            prefillLength: options.prefill?.length,
            repo: options.deepLinkRepo,
            lastFetch: options.deepLinkLastFetch !== undefined ? new Date(options.deepLinkLastFetch) : undefined
          }), 'warning');
        } else if (options.prefill) {
          deepLinkBanner = createSystemMessage('Launched with a pre-filled prompt — review it before pressing Enter.', 'warning');
        }
      }
      const initialMessages = deepLinkBanner ? [deepLinkBanner, ...hookMessages] : hookMessages.length > 0 ? hookMessages : undefined;
      await launchRepl(root, {
        getFpsMetrics,
        stats,
        initialState
      }, {
        ...sessionConfig,
        initialMessages,
        pendingHookMessages
      }, renderAndRun);
    }
  }).version(`${MACRO.VERSION} (UR-Nexus)`, '-v, --version', 'Output the version number');

  // Worktree flags
  program.option('-w, --worktree [name]', 'Create a new git worktree for this session (optionally specify a name)');
  program.option('--tmux', 'Create a tmux session for the worktree (requires --worktree). Uses iTerm2 native panes when available; use --tmux=classic for traditional tmux.');
  if (canUserConfigureAdvisor()) {
    program.addOption(new Option('--advisor <model>', 'Enable the server-side advisor tool with the specified model (alias or full ID).').hideHelp());
  }
  if (("external" as string) === 'ant') {
    program.addOption(new Option('--delegate-permissions', '[ANT-ONLY] Alias for --permission-mode auto.').implies({
      permissionMode: 'auto'
    }));
    program.addOption(new Option('--dangerously-skip-permissions-with-classifiers', '[ANT-ONLY] Deprecated alias for --permission-mode auto.').hideHelp().implies({
      permissionMode: 'auto'
    }));
    program.addOption(new Option('--afk', '[ANT-ONLY] Deprecated alias for --permission-mode auto.').hideHelp().implies({
      permissionMode: 'auto'
    }));
    program.addOption(new Option('--tasks [id]', '[ANT-ONLY] Tasks mode: watch for tasks and auto-process them. Optional id is used as both the task list ID and agent ID (defaults to "tasklist").').argParser(String).hideHelp());
    program.option('--agent-teams', '[ANT-ONLY] Force UR to use multi-agent mode for solving problems', () => true);
  }
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    program.addOption(new Option('--enable-auto-mode', 'Opt in to auto mode').hideHelp());
  }
  if (feature('PROACTIVE') || feature('KAIROS')) {
    program.addOption(new Option('--proactive', 'Start in proactive autonomous mode'));
  }
  if (feature('UDS_INBOX')) {
    program.addOption(new Option('--messaging-socket-path <path>', 'Unix domain socket path for the UDS messaging server (defaults to a tmp path)'));
  }
  if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
    program.addOption(new Option('--brief', 'Enable SendUserMessage tool for agent-to-user communication'));
  }
  if (feature('KAIROS')) {
    program.addOption(new Option('--assistant', 'Force assistant mode (Agent SDK daemon use)').hideHelp());
  }
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    program.addOption(new Option('--channels <servers...>', 'MCP servers whose channel notifications (inbound push) should register this session. Space-separated server names.').hideHelp());
    program.addOption(new Option('--dangerously-load-development-channels <servers...>', 'Load channel servers not on the approved allowlist. For local channel development only. Shows a confirmation dialog at startup.').hideHelp());
  }

  // Teammate identity options (set by leader when spawning tmux teammates)
  // These replace the UR_CODE_* environment variables
  program.addOption(new Option('--agent-id <id>', 'Teammate agent ID').hideHelp());
  program.addOption(new Option('--agent-name <name>', 'Teammate display name').hideHelp());
  program.addOption(new Option('--team-name <name>', 'Team name for swarm coordination').hideHelp());
  program.addOption(new Option('--agent-color <color>', 'Teammate UI color').hideHelp());
  program.addOption(new Option('--plan-mode-required', 'Require plan mode before implementation').hideHelp());
  program.addOption(new Option('--parent-session-id <id>', 'Parent session ID for analytics correlation').hideHelp());
  program.addOption(new Option('--teammate-mode <mode>', 'How to spawn teammates: "tmux", "in-process", or "auto"').choices(['auto', 'tmux', 'in-process']).hideHelp());
  program.addOption(new Option('--agent-type <type>', 'Custom agent type for this teammate').hideHelp());

  // Enable SDK URL for all builds but hide from help
  program.addOption(new Option('--sdk-url <url>', 'Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format)').hideHelp());

  // Enable teleport/remote flags for all builds but keep them undocumented until GA
  program.addOption(new Option('--teleport [session]', 'Resume a teleport session, optionally specify session ID').hideHelp());
  program.addOption(new Option('--remote [description]', 'Create a remote session with the given description').hideHelp());
  if (feature('BRIDGE_MODE')) {
    program.addOption(new Option('--remote-control [name]', 'Start an interactive session with Remote Control enabled (optionally named)').argParser(value => value || true).hideHelp());
    program.addOption(new Option('--rc [name]', 'Alias for --remote-control').argParser(value => value || true).hideHelp());
  }
  if (feature('HARD_FAIL')) {
    program.addOption(new Option('--hard-fail', 'Crash on logError calls instead of silently logging').hideHelp());
  }
  profileCheckpoint('run_main_options_built');

  // -p/--print mode: skip subcommand registration. The 52 subcommands
  // (mcp, auth, plugin, skill, task, config, doctor, update, etc.) are
  // never dispatched in print mode — commander routes the prompt to the
  // default action. The subcommand registration path was measured at ~65ms
  // on baseline — mostly the isBridgeEnabled() call (25ms settings Zod parse
  // + 40ms sync keychain subprocess), both hidden by the try/catch that
  // always returns false before enableConfigs(). cc:// URLs are rewritten to
  // `open` at main() line ~851 BEFORE this runs, so argv check is safe here.
  const isPrintMode = process.argv.includes('-p') || process.argv.includes('--print');
  const isCcUrl = process.argv.some(a => a.startsWith('cc://') || a.startsWith('cc+unix://'));
  if (isPrintMode && !isCcUrl) {
    profileCheckpoint('run_before_parse');
    await program.parseAsync(process.argv);
    profileCheckpoint('run_after_parse');
    return program;
  }

  // ur ag-ui

  const agUi = program.command('ag-ui').description('Expose UR to user-facing applications through the AG-UI event protocol').configureHelp(createSortedHelpConfig()).enablePositionalOptions();
  agUi.command('serve').description('Start the secure AG-UI streaming HTTP adapter').option('--host <host>', 'Host interface to bind', '127.0.0.1').option('--port <port>', 'TCP port to bind', '8977').option('--allow-origin <origins...>', 'Exact browser origins allowed by CORS').addOption(new Option('--permission-mode <mode>', 'UR permission mode for adapter runs').choices(['default', 'acceptEdits', 'plan']).default('default')).action(async ({
    host,
    port,
    allowOrigin,
    permissionMode
  }: {
    host?: string;
    port?: string;
    allowOrigin?: string[];
    permissionMode?: 'default' | 'acceptEdits' | 'plan';
  }) => {
    const {
      agUiServeHandler
    } = await import('./cli/handlers/agUi.js');
    await agUiServeHandler({
      host,
      port,
      allowOrigin,
      permissionMode
    });
  });

  // ur mcp

  const mcp = program.command('mcp').description('Configure and manage MCP servers').configureHelp(createSortedHelpConfig()).enablePositionalOptions();
  mcp.command('serve').description(`Start the UR MCP server`).option('-d, --debug', 'Enable debug mode', () => true).option('--verbose', 'Override verbose mode setting from config', () => true).action(async ({
    debug,
    verbose
  }: {
    debug?: boolean;
    verbose?: boolean;
  }) => {
    const {
      mcpServeHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpServeHandler({
      debug,
      verbose
    });
  });
  mcp.command('serve-http').description('Start the opt-in stateless MCP 2026 HTTP server with Tasks and Apps').option('--host <host>', 'Host interface to bind', '127.0.0.1').option('--port <port>', 'TCP port to bind', '8976').option('--allow-origin <origins...>', 'Exact browser origins allowed by CORS').option('-d, --debug', 'Enable debug mode', () => true).option('--verbose', 'Override verbose mode setting from config', () => true).action(async ({
    host,
    port,
    allowOrigin,
    debug,
    verbose
  }: {
    host?: string;
    port?: string;
    allowOrigin?: string[];
    debug?: boolean;
    verbose?: boolean;
  }) => {
    const {
      mcpServeHttpHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpServeHttpHandler({
      host,
      port,
      allowOrigin,
      debug,
      verbose
    });
  });

  // Register the mcp add subcommand (extracted for testability)
  registerMcpAddCommand(mcp);
  if (isXaaEnabled()) {
    registerMcpXaaIdpCommand(mcp);
  }
  mcp.command('remove <name>').description('Remove an MCP server').option('-s, --scope <scope>', 'Configuration scope (local, user, or project) - if not specified, removes from whichever scope it exists in').action(async (name: string, options: {
    scope?: string;
  }) => {
    const {
      mcpRemoveHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpRemoveHandler(name, options);
  });
  mcp.command('list').description('List configured MCP servers. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.').action(async () => {
    const {
      mcpListHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpListHandler();
  });
  mcp.command('get <name>').description('Get details about an MCP server. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.').action(async (name: string) => {
    const {
      mcpGetHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpGetHandler(name);
  });
  mcp.command('add-json <name> <json>').description('Add an MCP server (stdio or SSE) with a JSON string').option('-s, --scope <scope>', 'Configuration scope (local, user, or project)', 'local').option('--client-secret', 'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)').action(async (name: string, json: string, options: {
    scope?: string;
    clientSecret?: true;
  }) => {
    const {
      mcpAddJsonHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpAddJsonHandler(name, json, options);
  });
  mcp.command('add-from-ur-desktop').description('Import MCP servers from UR Desktop (Mac and WSL only)').option('-s, --scope <scope>', 'Configuration scope (local, user, or project)', 'local').action(async (options: {
    scope?: string;
  }) => {
    const {
      mcpAddFromDesktopHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpAddFromDesktopHandler(options);
  });
  mcp.command('reset-project-choices').description('Reset all approved and rejected project-scoped (.mcp.json) servers within this project').action(async () => {
    const {
      mcpResetChoicesHandler
    } = await import('./cli/handlers/mcp.js');
    await mcpResetChoicesHandler();
  });

  // ur server
  if (feature('DIRECT_CONNECT')) {
    program.command('server').description('Start a UR session server').option('--port <number>', 'HTTP port', '0').option('--host <string>', 'Bind address', '0.0.0.0').option('--auth-token <token>', 'Bearer token for auth').option('--unix <path>', 'Listen on a unix domain socket').option('--workspace <dir>', 'Default working directory for sessions that do not specify cwd').option('--idle-timeout <ms>', 'Idle timeout for detached sessions in ms (0 = never expire)', '600000').option('--max-sessions <n>', 'Maximum concurrent sessions (0 = unlimited)', '32').action(async (opts: {
      port?: string;
      host?: string;
      authToken?: string;
      unix?: string;
      workspace?: string;
      idleTimeout?: string;
      maxSessions?: string;
    }) => {
      const {
        randomBytes
      } = await import('crypto');
      const {
        startServer
      } = await import('./server/server.js');
      const {
        SessionManager
      } = await import('./server/sessionManager.js');
      const {
        DangerousBackend
      } = await import('./server/backends/dangerousBackend.js');
      const {
        printBanner
      } = await import('./server/serverBanner.js');
      const {
        createServerLogger
      } = await import('./server/serverLog.js');
      const {
        writeServerLock,
        removeServerLock,
        probeRunningServer
      } = await import('./server/lockfile.js');
      const existing = await probeRunningServer();
      if (existing) {
        process.stderr.write(`A ur server is already running (pid ${existing.pid}) at ${existing.httpUrl}\n`);
        process.exit(1);
      }
      const authToken = opts.authToken ?? `sk-ant-cc-${randomBytes(16).toString('base64url')}`;
      const config = {
        port: parseInt(opts.port, 10),
        host: opts.host,
        authToken,
        unix: opts.unix,
        workspace: opts.workspace,
        idleTimeoutMs: parseInt(opts.idleTimeout, 10),
        maxSessions: parseInt(opts.maxSessions, 10)
      };
      const backend = new DangerousBackend();
      const sessionManager = new SessionManager(backend, {
        idleTimeoutMs: config.idleTimeoutMs,
        maxSessions: config.maxSessions
      });
      const logger = createServerLogger();
      const server = startServer(config, sessionManager, logger);
      const actualPort = server.port ?? config.port;
      printBanner(config, authToken, actualPort);
      await writeServerLock({
        pid: process.pid,
        port: actualPort,
        host: config.host,
        httpUrl: config.unix ? `unix:${config.unix}` : `http://${config.host}:${actualPort}`,
        startedAt: Date.now()
      });
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        // Stop accepting new connections before tearing down sessions.
        server.stop(true);
        await sessionManager.destroyAll();
        await removeServerLock();
        process.exit(0);
      };
      process.once('SIGINT', () => void shutdown());
      process.once('SIGTERM', () => void shutdown());
    });
  }

  // `ur ssh <host> [dir]` — registered here only so --help shows it.
  // The actual interactive flow is handled by early argv rewriting in main()
  // (parallels the DIRECT_CONNECT/cc:// pattern above). If commander reaches
  // this action it means the argv rewrite didn't fire (e.g. user ran
  // `ur ssh` with no host) — just print usage.
  if (feature('SSH_REMOTE')) {
    program.command('ssh <host> [dir]').description('Run UR on a remote host over SSH. Deploys the binary and ' + 'tunnels API auth back through your local machine — no remote setup needed.').option('--permission-mode <mode>', 'Permission mode for the remote session').option('--dangerously-skip-permissions', 'Skip all permission prompts on the remote (dangerous)').option('--local', 'e2e test mode — spawn the child CLI locally (skip ssh/deploy). ' + 'Exercises the auth proxy and unix-socket plumbing without a remote host.').action(async () => {
      // Argv rewriting in main() should have consumed `ssh <host>` before
      // commander runs. Reaching here means host was missing or the
      // rewrite predicate didn't match.
      process.stderr.write('Usage: ur ssh <user@host | ssh-config-alias> [dir]\n\n' + "Runs UR on a remote Linux host. You don't need to install\n" + 'anything on the remote or run `ur auth login` there — the binary is\n' + 'deployed over SSH and API auth tunnels back through your local machine.\n');
      process.exit(1);
    });
  }

  // ur connect — subcommand only handles -p (headless) mode.
  // Interactive mode (without -p) is handled by early argv rewriting in main()
  // which redirects to the main command with full TUI support.
  if (feature('DIRECT_CONNECT')) {
    program.command('open <cc-url>').description('Connect to a UR server (internal — use cc:// URLs)').option('-p, --print [prompt]', 'Print mode (headless)').option('--output-format <format>', 'Output format: text, json, stream-json', 'text').action(async (ccUrl: string, opts: {
      print?: string | true;
      outputFormat?: string;
    }) => {
      const {
        parseConnectUrl
      } = await import('./server/parseConnectUrl.js');
      const {
        serverUrl,
        authToken
      } = parseConnectUrl(ccUrl);
      let connectConfig;
      try {
        const session = await createDirectConnectSession({
          serverUrl,
          authToken,
          cwd: getOriginalCwd(),
          dangerouslySkipPermissions: _pendingConnect?.dangerouslySkipPermissions
        });
        if (session.workDir) {
          setOriginalCwd(session.workDir);
          setCwdState(session.workDir);
        }
        setDirectConnectServerUrl(serverUrl);
        connectConfig = session.config;
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: intentional error output
        console.error(err instanceof DirectConnectError ? err.message : String(err));
        process.exit(1);
      }
      const {
        runConnectHeadless
      } = await import('./server/connectHeadless.js');
      const prompt = typeof opts.print === 'string' ? opts.print : '';
      const interactive = opts.print === true;
      await runConnectHeadless(connectConfig, prompt, opts.outputFormat, interactive);
    });
  }

  // ur auth

  const auth = program.command('auth').description('Manage authentication').configureHelp(createSortedHelpConfig());
  // Hidden: legacy first-party account login retained for compatibility only.
  // Provider logins go through `ur auth <provider>` / `ur connect`.
  auth.command('login', {
    hidden: true
  }).description('Sign in to your URHQ account').option('--email <email>', 'Pre-populate email address on the login page').option('--sso', 'Force SSO login flow').option('--console', 'Use URHQ Console (API usage billing) instead of UR subscription').option('--urai', 'Use UR subscription (default)').action(async ({
    email,
    sso,
    console: useConsole,
    urai
  }: {
    email?: string;
    sso?: boolean;
    console?: boolean;
    urai?: boolean;
  }) => {
    const {
      authLogin
    } = await import('./cli/handlers/auth.js');
    await authLogin({
      email,
      sso,
      console: useConsole,
      urai
    });
  });
  auth.command('status').description('Show authentication status').option('--json', 'Output as JSON (default)').option('--text', 'Output as human-readable text').action(async (opts: {
    json?: boolean;
    text?: boolean;
  }) => {
    const {
      authStatus
    } = await import('./cli/handlers/auth.js');
    await authStatus(opts);
  });
  auth.command('logout', {
    hidden: true
  }).description('Log out from your URHQ account').action(async () => {
    const {
      authLogout
    } = await import('./cli/handlers/auth.js');
    await authLogout();
  });
  auth.command('chatgpt').description('Sign in through the official Codex CLI for ChatGPT subscription access').option('--device-auth', 'Use Codex CLI device authorization when supported').option('--dry-run', 'Show the official command without launching it').option('--json', 'Output as JSON').action(async (options: {
    deviceAuth?: boolean;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const {
      providerAuthHandler
    } = await import('./cli/handlers/providers.js');
    await providerAuthHandler('chatgpt', options);
  });
  auth.command('claude').description('Sign in through the official Claude Code CLI subscription login').option('--dry-run', 'Show the official command without launching it').option('--json', 'Output as JSON').action(async (options: {
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const {
      providerAuthHandler
    } = await import('./cli/handlers/providers.js');
    await providerAuthHandler('claude', options);
  });
  auth.command('gemini').description('Use the official Gemini CLI login flow where supported').option('--dry-run', 'Show the official command without launching it').option('--json', 'Output as JSON').action(async (options: {
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const {
      providerAuthHandler
    } = await import('./cli/handlers/providers.js');
    await providerAuthHandler('gemini', options);
  });
  auth.command('antigravity').description('Use the official Antigravity CLI login flow where supported').option('--dry-run', 'Show the official command without launching it').option('--json', 'Output as JSON').action(async (options: {
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const {
      providerAuthHandler
    } = await import('./cli/handlers/providers.js');
    await providerAuthHandler('antigravity', options);
  });

  // ur provider
  const provider = program.command('provider').description('Manage legal model providers').configureHelp(createSortedHelpConfig());
  provider.command('list').description('List supported provider adapters and legal access paths').option('--json', 'Output as JSON').action(async (options: {
    json?: boolean;
  }) => {
    const {
      providerListHandler
    } = await import('./cli/handlers/providers.js');
    await providerListHandler(options);
  });
  provider.command('status').description('Show selected provider readiness').option('--json', 'Output as JSON').action(async (options: {
    json?: boolean;
  }) => {
    const {
      providerStatusHandler
    } = await import('./cli/handlers/providers.js');
    await providerStatusHandler(options);
  });
  provider.command('doctor [provider]').description('Check a provider without reading hidden credential files').option('--json', 'Output as JSON').action(async (providerArg: string | undefined, options: {
    json?: boolean;
  }) => {
    const {
      providerDoctorHandler
    } = await import('./cli/handlers/providers.js');
    await providerDoctorHandler(providerArg, options);
  });
  provider.command('models [provider]').description('List models available for a provider').option('--json', 'Output as JSON').action(async (providerArg: string | undefined, options: {
    json?: boolean;
  }) => {
    const {
      providerModelsHandler
    } = await import('./cli/handlers/providers.js');
    await providerModelsHandler(providerArg, options);
  });
  provider.command('select-model <provider> <model...>').description('Select a provider-scoped model').option('--json', 'Output as JSON').action(async (providerArg: string, model: string[], options: {
    json?: boolean;
  }) => {
    const {
      providerSelectModelHandler
    } = await import('./cli/handlers/providers.js');
    await providerSelectModelHandler(providerArg, model, options);
  });

  // ur config
  const configCmd = program.command('config').description('Manage safe UR-Nexus settings').configureHelp(createSortedHelpConfig());
  configCmd.command('set <key> <value...>').description('Set a safe non-secret setting: provider, provider.fallback, provider.command_path, model, or base_url').action(async (key: string, value: string[]) => {
    const {
      configSetHandler
    } = await import('./cli/handlers/providers.js');
    await configSetHandler(key, value);
  });

  // Connect command - same implementation as the /connect slash command
  program.command('connect [action] [provider]').description('Connect a provider account: subscription login (Codex, Claude, Gemini) or store an API key').option('--key <key>', 'API key to store for an API provider').option('--json', 'Output as JSON').action(async (action: string | undefined, providerArg: string | undefined, opts: {
    key?: string;
    json?: boolean;
  }) => {
    const args = [action, providerArg, opts.key ? `--key ${quoteLocalCommandArg(opts.key)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/connect/connect.js'), args);
  });

  /**
   * Helper function to handle marketplace command errors consistently.
   * Logs the error and exits the process with status 1.
   * @param error The error that occurred
   * @param action Description of the action that failed
   */
  // Hidden flag on all plugin/marketplace subcommands to target cowork_plugins.
  const coworkOption = () => new Option('--cowork', 'Use cowork_plugins directory').hideHelp();

  // Plugin validate command
  const pluginCmd = program.command('plugin').alias('plugins').description('Manage UR plugins').configureHelp(createSortedHelpConfig());
  pluginCmd.command('validate <path>').description('Validate a plugin or marketplace manifest').addOption(coworkOption()).action(async (manifestPath: string, options: {
    cowork?: boolean;
  }) => {
    const {
      pluginValidateHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginValidateHandler(manifestPath, options);
  });

  // Plugin list command
  pluginCmd.command('list').description('List installed plugins').option('--json', 'Output as JSON').option('--available', 'Include available plugins from marketplaces (requires --json)').addOption(coworkOption()).action(async (options: {
    json?: boolean;
    available?: boolean;
    cowork?: boolean;
  }) => {
    const {
      pluginListHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginListHandler(options);
  });

  // Plugin doctor command
  pluginCmd.command('doctor').description('Validate plugin manifests and report declared components and capabilities').option('--json', 'Output as JSON').option('--path <dir>', 'Also scan a specific plugin or plugins directory').action(async (options: {
    json?: boolean;
    path?: string;
  }) => {
    const {
      pluginDoctorHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginDoctorHandler(options);
  });

  // Marketplace subcommands
  const marketplaceCmd = pluginCmd.command('marketplace').description('Manage UR marketplaces').configureHelp(createSortedHelpConfig());
  marketplaceCmd.command('add <source>').description('Add a marketplace from a URL, path, or GitHub repo').addOption(coworkOption()).option('--sparse <paths...>', 'Limit checkout to specific directories via git sparse-checkout (for monorepos). Example: --sparse .ur-plugin plugins').option('--scope <scope>', 'Where to declare the marketplace: user (default), project, or local').action(async (source: string, options: {
    cowork?: boolean;
    sparse?: string[];
    scope?: string;
  }) => {
    const {
      marketplaceAddHandler
    } = await import('./cli/handlers/plugins.js');
    await marketplaceAddHandler(source, options);
  });
  marketplaceCmd.command('list').description('List all configured marketplaces').option('--json', 'Output as JSON').addOption(coworkOption()).action(async (options: {
    json?: boolean;
    cowork?: boolean;
  }) => {
    const {
      marketplaceListHandler
    } = await import('./cli/handlers/plugins.js');
    await marketplaceListHandler(options);
  });
  marketplaceCmd.command('remove <name>').alias('rm').description('Remove a configured marketplace').addOption(coworkOption()).action(async (name: string, options: {
    cowork?: boolean;
  }) => {
    const {
      marketplaceRemoveHandler
    } = await import('./cli/handlers/plugins.js');
    await marketplaceRemoveHandler(name, options);
  });
  marketplaceCmd.command('update [name]').description('Update marketplace(s) from their source - updates all if no name specified').addOption(coworkOption()).action(async (name: string | undefined, options: {
    cowork?: boolean;
  }) => {
    const {
      marketplaceUpdateHandler
    } = await import('./cli/handlers/plugins.js');
    await marketplaceUpdateHandler(name, options);
  });

  // Plugin install command
  pluginCmd.command('install <plugin>').alias('i').description('Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)').option('-s, --scope <scope>', 'Installation scope: user, project, or local', 'user').addOption(coworkOption()).action(async (plugin: string, options: {
    scope?: string;
    cowork?: boolean;
  }) => {
    const {
      pluginInstallHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginInstallHandler(plugin, options);
  });

  // Plugin uninstall command
  pluginCmd.command('uninstall <plugin>').alias('remove').alias('rm').description('Uninstall an installed plugin').option('-s, --scope <scope>', 'Uninstall from scope: user, project, or local', 'user').option('--keep-data', "Preserve the plugin's persistent data directory (~/.ur/plugins/data/{id}/)").addOption(coworkOption()).action(async (plugin: string, options: {
    scope?: string;
    cowork?: boolean;
    keepData?: boolean;
  }) => {
    const {
      pluginUninstallHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginUninstallHandler(plugin, options);
  });

  // Plugin enable command
  pluginCmd.command('enable <plugin>').description('Enable a disabled plugin').option('-s, --scope <scope>', `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`).addOption(coworkOption()).action(async (plugin: string, options: {
    scope?: string;
    cowork?: boolean;
  }) => {
    const {
      pluginEnableHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginEnableHandler(plugin, options);
  });

  // Plugin disable command
  pluginCmd.command('disable [plugin]').description('Disable an enabled plugin').option('-a, --all', 'Disable all enabled plugins').option('-s, --scope <scope>', `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`).addOption(coworkOption()).action(async (plugin: string | undefined, options: {
    scope?: string;
    cowork?: boolean;
    all?: boolean;
  }) => {
    const {
      pluginDisableHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginDisableHandler(plugin, options);
  });

  // Plugin update command
  pluginCmd.command('update <plugin>').description('Update a plugin to the latest version (restart required to apply)').option('-s, --scope <scope>', `Installation scope: ${VALID_UPDATE_SCOPES.join(', ')} (default: user)`).addOption(coworkOption()).action(async (plugin: string, options: {
    scope?: string;
    cowork?: boolean;
  }) => {
    const {
      pluginUpdateHandler
    } = await import('./cli/handlers/plugins.js');
    await pluginUpdateHandler(plugin, options);
  });
  // END ANT-ONLY

  // Setup token command. Hidden: legacy first-party subscription token flow
  // retained for compatibility only; not part of the public provider surface.
  program.command('setup-token', {
    hidden: true
  }).description('Set up a long-lived authentication token (requires UR subscription)').action(async () => {
    const [{
      setupTokenHandler
    }, {
      createRoot
    }] = await Promise.all([import('./cli/handlers/util.js'), import('./ink.js')]);
    const root = await createRoot(getBaseRenderOptions(false));
    await setupTokenHandler(root);
  });

  // Agents command - list configured agents
  program.command('agents').description('List configured agents').option('--setting-sources <sources>', 'Comma-separated list of setting sources to load (user, project, local).').action(async () => {
    const {
      agentsHandler
    } = await import('./cli/handlers/agents.js');
    await agentsHandler();
    process.exit(0);
  });
  program.command('agent-trends').description('Show UR coverage for current agent technology trends').option('--json', 'Output as JSON').option('--a2a-base-url <url>', 'Base URL to include in the embedded A2A Agent Card').action(async (opts: {
    json?: boolean;
    a2aBaseUrl?: string;
  }) => {
    const {
      buildAgentTrendReport,
      formatAgentTrendReport
    } = await import('./services/agents/trends.js');
    const report = buildAgentTrendReport({
      baseUrl: opts.a2aBaseUrl
    });
    // biome-ignore lint/suspicious/noConsole:: CLI command output
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatAgentTrendReport(report));
    process.exit(0);
  });
  const quoteLocalCommandArg = (value: string) => JSON.stringify(value);
  const parseServerPort = (raw: string | undefined, fallback: number): number => {
    const port = Number(raw ?? fallback);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new InvalidArgumentError('Port must be an integer between 1 and 65535');
    }
    return port;
  };
  const runLocalTextCommand = async (load: () => Promise<LocalCommandModule>, args: string) => {
    const {
      call
    } = await load();
    const result = await call(args, {} as never);
    if (result.type === 'text' && typeof result.value === 'string') {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(result.value);
    } else if (result.type === 'compact' && typeof result.displayText === 'string') {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(result.displayText);
    }
    process.exit(0);
  };
  program.command('agent-features [action]').alias('agent-roadmap').description('Show or initialize UR agent feature expansion scaffolds').option('--json', 'Output as JSON').option('--force', 'Overwrite existing scaffold files').action(async (action: string | undefined, opts: {
    json?: boolean;
    force?: boolean;
  }) => {
    const args = [action, opts.json ? '--json' : undefined, opts.force ? '--force' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/agent-features/agent-features.js'), args);
  });
  program.command('agent-templates [action] [names...]').alias('agent-template').description('List or install reusable project agent templates').option('--json', 'Output as JSON').option('--force', 'Overwrite existing agent template files').action(async (action: string | undefined, names: string[] = [], opts: {
    json?: boolean;
    force?: boolean;
  }) => {
    const args = [action, ...names, opts.json ? '--json' : undefined, opts.force ? '--force' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/agent-templates/agent-templates.js'), args);
  });
  program.command('automation [action] [name]').alias('automations').description('Manage project-local UR automation specs and the resident scheduler (install/daemon)').option('--schedule <cron>', 'Cron expression for create').option('--prompt <prompt>', 'Prompt text for create').option('--now <isoDate>', 'Override current time for run-due checks').option('--platform <platform>', 'Scheduler platform for install/uninstall: launchd|systemd|cron').option('--interval <seconds>', 'Seconds between scheduler checks (install/daemon)').option('--once', 'Run a single scheduler tick then exit (daemon)').option('--disabled', 'Create automation disabled').option('--dry-run', 'Show runnable command without executing it').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, opts: {
    schedule?: string;
    prompt?: string;
    now?: string;
    platform?: string;
    interval?: string;
    once?: boolean;
    disabled?: boolean;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, opts.schedule ? `--schedule ${quoteLocalCommandArg(opts.schedule)}` : undefined, opts.prompt ? `--prompt ${quoteLocalCommandArg(opts.prompt)}` : undefined, opts.now ? `--now ${quoteLocalCommandArg(opts.now)}` : undefined, opts.platform ? `--platform ${quoteLocalCommandArg(opts.platform)}` : undefined, opts.interval ? `--interval ${opts.interval}` : undefined, opts.once ? '--once' : undefined, opts.disabled ? '--disabled' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/automation/automation.js'), args);
  });
  program.command('agent-task [action]').alias('task-pr').description('Summarize task state, git diff status, and PR handoff commands').option('--create', 'Create a GitHub PR with gh for the current branch').option('--draft', 'Create the PR as draft').option('--base <branch>', 'Base branch for PR creation').option('--title <title>', 'PR title').option('--body <body>', 'PR body').option('--dry-run', 'Print the gh command without creating a PR').option('--force', 'Override blocking self-review findings when creating a PR').option('--no-review', 'Skip the pre-PR self-review gate').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    create?: boolean;
    draft?: boolean;
    base?: string;
    title?: string;
    body?: string;
    dryRun?: boolean;
    force?: boolean;
    review?: boolean;
    json?: boolean;
  }) => {
    const args = [action, opts.create ? '--create' : undefined, opts.draft ? '--draft' : undefined, opts.base ? `--base ${quoteLocalCommandArg(opts.base)}` : undefined, opts.title ? `--title ${quoteLocalCommandArg(opts.title)}` : undefined, opts.body ? `--body ${quoteLocalCommandArg(opts.body)}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.force ? '--force' : undefined, opts.review === false ? '--no-review' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/agent-task/agent-task.js'), args);
  });
  program.command('bg [action] [task...]').alias('background-agent').description('Run and manage detached local UR background agents').option('--agents <n>', 'Number of agents for fanout').option('--worktree', 'Run in an isolated git worktree').option('--pr', 'Create a GitHub PR after completion').option('--draft', 'Create the PR as draft').option('--base <branch>', 'Base branch for PR creation').option('--title <title>', 'PR title').option('--body <body>', 'PR body').option('--no-push', 'Do not push the branch before PR creation').option('--model <model>', 'Model override for the background run').option('--route <strategy>', 'Model route strategy: auto|cheap|strong|default').option('--max-turns <n>', 'Maximum agentic turns').option('--skip-permissions', 'Pass --dangerously-skip-permissions to the background agent').option('--tail <n>', 'Number of log lines for logs/attach').option('--dry-run', 'Create the task plan without spawning the worker').option('--offline', 'Run background agent in local-first mode (cloud APIs disabled)').option('--json', 'Output as JSON').action(async (action: string | undefined, task: string[] = [], opts: {
    agents?: string;
    worktree?: boolean;
    pr?: boolean;
    draft?: boolean;
    base?: string;
    title?: string;
    body?: string;
    push?: boolean;
    model?: string;
    route?: string;
    maxTurns?: string;
    skipPermissions?: boolean;
    tail?: string;
    dryRun?: boolean;
    offline?: boolean;
    json?: boolean;
  }) => {
    const args = [action, ...task, opts.agents ? `--agents ${opts.agents}` : undefined, opts.worktree ? '--worktree' : undefined, opts.pr ? '--pr' : undefined, opts.draft ? '--draft' : undefined, opts.base ? `--base ${quoteLocalCommandArg(opts.base)}` : undefined, opts.title ? `--title ${quoteLocalCommandArg(opts.title)}` : undefined, opts.body ? `--body ${quoteLocalCommandArg(opts.body)}` : undefined, opts.push === false ? '--no-push' : undefined, opts.model ? `--model ${quoteLocalCommandArg(opts.model)}` : undefined, opts.route ? `--route ${quoteLocalCommandArg(opts.route)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.tail ? `--tail ${opts.tail}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.offline ? '--offline' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/bg/bg.js'), args);
  });
  program.command('cloud [action] [rest...]').description('Detached best-of-N tasks: run, list, show, apply').option('--attempts <n>', 'Number of racing agents').option('--model <model>', 'Model override').option('--max-turns <n>', 'Maximum agentic turns').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: { attempts?: string; model?: string; maxTurns?: string; json?: boolean }) => {
    const args = [action, ...rest.map(quoteLocalCommandArg), opts.attempts ? `--attempts ${opts.attempts}` : undefined, opts.model ? `--model ${quoteLocalCommandArg(opts.model)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/cloud/cloud.js'), args);
  });
  program.command('wiki [action]').alias('repo-wiki').description('Generate the living repo wiki and repo map').option('--quiet', 'Suppress output (hook use)').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: { quiet?: boolean; json?: boolean }) => {
    const args = [action, opts.quiet ? '--quiet' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/wiki/wiki.js'), args);
  });
  program.command('audit [action] [file]').description('Export or verify the hash-chained audit trail').option('--format <fmt>', 'jsonl or csv').option('--out <file>', 'Write to a file').action(async (action: string | undefined, file: string | undefined, opts: { format?: string; out?: string }) => {
    const args = [action, file, opts.format ? `--format ${opts.format}` : undefined, opts.out ? `--out ${quoteLocalCommandArg(opts.out)}` : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/audit/audit.js'), args);
  });
  program.command('recipe [action] [rest...]').alias('recipes').description('Structured-output playbooks: init, list, run').option('--model <model>', 'Model override').option('--max-turns <n>', 'Maximum agentic turns').option('--dry-run', 'Dry run').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: { model?: string; maxTurns?: string; dryRun?: boolean; json?: boolean }) => {
    const args = [action, ...rest.map(quoteLocalCommandArg), opts.model ? `--model ${quoteLocalCommandArg(opts.model)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/recipe/recipe.js'), args);
  });
  program.command('thread [action] [id]').alias('threads').description('Share session threads as local web pages').option('--json', 'Output as JSON').action(async (action: string | undefined, id: string | undefined, opts: { json?: boolean }) => {
    const args = [action, id, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/thread/thread.js'), args);
  });
  program.command('worktree [action] [id]').alias('worktrees').description('List, inspect, and clean up UR agent worktrees').option('--dry-run', 'Show what would be cleaned without removing anything').option('--json', 'Output as JSON').action(async (action: string | undefined, id: string | undefined, opts: {
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, id, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/worktree/worktree.js'), args);
  });
  program.command('model-doctor [model]').alias('model-capabilities').description('Inspect local Ollama models and report likely agent capabilities').option('--json', 'Output as JSON').action(async (model: string | undefined, opts: {
    json?: boolean;
  }) => {
    const args = [model, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/model-doctor/model-doctor.js'), args);
  });
  program.command('semantic-memory [action] [query...]').alias('memory-index').description('Build and search the project-local memory index').option('--json', 'Output as JSON').action(async (action: string | undefined, query: string[] = [], opts: {
    json?: boolean;
  }) => {
    const args = [action, ...query, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/semantic-memory/semantic-memory.js'), args);
  });
  const memoryCmd = program.command('memory').description('Manage UR memory').configureHelp(createSortedHelpConfig());
  memoryCmd.command('retention [action]').description('Configure and apply local memory retention policies').option('--ttl-days <n>', 'Remove memory entries older than N days').option('--max-entries <n>', 'Keep at most N entries per memory JSONL file').option('--decay-days <n>', 'Half-life style age bias when trimming to max entries').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    ttlDays?: string;
    maxEntries?: string;
    decayDays?: string;
    json?: boolean;
  }) => {
    const args = [action, opts.ttlDays ? `--ttl-days ${opts.ttlDays}` : undefined, opts.maxEntries ? `--max-entries ${opts.maxEntries}` : undefined, opts.decayDays ? `--decay-days ${opts.decayDays}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/memory-retention/memory-retention.js'), args);
  });
  program.command('claim-ledger [action]').alias('claims').description('Manage project claim-to-source provenance ledger').option('--claim <text>', 'Claim text to add').option('--source <kindRef>', 'Source as kind:ref, for example web:https://example.com').option('--confidence <level>', 'low, medium, or high').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    claim?: string;
    source?: string;
    confidence?: string;
    json?: boolean;
  }) => {
    const args = [action, opts.claim ? `--claim ${quoteLocalCommandArg(opts.claim)}` : undefined, opts.source ? `--source ${quoteLocalCommandArg(opts.source)}` : undefined, opts.confidence ? `--confidence ${quoteLocalCommandArg(opts.confidence)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/claim-ledger/claim-ledger.js'), args);
  });
  program.command('browser-qa [action] [fixture]').description('Validate and smoke-run browser QA replay fixtures').option('--dry-run', 'Show what would run without fetching the target').option('--json', 'Output as JSON').action(async (action: string | undefined, fixture: string | undefined, opts: {
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, fixture, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/browser-qa/browser-qa.js'), args);
  });
  program.command('pattern [action] [name] [task...]').alias('patterns').description('Multi-agent collaboration patterns (PEER, DOE): list, show, run, install').option('--execute', 'Execute the pattern live (auto-iterating review loop)').option('--dry-run', 'Execute offline without calling any model').option('--resume', 'Resume execution from the last checkpoint').option('--max-turns <n>', 'Max agentic turns per step when executing').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each step (sandboxes only)').option('--save', 'Save the compiled workflow when running').option('--force', 'Overwrite existing files on install').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, task: string[] = [], opts: {
    execute?: boolean;
    dryRun?: boolean;
    resume?: boolean;
    maxTurns?: string;
    skipPermissions?: boolean;
    save?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, ...task, opts.execute ? '--execute' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.resume ? '--resume' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.save ? '--save' : undefined, opts.force ? '--force' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/pattern/pattern.js'), args);
  });
  program.command('workflow [action] [name] [stepId]').alias('wf').description('Declarative agent workflows: init, list, show, validate, graph, run, plan, next, done, reset').option('--ascii', 'Render the graph as ASCII instead of Mermaid').option('--force', 'Overwrite on init').option('--dry-run', 'Preview run without calling any model').option('--resume', 'Resume run from the last checkpoint').option('--max-turns <n>', 'Max agentic turns per step when running').option('--concurrency <n>', 'Max independent steps to run in parallel (1 = sequential)').option('--live', 'Stream a live execution board while running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each step (sandboxes only)').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, stepId: string | undefined, opts: {
    ascii?: boolean;
    force?: boolean;
    dryRun?: boolean;
    resume?: boolean;
    maxTurns?: string;
    concurrency?: string;
    live?: boolean;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, stepId, opts.ascii ? '--ascii' : undefined, opts.force ? '--force' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.resume ? '--resume' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.concurrency ? `--concurrency ${opts.concurrency}` : undefined, opts.live ? '--live' : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/workflow/workflow.js'), args);
  });
  program.command('skill [action] [name] [args...]').alias('skills').description('Executable skill workflows: list, show, run, init').option('--dry-run', 'Preview run without calling any model').option('--max-turns <n>', 'Max agentic turns per step when running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each step (sandboxes only)').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, args: string[] = [], opts: {
    dryRun?: boolean;
    maxTurns?: string;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const cmdArgs = [action, name, ...args, opts.dryRun ? '--dry-run' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/skill/skill.js'), cmdArgs);
  });
  program.command('agent-inspect').alias('inspect-agents').description('Reconstruct a per-subagent timeline from a session transcript').option('--file <path>', 'Transcript JSONL or JSON file').option('--json', 'Output as JSON').action(async (opts: {
    file?: string;
    json?: boolean;
  }) => {
    const args = [opts.file ? `--file ${quoteLocalCommandArg(opts.file)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/agent-inspect/agent-inspect.js'), args);
  });
  program.command('route [task...]').alias('intent').description('Classify a task and recommend the best subagent and collaboration pattern').option('--json', 'Output as JSON').action(async (task: string[] = [], opts: {
    json?: boolean;
  }) => {
    const args = [...task, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/route/route.js'), args);
  });
  program.command('model-route [task...]').alias('model-pick').description('Recommend the best local Ollama model for a task by capability fit').option('--strategy <strategy>', 'Routing strategy: auto|cheap|strong|default').option('--offline', 'Filter cloud models and route only to local/no-cloud models').option('--json', 'Output as JSON').action(async (task: string[] = [], opts: {
    strategy?: string;
    offline?: boolean;
    json?: boolean;
  }) => {
    const args = [...task, opts.strategy ? `--strategy ${quoteLocalCommandArg(opts.strategy)}` : undefined, opts.offline ? '--offline' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/model-route/model-route.js'), args);
  });
  program.command('local-first').alias('offline-readiness').alias('local').description('Show UR readiness for no-cloud, private, lab, offline, and edge/server environments').option('--json', 'Output as JSON').action(async (opts: {
    json?: boolean;
  }) => {
    const args = [opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/local-first/local-first.js'), args);
  });
  program.command('crew [action] [name]').alias('crews').description('Headless agent crew: a lead splits a goal into a shared task board that worker subagents claim and run').option('--goal <goal>', 'Goal text for create').option('--task <task>', 'Subtask text for add').option('--lead <agent>', 'Lead/worker subagent type (default general-purpose)').option('--workers <n>', 'Number of parallel workers for run').option('--worktrees', 'Run each worker in its own git worktree').option('--dry-run', 'Run offline without calling any model').option('--resume', 'Reopen in-progress tasks and continue the board').option('--max-turns <n>', 'Max agentic turns per task when running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each worker (sandboxes only)').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, opts: {
    goal?: string;
    task?: string;
    lead?: string;
    workers?: string;
    worktrees?: boolean;
    dryRun?: boolean;
    resume?: boolean;
    maxTurns?: string;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, opts.goal ? `--goal ${quoteLocalCommandArg(opts.goal)}` : undefined, opts.task ? `--task ${quoteLocalCommandArg(opts.task)}` : undefined, opts.lead ? `--lead ${quoteLocalCommandArg(opts.lead)}` : undefined, opts.workers ? `--workers ${opts.workers}` : undefined, opts.worktrees ? '--worktrees' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.resume ? '--resume' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/crew/crew.js'), args);
  });
  program.command('goal [action] [name]').alias('goals').description('Track long-horizon objectives that persist across sessions and resume their workflow').option('--objective <text>', 'Objective text for add').option('--workflow <name>', 'Workflow that advances this goal').option('--pattern <id>', 'Collaboration pattern associated with this goal').option('--note <text>', 'Progress note text').option('--max-turns <n>', 'Max agentic turns per step when resuming').option('--dry-run', 'Resume offline without calling any model').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, opts: {
    objective?: string;
    workflow?: string;
    pattern?: string;
    note?: string;
    maxTurns?: string;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, opts.objective ? `--objective ${quoteLocalCommandArg(opts.objective)}` : undefined, opts.workflow ? `--workflow ${quoteLocalCommandArg(opts.workflow)}` : undefined, opts.pattern ? `--pattern ${quoteLocalCommandArg(opts.pattern)}` : undefined, opts.note ? `--note ${quoteLocalCommandArg(opts.note)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/goal/goal.js'), args);
  });
  program.command('spec [action] [name] [phase]').alias('specs').description('Spec-driven development: scaffold requirements/design/tasks in .ur/specs and drive execution task-by-task').option('--goal <text>', 'Goal text for init').option('--all', 'Run all open tasks, not just the next one').option('--dry-run', 'Run offline without calling any model').option('--kernel', 'Run tasks through the agent kernel loop').option('--max-turns <n>', 'Max agentic turns per task when running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each task (sandboxes only)').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, phase: string | undefined, opts: {
    goal?: string;
    all?: boolean;
    dryRun?: boolean;
    kernel?: boolean;
    maxTurns?: string;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, phase, opts.goal ? `--goal ${quoteLocalCommandArg(opts.goal)}` : undefined, opts.all ? '--all' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.kernel ? '--kernel' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/spec/spec.js'), args);
  });
  program.command('escalate [action] [task...]').description('Capability-aware local model escalation: run on a fast model and auto-escalate hard work to the oracle').option('--dry-run', 'Run offline without calling any model').option('--force-oracle', 'Start on the oracle regardless of difficulty').option('--fast <model>', 'Pin the fast-tier model (policy)').option('--oracle <model>', 'Pin the oracle-tier model (policy)').option('--auto <onoff>', 'Enable/disable auto-escalation (policy): on|off').option('--max-turns <n>', 'Max agentic turns when running').option('--skip-permissions', 'Pass --dangerously-skip-permissions (sandboxes only)').option('--json', 'Output as JSON').action(async (action: string | undefined, task: string[] = [], opts: {
    dryRun?: boolean;
    forceOracle?: boolean;
    fast?: string;
    oracle?: string;
    auto?: string;
    maxTurns?: string;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const args = [action, ...task, opts.dryRun ? '--dry-run' : undefined, opts.forceOracle ? '--force-oracle' : undefined, opts.fast ? `--fast ${quoteLocalCommandArg(opts.fast)}` : undefined, opts.oracle ? `--oracle ${quoteLocalCommandArg(opts.oracle)}` : undefined, opts.auto ? `--auto ${quoteLocalCommandArg(opts.auto)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/escalate/escalate.js'), args);
  });
  program.command('arena [task...]').alias('best-of').description('Run N agents on the same task in isolated worktrees, judge the diffs, and surface the winner').option('--agents <n>', 'Number of competing agents (default 3)').option('--models <list>', 'Comma-separated per-agent models').option('--apply', 'Apply the winning diff to the working tree').option('--keep', 'Keep the candidate worktrees after judging').option('--dry-run', 'Run offline without calling any model').option('--max-turns <n>', 'Max agentic turns per agent').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each agent (sandboxes only)').option('--json', 'Output as JSON').action(async (task: string[] = [], opts: {
    agents?: string;
    models?: string;
    apply?: boolean;
    keep?: boolean;
    dryRun?: boolean;
    maxTurns?: string;
    skipPermissions?: boolean;
    json?: boolean;
  }) => {
    const args = [...task, opts.agents ? `--agents ${opts.agents}` : undefined, opts.models ? `--models ${quoteLocalCommandArg(opts.models)}` : undefined, opts.apply ? '--apply' : undefined, opts.keep ? '--keep' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/arena/arena.js'), args);
  });
  program.command('ci-loop').alias('heal').description('CI agent: run a build/test command, fix failures, rerun until green, or prove cannot-fix with command evidence').option('--command <cmd>', 'Command to run, e.g. "bun test", "pytest", or "npm run build" (default "bun test")').option('--cwd <path>', 'Directory in which to run the CI command (default: active session directory)').option('--max-attempts <n>', 'Maximum fix attempts (default 3)').option('--from-log <path>', 'Seed the first failure from an existing log file').option('--commit', 'Commit each fix (self-review gated)').option('--push', 'Commit and push each fix').option('--dry-run', 'Show the plan without running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to the fix agent (sandboxes only)').option('--max-turns <n>', 'Max agentic turns for the fix agent').option('--allow-generated', 'Allow edits to generated/vendor files').option('--allow-delete', 'Explicitly allow file deletions by the fix agent').option('--json', 'Output as JSON').action(async (opts: {
    command?: string;
    cwd?: string;
    maxAttempts?: string;
    fromLog?: string;
    commit?: boolean;
    push?: boolean;
    dryRun?: boolean;
    skipPermissions?: boolean;
    maxTurns?: string;
    allowGenerated?: boolean;
    allowDelete?: boolean;
    json?: boolean;
  }) => {
    const args = [opts.command ? `--command ${quoteLocalCommandArg(opts.command)}` : undefined, opts.cwd ? `--cwd ${quoteLocalCommandArg(opts.cwd)}` : undefined, opts.maxAttempts ? `--max-attempts ${opts.maxAttempts}` : undefined, opts.fromLog ? `--from-log ${quoteLocalCommandArg(opts.fromLog)}` : undefined, opts.commit ? '--commit' : undefined, opts.push ? '--push' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.allowGenerated ? '--allow-generated' : undefined, opts.allowDelete ? '--allow-delete' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/ci-loop/ci-loop.js'), args);
  });
  program.command('test-first [action]').alias('quality-loop').alias('tf-loop').description('Detect project stack, run compile/test/lint loops, store failure traces, and install edit-time verify gates').option('--max-attempts <n>', 'Maximum fix attempts (default 3)').option('--install-gates', 'Write detected commands to .ur/verify.json afterEdit').option('--dry-run', 'Show detected commands without running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to the fix agent (sandboxes only)').option('--max-turns <n>', 'Max agentic turns for the fix agent').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    maxAttempts?: string;
    installGates?: boolean;
    dryRun?: boolean;
    skipPermissions?: boolean;
    maxTurns?: string;
    json?: boolean;
  }) => {
    const args = [action, opts.maxAttempts ? `--max-attempts ${opts.maxAttempts}` : undefined, opts.installGates ? '--install-gates' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/test-first/test-first.js'), args);
  });
  program.command('safety [action] [rest...]').alias('safety-policy').description('Inspect project shell safety policy, initialize .ur/safety-policy.json, and evaluate risky commands').option('--command <cmd>', 'Command to evaluate with the project safety policy').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: {
    command?: string;
    json?: boolean;
  }) => {
    const args = [action, ...rest, opts.command ? `--command ${quoteLocalCommandArg(opts.command)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/safety/safety.js'), args);
  });
  program.command('sandbox [action] [commandArg...]').alias('sandboxctl').description('Inspect and manage the real sandbox / permission architecture: status, dependency check, policy init, and command approval levels').option('--json', 'Output as JSON').action(async (action: string | undefined, commandArg: string[] = [], opts: {
    json?: boolean;
  }) => {
    const args = [action, ...commandArg, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/sandbox/sandbox.js'), args);
  });
  program.command('task [action] [name]').alias('taskctl').description('Start, run, and hand off worktree-per-task sessions. Each task can run in its own git branch/worktree for safe parallel work.').option('--worktree', 'Create a git branch and worktree for this task').option('--base <branch>', 'Base branch for the task worktree').option('--model <model>', 'Model override for the task agent').option('--max-turns <n>', 'Max agentic turns').option('--draft', 'Create PR as draft').option('--create', 'Create the PR from the task worktree').option('--title <text>', 'PR title').option('--body <text>', 'PR body').option('--dry-run', 'Preview PR without creating it').option('--offline', 'Run task in local-first mode (cloud APIs disabled)').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, opts: {
    worktree?: boolean;
    base?: string;
    model?: string;
    maxTurns?: string;
    draft?: boolean;
    create?: boolean;
    title?: string;
    body?: string;
    dryRun?: boolean;
    offline?: boolean;
    json?: boolean;
  }) => {
    const args = [
      action,
      name,
      opts.worktree ? '--worktree' : undefined,
      opts.base ? `--base ${quoteLocalCommandArg(opts.base)}` : undefined,
      opts.model ? `--model ${quoteLocalCommandArg(opts.model)}` : undefined,
      opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined,
      opts.draft ? '--draft' : undefined,
      opts.create ? '--create' : undefined,
      opts.title ? `--title ${quoteLocalCommandArg(opts.title)}` : undefined,
      opts.body ? `--body ${quoteLocalCommandArg(opts.body)}` : undefined,
      opts.dryRun ? '--dry-run' : undefined,
      opts.offline ? '--offline' : undefined,
      opts.json ? '--json' : undefined,
    ].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/task/task.js'), args);
  });
  program.command('context-pack [action] [rest...]').alias('project-manifest').alias('ctx-pack').description('Summarize repo architecture, maintain task memory, and compress project context under .ur/').option('--type <kind>', 'Memory kind: decision|constraint|command|diff|note').option('--text <text>', 'Memory text for remember').option('--decision <text>', 'Remember a decision').option('--constraint <text>', 'Remember a constraint').option('--command <cmd>', 'Remember a command').option('--diff <text>', 'Remember a diff summary').option('--note <text>', 'Remember a note').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: {
    type?: string;
    text?: string;
    decision?: string;
    constraint?: string;
    command?: string;
    diff?: string;
    note?: string;
    json?: boolean;
  }) => {
    const args = [action, ...rest, opts.type ? `--type ${quoteLocalCommandArg(opts.type)}` : undefined, opts.text ? `--text ${quoteLocalCommandArg(opts.text)}` : undefined, opts.decision ? `--decision ${quoteLocalCommandArg(opts.decision)}` : undefined, opts.constraint ? `--constraint ${quoteLocalCommandArg(opts.constraint)}` : undefined, opts.command ? `--command ${quoteLocalCommandArg(opts.command)}` : undefined, opts.diff ? `--diff ${quoteLocalCommandArg(opts.diff)}` : undefined, opts.note ? `--note ${quoteLocalCommandArg(opts.note)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/context-pack/context-pack.js'), args);
  });
  program.command('artifacts [action] [id]').alias('artifact').description('Reviewable deliverables (plans, diffs, test runs) with approve/reject/feedback under .ur/artifacts').option('--kind <kind>', 'Artifact kind: plan|diff|test-run|screenshot|browser-recording|note').option('--title <text>', 'Artifact title').option('--body <text>', 'Inline artifact body').option('--file <path>', 'Attach an existing file as the artifact body').option('--summary <text>', 'Short summary line').option('--feedback <text>', 'Feedback text for reject/feedback/comment').option('--task <id>', 'Background task id to steer when adding feedback').option('--command <cmd>', 'Command for capture-tests (default "bun test")').option('--json', 'Output as JSON').action(async (action: string | undefined, id: string | undefined, opts: {
    kind?: string;
    title?: string;
    body?: string;
    file?: string;
    summary?: string;
    feedback?: string;
    task?: string;
    command?: string;
    json?: boolean;
  }) => {
    const args = [action, id, opts.kind ? `--kind ${quoteLocalCommandArg(opts.kind)}` : undefined, opts.title ? `--title ${quoteLocalCommandArg(opts.title)}` : undefined, opts.body ? `--body ${quoteLocalCommandArg(opts.body)}` : undefined, opts.file ? `--file ${quoteLocalCommandArg(opts.file)}` : undefined, opts.summary ? `--summary ${quoteLocalCommandArg(opts.summary)}` : undefined, opts.feedback ? `--feedback ${quoteLocalCommandArg(opts.feedback)}` : undefined, opts.task ? `--task ${quoteLocalCommandArg(opts.task)}` : undefined, opts.command ? `--command ${quoteLocalCommandArg(opts.command)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/artifacts/artifacts.js'), args);
  });
  program.command('trigger [action]').alias('mention').description('Parse a GitHub/Slack webhook payload and optionally launch a headless UR run').option('--file <path>', 'Webhook payload JSON file').option('--source <source>', 'Force payload source: github|slack|generic').option('--keyword <keyword>', 'Mention/command that triggers a run (default /ur)').option('--max-turns <n>', 'Max agentic turns for the launched run').option('--dry-run', 'Show the command without executing it (run action)').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    file?: string;
    source?: string;
    keyword?: string;
    maxTurns?: string;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, opts.file ? `--file ${quoteLocalCommandArg(opts.file)}` : undefined, opts.source ? `--source ${quoteLocalCommandArg(opts.source)}` : undefined, opts.keyword ? `--keyword ${quoteLocalCommandArg(opts.keyword)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/trigger/trigger.js'), args);
  });
  program.command('sdk [action]').alias('embed').description('Show how to drive UR programmatically (headless) and scaffold TS/Python SDK examples').option('--force', 'Overwrite existing example files on init').option('--json', 'Output as JSON').action(async (action: string | undefined, opts: {
    force?: boolean;
    json?: boolean;
  }) => {
    const args = [action, opts.force ? '--force' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/sdk/sdk.js'), args);
  });
  program.command('knowledge [action] [args...]').alias('kb').description('Curated project knowledge base with provenance: add, remove, build, search, list, prune, status').option('--note', 'Treat the input as an inline note').option('--label <label>', 'Label for the source').option('--embeddings', 'Build/search with local Ollama embeddings (dense retrieval)').option('--embed-model <model>', 'Embedding model (default nomic-embed-text)').option('--older-than <days>', 'Age threshold in days for prune').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: {
    note?: boolean;
    label?: string;
    embeddings?: boolean;
    embedModel?: string;
    olderThan?: string;
    json?: boolean;
  }) => {
    const args = [action, ...rest, opts.note ? '--note' : undefined, opts.label ? `--label ${quoteLocalCommandArg(opts.label)}` : undefined, opts.embeddings ? '--embeddings' : undefined, opts.embedModel ? `--embed-model ${quoteLocalCommandArg(opts.embedModel)}` : undefined, opts.olderThan ? `--older-than ${opts.olderThan}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/knowledge/knowledge.js'), args);
  });
  program.command('eval [action] [name] [rest...]').alias('evals').description('Public agent eval harness: init, list, validate, run, report, compare, route, builtin, leaderboard, benchmark adapters').option('--file <path>', 'Local benchmark JSON/JSONL file for eval bench').option('--name <suite>', 'Suite name when importing a benchmark adapter').option('--limit <n>', 'Limit imported benchmark records').option('--dry-run', 'Run offline without calling any model').option('--metrics', 'Write per-case metrics files after running').option('--model <model>', 'Model override for eval runs').option('--strategy <auto|cheap|strong|default>', 'Model routing strategy for eval route').option('--repeat <n>', 'Repeat eval run for reliability scoring').option('--format <format>', 'Leaderboard format: html, json, or md').option('--dashboard', 'Render report as a local dashboard').option('--category <c>', 'Only run cases in this category').option('--max-turns <n>', 'Max agentic turns per case when running').option('--skip-permissions', 'Pass --dangerously-skip-permissions to each case (sandboxes only)').option('--offline', 'Run eval in local-first mode (cloud APIs disabled)').option('--force', 'Overwrite existing files on init/import').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, rest: string[] = [], opts: {
    file?: string;
    name?: string;
    limit?: string;
    dryRun?: boolean;
    metrics?: boolean;
    model?: string;
    strategy?: string;
    repeat?: string;
    format?: string;
    dashboard?: boolean;
    category?: string;
    maxTurns?: string;
    skipPermissions?: boolean;
    offline?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, ...rest, opts.file ? `--file ${quoteLocalCommandArg(opts.file)}` : undefined, opts.name ? `--name ${quoteLocalCommandArg(opts.name)}` : undefined, opts.limit ? `--limit ${opts.limit}` : undefined, opts.dryRun ? '--dry-run' : undefined, opts.metrics ? '--metrics' : undefined, opts.model ? `--model ${quoteLocalCommandArg(opts.model)}` : undefined, opts.strategy ? `--strategy ${quoteLocalCommandArg(opts.strategy)}` : undefined, opts.repeat ? `--repeat ${opts.repeat}` : undefined, opts.format ? `--format ${quoteLocalCommandArg(opts.format)}` : undefined, opts.dashboard ? '--dashboard' : undefined, opts.category ? `--category ${quoteLocalCommandArg(opts.category)}` : undefined, opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined, opts.skipPermissions ? '--skip-permissions' : undefined, opts.offline ? '--offline' : undefined, opts.force ? '--force' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/eval/eval.js'), args);
  });
  program.command('code-index [action] [query...]').alias('codeindex').description('Build and query a local semantic code index (embeddings via the local Ollama app)').option('--graph', 'Also build or watch the structural code graph').option('--repo', 'Also build or watch the semantic repo index').option('--dry-run', 'Preview watch mode without starting a watcher').option('--json', 'Output as JSON').action(async (action: string | undefined, query: string[] = [], opts: {
    graph?: boolean;
    repo?: boolean;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    const args = [action, ...query, opts.graph ? '--graph' : undefined, opts.repo ? '--repo' : undefined, opts.dryRun ? '--dry-run' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/code-index/code-index.js'), args);
  });
  program.command('repo-edit [action] [rest...]').alias('repoedit').alias('reliable-edit').description('Reliable repo editing: indexed search, AST-aware rename plans, patch previews, and rollback-safe apply').option('--to <identifier>', 'New identifier for rename operations').option('--check <cmd>', 'Validation command to run after apply; failures rollback touched files').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: {
    to?: string;
    check?: string;
    json?: boolean;
  }) => {
    const args = [action, ...rest, opts.to ? `--to ${quoteLocalCommandArg(opts.to)}` : undefined, opts.check ? `--check ${quoteLocalCommandArg(opts.check)}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/repo-edit/repo-edit.js'), args);
  });
  program.command('ide [action] [rest...]').description('Manage IDE integrations and inline diff bundles').option('--title <title>', 'Title for captured inline diff bundle').option('--base <ref>', 'Capture branch diff from this base ref').option('--staged', 'Capture staged changes instead of unstaged changes').option('--feedback <text>', 'Comment text for an IDE diff bundle').option('--file <path>', 'File path for an inline diff comment').option('--line <line>', 'Line number for an inline diff comment').option('--json', 'Output as JSON').action(async (action: string | undefined, rest: string[] = [], opts: {
    title?: string;
    base?: string;
    staged?: boolean;
    feedback?: string;
    file?: string;
    line?: string;
    json?: boolean;
  }) => {
    if (action === 'open') {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log('Use `/ide open` inside an interactive UR session, or use `ur ide diff ...` for inline diff bundles.');
      process.exit(0);
    }
    if (action === 'status' || action === 'doctor' || action === 'config') {
      const {
        runIdeInfoCommand
      } = await import('./commands/ide/ideInfoCommand.js');
      const args = [action, ...rest, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(await runIdeInfoCommand(args));
      process.exit(0);
    }
    const {
      runIdeDiffCommand
    } = await import('./commands/ide/inlineDiffCommand.js');
    const command = action === 'diff' || action === 'diffs' ? [action, ...rest] : ['diff', action ?? 'list', ...rest];
    const args = [...command, opts.title ? `--title ${quoteLocalCommandArg(opts.title)}` : undefined, opts.base ? `--base ${quoteLocalCommandArg(opts.base)}` : undefined, opts.staged ? '--staged' : undefined, opts.feedback ? `--feedback ${quoteLocalCommandArg(opts.feedback)}` : undefined, opts.file ? `--file ${quoteLocalCommandArg(opts.file)}` : undefined, opts.line ? `--line ${opts.line}` : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    // biome-ignore lint/suspicious/noConsole:: CLI command output
    console.log(await runIdeDiffCommand(args));
    process.exit(0);
  });
  program.command('role-mode [action] [name]').alias('roles').description('List, show, or install built-in role modes (Architect, Code, Debug, Ask)').option('--force', 'Overwrite existing mode agents').option('--json', 'Output as JSON').action(async (action: string | undefined, name: string | undefined, opts: {
    force?: boolean;
    json?: boolean;
  }) => {
    const args = [action, name, opts.force ? '--force' : undefined, opts.json ? '--json' : undefined].filter(Boolean).join(' ');
    await runLocalTextCommand(() => import('./commands/role-mode/role-mode.js'), args);
  });
  const a2a = program.command('a2a').description('A2A interoperability utilities (stable v0.3 binding)').configureHelp(createSortedHelpConfig());
  a2a.command('card').description('Print an A2A Agent Card preview').option('--base-url <url>', 'Base URL to use for the Agent Card endpoint').option('--compact', 'Output compact JSON').action(async (opts: {
    baseUrl?: string;
    compact?: boolean;
  }) => {
    const {
      formatA2AAgentCard
    } = await import('./services/agents/trends.js');
    // biome-ignore lint/suspicious/noConsole:: CLI command output
    console.log(formatA2AAgentCard({
      baseUrl: opts.baseUrl
    }, !opts.compact));
    process.exit(0);
  });
  a2a.command('serve').description('Start negotiated A2A v1 JSON-RPC/HTTP+JSON, stable v0.3 JSON-RPC, and UR compatibility routes').option('--host <host>', 'Host to bind', '127.0.0.1').option('--port <port>', 'Port to bind', '8765').option('--public-base-url <url>', 'External HTTP(S) base URL advertised by the Agent Card').option('--token <token>', 'Static bearer token (prefer UR_A2A_TOKEN; argv may be visible)').option('--delegation-secret <secret>', 'HMAC verification secret (prefer UR_A2A_DELEGATION_SECRET; argv may be visible)').option('--audience <id>', 'Agent id that delegation tokens must target', 'ur-nexus').option('--dry-run', 'Return spawned UR command without executing prompts').action(async (opts: {
    host?: string;
    port?: string;
    publicBaseUrl?: string;
    token?: string;
    delegationSecret?: string;
    audience?: string;
    dryRun?: boolean;
  }) => {
    const {
      serveA2A
    } = await import('./services/agents/a2aServer.js');
    await serveA2A({
      host: opts.host ?? '127.0.0.1',
      port: parseServerPort(opts.port, 8765),
      publicBaseUrl: opts.publicBaseUrl,
      token: opts.token ?? process.env.UR_A2A_TOKEN,
      delegationSecret: opts.delegationSecret ?? process.env.UR_A2A_DELEGATION_SECRET,
      audience: opts.audience ?? 'ur-nexus',
      dryRun: opts.dryRun,
      cwd: process.cwd()
    });
  });
  const a2aToken = a2a.command('token').description('Mint and verify issuer-signed A2A delegation tokens').configureHelp(createSortedHelpConfig());
  a2aToken.command('mint').description('Mint an expiring, audience-bound, scoped delegation token').option('--secret <secret>', 'HMAC signing secret (prefer UR_A2A_DELEGATION_SECRET; argv may be visible)').option('--sub <subject>', 'Delegator identity', 'ur-cli').option('--aud <audience>', 'Target agent id', 'ur-nexus').option('--scope <csv>', 'Comma-separated skill ids, or * for all', '*').option('--ttl <seconds>', 'Lifetime in seconds', '3600').option('--json', 'Output as JSON').action(async (opts: {
    secret?: string;
    sub?: string;
    aud?: string;
    scope?: string;
    ttl?: string;
    json?: boolean;
  }) => {
    const {
      mintDelegationToken
    } = await import('./services/agents/delegation.js');
    const secret = opts.secret ?? process.env.UR_A2A_DELEGATION_SECRET;
    if (!secret) {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.error('A signing secret is required: pass --secret or set UR_A2A_DELEGATION_SECRET');
      process.exit(1);
    }
    const scope = (opts.scope ?? '*').split(',').map(part => part.trim()).filter(Boolean);
    const ttlSeconds = Number(opts.ttl ?? '3600');
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 2592000) {
      throw new InvalidArgumentError('TTL must be an integer between 1 and 2592000 seconds');
    }
    const token = mintDelegationToken(secret, {
      subject: opts.sub ?? 'ur-cli',
      audience: opts.aud ?? 'ur-nexus',
      scope,
      ttlSeconds
    });
    // biome-ignore lint/suspicious/noConsole:: CLI command output
    console.log(opts.json ? JSON.stringify({ token }, null, 2) : token);
    process.exit(0);
  });
  a2aToken.command('verify [token]').description('Verify a delegation token and print its claims').option('--token-stdin', 'Read the token from stdin (or set UR_A2A_DELEGATION_TOKEN)').option('--secret <secret>', 'HMAC signing secret (prefer UR_A2A_DELEGATION_SECRET; argv may be visible)').option('--aud <audience>', 'Required audience').option('--scope <skill>', 'Required skill scope').option('--json', 'Output as JSON').action(async (token: string | undefined, opts: {
    tokenStdin?: boolean;
    secret?: string;
    aud?: string;
    scope?: string;
    json?: boolean;
  }) => {
    const {
      verifyDelegationToken,
      describeClaims
    } = await import('./services/agents/delegation.js');
    if (token && opts.tokenStdin) {
      throw new InvalidArgumentError('Pass the token either as an argument or with --token-stdin, not both');
    }
    let verificationToken = token ?? process.env.UR_A2A_DELEGATION_TOKEN;
    if (opts.tokenStdin) {
      const { readSecretFromStdin } = await import('./utils/readSecretFromStdin.js');
      verificationToken = await readSecretFromStdin({ label: 'delegation token', maxBytes: 16 * 1024 });
    }
    if (!verificationToken) {
      throw new InvalidArgumentError('A token is required: pass it, use --token-stdin, or set UR_A2A_DELEGATION_TOKEN');
    }
    const secret = opts.secret ?? process.env.UR_A2A_DELEGATION_SECRET;
    if (!secret) {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.error('A signing secret is required: pass --secret or set UR_A2A_DELEGATION_SECRET');
      process.exit(1);
    }
    const result = verifyDelegationToken(secret, verificationToken, {
      audience: opts.aud,
      requiredScope: opts.scope
    });
    if (opts.json) {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(JSON.stringify(result, null, 2));
    } else if (result.valid && result.claims) {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(`valid\n${describeClaims(result.claims)}`);
    } else {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(`invalid: ${result.reason}`);
    }
    process.exit(result.valid ? 0 : 1);
  });
  const acp = program.command('acp').description('Agent Client Protocol and HTTP compatibility utilities').configureHelp(createSortedHelpConfig());
  acp.command('serve').description('Start the opt-in HTTP JSON-RPC compatibility server').option('--host <host>', 'Host to bind', '127.0.0.1').option('--port <port>', 'Port to bind', '8123').option('--token <token>', 'Static bearer token (prefer UR_ACP_TOKEN; argv may be visible)').option('--debug', 'Log JSON-RPC method names and outcomes to stderr').option('--dry-run', 'Return server options without starting').action(async (opts: {
    host?: string;
    port?: string;
    token?: string;
    debug?: boolean;
    dryRun?: boolean;
  }) => {
    const { serveAcp } = await import('./services/agents/acpServer.js');
    await serveAcp({
      host: opts.host ?? '127.0.0.1',
      port: parseServerPort(opts.port, 8123),
      token: opts.token ?? process.env.UR_ACP_TOKEN,
      debug: opts.debug,
      dryRun: opts.dryRun,
      cwd: process.cwd()
    });
  });
  acp.command('stdio').description('Run the official-SDK-backed ACP v1 stdio agent for editors').action(async () => {
    const { startAcpStdioAgent } = await import('./services/agents/acpStdio.js');
    await startAcpStdioAgent({ cwd: process.cwd() });
  });
  acp.command('stop').description('Stop the running UR HTTP agent server').action(async () => {
    const { stopAcpServer } = await import('./services/agents/acpServer.js');
    await stopAcpServer();
    // biome-ignore lint/suspicious/noConsole:: CLI command output
    console.log('UR HTTP agent server stopped');
    process.exit(0);
  });
  acp.command('status').description('Show UR HTTP agent server status').option('--json', 'Output as JSON').action(async (opts: {
    json?: boolean;
  }) => {
    const { getAcpServerPort } = await import('./services/agents/acpServer.js');
    const port = getAcpServerPort();
    const result = { running: port !== null, port };
    if (opts.json) {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(JSON.stringify(result, null, 2));
    } else {
      // biome-ignore lint/suspicious/noConsole:: CLI command output
      console.log(`UR HTTP agent server: ${result.running ? `running on port ${result.port}` : 'not running'}`);
    }
    process.exit(0);
  });
  program.command('exec [prompts...]')
    .description('Run one or more prompts in non-interactive mode with optional concurrency')
    .option('--file <jsonl>', 'Read prompts from a JSONL file')
    .option('--concurrency <n>', 'Number of parallel agents', '1')
    .option('--max-turns <n>', 'Maximum turns per prompt')
    .option('--model <model>', 'Ollama model to use')
    .option('--output-dir <dir>', 'Directory to write per-prompt outputs')
    .option('--worktree', 'Run each prompt in its own worktree')
    .option('--dry-run', 'Print commands without running')
    .option('--json', 'Output as JSON')
    .action(async (prompts: string[], opts: {
      file?: string;
      concurrency?: string;
      maxTurns?: string;
      model?: string;
      outputDir?: string;
      worktree?: boolean;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const args = [
        ...prompts.map(quoteLocalCommandArg),
        opts.file ? `--file ${opts.file}` : undefined,
        opts.concurrency ? `--concurrency ${opts.concurrency}` : undefined,
        opts.maxTurns ? `--max-turns ${opts.maxTurns}` : undefined,
        opts.model ? `--model ${opts.model}` : undefined,
        opts.outputDir ? `--output-dir ${opts.outputDir}` : undefined,
        opts.worktree ? '--worktree' : undefined,
        opts.dryRun ? '--dry-run' : undefined,
        opts.json ? '--json' : undefined,
      ].filter(Boolean).join(' ');
      await runLocalTextCommand(() => import('./commands/exec/exec.js'), args);
    });
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    // Skip when tengu_auto_mode_config.enabled === 'disabled' (circuit breaker).
    // Reads from disk cache — GrowthBook isn't initialized at registration time.
    if (getAutoModeEnabledStateIfCached() !== 'disabled') {
      const autoModeCmd = program.command('auto-mode').description('Inspect auto mode classifier configuration');
      autoModeCmd.command('defaults').description('Print the default auto mode environment, allow, and deny rules as JSON').action(async () => {
        const {
          autoModeDefaultsHandler
        } = await import('./cli/handlers/autoMode.js');
        autoModeDefaultsHandler();
        process.exit(0);
      });
      autoModeCmd.command('config').description('Print the effective auto mode config as JSON: your settings where set, defaults otherwise').action(async () => {
        const {
          autoModeConfigHandler
        } = await import('./cli/handlers/autoMode.js');
        autoModeConfigHandler();
        process.exit(0);
      });
      autoModeCmd.command('critique').description('Get AI feedback on your custom auto mode rules').option('--model <model>', 'Override which model is used').action(async options => {
        const {
          autoModeCritiqueHandler
        } = await import('./cli/handlers/autoMode.js');
        await autoModeCritiqueHandler(options);
        process.exit();
      });
    }
  }

  // Remote Control command — connect local environment to ur.ai/code.
  // The actual command is intercepted by the fast-path in cli.tsx before
  // Commander.js runs, so this registration exists only for help output.
  // Always hidden: isBridgeEnabled() at this point (before enableConfigs)
  // would throw inside isURAISubscriber → getGlobalConfig and return
  // false via the try/catch — but not before paying ~65ms of side effects
  // (25ms settings Zod parse + 40ms sync `security` keychain subprocess).
  // The dynamic visibility never worked; the command was always hidden.
  if (feature('BRIDGE_MODE')) {
    program.command('remote-control', {
      hidden: true
    }).alias('rc').description('Connect your local environment for remote-control sessions via ur.ai/code').action(async () => {
      // Unreachable — cli.tsx fast-path handles this command before main.tsx loads.
      // If somehow reached, delegate to bridgeMain.
      const {
        bridgeMain
      } = await import('./bridge/bridgeMain.js');
      await bridgeMain(process.argv.slice(3));
    });
  }
  if (feature('KAIROS')) {
    program.command('assistant [sessionId]').description('Attach the REPL as a client to a running bridge session. Discovers sessions via API if no sessionId given.').action(() => {
      // Argv rewriting above should have consumed `assistant [id]`
      // before commander runs. Reaching here means a root flag came first
      // (e.g. `--debug assistant`) and the position-0 predicate
      // didn't match. Print usage like the ssh stub does.
      process.stderr.write('Usage: ur assistant [sessionId]\n\n' + 'Attach the REPL as a viewer client to a running bridge session.\n' + 'Omit sessionId to discover and pick from available sessions.\n');
      process.exit(1);
    });
  }

  // Doctor command - check installation health
  program.command('doctor').description('Check the health of your UR auto-updater. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.').action(async () => {
    const [{
      doctorHandler
    }, {
      createRoot
    }] = await Promise.all([import('./cli/handlers/util.js'), import('./ink.js')]);
    const root = await createRoot(getBaseRenderOptions(false));
    await doctorHandler(root);
  });

  // ur update
  //
  // For SemVer-compliant versioning with build metadata (X.X.X+SHA):
  // - We perform exact string comparison (including SHA) to detect any change
  // - This ensures users always get the latest build, even when only the SHA changes
  // - UI shows both versions including build metadata for clarity
  program.command('update').alias('upgrade').description('Check npm for UR-Nexus updates').action(async () => {
    const {
      update
    } = await import('src/cli/update.js');
    await update();
  });

  // ur up — run the project's UR.md "# ur up" setup instructions.
  if (("external" as string) === 'ant') {
    program.command('up').description('[ANT-ONLY] Initialize or upgrade the local dev environment using the "# ur up" section of the nearest UR.md').action(async () => {
      const {
        up
      } = await import('src/cli/up.js');
      await up();
    });
  }

  // ur rollback (ant-only)
  // Rolls back to previous releases
  if (("external" as string) === 'ant') {
    program.command('rollback [target]').description('[ANT-ONLY] Roll back to a previous release\n\nExamples:\n  ur rollback                                    Go 1 version back from current\n  ur rollback 3                                  Go 3 versions back from current\n  ur rollback 2.0.73-dev.20251217.t190658        Roll back to a specific version').option('-l, --list', 'List recent published versions with ages').option('--dry-run', 'Show what would be installed without installing').option('--safe', 'Roll back to the server-pinned safe version (set by oncall during incidents)').action(async (target?: string, options?: {
      list?: boolean;
      dryRun?: boolean;
      safe?: boolean;
    }) => {
      const {
        rollback
      } = await import('src/cli/rollback.js');
      await rollback(target, options);
    });
  }

  // ur install
  // Hidden: the native-build installer has no published native package
  // (MACRO.NATIVE_PACKAGE_URL is undefined in all builds). Use `ur update`.
  program.command('install [target]', {
    hidden: true
  }).description('Install UR native build. Use [target] to specify version (stable, latest, or specific version)').option('--force', 'Force installation even if already installed').action(async (target: string | undefined, options: {
    force?: boolean;
  }) => {
    const {
      installHandler
    } = await import('./cli/handlers/util.js');
    await installHandler(target, options);
  });

  // ant-only commands
  if (("external" as string) === 'ant') {
    const validateLogId = (value: string) => {
      const maybeSessionId = validateUuid(value);
      if (maybeSessionId) return maybeSessionId;
      return Number(value);
    };
    // ur log
    program.command('log').description('[ANT-ONLY] Manage conversation logs.').argument('[number|sessionId]', 'A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log', validateLogId).action(async (logId: string | number | undefined) => {
      const {
        logHandler
      } = await import('./cli/handlers/ant.js');
      await logHandler(logId);
    });

    // ur error
    program.command('error').description('[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.').argument('[number]', 'A number (0, 1, 2, etc.) to display a specific log', parseInt).action(async (number: number | undefined) => {
      const {
        errorHandler
      } = await import('./cli/handlers/ant.js');
      await errorHandler(number);
    });

    // ur export
    program.command('export').description('[ANT-ONLY] Export a conversation to a text file.').usage('<source> <outputFile>').argument('<source>', 'Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file').argument('<outputFile>', 'Output file path for the exported text').addHelpText('after', `
Examples:
  $ ur export 0 conversation.txt                Export conversation at log index 0
  $ ur export <uuid> conversation.txt           Export conversation by session ID
  $ ur export input.json output.txt             Render JSON log file to text
  $ ur export <uuid>.jsonl output.txt           Render JSONL session file to text`).action(async (source: string, outputFile: string) => {
      const {
        exportHandler
      } = await import('./cli/handlers/ant.js');
      await exportHandler(source, outputFile);
    });
    if (("external" as string) === 'ant') {
      const taskCmd = program.command('task').description('[ANT-ONLY] Manage task list tasks');
      taskCmd.command('create <subject>').description('Create a new task').option('-d, --description <text>', 'Task description').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (subject: string, opts: {
        description?: string;
        list?: string;
      }) => {
        const {
          taskCreateHandler
        } = await import('./cli/handlers/ant.js');
        await taskCreateHandler(subject, opts);
      });
      taskCmd.command('list').description('List all tasks').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').option('--pending', 'Show only pending tasks').option('--json', 'Output as JSON').action(async (opts: {
        list?: string;
        pending?: boolean;
        json?: boolean;
      }) => {
        const {
          taskListHandler
        } = await import('./cli/handlers/ant.js');
        await taskListHandler(opts);
      });
      taskCmd.command('get <id>').description('Get details of a task').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (id: string, opts: {
        list?: string;
      }) => {
        const {
          taskGetHandler
        } = await import('./cli/handlers/ant.js');
        await taskGetHandler(id, opts);
      });
      taskCmd.command('update <id>').description('Update a task').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').option('-s, --status <status>', `Set status (${TASK_STATUSES.join(', ')})`).option('--subject <text>', 'Update subject').option('-d, --description <text>', 'Update description').option('--owner <agentId>', 'Set owner').option('--clear-owner', 'Clear owner').action(async (id: string, opts: {
        list?: string;
        status?: string;
        subject?: string;
        description?: string;
        owner?: string;
        clearOwner?: boolean;
      }) => {
        const {
          taskUpdateHandler
        } = await import('./cli/handlers/ant.js');
        await taskUpdateHandler(id, opts);
      });
      taskCmd.command('dir').description('Show the tasks directory path').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (opts: {
        list?: string;
      }) => {
        const {
          taskDirHandler
        } = await import('./cli/handlers/ant.js');
        await taskDirHandler(opts);
      });
    }

    // ur completion <shell>
    program.command('completion <shell>', {
      hidden: true
    }).description('Generate shell completion script (bash, zsh, or fish)').option('--output <file>', 'Write completion script directly to a file instead of stdout').action(async (shell: string, opts: {
      output?: string;
    }) => {
      const {
        completionHandler
      } = await import('./cli/handlers/ant.js');
      await completionHandler(shell, opts, program);
    });
  }
  profileCheckpoint('run_before_parse');
  await program.parseAsync(process.argv);
  profileCheckpoint('run_after_parse');

  // Record final checkpoint for total_time calculation
  profileCheckpoint('main_after_run');

  // Log startup perf to Statsig (sampled) and output detailed report if enabled
  profileReport();
  return program;
}
async function logTenguInit({
  hasInitialPrompt,
  hasStdin,
  verbose,
  debug,
  debugToStderr,
  print,
  outputFormat,
  inputFormat,
  numAllowedTools,
  numDisallowedTools,
  mcpClientCount,
  worktreeEnabled,
  skipWebFetchPreflight,
  githubActionInputs,
  dangerouslySkipPermissionsPassed,
  permissionMode,
  modeIsBypass,
  allowDangerouslySkipPermissionsPassed,
  systemPromptFlag,
  appendSystemPromptFlag,
  thinkingConfig,
  assistantActivationPath
}: {
  hasInitialPrompt: boolean;
  hasStdin: boolean;
  verbose: boolean;
  debug: boolean;
  debugToStderr: boolean;
  print: boolean;
  outputFormat: string;
  inputFormat: string;
  numAllowedTools: number;
  numDisallowedTools: number;
  mcpClientCount: number;
  worktreeEnabled: boolean;
  skipWebFetchPreflight: boolean | undefined;
  githubActionInputs: string | undefined;
  dangerouslySkipPermissionsPassed: boolean;
  permissionMode: string;
  modeIsBypass: boolean;
  allowDangerouslySkipPermissionsPassed: boolean;
  systemPromptFlag: 'file' | 'flag' | undefined;
  appendSystemPromptFlag: 'file' | 'flag' | undefined;
  thinkingConfig: ThinkingConfig;
  assistantActivationPath: string | undefined;
}): Promise<void> {
  try {
    logEvent('tengu_init', {
      entrypoint: 'ur' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasInitialPrompt,
      hasStdin,
      verbose,
      debug,
      debugToStderr,
      print,
      outputFormat: outputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      inputFormat: inputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numAllowedTools,
      numDisallowedTools,
      mcpClientCount,
      worktree: worktreeEnabled,
      skipWebFetchPreflight,
      ...(githubActionInputs && {
        githubActionInputs: githubActionInputs as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      dangerouslySkipPermissionsPassed,
      permissionMode: permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      modeIsBypass,
      inProtectedNamespace: isInProtectedNamespace(),
      allowDangerouslySkipPermissionsPassed,
      thinkingType: thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(systemPromptFlag && {
        systemPromptFlag: systemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      ...(appendSystemPromptFlag && {
        appendSystemPromptFlag: appendSystemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      is_simple: isBareMode() || undefined,
      is_coordinator: feature('COORDINATOR_MODE') && coordinatorModeModule?.isCoordinatorMode() ? true : undefined,
      ...(assistantActivationPath && {
        assistantActivationPath: assistantActivationPath as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      autoUpdatesChannel: (getInitialSettings().autoUpdatesChannel ?? 'latest') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(("external" as string) === 'ant' ? (() => {
        const cwd = getCwd();
        const gitRoot = findGitRoot(cwd);
        const rp = gitRoot ? relative(gitRoot, cwd) || '.' : undefined;
        return rp ? {
          relativeProjectPath: rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        } : {};
      })() : {})
    });
  } catch (error) {
    logError(error);
  }
}
function maybeActivateProactive(options: unknown): void {
  if ((feature('PROACTIVE') || feature('KAIROS')) && ((options as {
    proactive?: boolean;
  }).proactive || isEnvTruthy(process.env.UR_CODE_PROACTIVE))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const proactiveModule = require('./proactive/index.js');
    if (!proactiveModule.isProactiveActive()) {
      proactiveModule.activateProactive('command');
    }
  }
}
function maybeActivateBrief(options: unknown): void {
  if (!(feature('KAIROS') || feature('KAIROS_BRIEF'))) return;
  const briefFlag = (options as {
    brief?: boolean;
  }).brief;
  const briefEnv = isEnvTruthy(process.env.UR_CODE_BRIEF);
  if (!briefFlag && !briefEnv) return;
  // --brief / UR_CODE_BRIEF are explicit opt-ins: check entitlement,
  // then set userMsgOptIn to activate the tool + prompt section. The env
  // var also grants entitlement (isBriefEntitled() reads it), so setting
  // UR_CODE_BRIEF=1 alone force-enables for dev/testing — no GB gate
  // needed. initialIsBriefOnly reads getUserMsgOptIn() directly.
  // Conditional require: static import would leak the tool name string
  // into external builds via BriefTool.ts → prompt.ts.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const {
    isBriefEntitled
  } = require('./tools/BriefTool/BriefTool.js') as typeof import('./tools/BriefTool/BriefTool.js');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const entitled = isBriefEntitled();
  if (entitled) {
    setUserMsgOptIn(true);
  }
  // Fire unconditionally once intent is seen: enabled=false captures the
  // "user tried but was gated" failure mode in Datadog.
  logEvent('tengu_brief_mode_enabled', {
    enabled: entitled,
    gated: !entitled,
    source: (briefEnv ? 'env' : 'flag') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
}
function resetCursor() {
  const terminal = process.stderr.isTTY ? process.stderr : process.stdout.isTTY ? process.stdout : undefined;
  terminal?.write(SHOW_CURSOR);
}
type TeammateOptions = {
  agentId?: string;
  agentName?: string;
  teamName?: string;
  agentColor?: string;
  planModeRequired?: boolean;
  parentSessionId?: string;
  teammateMode?: 'auto' | 'tmux' | 'in-process';
  agentType?: string;
};
function extractTeammateOptions(options: unknown): TeammateOptions {
  if (typeof options !== 'object' || options === null) {
    return {};
  }
  const opts = options as Record<string, unknown>;
  const teammateMode = opts.teammateMode;
  return {
    agentId: typeof opts.agentId === 'string' ? opts.agentId : undefined,
    agentName: typeof opts.agentName === 'string' ? opts.agentName : undefined,
    teamName: typeof opts.teamName === 'string' ? opts.teamName : undefined,
    agentColor: typeof opts.agentColor === 'string' ? opts.agentColor : undefined,
    planModeRequired: typeof opts.planModeRequired === 'boolean' ? opts.planModeRequired : undefined,
    parentSessionId: typeof opts.parentSessionId === 'string' ? opts.parentSessionId : undefined,
    teammateMode: teammateMode === 'auto' || teammateMode === 'tmux' || teammateMode === 'in-process' ? teammateMode : undefined,
    agentType: typeof opts.agentType === 'string' ? opts.agentType : undefined
  };
}
