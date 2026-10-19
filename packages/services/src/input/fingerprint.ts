import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {property} from '@shade/core/decorators';
import logger from '@shade/core/logger';
import {Object, register, signal} from 'gnim/gobject';

const FPRINTD_SERVICE = 'net.reactivated.Fprint';
const FPRINTD_MANAGER = '/net/reactivated/Fprint/Manager';
const MAX_RETRIES = 3;

const DBUS_TIMEOUT_MS = 2000;
const CLEANUP_TIMEOUT_MS = 1000;

type FingerprintState = 'idle' | 'initializing' | 'verifying' | 'error';

type ProxyFactory = (objectPath: string, interfaceName: string) => Promise<Gio.DBusProxy>;

export interface FingerprintAuthOptions {
    proxyFactory?: ProxyFactory;
}

interface ActiveVerification {
    generation: number;
    proxy: Gio.DBusProxy;
    signalId: number;
}

// fprintd claims are process-wide; serialize operations even across singleton replacement.
let deviceOperationQueue: Promise<void> = Promise.resolve();
// A timed-out call leaves remote state unknown until stop and release both acknowledge.
let deviceNeedsReset = false;
let deviceNeedsResetProxy: Gio.DBusProxy | null = null;

function enqueueDeviceOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = deviceOperationQueue.then(operation, operation);
    deviceOperationQueue = pending.then(
        () => undefined,
        () => undefined
    );
    return pending;
}

function isRemoteFprintError(error: unknown, code: string) {
    try {
        return (
            Gio.DBusError.get_remote_error(error as GLib.Error) ===
            `net.reactivated.Fprint.Error.${code}`
        );
    } catch {
        return false;
    }
}

@register
export default class FingerprintAuth extends Object {
    private static instance: FingerprintAuth | null = null;

    static get_default() {
        if (!FingerprintAuth.instance) FingerprintAuth.instance = new FingerprintAuth();
        return FingerprintAuth.instance;
    }

    #available = false;
    #state: FingerprintState = 'idle';
    #errorMessage = '';
    #deviceProxy: Gio.DBusProxy | null;
    #initialized = false;
    #consecutiveFailures = 0;
    #disposed = false;
    #initGeneration = 0;
    #verifyGeneration = 0;
    #retrySource = 0;
    #initPromise: Promise<void> | null;
    #activeVerification: ActiveVerification | null;
    #proxyFactory: ProxyFactory;

