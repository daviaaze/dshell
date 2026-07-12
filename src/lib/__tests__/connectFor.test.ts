/**
 * Tests for connectFor — signal lifecycle helper.
 *
 * These tests use GObject signals (the real thing) since connectFor
 * interacts directly with GObject.connect/disconnect.
 *
 * Run: gjs -m src/lib/__tests__/connectFor.test.ts
 */

import GObject from 'gi://GObject?version=2.0';
import {connectFor, cleanupNode} from '../core/connectFor';
import {describe, it, expect, run} from './test-runner';

class TestSignaler extends GObject.Object {
    fire() {
        this.emit('test-signal');
    }

    fireWith(value: number) {
        this.emit('test-value', value);
    }
}

// Register a simple GObject type for testing
GObject.registerClass(
    {
        GTypeName: 'TestSignaler',
        Signals: {
            'test-signal': {},
            'test-value': {param_types: [GObject.TYPE_INT]},
        },
    },
    TestSignaler
);

describe('connectFor', () => {
    it('disconnects handler when node is cleaned up', () => {
        const signaler = new TestSignaler();
        const node = {};
        let callCount = 0;

        connectFor(node, signaler, 'test-signal', () => {
            callCount++;
        });

        signaler.fire();
        expect(callCount).toBe(1);

        cleanupNode(node);

        signaler.fire();
        expect(callCount).toBe(1); // Should NOT have incremented
    });

    it('supports multiple handlers on same object', () => {
        const signaler = new TestSignaler();
        const node = {};
        let countA = 0;
        let countB = 0;

        connectFor(node, signaler, 'test-signal', () => {
            countA++;
        });
        connectFor(node, signaler, 'test-signal', () => {
            countB++;
        });

        signaler.fire();
        expect(countA).toBe(1);
        expect(countB).toBe(1);

        cleanupNode(node);

        signaler.fire();
        expect(countA).toBe(1);
        expect(countB).toBe(1);
    });

    it('handles disconnected objects gracefully on cleanup', () => {
        const signaler = new TestSignaler();
        const node = {};

        connectFor(node, signaler, 'test-signal', () => {});

        signaler.run_dispose(); // Simulate object destruction
        // cleanupNode should not throw
        let threw = false;
        try {
            cleanupNode(node);
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
    });

    it('supports multiple nodes independently', () => {
        const signaler = new TestSignaler();
        const nodeA = {};
        const nodeB = {};
        let countA = 0;
        let countB = 0;

        connectFor(nodeA, signaler, 'test-signal', () => {
            countA++;
        });
        connectFor(nodeB, signaler, 'test-signal', () => {
            countB++;
        });

        signaler.fire();
        expect(countA).toBe(1);
        expect(countB).toBe(1);

        cleanupNode(nodeA);

        signaler.fire();
        expect(countA).toBe(1); // Frozen
        expect(countB).toBe(2); // Still active
    });

    it('passes signal arguments through', () => {
        const signaler = new TestSignaler();
        const node = {};
        let received: number | null = null;

        connectFor(node, signaler, 'test-value', (_, value: number) => {
            received = value;
        });

        signaler.fireWith(42);
        expect(received).toBe(42);
    });

    it('does nothing when cleanNode is called twice', () => {
        const signaler = new TestSignaler();
        const node = {};
        let callCount = 0;

        connectFor(node, signaler, 'test-signal', () => {
            callCount++;
        });

        cleanupNode(node);
        cleanupNode(node); // Should not throw

        signaler.fire();
        expect(callCount).toBe(0);
    });
});

await run(import.meta.url);
