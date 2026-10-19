import type SessionLock from 'gi://Gtk4SessionLock';
import SessionLockService from '../session/sessionLockService';
import {describe, expect, it, run} from './test-runner';

class NativeLock {
    locked = false;
    requests = 0;
    unlocks = 0;
    handlers = new Map<number, {name: string; callback: () => void}>();
    nextId = 1;

    connect(name: string, callback: () => void) {
        const id = this.nextId++;
        this.handlers.set(id, {name, callback});
        return id;
    }

    disconnect(id: number) {
        this.handlers.delete(id);
    }

    emit(name: string) {
        if (name === 'locked') this.locked = true;
        if (name === 'unlocked') this.locked = false;
        for (const handler of this.handlers.values()) {
            if (handler.name === name) handler.callback();
        }
    }

    lock() {
        this.requests++;
        return true;
    }

    is_locked() {
        return this.locked;
    }

    unlock() {
        this.unlocks++;
        this.emit('unlocked');
    }
}

describe('Compositor lock acquisition', () => {
    it('does not claim a lock before confirmation or send unlock while acquisition is pending', () => {
        const native = new NativeLock();
        const service = new SessionLockService(() => native as unknown as SessionLock.Instance);
        let confirmed = 0;
        service.connect('locked', () => confirmed++);
        service.lock();
        service.lock();
        service.unlock();
        expect(native.requests).toBe(1);
        expect(native.unlocks).toBe(0);
        expect(service.isLocked).toBe(false);
        expect(confirmed).toBe(0);
        native.emit('locked');
        expect(service.isLocked).toBe(true);
        expect(confirmed).toBe(1);
        service.unlock();
        expect(service.isLocked).toBe(false);
        expect(native.unlocks).toBe(1);
    });

    it('retries a rejected acquisition with a fresh instance and ignores retired events', () => {
        const instances: NativeLock[] = [];
        const service = new SessionLockService(() => {
            const native = new NativeLock();
            instances.push(native);
            return native as unknown as SessionLock.Instance;
        });
        let confirmed = 0;
        service.connect('locked', () => confirmed++);
        service.lock();
        instances[0].emit('failed');
        service.lock();
        expect(instances.length).toBe(2);
        instances[0].emit('locked');
        expect(confirmed).toBe(0);
        expect(service.isLocked).toBe(false);
        instances[1].emit('locked');
        expect(confirmed).toBe(1);
        service.unlock();
        expect(instances[0].unlocks).toBe(0);
        expect(instances[1].unlocks).toBe(1);
    });
});

await run(import.meta.url);
