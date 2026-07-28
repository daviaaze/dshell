/**
 * Tests for SessionLockService — Gtk4SessionLock lifecycle wrapper.
 *
 * Run via: pnpm test (or manually: gjs -m src/lib/__tests__/sessionLockService.test.ts)
 *
 * NOTE: lock()/unlock()/assignWindow() require a running Wayland session
 * with a DRM-based compositor. These tests verify only the singleton
 * contract and that the service instantiates without throwing.
 */

import SessionLockService from '../services/session/sessionLockService';
import {describe, it, expect, run} from './test-runner';

describe('SessionLockService singleton', () => {
    it('get_default returns the same instance', () => {
        const a = SessionLockService.get_default();
        const b = SessionLockService.get_default();
        expect(a).toBe(b);
    });

    it('constructor does not throw', () => {
        (expect(() => new SessionLockService()) as any).not.toThrow();
    });
});

await run(import.meta.url);
