/**
 * Resolve the auto-dismiss timeout (ms) for a notification.
 *
 * Fallback chain:
 *   notification.expireTimeout (> 0)
 *   → notifd.defaultTimeout (> 0)
 *   → DEFAULT_EXPIRE_MS
 *
 * Duck-typed params so this stays pure and unit-testable without
 * constructing real AstalNotifd GObjects.
 */
export const DEFAULT_EXPIRE_MS = 5000;

export function getExpireMs(
    notification: {expireTimeout: number},
    notifd?: {defaultTimeout: number} | null
): number {
    if (notification.expireTimeout > 0) return notification.expireTimeout;
    if (notifd && notifd.defaultTimeout > 0) return notifd.defaultTimeout;
    return DEFAULT_EXPIRE_MS;
}
