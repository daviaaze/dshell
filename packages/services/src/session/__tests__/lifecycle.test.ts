import Mpris from 'gi://AstalMpris';
import GLib from 'gi://GLib?version=2.0';
import type SessionLock from 'gi://Gtk4SessionLock';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import MediaController from '../mediaController';
import SessionLockService from '../sessionLockService';

class SignalSource {
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
        for (const handler of [...this.handlers.values()]) {
            if (handler.name === name) handler.callback();
        }
    }
}

class NativeLock extends SignalSource {
    locked = false;
    disposed = 0;
    unlocks = 0;
    accepted = true;
    requests = 0;
    lock() {
        this.requests++;
        return this.accepted;
    }
    is_locked() {
        return this.locked;
    }
    run_dispose() {
        this.disposed++;
    }
    override emit(name: string) {
        if (name === 'locked') this.locked = true;
        if (name === 'unlocked') this.locked = false;
        super.emit(name);
    }
    unlock() {
        this.unlocks++;
        this.emit('unlocked');
    }
}

function delay(ms: number): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
    return promise;
}

describe('Session lock lifecycle recovery', () => {
    it.async(
        'reports an unanswered acquisition without competing requests and retries only after native failure',
        async () => {
            const locks: NativeLock[] = [];
            const service = new SessionLockService(() => {
                const lock = new NativeLock();
                locks.push(lock);
                return lock as unknown as SessionLock.Instance;
            }, 1);
            let failed = 0;
            let confirmed = 0;
            let stalled = 0;
            service.connect('failed', () => failed++);
            service.connect('locked', () => confirmed++);
            service.connect('stalled', () => stalled++);
            try {
                service.lock();
                await delay(10);
                expect(stalled).toBe(1);
                expect(failed).toBe(0);
                expect(locks[0].disposed).toBe(0);
                expect(locks[0].unlocks).toBe(0);
                service.lock();
                expect(locks.length).toBe(1);
                expect(locks[0].requests).toBe(1);
                locks[0].emit('failed');
                expect(locks[0].disposed).toBe(1);
                service.lock();
                expect(locks.length).toBe(2);
                locks[0].emit('locked');
                expect(confirmed).toBe(0);
                locks[1].emit('locked');
                await delay(10);
                expect(confirmed).toBe(1);
                expect(failed).toBe(1);
                expect(stalled).toBe(1);
                expect(locks[1].disposed).toBe(0);
                service.unlock();
                expect(locks[1].unlocks).toBe(1);
                expect(locks[1].disposed).toBe(1);
            } finally {
                for (const lock of locks) lock.emit('failed');
            }
        }
    );

    it.async('accepts late confirmation after timeout without releasing the lock', async () => {
        const native = new NativeLock();
        const service = new SessionLockService(() => native as unknown as SessionLock.Instance, 1);
        let confirmed = 0;
        let failed = 0;
        let stalled = 0;
        service.connect('locked', () => confirmed++);
        service.connect('failed', () => failed++);
        service.connect('stalled', () => stalled++);
        try {
            service.lock();
            await delay(10);
            expect(stalled).toBe(1);
            expect(failed).toBe(0);
            expect(native.disposed).toBe(0);
            native.emit('locked');
            expect(confirmed).toBe(1);
            expect(service.isLocked).toBe(true);
            expect(native.unlocks).toBe(0);
            service.unlock();
            expect(native.unlocks).toBe(1);
            expect(native.disposed).toBe(1);
        } finally {
            if (native.locked) service.unlock();
            native.emit('failed');
        }
    });

    it('retires an immediate failure even if the native API emits no signal', () => {
        const native = new NativeLock();
        native.accepted = false;
        const service = new SessionLockService(() => native as unknown as SessionLock.Instance);
        let failed = 0;
        service.connect('failed', () => failed++);
        service.lock();
        expect(failed).toBe(1);
        expect(native.disposed).toBe(1);
        expect(native.unlocks).toBe(0);
        expect(native.handlers.size).toBe(0);
    });
});

describe('Media controller cleanup', () => {
    it('disconnects player metadata and proxy handlers and can initialize again', () => {
        const original = Mpris.get_default;
        const player = Object.assign(new SignalSource(), {
            title: 'Title',
            artist: 'Artist',
            coverArt: 'Cover',
        });
        const proxy = Object.assign(new SignalSource(), {players: [player]});
        Mpris.get_default = () => proxy as unknown as Mpris.Mpris;
        const controller = new MediaController();
        try {
            controller.init();
            expect(proxy.handlers.size).toBe(1);
            expect(player.handlers.size).toBe(3);
            expect(controller.activeTitle).toBe('Title');
            controller.dispose();
            expect(proxy.handlers.size).toBe(0);
            expect(player.handlers.size).toBe(0);
            expect(controller.activeTitle).toBe('');
            expect(controller.activeArtist).toBe('');
            expect(controller.activeCoverArt).toBe('');
            controller.dispose();
            controller.init();
            expect(proxy.handlers.size).toBe(1);
            expect(player.handlers.size).toBe(3);
        } finally {
            controller.dispose();
            Mpris.get_default = original;
        }
    });
});

await run(import.meta.url);
