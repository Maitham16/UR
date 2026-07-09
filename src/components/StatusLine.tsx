// @ts-nocheck
import { feature } from 'bun:bundle';
import * as React from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { getProviderRuntimeInfo, type ProviderSettings } from 'src/services/providers/providerRegistry.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js';
import { getIsRemoteMode, getKairosActive, getMainThreadAgentType, getOriginalCwd, getSdkBetas, getSessionId } from '../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js';
import { useNotifications } from '../context/notifications.js';
import { getTotalAPIDuration, getTotalCost, getTotalDuration, getTotalInputTokens, getTotalLinesAdded, getTotalLinesRemoved, getTotalOutputTokens } from '../cost-tracker.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { type ReadonlySettings, useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, Text } from '../ink.js';
import { getRawUtilization } from '../services/urAiLimits.js';
import type { Message } from '../types/message.js';
import type { StatusLineCommandInput } from '../types/statusLine.js';
import type { VimMode } from '../types/textInputTypes.js';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { checkHasTrustDialogAccepted } from '../utils/config.js';
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { getCachedBranch } from '../utils/git/gitFilesystem.js';
import { createBaseHookInput, executeStatusLineCommand } from '../utils/hooks.js';
import { getLastAssistantMessage } from '../utils/messages.js';
import { getRuntimeMainLoopModel, type ModelName, renderModelName } from '../utils/model/model.js';
import { getCurrentSessionTitle } from '../utils/sessionStorage.js';
import { buildDefaultStatusBar, statusBarShouldDisplay } from '../utils/statusBar.js';
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../utils/tokens.js';
import { getCurrentWorktreeSession } from '../utils/worktree.js';
import { isVimModeEnabled } from './PromptInput/utils.js';
export function getEffectiveStatusLineSettings(settings: ReadonlySettings, providerSelection?: ProviderSettings | null): ReadonlySettings {
  if (!providerSelection) {
    return settings;
  }
  return {
    ...settings,
    provider: {
      ...providerSelection
    }
  };
}
export function statusLineShouldDisplay(settings: ReadonlySettings): boolean {
  let isKairosActive = false;
  if (feature('KAIROS')) {
    isKairosActive = getKairosActive();
  }
  return statusBarShouldDisplay({
    settingsStatusLineConfigured: settings?.statusLine !== undefined,
    isKairosActive,
    isTTY: process.stdout.isTTY,
    isCI: process.env.CI === 'true' || process.env.CI === '1',
    term: process.env.TERM,
    disabled: process.env.UR_STATUS_BAR === '0' || process.env.UR_STATUS_BAR === 'false'
  });
}
function buildStatusLineCommandInput(permissionMode: PermissionMode, exceeds200kTokens: boolean, settings: ReadonlySettings, messages: Message[], addedDirs: string[], mainLoopModel: ModelName, vimMode?: VimMode): StatusLineCommandInput {
  const agentType = getMainThreadAgentType();
  const worktreeSession = getCurrentWorktreeSession();
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens
  });
  const providerRuntime = getProviderRuntimeInfo(settings);
  const outputStyleName = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  const currentUsage = getCurrentUsage(messages);
  const contextWindowSize = getContextWindowForModel(
    runtimeModel,
    getSdkBetas(),
    providerRuntime.provider === 'ollama' ? 'ollama' : 'foundry',
  );
  const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize);
  const sessionId = getSessionId();
  const sessionName = getCurrentSessionTitle(sessionId);
  const rawUtil = getRawUtilization();
  const rateLimits: StatusLineCommandInput['rate_limits'] = {
    ...(rawUtil.five_hour && {
      five_hour: {
        used_percentage: rawUtil.five_hour.utilization * 100,
        resets_at: rawUtil.five_hour.resets_at
      }
    }),
    ...(rawUtil.seven_day && {
      seven_day: {
        used_percentage: rawUtil.seven_day.utilization * 100,
        resets_at: rawUtil.seven_day.resets_at
      }
    })
  };
  return {
    ...createBaseHookInput(),
    ...(sessionName && {
      session_name: sessionName
    }),
    model: {
      id: runtimeModel,
      display_name: renderModelName(runtimeModel)
    },
    provider: {
      id: providerRuntime.provider,
      display_name: providerRuntime.providerLabel,
      auth_mode: providerRuntime.authLabel,
      model: providerRuntime.model,
      base_url: providerRuntime.baseUrl,
      fallback: providerRuntime.fallback
    },
    workspace: {
      current_dir: getCwd(),
      project_dir: getOriginalCwd(),
      added_dirs: addedDirs
    },
    version: MACRO.VERSION,
    output_style: {
      name: outputStyleName
    },
    cost: {
      total_cost_usd: getTotalCost(),
      total_duration_ms: getTotalDuration(),
      total_api_duration_ms: getTotalAPIDuration(),
      total_lines_added: getTotalLinesAdded(),
      total_lines_removed: getTotalLinesRemoved()
    },
    context_window: {
      total_input_tokens: getTotalInputTokens(),
      total_output_tokens: getTotalOutputTokens(),
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
      used_percentage: contextPercentages.used,
      remaining_percentage: contextPercentages.remaining
    },
    exceeds_200k_tokens: exceeds200kTokens,
    ...((rateLimits.five_hour || rateLimits.seven_day) && {
      rate_limits: rateLimits
    }),
    ...(isVimModeEnabled() && {
      vim: {
        mode: vimMode ?? 'INSERT'
      }
    }),
    ...(agentType && {
      agent: {
        name: agentType
      }
    }),
    ...(getIsRemoteMode() && {
      remote: {
        session_id: getSessionId()
      }
    }),
    ...(worktreeSession && {
      worktree: {
        name: worktreeSession.worktreeName,
        path: worktreeSession.worktreePath,
        branch: worktreeSession.worktreeBranch,
        original_cwd: worktreeSession.originalCwd,
        original_branch: worktreeSession.originalBranch
      }
    })
  };
}
type Props = {
  // messages stays behind a ref (read only in the debounced callback);
  // lastAssistantMessageId is the actual re-render trigger.
  messagesRef: React.RefObject<Message[]>;
  lastAssistantMessageId: string | null;
  vimMode?: VimMode;
  autoUpdaterResult?: AutoUpdaterResult | null;
  isAutoUpdating?: boolean;
};
export function getLastAssistantMessageId(messages: Message[]): string | null {
  return getLastAssistantMessage(messages)?.uuid ?? null;
}
function StatusLineInner({
  messagesRef,
  lastAssistantMessageId,
  vimMode,
  autoUpdaterResult,
  isAutoUpdating
}: Props): React.ReactNode {
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const additionalWorkingDirectories = useAppState(s => s.toolPermissionContext.additionalWorkingDirectories);
  const statusLineText = useAppState(s => s.statusLineText);
  const tasks = useAppState(s => s.tasks);
  const setAppState = useSetAppState();
  const settings = useSettings();
  const providerSelection = useAppState(s => s.provider);
  const [branch, setBranch] = useState<string | null>(null);
  const {
    addNotification
  } = useNotifications();
  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's statusline (urhqs/ur#37596).
  const mainLoopModel = useMainLoopModel();
  const effectiveSettings = getEffectiveStatusLineSettings(settings, providerSelection);
  const providerRuntime = getProviderRuntimeInfo(effectiveSettings);
  const providerRuntimeKey = [
    providerRuntime.provider,
    providerRuntime.model ?? '',
    providerRuntime.baseUrl ?? '',
    providerRuntime.fallback ?? '',
  ].join('|');
  const taskValues = Object.values(tasks);
  const taskRunningCount = taskValues.filter(task => task.status === 'running' || task.status === 'pending').length;
  const defaultStatusLineText = buildDefaultStatusBar({
    version: MACRO.VERSION,
    providerLabel: providerRuntime.providerLabel,
    authMode: providerRuntime.authLabel,
    model: providerRuntime.model ?? renderModelName(mainLoopModel),
    mode: permissionMode,
    branch,
    taskRunningCount,
    taskTotalCount: taskValues.length,
    latestVersion: autoUpdaterResult?.status === 'success' ? null : autoUpdaterResult?.version,
    isCheckingUpdate: isAutoUpdating
  });

  // Keep latest values in refs for stable callback access
  const settingsRef = useRef(effectiveSettings);
  settingsRef.current = effectiveSettings;
  const vimModeRef = useRef(vimMode);
  vimModeRef.current = vimMode;
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const addedDirsRef = useRef(additionalWorkingDirectories);
  addedDirsRef.current = additionalWorkingDirectories;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;

  // Track previous state to detect changes and cache expensive calculations
  const previousStateRef = useRef<{
    messageId: string | null;
    exceeds200kTokens: boolean;
    permissionMode: PermissionMode;
    vimMode: VimMode | undefined;
    mainLoopModel: ModelName;
    providerRuntimeKey: string;
  }>({
    messageId: null,
    exceeds200kTokens: false,
    permissionMode,
    vimMode,
    mainLoopModel,
    providerRuntimeKey
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // True when the next invocation should log its result (first run or after settings reload)
  const logNextResultRef = useRef(true);

  // Stable update function — reads latest values from refs
  const doUpdate = useCallback(async () => {
    if (!settingsRef.current?.statusLine) {
      return;
    }
    // Cancel any in-flight requests
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const msgs = messagesRef.current;
    const logResult = logNextResultRef.current;
    logNextResultRef.current = false;
    try {
      let exceeds200kTokens = previousStateRef.current.exceeds200kTokens;

      // Only recalculate 200k check if messages changed
      const currentMessageId = getLastAssistantMessageId(msgs);
      if (currentMessageId !== previousStateRef.current.messageId) {
        exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(msgs);
        previousStateRef.current.messageId = currentMessageId;
        previousStateRef.current.exceeds200kTokens = exceeds200kTokens;
      }
      const statusInput = buildStatusLineCommandInput(permissionModeRef.current, exceeds200kTokens, settingsRef.current, msgs, Array.from(addedDirsRef.current.keys()), mainLoopModelRef.current, vimModeRef.current);
      const text = await executeStatusLineCommand(statusInput, controller.signal, undefined, logResult);
      if (!controller.signal.aborted) {
        setAppState(prev => {
          if (prev.statusLineText === text) return prev;
          return {
            ...prev,
            statusLineText: text
          };
        });
      }
    } catch {
      // Silently ignore errors in status line updates
    }
  }, [messagesRef, setAppState]);

  useEffect(() => {
    let cancelled = false;
    const refreshBranch = async () => {
      try {
        const nextBranch = await getCachedBranch();
        if (!cancelled) {
          setBranch(nextBranch);
        }
      } catch {
        if (!cancelled) {
          setBranch(null);
        }
      }
    };
    void refreshBranch();
    const timer = setInterval(refreshBranch, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Stable debounced schedule function — no deps, uses refs
  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout((ref, doUpdate) => {
      ref.current = undefined;
      void doUpdate();
    }, 300, debounceTimerRef, doUpdate);
  }, [doUpdate]);

  // Only trigger update when assistant message, permission mode, vim mode, or model actually changes
  useEffect(() => {
    if (!settings?.statusLine) return;
    if (lastAssistantMessageId !== previousStateRef.current.messageId || permissionMode !== previousStateRef.current.permissionMode || vimMode !== previousStateRef.current.vimMode || mainLoopModel !== previousStateRef.current.mainLoopModel || providerRuntimeKey !== previousStateRef.current.providerRuntimeKey) {
      // Don't update messageId here — let doUpdate handle it so
      // exceeds200kTokens is recalculated with the latest messages
      previousStateRef.current.permissionMode = permissionMode;
      previousStateRef.current.vimMode = vimMode;
      previousStateRef.current.mainLoopModel = mainLoopModel;
      previousStateRef.current.providerRuntimeKey = providerRuntimeKey;
      scheduleUpdate();
    }
  }, [lastAssistantMessageId, permissionMode, vimMode, mainLoopModel, providerRuntimeKey, scheduleUpdate]);

  // When the statusLine command changes (hot reload), log the next result
  const statusLineCommand = effectiveSettings?.statusLine?.command;
  const isFirstSettingsRender = useRef(true);
  useEffect(() => {
    if (!effectiveSettings?.statusLine) return;
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      return;
    }
    logNextResultRef.current = true;
    void doUpdate();
  }, [statusLineCommand, doUpdate]);

  // Separate effect for logging on mount
  useEffect(() => {
    const statusLine = effectiveSettings?.statusLine;
    if (statusLine) {
      logEvent('tengu_status_line_mount', {
        command_length: statusLine.command.length,
        padding: statusLine.padding
      });
      // Log if status line is configured but disabled by disableAllHooks
      if (settings.disableAllHooks === true) {
        logForDebugging('Status line is configured but disableAllHooks is true', {
          level: 'warn'
        });
      }
      // executeStatusLineCommand (hooks.ts) returns undefined when trust is
      // blocked — statusLineText stays undefined forever, user sees nothing,
      // and tengu_status_line_mount above fires anyway so telemetry looks fine.
      if (!checkHasTrustDialogAccepted()) {
        addNotification({
          key: 'statusline-trust-blocked',
          text: 'statusline skipped · restart to fix',
          color: 'warning',
          priority: 'low'
        });
        logForDebugging('Status line command skipped: workspace trust not accepted', {
          level: 'warn'
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount - settings stable for initial logging

  // Initial update on mount + cleanup on unmount
  useEffect(() => {
    void doUpdate();
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount, not when doUpdate changes

  // Get padding from settings or default to 0
  const paddingX = effectiveSettings?.statusLine?.padding ?? 0;
  const renderedStatusLineText = effectiveSettings?.statusLine ? statusLineText : defaultStatusLineText;

  // StatusLine must have stable height in fullscreen — the footer is
  // flexShrink:0 so a 0→1 row change when the command finishes steals
  // a row from ScrollBox and shifts content. Reserve the row while loading
  // (same trick as PromptInputFooterLeftSide).
  return <Box paddingX={paddingX} gap={2}>
      {renderedStatusLineText ? <Text dimColor wrap="truncate">
          <Ansi>{renderedStatusLineText}</Ansi>
        </Text> : isFullscreenEnvEnabled() ? <Text> </Text> : null}
    </Box>;
}

// Parent (PromptInputFooter) re-renders on every setMessages, but StatusLine's
// own props now only change when lastAssistantMessageId flips — memo keeps it
// from being dragged along (previously ~18 no-prop-change renders per session).
export const StatusLine = memo(StatusLineInner);
