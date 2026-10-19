import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import FingerprintAuth from '../input/fingerprint';
import {describe, expect, it, run} from './test-runner';

const MANAGER_PATH = '/net/reactivated/Fprint/Manager';
const DEVICE_PATH = '/net/reactivated/Fprint/Device/0';

type FakeResult = {value: GLib.Variant; error: Error | null};
type FakeCall = {method: string; complete: (error?: Error) => void};
type FakeSignal = (...args: unknown[]) => void;

class FakeProxy {
    readonly methods: string[] = [];
    #results = new Map<object, FakeResult>();
    #pending: FakeCall[] = [];
    #waiters = new Map<string, Array<(call: FakeCall) => void>>();
    #heldMethods = new Set<string>();
    #failures = new Map<string, Error[]>();
    #signals = new Map<number, FakeSignal>();
    #nextSignalId = 1;
    readonly history: string[];

    constructor(
        readonly name: string,
        private readonly devicePath: string,
        history: string[] = []
    ) {
        this.history = history;
    }

    call(
        method: string,
        _parameters: GLib.Variant | null,
        _flags: Gio.DBusCallFlags,
        _timeout: number,
        _cancellable: Gio.Cancellable | null,
        callback: (source: FakeProxy, result: object) => void
    ) {
        this.methods.push(method);
        this.history.push(`${this.name}:${method}`);
        const result = {};
        const call: FakeCall = {
            method,
            complete: (error) => {
                this.#results.set(result, {
                    value:
                        method === 'GetDevices'
                            ? GLib.Variant.new('(ao)', [[this.devicePath]])
                            : GLib.Variant.new('()', []),
                    error: error ?? null,
                });
                callback(this, result);
            },
        };

        const waiters = this.#waiters.get(method);
        if (waiters?.length) waiters.shift()?.(call);
        if (this.#heldMethods.delete(method)) {
            this.#pending.push(call);
            return;
        }
        const failures = this.#failures.get(method);
        call.complete(failures?.shift());
    }

    call_finish(result: object) {
        const response = this.#results.get(result);
        if (!response) throw new Error('fake D-Bus result was not recorded');
        if (response.error) throw response.error;
        return response.value;
    }

    connect(_signal: string, callback: FakeSignal) {
        const id = this.#nextSignalId++;
        this.#signals.set(id, callback);
        return id;
    }

    disconnect(id: number) {
        this.#signals.delete(id);
    }

    holdNext(method: string) {
        this.#heldMethods.add(method);
    }

    failNext(method: string, error: Error) {
        const failures = this.#failures.get(method) ?? [];
        failures.push(error);
        this.#failures.set(method, failures);
    }

    waitForCall(method: string): Promise<FakeCall> {
        const {promise, resolve} = Promise.withResolvers<FakeCall>();
        const waiters = this.#waiters.get(method) ?? [];
        waiters.push(resolve);
        this.#waiters.set(method, waiters);
        return promise;
    }

    completeNext(method: string, error?: Error) {
        const index = this.#pending.findIndex((call) => call.method === method);
        if (index < 0) throw new Error(`no held fake ${method} call`);
        this.#pending.splice(index, 1)[0]?.complete(error);
    }

    signalHandler(id: number) {
        return this.#signals.get(id);
    }

    emitStatus(status: string, done: boolean) {
        const params = GLib.Variant.new('(sb)', [status, done]);
        for (const callback of this.#signals.values()) {
            callback(this, null, 'VerifyStatus', params);
        }
    }
}

function makeFingerprint(history: string[] = []) {
    const manager = new FakeProxy('manager', DEVICE_PATH, history);
    const device = new FakeProxy('device', DEVICE_PATH, history);
    const fingerprint = new FingerprintAuth({
        proxyFactory: async (path) =>
            (path === MANAGER_PATH ? manager : device) as unknown as Gio.DBusProxy,
    });
    return {fingerprint, manager, device, history};
}

async function initialize(fingerprint: FingerprintAuth) {
    await fingerprint.init();
    expect(fingerprint.available).toBe(true);
}

