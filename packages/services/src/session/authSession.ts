import AstalAuth from 'gi://AstalAuth?version=0.1';
import GObject from 'gi://GObject?version=2.0';
import logger from '@shade/core/logger';
import {Timeout} from '@shade/core/timeout';
import {Object, property, register, signal} from 'gnim/gobject';
import Brightness from '../display/brightness';
import FingerprintAuth from '../input/fingerprint';

const PAM_TIMEOUT_MS = 10000;

/**
 * Encapsulates lock-screen authentication lifecycle:
 * PAM password auth, fingerprint auth, and brightness save/restore.
 *
 * Widgets create an instance, call submitPassword(), and listen for
 * signals — no direct PAM/fingerprint/brightness logic in UI code.
 */
@register
export default class AuthSession extends Object {
    #pam: AstalAuth.Pam;
    #pamActive = false;
    #disposed = false;
    #pendingPassword = '';
    #pamTimeout = new Timeout();
    #pamSignalIds: number[] = [];
    #fingerprint: FingerprintAuth;
    #fpSignalIds: number[] = [];
    #savedBrightness = -1;
    #initialized = false;
    #authStatus = '';

    /** Human-readable auth status for UI display. */
    @property
    get authStatus() {
        return this.#authStatus;
    }

    set authStatus(v: string) {
        this.#authStatus = v;
        this.notify('auth-status');
    }

    constructor() {
        super();
        this.#pam = new AstalAuth.Pam();
        this.#fingerprint = FingerprintAuth.get_default();
    }

    // ── Signals ──

    @signal
    success(): void {}

    @signal
    fail(_reason: string): void {}

    /** Called when authentication process fully completes (success or fatal). */
    #complete() {
        this.#disconnectPam();
        this.#disconnectFingerprint();
        this.#pamTimeout.cancel();
        this.#restoreBrightness();
    }

    // ── PAM auth ──

    #setupPam() {
        const onSuccess = () => {
            if (!this.#pamActive || this.#disposed) return;
            this.#pamActive = false;
            this.#pendingPassword = '';
            this.#complete();
            this.success();
        };

        const onFail = (_pam: AstalAuth.Pam, msg: string) => {
            if (!this.#pamActive || this.#disposed) return;
            this.#pamActive = false;
            this.#pendingPassword = '';
            this.#pamTimeout.cancel();
            logger.debug('auth', 'PAM auth failed:', msg);
            this.authStatus = 'Authentication failed';
        };

        const onError = (_pam: AstalAuth.Pam, msg: string) => {
            if (!this.#pamActive || this.#disposed) return;
            this.#pamActive = false;
            this.#pendingPassword = '';
            this.#pamTimeout.cancel();
            logger.debug('auth', 'PAM auth error:', msg);
            this.authStatus = msg || 'Authentication error';
            try {
                this.#pam.supply_secret(null);
            } catch (e) {
                logger.debug('auth', 'could not clear PAM secret after auth error:', e);
            }
        };

        this.#pamSignalIds = [
            this.#pam.connect('auth-prompt-hidden', () => {
                if (!this.#pamActive || this.#disposed) return;
                this.#pam.supply_secret(this.#pendingPassword);
            }),
            this.#pam.connect('success', onSuccess),
            this.#pam.connect('fail', onFail),
            this.#pam.connect('auth-error', onError),
        ];
    }

    #disconnectPam() {
        for (const id of this.#pamSignalIds) {
            try {
                this.#pam.disconnect(id);
            } catch {
                /* ignore */
            }
        }
        this.#pamSignalIds = [];
    }

    /** Attempt unlock with a password. */
    submitPassword(password: string) {
        if (this.#pamActive || this.#disposed) return;
        this.#pendingPassword = password;
        this.authStatus = 'Authenticating...';
        this.#pamActive = true;
        // Watchdog is started before PAM in case a terminal signal arrives synchronously.
        this.#pamTimeout.start(PAM_TIMEOUT_MS, () => {
            if (!this.#pamActive || this.#disposed) return;
            // This only updates the UI; PAM remains active until a terminal signal.
            this.authStatus = 'Authentication is taking longer…';
        });
        this.#pam.start_authenticate();
    }

    // ── Fingerprint ──

    #setupFingerprint() {
        this.#fingerprint.init().then(() => {
            if (this.#fingerprint.available) {
                this.#fingerprint.start();
            }
        });

        const onVerified = () => {
            this.#complete();
            this.success();
        };

        const onStatus = (_fp: FingerprintAuth, status: string) => {
            if (status === 'verify-no-match') {
                this.authStatus = 'Fingerprint did not match, retrying...';
            } else if (status === 'verify-retry' || status === 'verify-swipe-too-short') {
                this.authStatus = 'Try again...';
            }
        };

        this.#fpSignalIds = [
            GObject.signal_connect(
                this.#fingerprint,
                'verified',
                (_source: FingerprintAuth, ..._args: unknown[]) => {
                    onVerified();
                }
            ),
            GObject.signal_connect(
                this.#fingerprint,
                'status-changed',
                (_source: FingerprintAuth, ...args: unknown[]) => {
                    onStatus(_source, args.length > 0 ? String(args[0]) : '');
                }
            ),
        ];
    }

    #disconnectFingerprint() {
        this.#fingerprint.stop();
        for (const id of this.#fpSignalIds) {
            try {
                this.#fingerprint.disconnect(id);
            } catch {
                /* ignore */
            }
        }
        this.#fpSignalIds = [];
    }

    // ── Brightness ──

    #saveBrightness() {
        try {
            this.#savedBrightness = Brightness.get_default().screen;
        } catch (e) {
            logger.warn('auth', 'could not save brightness:', e);
            this.#savedBrightness = -1;
        }
    }

    #restoreBrightness() {
        if (this.#savedBrightness < 0) return;
        try {
            Brightness.get_default().screen = this.#savedBrightness;
        } catch (e) {
            logger.warn('auth', 'failed to restore brightness:', e);
        }
    }

    // ── Public lifecycle ──

    /** Start the auth session: save brightness, connect PAM + fingerprint. */
    async start(): Promise<void> {
        if (this.#initialized || this.#disposed) return;
        this.#initialized = true;
        this.#saveBrightness();
        this.#setupPam();
        this.#setupFingerprint();
    }

    /** Cancel/cleanup the auth session. Safe to call multiple times. */
    cancel(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#pendingPassword = '';
        if (this.#pamActive) {
            try {
                this.#pam.supply_secret(null);
            } catch (e) {
                logger.debug('auth', 'could not clear secret while disposing PAM prompt:', e);
            }
        }
        // AstalAuth exposes no conversation cancellation. Keep #pamActive truthful;
        // disposal only stops this session from submitting secrets or handling events.
        this.#complete();
    }
}
