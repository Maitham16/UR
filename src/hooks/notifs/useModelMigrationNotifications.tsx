import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';

// Shows a one-time notification right after a model migration writes its
// timestamp to config. Each entry reads its own timestamp field(s) and emits
// a notification if the write happened within the last 3s (i.e. this launch).
// Future model migrations: add an entry to MIGRATIONS below.
const MIGRATIONS: ((c: GlobalConfig) => Notification | undefined)[] = [
// Legacy model alias cleanup.
c => {
  if (!recent(c.modelS45To46MigrationTimestamp)) return;
  return {
    key: 'model-alias-update',
    text: 'Model setting updated',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: 3000
  };
},
// Legacy model alias cleanup.
c => {
  const isLegacyRemap = Boolean(c.legacymodelOMigrationTimestamp);
  const ts = c.legacymodelOMigrationTimestamp ?? c.modelOProMigrationTimestamp;
  if (!recent(ts)) return;
  return {
    key: 'modelO-pro-update',
    text: isLegacyRemap ? 'Model setting updated · Set UR_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out' : 'Model setting updated',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: isLegacyRemap ? 8000 : 3000
  };
}];
export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = [];
  for (const migration of MIGRATIONS) {
    const notif = migration(config);
    if (notif) {
      notifs.push(notif);
    }
  }
  return notifs.length > 0 ? notifs : null;
}
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