function delay(ms: number): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
    return promise;
}

describe('FingerprintAuth operation lifecycle', () => {
    it.async('drains a pending claim before rearming after stop', async () => {
        const {fingerprint, device} = makeFingerprint();
        await initialize(fingerprint);
        device.holdNext('Claim');
        const firstClaim = device.waitForCall('Claim');
        const nextVerify = device.waitForCall('VerifyStart');

        fingerprint.start();
        const pendingClaim = await firstClaim;
        fingerprint.stop();
        fingerprint.start();
        pendingClaim.complete();
        await nextVerify;

        expect(device.methods).toEqual([
            'Claim',
            'VerifyStop',
            'Release',
            'Claim',
            'VerifyStart',
        ]);
        const stopCall = device.waitForCall('VerifyStop');
        const releaseCall = device.waitForCall('Release');
        fingerprint.stop();
        await Promise.all([stopCall, releaseCall]);
    });

    it.async('rejects a retired verification handler after a new verification starts', async () => {
        const {fingerprint, device} = makeFingerprint();
        await initialize(fingerprint);
        const firstVerify = device.waitForCall('VerifyStart');
        fingerprint.start();
        await firstVerify;
        const oldHandler = device.signalHandler(1);
        expect(oldHandler).toBeDefined();

        const firstStop = device.waitForCall('VerifyStop');
        const firstRelease = device.waitForCall('Release');
        const secondVerify = device.waitForCall('VerifyStart');
        fingerprint.stop();
        fingerprint.start();
        await Promise.all([firstStop, firstRelease, secondVerify]);

        let verified = 0;
        GObject.signal_connect(fingerprint, 'verified', () => verified++);
        const oldStatus = GLib.Variant.new('(sb)', ['verify-match', true]);
        oldHandler?.(device, null, 'VerifyStatus', oldStatus);
        expect(verified).toBe(0);

        const terminalStop = device.waitForCall('VerifyStop');
        const terminalRelease = device.waitForCall('Release');
        device.emitStatus('verify-match', true);
        await Promise.all([terminalStop, terminalRelease]);
        expect(verified).toBe(1);
        expect(device.methods).toEqual([
            'Claim',
            'VerifyStart',
            'VerifyStop',
            'Release',
            'Claim',
            'VerifyStart',
            'VerifyStop',
            'Release',
        ]);
    });

    it.async('queues terminal teardown behind VerifyStart acknowledgement', async () => {
        const {fingerprint, device} = makeFingerprint();
        await initialize(fingerprint);
        device.holdNext('VerifyStart');
        const verifyStart = device.waitForCall('VerifyStart');
        fingerprint.start();
        const pendingVerify = await verifyStart;
        let verified = 0;
        GObject.signal_connect(fingerprint, 'verified', () => verified++);
        const verifyStop = device.waitForCall('VerifyStop');
        const release = device.waitForCall('Release');

        device.emitStatus('verify-match', true);
        expect(verified).toBe(1);
        expect(device.methods).toEqual(['Claim', 'VerifyStart']);
        pendingVerify.complete();
        await Promise.all([verifyStop, release]);

        expect(device.methods).toEqual(['Claim', 'VerifyStart', 'VerifyStop', 'Release']);
    });

    it.async('retries a no-match only after teardown is acknowledged', async () => {
        const {fingerprint, device} = makeFingerprint();
        await initialize(fingerprint);
        const firstVerify = device.waitForCall('VerifyStart');
        fingerprint.start();
        await firstVerify;

        device.holdNext('Release');
        const verifyStop = device.waitForCall('VerifyStop');
        const pendingRelease = device.waitForCall('Release');
        const retryClaim = device.waitForCall('Claim');
        device.emitStatus('verify-no-match', true);
        await Promise.all([verifyStop, pendingRelease]);

        expect(device.methods).toEqual(['Claim', 'VerifyStart', 'VerifyStop', 'Release']);
        const retryVerify = device.waitForCall('VerifyStart');
        device.completeNext('Release');
        await delay(600);
        await Promise.all([retryClaim, retryVerify]);
        expect(device.methods).toEqual([
            'Claim',
            'VerifyStart',
            'VerifyStop',
            'Release',
            'Claim',
            'VerifyStart',
        ]);

        const finalStop = device.waitForCall('VerifyStop');
        const finalRelease = device.waitForCall('Release');
        fingerprint.stop();
        await Promise.all([finalStop, finalRelease]);
    });

    it.async('requires a fresh acknowledged teardown after cleanup failure', async () => {
        const {fingerprint, device} = makeFingerprint();
        await initialize(fingerprint);
        const verifyStart = device.waitForCall('VerifyStart');
        fingerprint.start();
        await verifyStart;

        device.failNext('VerifyStop', new Error('temporary D-Bus failure'));
        const firstStop = device.waitForCall('VerifyStop');
        const firstRelease = device.waitForCall('Release');
        const secondStop = device.waitForCall('VerifyStop');
        const secondRelease = device.waitForCall('Release');
        const nextClaim = device.waitForCall('Claim');
        const nextVerify = device.waitForCall('VerifyStart');
        fingerprint.stop();
        fingerprint.start();
        await Promise.all([
            firstStop,
            firstRelease,
            secondStop,
            secondRelease,
            nextClaim,
            nextVerify,
        ]);

        expect(device.methods).toEqual([
            'Claim',
            'VerifyStart',
            'VerifyStop',
            'Release',
            'VerifyStop',
            'Release',
            'Claim',
            'VerifyStart',
        ]);

        const finalStop = device.waitForCall('VerifyStop');
        const finalRelease = device.waitForCall('Release');
        fingerprint.stop();
        await Promise.all([finalStop, finalRelease]);
    });

    it.async('does not revive an instance disposed during proxy initialization', async () => {
        const manager = new FakeProxy('manager', DEVICE_PATH);
        const {promise, resolve} = Promise.withResolvers<Gio.DBusProxy>();
        let requested = 0;
        const fingerprint = new FingerprintAuth({
            proxyFactory: (path) => {
                requested++;
                return path === MANAGER_PATH
                    ? promise
                    : Promise.resolve(manager as unknown as Gio.DBusProxy);
            },
        });
        const initialization = fingerprint.init();

        fingerprint.dispose();
        resolve(manager as unknown as Gio.DBusProxy);
        await initialization;

        expect(requested).toBe(1);
        expect(fingerprint.available).toBe(false);
        expect(manager.methods).toEqual([]);
    });

    it.async('serializes old-instance cleanup before a replacement instance claims', async () => {
        const history: string[] = [];
        const old = makeFingerprint(history);
        await initialize(old.fingerprint);
        old.device.holdNext('Claim');
        const oldClaim = old.device.waitForCall('Claim');
        old.fingerprint.start();
        const pendingClaim = await oldClaim;
        old.fingerprint.dispose();

        const replacement = makeFingerprint(history);
        await initialize(replacement.fingerprint);
        const replacementVerify = replacement.device.waitForCall('VerifyStart');
        replacement.fingerprint.start();
        pendingClaim.complete();
        await replacementVerify;

        const oldClaimIndex = history.indexOf('device:Claim');
        const oldVerifyStopIndex = history.indexOf('device:VerifyStop');
        const oldReleaseIndex = history.indexOf('device:Release');
        const replacementClaimIndex = history.lastIndexOf('device:Claim');
        const replacementVerifyIndex = history.lastIndexOf('device:VerifyStart');
        expect(oldClaimIndex).toBeLessThan(oldVerifyStopIndex);
        expect(oldVerifyStopIndex).toBeLessThan(oldReleaseIndex);
        expect(oldReleaseIndex).toBeLessThan(replacementClaimIndex);
        expect(replacementClaimIndex).toBeLessThan(replacementVerifyIndex);

        const finalStop = replacement.device.waitForCall('VerifyStop');
        const finalRelease = replacement.device.waitForCall('Release');
        replacement.fingerprint.stop();
        await Promise.all([finalStop, finalRelease]);
    });
});

await run(import.meta.url);