    constructor(options: FingerprintAuthOptions = {}) {
        super();
        this.#deviceProxy = null;
        this.#initPromise = null;
        this.#activeVerification = null;
        this.#proxyFactory =
            options.proxyFactory ?? ((path, interfaceName) => this.#getProxy(path, interfaceName));
    }

    @property
    get available() {
        return this.#available;
    }

    dispose() {
        if (this.#disposed) return;
        this.stop();
        this.#disposed = true;
        this.#initGeneration++;
        this.#initialized = false;
        this.#initPromise = null;
        this.#deviceProxy = null;
        if (this.#available) {
            this.#available = false;
            this.notify('available');
        }
        if (this.#errorMessage) {
            this.#errorMessage = '';
            this.notify('error-message');
        }
        this.#setState('idle');
        if (FingerprintAuth.instance === this) FingerprintAuth.instance = null;
    }

    @property
    get state() {
        return this.#state;
    }

    @property
    get errorMessage() {
        return this.#errorMessage;
    }

    @property
    get verifying() {
        return this.#state === 'verifying';
    }

    @signal
    verified(): void {}

    @signal
    failed(_reason: string): void {}

    @signal
    statusChanged(_status: string): void {}

    #setState(state: FingerprintState) {
        if (this.#state === state) return;
        this.#state = state;
        this.notify('state');
        this.notify('verifying');
    }

    #setError(message: string) {
        this.#errorMessage = message;
        this.notify('error-message');
        this.#setState('error');
    }

    #call(
        proxy: Gio.DBusProxy,
        method: string,
        parameters: GLib.Variant | null,
        timeoutMs: number
    ): Promise<GLib.Variant> {
        const {promise, resolve, reject} = Promise.withResolvers<GLib.Variant>();
        try {
            proxy.call(
                method,
                parameters,
                Gio.DBusCallFlags.NONE,
                timeoutMs,
                null,
                (_, result) => {
                    try {
                        resolve(proxy.call_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        } catch (e) {
            reject(e);
        }
        return promise;
    }

    #isCurrentInit(generation: number) {
        return !this.#disposed && this.#initGeneration === generation;
    }

    #isCurrentGeneration(generation: number, proxy: Gio.DBusProxy) {
        return (
            !this.#disposed &&
            this.#verifyGeneration === generation &&
            this.#deviceProxy === proxy
        );
    }

    #isActiveVerification(verification: ActiveVerification) {
        return (
            !this.#disposed &&
            this.#activeVerification === verification &&
            this.#verifyGeneration === verification.generation &&
            this.#deviceProxy === verification.proxy
        );
    }

    async init() {
        if (this.#disposed || this.#initialized) return;
        if (this.#initPromise) return this.#initPromise;

        const generation = ++this.#initGeneration;
        const pending = this.#initialize(generation);
        this.#initPromise = pending;
        try {
            await pending;
        } finally {
            if (this.#initPromise === pending) this.#initPromise = null;
        }
    }

    async #initialize(generation: number) {
        try {
            const manager = await this.#proxyFactory(
                FPRINTD_MANAGER,
                'net.reactivated.Fprint.Manager'
            );
            if (!this.#isCurrentInit(generation)) return;

            const result = await this.#call(manager, 'GetDevices', null, DBUS_TIMEOUT_MS);
            if (!this.#isCurrentInit(generation)) return;
            const devices = result.get_child_value(0);
            if (!devices || devices.n_children() === 0) {
                if (this.#available) {
                    this.#available = false;
                    this.notify('available');
                }
                return;
            }

            const devicePath = devices.get_child_value(0).get_string()[0];
            const proxy = await this.#proxyFactory(devicePath, 'net.reactivated.Fprint.Device');
            if (!this.#isCurrentInit(generation)) return;

            this.#deviceProxy = proxy;
            this.#initialized = true;
            if (!this.#available) {
                this.#available = true;
                this.notify('available');
            }
        } catch (e) {
            if (!this.#isCurrentInit(generation)) return;
            logger.warn('fingerprint', 'init failed:', e);
            if (this.#available) {
                this.#available = false;
                this.notify('available');
            }
        }
    }

    #connectVerification(generation: number, proxy: Gio.DBusProxy) {
        const verification: ActiveVerification = {
            generation,
            proxy,
            signalId: 0,
        };
        verification.signalId = proxy.connect(
            'g-signal',
            (_proxy, _sender, signalName, params) => {
                if (!this.#isActiveVerification(verification) || signalName !== 'VerifyStatus') {
                    return;
                }
                const status = params.get_child_value(0).get_string()[0];
                const done = params.get_child_value(1).get_boolean();
                this.statusChanged(status);
                if (done) this.#handleVerifyDone(verification, status);
            }
        );
        this.#activeVerification = verification;
        return verification;
    }

    #disconnectVerification(verification = this.#activeVerification) {
        if (!verification || this.#activeVerification !== verification) return;
        this.#activeVerification = null;
        try {
            verification.proxy.disconnect(verification.signalId);
        } catch {
            /* ignore */
        }
    }

    #retireVerification(verification: ActiveVerification) {
        if (!this.#isActiveVerification(verification)) return false;
        this.#disconnectVerification(verification);
        this.#verifyGeneration++;
        if (this.#state === 'verifying' || this.#state === 'initializing') {
            this.#setState('idle');
        }
        return true;
    }

    #handleVerifyDone(verification: ActiveVerification, status: string) {
        if (!this.#retireVerification(verification)) return;
        const generation = this.#verifyGeneration;
        const cleanup = this.#queueTeardown(verification.proxy);

        if (status === 'verify-match') {
            this.#consecutiveFailures = 0;
            this.verified();
            void cleanup.catch((e) => this.#cleanupFailed(e));
            return;
        }

        if (status === 'verify-no-match') {
            this.#consecutiveFailures++;
            if (this.#consecutiveFailures >= MAX_RETRIES) {
                this.#setError('Too many fingerprint attempts');
                this.failed('too-many-retries');
                void cleanup.catch((e) => this.#cleanupFailed(e));
                return;
            }
            this.#scheduleRetry(generation, verification.proxy, cleanup);
            return;
        }

        this.#setError(`Fingerprint error: ${status}`);
        this.failed(status);
        void cleanup.catch((e) => this.#cleanupFailed(e));
    }

    #scheduleRetry(
        generation: number,
        proxy: Gio.DBusProxy,
        cleanup: Promise<void>
    ) {
        void cleanup
            .then(() => {
                if (
                    !this.#isCurrentGeneration(generation, proxy) ||
                    this.#state !== 'idle'
                ) {
                    return;
                }
                this.#retrySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this.#retrySource = 0;
                    if (
                        this.#isCurrentGeneration(generation, proxy) &&
                        this.#state === 'idle'
                    ) {
                        this.start();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            })
            .catch((e) => this.#cleanupFailed(e));
    }

    async #teardownDevice(proxy: Gio.DBusProxy): Promise<void> {
        if (!deviceNeedsReset) return;
        const resetProxy = deviceNeedsResetProxy ?? proxy;

        let stopFailure: unknown = null;
        try {
            await this.#call(resetProxy, 'VerifyStop', null, CLEANUP_TIMEOUT_MS);
        } catch (e) {
            if (
                !isRemoteFprintError(e, 'NoActionInProgress') &&
                !isRemoteFprintError(e, 'ClaimDevice')
            ) {
                stopFailure = e;
            }
        }

        let releaseFailure: unknown = null;
        try {
            await this.#call(resetProxy, 'Release', null, CLEANUP_TIMEOUT_MS);
        } catch (e) {
            if (!isRemoteFprintError(e, 'ClaimDevice')) releaseFailure = e;
        }

        if (stopFailure || releaseFailure) {
            deviceNeedsReset = true;
            deviceNeedsResetProxy = resetProxy;
            throw stopFailure ?? releaseFailure;
        }
        deviceNeedsReset = false;
        deviceNeedsResetProxy = null;
    }

    #queueTeardown(proxy: Gio.DBusProxy): Promise<void> {
        return enqueueDeviceOperation(() => this.#teardownDevice(proxy));
    }

    #cleanupFailed(error: unknown) {
        logger.warn('fingerprint', 'device cleanup failed:', error);
        if (this.#disposed || this.#state === 'error') return;
        this.#setError('Fingerprint device cleanup failed');
        this.failed('cleanup-failed');
    }

    start() {
        if (
            this.#disposed ||
            !this.#available ||
            !this.#deviceProxy ||
            this.#state === 'initializing' ||
            this.#state === 'verifying'
        ) {
            return;
        }

        const proxy = this.#deviceProxy;
        const generation = ++this.#verifyGeneration;
        this.#setState('initializing');
        void enqueueDeviceOperation(async () => {
            if (!this.#isCurrentGeneration(generation, proxy)) return;
            if (deviceNeedsReset) await this.#teardownDevice(proxy);
            if (!this.#isCurrentGeneration(generation, proxy)) return;

            deviceNeedsReset = true;
            deviceNeedsResetProxy = proxy;
            await this.#call(
                proxy,
                'Claim',
                GLib.Variant.new('(s)', [GLib.get_user_name()]),
                DBUS_TIMEOUT_MS
            );
            if (!this.#isCurrentGeneration(generation, proxy)) return;

            this.#setState('verifying');
            const verification = this.#connectVerification(generation, proxy);
            await this.#call(
                proxy,
                'VerifyStart',
                GLib.Variant.new('(s)', ['']),
                DBUS_TIMEOUT_MS
            );
            if (!this.#isActiveVerification(verification)) return;
        }).catch((e) => {
            if (!this.#isCurrentGeneration(generation, proxy)) return;
            this.#disconnectVerification();
            this.#verifyGeneration++;
            deviceNeedsReset = true;
            logger.warn('fingerprint', 'start failed:', e);
            this.#setError(`Fingerprint device error: ${String(e)}`);
            this.failed(String(e));
            void this.#queueTeardown(proxy).catch((cleanupError) =>
                this.#cleanupFailed(cleanupError)
            );
        });
    }

    retry() {
        if (this.#disposed || this.#state !== 'error') return;
        // Keep the failure count so dismissing the error cannot reset retries.
        this.#errorMessage = '';
        this.notify('error-message');
        this.#setState('idle');
        this.start();
    }

    stop() {
        if (this.#disposed) return;
        this.#verifyGeneration++;
        this.#disconnectVerification();
        if (this.#retrySource !== 0) {
            GLib.source_remove(this.#retrySource);
            this.#retrySource = 0;
        }

        if (this.#state === 'verifying' || this.#state === 'initializing') {
            this.#setState('idle');
        }
        const proxy = this.#deviceProxy;
        if (proxy && deviceNeedsReset) {
            void this.#queueTeardown(proxy).catch((e) => this.#cleanupFailed(e));
        }
    }

    async #getProxy(objectPath: string, interfaceName: string): Promise<Gio.DBusProxy> {
        const {promise, resolve, reject} = Promise.withResolvers<Gio.DBusProxy>();
        try {
            Gio.DBusProxy.new_for_bus(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.NONE,
                null,
                FPRINTD_SERVICE,
                objectPath,
                interfaceName,
                null,
                (_, res) => {
                    try {
                        resolve(Gio.DBusProxy.new_for_bus_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        } catch (e) {
            reject(e);
        }
        return promise;
    }
}
