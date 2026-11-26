import SessionLockService from '../../session/sessionLockService';
import ShellState from '../../state/shellState';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {captureBlocked} from '../utils';

describe('Native capture lock gate', () => {
    it('also blocks capture while the compositor still holds a lock after shell state changes', () => {
        const original = SessionLockService.get_default;
        const state = ShellState.get_default();
        const wasLocked = state.screenlocked;
        let nativeLocked = true;
        SessionLockService.get_default = () =>
            ({
                get isLocked() {
                    return nativeLocked;
                },
            }) as SessionLockService;
        try {
            state.screenlocked = false;
            expect(captureBlocked()).toBe(true);
            nativeLocked = false;
            expect(captureBlocked()).toBe(false);
            state.screenlocked = true;
            expect(captureBlocked()).toBe(true);
        } finally {
            SessionLockService.get_default = original;
            state.screenlocked = wasLocked;
        }
    });
});

await run(import.meta.url);
