import ShellState from '../state/shellState';
import {describe, expect, it, run} from './test-runner';

function reset(): ShellState {
    const state = ShellState.get_default();
    state.screenlocked = false;
    state.closeAll();
    return state;
}

describe('ShellState transient surfaces', () => {
    it('opens notifications without retaining other panels and closes them idempotently', () => {
        const state = reset();
        state.launcherOpen = true;
        state.qsOpen = true;
        state.openNotifications();
        expect(state.notificationsOpen).toBe(true);
        expect(state.launcherOpen).toBe(false);
        expect(state.qsOpen).toBe(false);
        state.closeAll();
        state.closeAll();
        expect(state.notificationsOpen).toBe(false);
    });

    it('closes transient content on lock and refuses to reopen it until unlocked', () => {
        const state = reset();
        state.openNotifications();
        state.screenlocked = true;
        expect(state.notificationsOpen).toBe(false);
        state.launcherOpen = true;
        state.qsOpen = true;
        state.notificationsOpen = true;
        state.openNotifications();
        expect(state.launcherOpen).toBe(false);
        expect(state.qsOpen).toBe(false);
        expect(state.notificationsOpen).toBe(false);
        state.screenlocked = false;
        state.openNotifications();
        expect(state.notificationsOpen).toBe(true);
        state.closeAll();
    });
});

await run(import.meta.url);
