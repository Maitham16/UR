// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { Box, Text } from '../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { calculateTokenWarningState, getEffectiveContextWindowSize, isAutoCompactEnabled } from '../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../services/compact/compactWarningHook.js';
import { getUpgradeMessage } from '../utils/model/contextWindowUpgradeCheck.js';
type Props = {
  tokenUsage: number;
  model: string;
};

/**
 * Live collapse progress: "x / y summarized". Sub-component so
 * useSyncExternalStore can subscribe to store mutations unconditionally
 * (hooks-in-conditionals would violate React rules). The parent only
 * renders this when feature('CONTEXT_COLLAPSE') + isContextCollapseEnabled().
 */
function CollapseLabel(t0) {
  const $ = _c(8);
  const {
    upgradeMessage
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = require("../services/contextCollapse/index.js");
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const {
    getStats,
    subscribe
  } = t1 as typeof import('../services/contextCollapse/index.js');
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      const s = getStats();
      const idleWarn = s.health.emptySpawnWarningEmitted ? 1 : 0;
      return `${s.collapsedSpans}|${s.stagedSpans}|${s.health.totalErrors}|${s.health.totalEmptySpawns}|${idleWarn}`;
    };
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const snapshot = useSyncExternalStore(subscribe, t2);
  let t3;
  if ($[2] !== snapshot) {
    t3 = snapshot.split("|").map(Number);
    $[2] = snapshot;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const [collapsed, staged, errors, emptySpawns, idleWarn_0] = t3 as [number, number, number, number, number];
  const total = collapsed + staged;
  if (errors > 0 || idleWarn_0) {
    const problem = errors > 0 ? `collapse errors: ${errors}` : `collapse idle (${emptySpawns} empty runs)`;
    const t4 = total > 0 ? `${collapsed} / ${total} summarized \u00b7 ${problem}` : problem;
    let t5;
    if ($[4] !== t4) {
      t5 = <Text color="warning" wrap="truncate">{t4}</Text>;
      $[4] = t4;
      $[5] = t5;
    } else {
      t5 = $[5];
    }
    return t5;
  }
  if (total === 0) {
    return null;
  }
  const label = `${collapsed} / ${total} summarized`;
  const t4 = upgradeMessage ? `${label} \u00b7 ${upgradeMessage}` : label;
  let t5;
  if ($[6] !== t4) {
    t5 = <Text dimColor={true} wrap="truncate">{t4}</Text>;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  return t5;
}
export function TokenWarning({
  tokenUsage,
  model
}: Props) {
  let reactiveOnlyMode = false;
  let collapseMode = false;
  if (feature("REACTIVE_COMPACT")) {
    if (getFeatureValue_CACHED_MAY_BE_STALE("tengu_cobalt_raccoon", false)) {
      reactiveOnlyMode = true;
    }
  }
  if (feature("CONTEXT_COLLAPSE")) {
    const {
      isContextCollapseEnabled
    } = require("../services/contextCollapse/index.js") as typeof import('../services/contextCollapse/index.js');
    if (isContextCollapseEnabled()) {
      collapseMode = true;
    }
  }
  const effectiveWindow = reactiveOnlyMode || collapseMode ? getEffectiveContextWindowSize(model) : undefined;
  const {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold
  } = calculateTokenWarningState(tokenUsage, model, effectiveWindow);
  const suppressWarning = useCompactWarningSuppression();
  if (suppressWarning) {
    return null;
  }
  // Read configuration on every render. /config can change enablement or the
  // threshold without changing the model or token count.
  const showAutoCompactWarning = isAutoCompactEnabled();
  const upgradeMessage = getUpgradeMessage("warning");
  const displayPercentLeft = percentLeft;
  if (collapseMode && feature("CONTEXT_COLLAPSE")) {
    return isAboveWarningThreshold ? <Box flexDirection="row"><CollapseLabel upgradeMessage={upgradeMessage} /></Box> : null;
  }
  const autocompactLabel = reactiveOnlyMode ? `${100 - displayPercentLeft}% context used` : `≈${displayPercentLeft}% until auto-compact`;

  if (showAutoCompactWarning && !reactiveOnlyMode) {
    return <Box flexDirection="row">
      <Text
        color={isAboveErrorThreshold ? "error" : isAboveWarningThreshold ? "warning" : undefined}
        dimColor={!isAboveWarningThreshold}
        wrap="truncate"
      >
        {upgradeMessage ? `${autocompactLabel} \u00b7 ${upgradeMessage}` : autocompactLabel}
      </Text>
    </Box>;
  }

  if (!isAboveWarningThreshold) {
    return null;
  }

  if (reactiveOnlyMode) {
    return <Box flexDirection="row">
      <Text color={isAboveErrorThreshold ? "error" : "warning"} wrap="truncate">
        {upgradeMessage ? `${autocompactLabel} \u00b7 ${upgradeMessage}` : autocompactLabel}
      </Text>
    </Box>;
  }

  return <Box flexDirection="row">
    <Text color={isAboveErrorThreshold ? "error" : "warning"} wrap="truncate">
      {upgradeMessage ? `Context low (${percentLeft}% remaining) \u00b7 ${upgradeMessage}` : `Context low (${percentLeft}% remaining) \u00b7 Run /compact to compact & continue`}
    </Text>
  </Box>;
}
