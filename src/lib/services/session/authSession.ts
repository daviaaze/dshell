import AstalAuth from 'gi://AstalAuth?version=0.1';
import {Object, register, signal, property} from 'gnim/gobject';
import {Timeout} from '#/lib/core/timeout';
import logger from '#/lib/core/logger';
import Brightness from '#/lib/services/display/brightness';
import FingerprintAuth from '#/lib/services/input/fingerprint';

const PAM_TIMEOUT_MS = 10000;

/**
 * Encapsulates lock-screen authentication lifecycle:
 * PAM password auth, fingerprint auth, and brightness save/restore.
 *
 * Widgets create an instance, call submitPassword(), and listen for
 * signals — no direct PAM/fingerprint/brightness logic in UI code.
 */
@register({GTypeName: 'AuthSession'})
export default class AuthSession extends Object {
    #pam: AstalAuth.Pam;
    #pamActive = false;
    #pendingPassword = '';
    #pamTimeout = new Timeout();
    #pamSignalIds: number[] = [];
    #fingerprint: FingerprintAuth;
    #fpSignalIds: number[] = [];
    #savedBrightness = -1;
    #initialized = false;
    #authStatus = '';

    /** Human-readable auth status for UI display. */
    @property(String)
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

    @signal([])
    success(): void {}

    @signal([String])
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
            if (!this.#pamActive) return;
            this.#pamActive = false;
            this.#pamTimeout.cancel();
            this.#complete();
            this.success();
        };

        const onFail = (_pam: AstalAuth.Pam, msg: string) => {
            if (!this.#pamActive) return;
            this.#pamActive = false;
            this.#pamTimeout.cancel();
            logger.debug('auth', 'PAM auth failed:', msg);
            this.authStatus = 'Authentication failed';
        };

        const onError = (_pam: AstalAuth.Pam, msg: string) => {
            if (!this.#pamActive) return;
            this.#pamActive = false;
            this.#pamTimeout.cancel();
            logger.debug('auth', 'PAM auth error:', msg);
            this.authStatus = msg || 'Authentication error';
            this.#pam.supply_secret(null);
        };

        this.#pamSignalIds = [
            this.#pam.connect('auth-prompt-hidden', () => {
                this.#pam.supply_secret(this.#pendingPassword);
            }),
            this.#pam.connect('success', onSuccess),
            this.#pam.connect('fail', onFail),
            this.#pam.connect('auth-error', onError),
        ];
    }

    #disconnectPam() {
        for (const id of this.#pamSignalIds) {
            try { this.#pam.disconnect(id); } catch { /* ignore */ }
        }
        this.#pamSignalIds = [];
    }

    /** Attempt unlock with a password. */
    submitPassword(password: string) {
        if (this.#pamActive) return;
        this.#pendingPassword = password;
        this.authStatus = 'Authenticating...';
        this.#pamActive = true;
        this.#pam.start_authenticate();

        this.#pamTimeout.start(PAM_TIMEOUT_MS, () => {
            this.#pamActive = false;
            this.authStatus = 'Authentication timed out';
        });
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
            } else if (
                status === 'verify-retry' ||
                status === 'verify-swipe-too-short'
            ) {
                this.authStatus = 'Try again...';
            }
        };

        this.#fpSignalIds = [
            this.#fingerprint.connect('verified' as any, onVerified as any),
            this.#fingerprint.connect('status-changed' as any, onStatus as any),
        ];
    }

    #disconnectFingerprint() {
        this.#fingerprint.stop();
        for (const id of this.#fpSignalIds) {
            try { this.#fingerprint.disconnect(id); } catch { /* ignore */ }
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
        if (this.#initialized) return;
        this.#initialized = true;
        this.#saveBrightness();
        this.#setupPam();
        this.#setupFingerprint();
    }

    /** Cancel/cleanup the auth session. Safe to call multiple times. */
    cancel(): void {
        this.#disconnectPam();
        this.#disconnectFingerprint();
        this.#pamTimeout.cancel();
        this.#restoreBrightness();
    }
}
