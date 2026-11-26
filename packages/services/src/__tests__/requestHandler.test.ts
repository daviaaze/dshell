/**
 * Tests for the shade-shell CLI routing table used by requestHandler.
 *
 * Imports the real resolver (cliRoutes.ts), which requestHandler dispatches through.
 *
 * Run: pnpm run test:compile && nix develop -c gjs -m build/test/requestHandler.test.js
 */

import {type CliRoute, resolveRoute, TOGGLE_ACTIONS} from '../state/cliRoutes';
import {describe, expect, it, run} from './test-runner';

/** Action a subcommand activates, or null when it is unknown or misused. */
function actionOf(name: string, ...args: string[]): string | null {
    const route = resolveRoute(name, args);
    return route?.kind === 'action' ? route.action : null;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('requestHandler action resolution', () => {
    it('maps lockscreen', () => {
        expect(actionOf('lockscreen')).toBe('lockscreen');
    });

    it('maps toggle applauncher', () => {
        expect(actionOf('toggle', 'applauncher')).toBe('toggle-applauncher');
    });

    it('maps toggle launcher, the name the help text advertises, to the launcher action', () => {
        expect(actionOf('toggle', 'launcher')).toBe('toggle-applauncher');
    });

    it('maps toggle quicksettings', () => {
        expect(actionOf('toggle', 'quicksettings')).toBe('toggle-quicksettings');
    });

    it('maps toggle bar', () => {
        expect(actionOf('toggle', 'bar')).toBe('toggle-bar');
    });

    it('maps toggle windowswitcher', () => {
        expect(actionOf('toggle', 'windowswitcher')).toBe('toggle-windowswitcher');
    });

    it('maps toggle settings', () => {
        expect(actionOf('toggle', 'settings')).toBe('toggle-settings');
    });

    it('maps toggle touchpad to toggle-touchpad', () => {
        expect(actionOf('toggle', 'touchpad')).toBe('toggle-touchpad');
    });

    it('maps clipboard to toggle-clipboard', () => {
        expect(actionOf('clipboard')).toBe('toggle-clipboard');
    });

    it('maps screenshot', () => {
        expect(actionOf('screenshot')).toBe('screenshot');
    });

    it('maps screenshot-area', () => {
        expect(actionOf('screenshot-area')).toBe('screenshot-area');
    });

    it('maps record', () => {
        expect(actionOf('record')).toBe('record');
    });

    it('maps record-area', () => {
        expect(actionOf('record-area')).toBe('record-area');
    });

    it('maps record-window', () => {
        expect(actionOf('record-window')).toBe('record-window');
    });

    it('maps record-output', () => {
        expect(actionOf('record-output')).toBe('record-output');
    });

    it('maps touchpad direct', () => {
        expect(actionOf('touchpad')).toBe('toggle-touchpad');
    });

    it('routes direct display mode values with their parameterized action', () => {
        for (const mode of ['internal-only', 'external-only', 'extend', 'duplicate']) {
            expect(resolveRoute('display-mode', [mode])).toEqual({
                kind: 'action',
                action: 'display-mode',
                value: mode,
            });
        }
    });

    it('routes record-window-address with its address as the string parameter', () => {
        expect(resolveRoute('record-window-address', ['0x1234'])).toEqual({
            kind: 'action',
            action: 'record-window-address',
            value: '0x1234',
        });
    });

    it('routes display chooser, internal toggle, and saved-layout cycling', () => {
        expect(actionOf('display-mode-chooser')).toBe('display-mode-chooser');
        expect(actionOf('display-toggle-internal')).toBe('display-toggle-internal');
        expect(actionOf('display-next')).toBe('display-next');
    });

    it('routes toggle-dnd through the event bus', () => {
        expect(resolveRoute('toggle-dnd', [])).toEqual({kind: 'dnd-toggle'});
    });

    it('returns null for unknown command', () => {
        expect(resolveRoute('nonexistent', [])).toBe(null);
        expect(resolveRoute(null, [])).toBe(null);
    });
});

describe('requestHandler usage errors', () => {
    const isUsage = (route: CliRoute | null) => route?.kind === 'usage';

    it('reports toggle without a widget', () => {
        expect(isUsage(resolveRoute('toggle', []))).toBe(true);
    });

    it('reports toggle with an unknown widget instead of reporting success', () => {
        expect(isUsage(resolveRoute('toggle', ['nonexistent']))).toBe(true);
    });

    it('does not resolve widget names that exist on Object.prototype', () => {
        expect(isUsage(resolveRoute('toggle', ['constructor']))).toBe(true);
        expect(resolveRoute('constructor', [])).toBe(null);
    });

    it('reports missing required arguments', () => {
        expect(isUsage(resolveRoute('display-mode', []))).toBe(true);
        expect(isUsage(resolveRoute('record-window-address', []))).toBe(true);
    });
});

// ── Action completeness ─────────────────────────────────────────────────────

describe('requestHandler action completeness', () => {
    // All actions registered via ShellState.registerCommands() and the service
    // command registries should have a CLI route.
    const registeredActions = [
        'toggle-applauncher',
        'toggle-quicksettings',
        'toggle-notifications',
        'toggle-bar',
        'toggle-windowswitcher',
        'toggle-settings',
        'toggle-clipboard',
        'open-clipboard',
        'lockscreen',
        'screenshot',
        'screenshot-area',
        'screenshot-overlay',
        'record',
        'record-area',
        'record-window',
        'record-window-address',
        'record-output',
        'display-next',
        'display-mode',
        'display-mode-chooser',
        'display-toggle-internal',
        'toggle-touchpad',
    ];

    const reachableViaCLI = new Set<string>();

    const plainCommands = [
        'lockscreen',
        'clipboard',
        'screenshot',
        'screenshot-area',
        'screenshot-overlay',
        'record',
        'record-area',
        'record-window',
        'record-output',
        'open-clipboard',
        'touchpad',
        'display-next',
        'display-mode-chooser',
        'display-toggle-internal',
    ];
    for (const cmd of plainCommands) {
        const action = actionOf(cmd);
        if (action) reachableViaCLI.add(action);
    }

    for (const [cmd, arg] of [
        ['display-mode', 'extend'],
        ['record-window-address', '0x1'],
    ]) {
        const action = actionOf(cmd, arg);
        if (action) reachableViaCLI.add(action);
    }

    for (const widget of Object.keys(TOGGLE_ACTIONS)) {
        const action = actionOf('toggle', widget);
        if (action) reachableViaCLI.add(action);
    }

    it('all registered actions have a CLI route', () => {
        for (const action of registeredActions) {
            expect(reachableViaCLI.has(action)).toBe(true);
        }
    });
});

await run(import.meta.url);
