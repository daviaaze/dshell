import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import {Object as GObjectObject, register, signal} from 'gnim/gobject';
import AuthSession, {type AuthSessionOptions, type PasswordWorker} from '../session/authSession';
import type FingerprintAuth from '../input/fingerprint';
import {expect, describe, it, run} from './test-runner';

type ControlledAttempt = {
    password: string;
    complete: (authenticated: boolean) => void;
    cancelled: boolean;
};

class FakePasswordWorker {
    attempts: ControlledAttempt[] = [];

    readonly start: PasswordWorker = (password, complete) => {
        const attempt = {password, complete, cancelled: false};
        this.attempts.push(attempt);
        return () => {
            attempt.cancelled = true;
        };
    };
}

@register
class FakeFingerprint extends GObjectObject {
    #available: boolean;
    #initialize: () => Promise<void>;
    #starts = 0;
    #stops = 0;

    constructor(options: {available?: boolean; initialize?: () => Promise<void>} = {}) {
        super();
        this.#available = options.available ?? false;
        this.#initialize = options.initialize ?? (() => Promise.resolve());
    }

    get available() {
        return this.#available;
    }

    get starts() {
        return this.#starts;
    }

    get stops() {
        return this.#stops;
    }

    @signal
    verified(): void {}

    @signal
    statusChanged(_status: string): void {}

    async init() {
        await this.#initialize();
    }

    start() {
        this.#starts++;
    }

    stop() {
        this.#stops++;
    }
}

function makeSession(
    worker: FakePasswordWorker,
    fingerprint = new FakeFingerprint(),
    timeoutMs = 10000
): AuthSession {
    const options: AuthSessionOptions = {
        fingerprint: fingerprint as unknown as FingerprintAuth,
        passwordWorker: worker.start,
        timeoutMs,
    };
    const session = new AuthSession(options);
    void session.start();
    return session;
}

function delay(ms: number): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
    return promise;
}

describe('AuthSession', () => {
    it.async('does not consume a password or complete authentication before the session starts', async () => {
        const worker = new FakePasswordWorker();
        const session = new AuthSession({
            passwordWorker: worker.start,
            fingerprint: new FakeFingerprint() as unknown as FingerprintAuth,
        });
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);
        expect(session.submitPassword('early-secret')).toBe(false);
        expect(worker.attempts.length).toBe(0);
        await session.start();
        expect(session.submitPassword('current-secret')).toBe(true);
        worker.attempts[0].complete(true);
        expect(successes).toBe(1);
        session.cancel();
    });

    it.async('retires a hung helper and allows the next correct password', async () => {
        const worker = new FakePasswordWorker();
        const session = makeSession(worker, new FakeFingerprint(), 5);
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);

        await session.start();
        session.submitPassword('stalled-secret');
        await delay(25);

        expect(session.authStatus).toBe('Authentication timed out. Try again.');
        expect(worker.attempts[0]?.cancelled).toBeTruthy();

        session.submitPassword('current-secret');
        expect(worker.attempts.length).toBe(2);
        expect(worker.attempts[1]?.password).toBe('current-secret');
        worker.attempts[1]?.complete(true);

        expect(successes).toBe(1);
        session.cancel();
    });

    it.async('ignores a retired late success and does not unlock on a wrong password', async () => {
        const worker = new FakePasswordWorker();
        const session = makeSession(worker, new FakeFingerprint(), 5);
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);

        session.submitPassword('old-secret');
        await delay(25);
        session.submitPassword('wrong-secret');
        worker.attempts[0]?.complete(true);
        expect(successes).toBe(0);
        worker.attempts[1]?.complete(false);

        expect(successes).toBe(0);
        expect(session.authStatus).toBe('Authentication failed');
        session.cancel();
    });

    it('kills active authentication on disposal and ignores its late success', () => {
        const worker = new FakePasswordWorker();
        const fingerprint = new FakeFingerprint();
        const session = makeSession(worker, fingerprint);
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);

        session.submitPassword('secret');
        session.cancel();
        session.cancel();
        worker.attempts[0]?.complete(true);

        expect(worker.attempts[0]?.cancelled).toBeTruthy();
        expect(fingerprint.stops).toBe(1);
        expect(successes).toBe(0);
    });

    it.async('keeps password authentication available when fingerprint initialization fails', async () => {
        const worker = new FakePasswordWorker();
        const fingerprint = new FakeFingerprint({
            initialize: () => Promise.reject(new Error('fprintd unavailable')),
        });
        const session = makeSession(worker, fingerprint);
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);

        await session.start();
        session.submitPassword('valid-secret');
        worker.attempts[0]?.complete(true);

        expect(worker.attempts.length).toBe(1);
        expect(successes).toBe(1);
        session.cancel();
    });

    it.async('does not start fingerprint verification after the session is cancelled', async () => {
        const worker = new FakePasswordWorker();
        const {promise, resolve} = Promise.withResolvers<void>();
        const fingerprint = new FakeFingerprint({available: true, initialize: () => promise});
        const session = makeSession(worker, fingerprint);
        let successes = 0;
        GObject.signal_connect(session, 'success', () => successes++);

        await session.start();
        session.cancel();
        resolve();
        await delay(0);
        fingerprint.verified();
        fingerprint.statusChanged('verify-retry');

        expect(fingerprint.starts).toBe(0);
        expect(successes).toBe(0);
        expect(session.authStatus).toBe('');
    });

    it('keeps fingerprint signal ownership independent between sessions', () => {
        const worker = new FakePasswordWorker();
        const fingerprint = new FakeFingerprint({available: true});
        const first = makeSession(worker, fingerprint);
        const second = makeSession(worker, fingerprint);
        let firstSuccesses = 0;
        let secondSuccesses = 0;
        GObject.signal_connect(first, 'success', () => firstSuccesses++);
        GObject.signal_connect(second, 'success', () => secondSuccesses++);

        void first.start();
        void second.start();
        first.cancel();
        fingerprint.verified();

        expect(firstSuccesses).toBe(0);
        expect(secondSuccesses).toBe(1);
        second.cancel();
    });

    it.async('keeps password attempts and watchdogs independent between sessions', async () => {
        const worker = new FakePasswordWorker();
        const first = makeSession(worker, new FakeFingerprint(), 5);
        const second = makeSession(worker, new FakeFingerprint(), 5);
        let firstSuccesses = 0;
        let secondSuccesses = 0;
        GObject.signal_connect(first, 'success', () => firstSuccesses++);
        GObject.signal_connect(second, 'success', () => secondSuccesses++);

        first.submitPassword('first-secret');
        second.submitPassword('second-secret');
        first.cancel();
        await delay(25);

        expect(worker.attempts[0]?.cancelled).toBeTruthy();
        expect(second.authStatus).toBe('Authentication timed out. Try again.');
        expect(firstSuccesses).toBe(0);

        second.submitPassword('retry-secret');
        worker.attempts[2]?.complete(true);
        expect(secondSuccesses).toBe(1);
        second.cancel();
    });

});

await run(import.meta.url);
