/**
 * SoundAlertService — DI override test example.
 *
 * Demonstrates ServiceRegistry.override() for injecting mock dependencies,
 * enabling isolated unit testing of service logic.
 *
 * Run: gjs -m src/lib/__tests__/soundAlerts.test.ts
 */

import {describe, it, expect, run} from './test-runner';
import ServiceRegistry, {type Service} from '@shade/core/serviceRegistry';

// ── Mock ShellState ───────────────────────────────────────────────

class MockShellState {
    screenlocked = false;
    #handlers = new Map<number, () => void>();
    #nextId = 1;

    connect(signal: string, fn: () => void): number {
        const id = this.#nextId++;
        if (signal === 'notify::screenlocked') {
            this.#handlers.set(id, fn);
        }
        return id;
    }

    disconnect(id: number) {
        this.#handlers.delete(id);
    }

    /** Simulate unlocking the screen (triggers 'screen-unlock' listener). */
    simulateUnlock() {
        this.screenlocked = false;
        for (const fn of this.#handlers.values()) {
            fn();
        }
    }
}

// ── Mock DndService ───────────────────────────────────────────────

class MockDndService {
    dnd = false;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('SoundAlertService (DI override)', () => {
    it('uses mocked ShellState and DndService via ServiceRegistry.override()', () => {
        const reg = ServiceRegistry.get_default();
        const mockShell = new MockShellState();
        const mockDnd = new MockDndService();

        // Register mocks BEFORE the service under test resolves them
        reg.register({name: 'ShellState', service: mockShell as unknown as Service});
        reg.register({name: 'DndService', service: mockDnd as unknown as Service});

        // Verify resolution works
        const resolvedShell = reg.resolve<MockShellState>('ShellState');
        expect(resolvedShell).toBe(mockShell);

        const resolvedDnd = reg.resolve<MockDndService>('DndService');
        expect(resolvedDnd).toBe(mockDnd);

        // Toggle DND — verify mock responds
        expect(mockDnd.dnd).toBe(false);
        mockDnd.dnd = true;
        expect(mockDnd.dnd).toBe(true);

        // Override with a different mock
        const altMock = new MockDndService();
        altMock.dnd = true;
        reg.override('DndService', altMock as unknown as Service);
        expect(reg.resolve<MockDndService>('DndService').dnd).toBe(true);
    });

    it('reset() clears all registrations for test isolation', () => {
        const reg = ServiceRegistry.get_default();
        reg.reset();

        // After reset, resolve should throw
        let threw = false;
        try {
            reg.resolve('ShellState');
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });

    it('override() works even for unregistered names (with warning)', () => {
        const reg = ServiceRegistry.get_default();
        const mock = new MockDndService();

        // override() on an unregistered name logs a warning but still registers
        reg.override('NeverRegistered', mock as unknown as Service);
        expect(reg.resolve<MockDndService>('NeverRegistered')).toBe(mock);

        reg.reset();
    });
});

// ── Run ───────────────────────────────────────────────────────────

run();
