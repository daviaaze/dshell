/**
 * Tests for getExpireMs — notification timeout fallback chain.
 *
 * Run: gjs -m src/lib/__tests__/expire.test.ts
 */

import {describe, it, expect, run} from './test-runner';
import {getExpireMs, DEFAULT_EXPIRE_MS} from '../services/notifications/expire';

describe('getExpireMs', () => {
    it('uses notification.expireTimeout when positive', () => {
        expect(getExpireMs({expireTimeout: 3000})).toBe(3000);
    });

    it('notification.expireTimeout wins over notifd.defaultTimeout', () => {
        expect(getExpireMs({expireTimeout: 3000}, {defaultTimeout: 9000})).toBe(
            3000
        );
    });

    it('falls back to notifd.defaultTimeout when expireTimeout is 0', () => {
        expect(getExpireMs({expireTimeout: 0}, {defaultTimeout: 9000})).toBe(
            9000
        );
    });

    it('falls back to notifd.defaultTimeout when expireTimeout is negative', () => {
        expect(getExpireMs({expireTimeout: -1}, {defaultTimeout: 9000})).toBe(
            9000
        );
    });

    it('falls back to DEFAULT_EXPIRE_MS when both are unset', () => {
        expect(getExpireMs({expireTimeout: 0}, {defaultTimeout: 0})).toBe(
            DEFAULT_EXPIRE_MS
        );
        expect(getExpireMs({expireTimeout: -1})).toBe(DEFAULT_EXPIRE_MS);
        expect(getExpireMs({expireTimeout: 0}, null)).toBe(DEFAULT_EXPIRE_MS);
    });

    it('ignores negative defaultTimeout', () => {
        expect(getExpireMs({expireTimeout: 0}, {defaultTimeout: -5})).toBe(
            DEFAULT_EXPIRE_MS
        );
    });
});

run(import.meta.url);
