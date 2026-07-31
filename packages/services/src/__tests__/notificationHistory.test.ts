/**
 * Smoke test for NotificationHistory — singleton identity and the
 * clear() behavior, which is hermetic (unlike `history`, which loads
 * persisted entries from disk on construction).
 */
import NotificationHistory from '../notifications/history';
import {describe, it, expect, run} from './test-runner';

describe('NotificationHistory', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = NotificationHistory.get_default();
        const b = NotificationHistory.get_default();
        expect(a).toBe(b);
    });

    it('clear() empties the history regardless of persisted state', () => {
        const h = NotificationHistory.get_default();
        h.clear();
        expect(h.history).toEqual([]);
    });
});

await run(import.meta.url);
