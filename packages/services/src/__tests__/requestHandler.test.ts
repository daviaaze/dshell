/**
 * Smoke tests for requestHandler — D-Bus command dispatcher.
 *
 * Tests that CLI args map to correct action names.
 *
 * Run: pnpm run test:compile && nix develop -c gjs -m build/test/requestHandler.test.js
 */

import {describe, it, expect, run} from './test-runner';

// ── Action resolver (mirrors requestHandler logic) ──────────────────────────

function resolveAction(args: string[]): string | null {
    if (args[1] === 'lockscreen') return 'lockscreen';
    else if (args[1] === 'toggle') return `toggle-${args[2]}`;
    else if (args[1] === 'clipboard') return 'toggle-clipboard';
    else if (args[1] === 'screenshot') return 'screenshot';
    else if (args[1] === 'screenshot-area') return 'screenshot-area';
    else if (args[1] === 'screenshot-overlay') return 'screenshot-overlay';
    else if (args[1] === 'record') return 'record';
    else if (args[1] === 'record-area') return 'record-area';
    else if (args[1] === 'record-window') return 'record-window';
    else if (args[1] === 'record-window-address')
        return 'record-window-address';
    else if (args[1] === 'record-output') return 'record-output';
    else if (args[1] === 'touchpad') return 'toggle-touchpad';
    return null;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('requestHandler action resolution', () => {
    it('maps lockscreen', () => {
        expect(resolveAction(['', 'lockscreen'])).toBe('lockscreen');
    });

    it('maps toggle applauncher', () => {
        expect(resolveAction(['', 'toggle', 'applauncher'])).toBe(
            'toggle-applauncher'
        );
    });

    it('maps toggle quicksettings', () => {
        expect(resolveAction(['', 'toggle', 'quicksettings'])).toBe(
            'toggle-quicksettings'
        );
    });

    it('maps toggle bar', () => {
        expect(resolveAction(['', 'toggle', 'bar'])).toBe('toggle-bar');
    });

    it('maps toggle windowswitcher', () => {
        expect(resolveAction(['', 'toggle', 'windowswitcher'])).toBe(
            'toggle-windowswitcher'
        );
    });

    it('maps toggle settings', () => {
        expect(resolveAction(['', 'toggle', 'settings'])).toBe(
            'toggle-settings'
        );
    });

    it('maps toggle touchpad to toggle-touchpad', () => {
        expect(resolveAction(['', 'toggle', 'touchpad'])).toBe(
            'toggle-touchpad'
        );
    });

    it('maps clipboard to toggle-clipboard', () => {
        expect(resolveAction(['', 'clipboard'])).toBe('toggle-clipboard');
    });

    it('maps screenshot', () => {
        expect(resolveAction(['', 'screenshot'])).toBe('screenshot');
    });

    it('maps screenshot-area', () => {
        expect(resolveAction(['', 'screenshot-area'])).toBe('screenshot-area');
    });

    it('maps record', () => {
        expect(resolveAction(['', 'record'])).toBe('record');
    });

    it('maps record-area', () => {
        expect(resolveAction(['', 'record-area'])).toBe('record-area');
    });

    it('maps record-window', () => {
        expect(resolveAction(['', 'record-window'])).toBe('record-window');
    });

    it('maps record-output', () => {
        expect(resolveAction(['', 'record-output'])).toBe('record-output');
    });

    it('maps touchpad direct', () => {
        expect(resolveAction(['', 'touchpad'])).toBe('toggle-touchpad');
    });

    it('returns null for unknown command', () => {
        expect(resolveAction(['', 'nonexistent'])).toBe(null);
    });
});

// ── Action completeness ─────────────────────────────────────────────────────

describe('requestHandler action completeness', () => {
    // All actions registered via registerCommands() should have a CLI route
    const registeredActions = [
        'toggle-applauncher',
        'toggle-quicksettings',
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
        'toggle-touchpad',
    ];

    const reachableViaCLI = new Set<string>();

    // Collect all reachable actions via known CLI patterns
    const commands = [
        'lockscreen',
        'clipboard',
        'screenshot',
        'screenshot-area',
        'screenshot-overlay',
        'record',
        'record-area',
        'record-window',
        'record-window-address',
        'record-output',
        'touchpad',
    ];

    for (const cmd of commands) {
        const action = resolveAction(['', cmd]);
        if (action) reachableViaCLI.add(action);
    }

    // toggle prefix covers: applauncher, quicksettings, bar, windowswitcher, settings
    const toggleTargets = [
        'applauncher',
        'quicksettings',
        'bar',
        'windowswitcher',
        'settings',
        'touchpad',
    ];
    for (const t of toggleTargets) {
        const action = resolveAction(['', 'toggle', t]);
        if (action) reachableViaCLI.add(action);
    }

    it('all registered actions have a CLI route except open-clipboard', () => {
        for (const action of registeredActions) {
            if (action === 'open-clipboard') continue; // internal, no CLI route
            expect(reachableViaCLI.has(action)).toBe(true);
        }
    });
});

await run(import.meta.url);
