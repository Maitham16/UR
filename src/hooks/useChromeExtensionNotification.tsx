import * as React from 'react';
import { Text } from '../ink.js';
import { isURAISubscriber } from '../utils/auth.js';
import { isChromeExtensionInstalled, shouldEnableURInChrome } from '../utils/urInChrome/setup.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';
function getChromeFlag(): boolean | undefined {
  if (process.argv.includes('--chrome')) {
    return true;
  }
  if (process.argv.includes('--no-chrome')) {
    return false;
  }
  return undefined;
}
export function useChromeExtensionNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  const chromeFlag = getChromeFlag();
  if (!shouldEnableURInChrome(chromeFlag)) {
    return null;
  }
  if (true && !isURAISubscriber()) {
    return {
      key: "chrome-requires-subscription",
      jsx: <Text color="error">UR in Chrome requires a ur.ai subscription</Text>,
      priority: "immediate" as const,
      timeoutMs: 5000
    };
  }
  const installed = await isChromeExtensionInstalled();
  if (!installed && !isRunningOnHomespace()) {
    return {
      key: "chrome-extension-not-detected",
      jsx: <Text color="warning">Chrome extension not detected · https://ur.ai/chrome to install</Text>,
      priority: "immediate" as const,
      timeoutMs: 3000
    };
  }
  if (chromeFlag === undefined) {
    return {
      key: "ur-in-chrome-default-enabled",
      text: "UR in Chrome enabled \xB7 /chrome",
      priority: "low" as const
    };
  }
  return null;
}
