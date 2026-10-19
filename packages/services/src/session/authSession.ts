import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import logger from '@shade/core/logger';
import {Timeout} from '@shade/core/timeout';
import {Object, property, register, signal} from 'gnim/gobject';
import Brightness from '../display/brightness';
import FingerprintAuth from '../input/fingerprint';

const PAM_TIMEOUT_MS = 10000;

const PASSWORD_ENCODER = new TextEncoder();
const WORKER_OUTPUT_DECODER = new TextDecoder();
export type PasswordWorker = (
    password: string,
    complete: (authenticated: boolean) => void
) => () => void;

export interface AuthSessionOptions {
    fingerprint?: FingerprintAuth;
    passwordWorker?: PasswordWorker;
    timeoutMs?: number;
}

interface ActiveAttempt {
    generation: number;
    cancel: () => void;
}

function startPamWorker(password: string, complete: (authenticated: boolean) => void): () => void {
    const developmentWorker =
        import.meta.bindir === '/usr/local/bin'
            ? GLib.getenv('SHADE_AUTH_WORKER_DEV_PATH')
            : null;
    const workerPath = developmentWorker ?? `${import.meta.bindir}/shade-shell-auth-worker`;
    let process: Gio.Subprocess;

    try {
        process = Gio.Subprocess.new(
            [workerPath],
            Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        logger.error('auth', 'could not start PAM worker:', e);
        complete(false);
        return () => {};
    }

    let cancelled = false;
    const communication = new Gio.Cancellable();
    try {
        const input = new GLib.Bytes(
            PASSWORD_ENCODER.encode(JSON.stringify({password}) + '\n')
        );
        process.communicate_async(input, communication, (_, res) => {
            try {
                const [, stdout] = process.communicate_finish(res);
                const result = stdout
                    ? WORKER_OUTPUT_DECODER.decode(stdout.toArray()).trim()
                    : '';
                if (!cancelled) complete(process.get_successful() && result === 'success');
            } catch {
                if (!cancelled) complete(false);
            }
        });
    } catch (e) {
        cancelled = true;
        process.force_exit();
        communication.cancel();
        logger.error('auth', 'could not communicate with PAM worker:', e);
        complete(false);
    }

    return () => {
        cancelled = true;
        // force_exit() is safe after completion; exit-status getters require a completed wait.
        process.force_exit();
        // A PAM module may fork a child holding the pipes after its worker is killed.
        communication.cancel();
    };
}

/**
 * Encapsulates lock-screen authentication lifecycle:
 * isolated PAM password attempts, fingerprint auth, and brightness save/restore.
 *
 * Widgets create an instance, call submitPassword(), and listen for signals;
 * password prompts run in a killable helper so a stuck PAM stack is recoverable.
 */
@register
export default class AuthSession extends Object {
    #disposed = false;
    #completed = false;
    #activeAttempt: ActiveAttempt | null;
    #attemptGeneration = 0;
    #pamTimeout: Timeout;
    #pamTimeoutMs: number;
    #passwordWorker: PasswordWorker;
    #fingerprint: FingerprintAuth;
    #fpSignalIds: number[];
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

    constructor(options: AuthSessionOptions = {}) {
        super();
        this.#activeAttempt = null;
        this.#pamTimeout = new Timeout();
        this.#pamTimeoutMs = options.timeoutMs ?? PAM_TIMEOUT_MS;
        this.#passwordWorker = options.passwordWorker ?? startPamWorker;
        this.#fingerprint = options.fingerprint ?? FingerprintAuth.get_default();
        this.#fpSignalIds = [];
    }

    // ── Signals ──

    @signal
    success(): void {}

    @signal
    fail(_reason: string): void {}

    /** Retire a password attempt before any terminal callback can affect the session. */
    #retireAttempt(attempt: ActiveAttempt | null) {
        this.#pamTimeout.cancel();
        if (!attempt || this.#activeAttempt !== attempt) return;

        this.#activeAttempt = null;
        this.#attemptGeneration++;
        try {
            attempt.cancel();
        } catch (e) {
            logger.debug('auth', 'could not stop PAM worker:', e);
        }
    }

    #isCurrentAttempt(attempt: ActiveAttempt) {
        return (
            !this.#disposed &&
            !this.#completed &&
            this.#activeAttempt === attempt &&
            this.#attemptGeneration === attempt.generation
        );
    }

    /** Called when authentication process fully completes. */
    #complete() {
        if (this.#completed) return;
        this.#completed = true;
        this.#retireAttempt(this.#activeAttempt);
        this.#disconnectFingerprint();
        this.#restoreBrightness();
    }

    /** Attempt unlock with a password. */
    submitPassword(password: string): boolean {
        if (!this.#initialized || this.#activeAttempt || this.#disposed || this.#completed) {
            return false;
        }

        const generation = ++this.#attemptGeneration;
        const attempt: ActiveAttempt = {generation, cancel: () => {}};
        this.#activeAttempt = attempt;
        this.authStatus = 'Authenticating...';
        this.#pamTimeout.start(this.#pamTimeoutMs, () => {
            if (!this.#isCurrentAttempt(attempt)) return;
            this.#retireAttempt(attempt);
            this.authStatus = 'Authentication timed out. Try again.';
        });

        try {
            const cancel = this.#passwordWorker(password, (authenticated) => {
                if (!this.#isCurrentAttempt(attempt)) return;
                this.#retireAttempt(attempt);
                if (authenticated) {
                    this.#complete();
                    this.success();
                } else {
                    this.authStatus = 'Authentication failed';
                }
            });
            if (this.#isCurrentAttempt(attempt)) {
                attempt.cancel = cancel;
            } else {
                cancel();
            }
        } catch (e) {
            logger.error('auth', 'could not run PAM authentication worker:', e);
            if (this.#isCurrentAttempt(attempt)) {
                this.#retireAttempt(attempt);
                this.authStatus = 'Authentication error';
            }
        }
        return true;
    }

    // ── Fingerprint ──

    #setupFingerprint() {
        const onVerified = () => {
            if (this.#disposed || this.#completed) return;
            this.#complete();
            this.success();
        };

        const onStatus = (_fp: FingerprintAuth, status: string) => {
            if (this.#disposed || this.#completed) return;
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
                (_source: FingerprintAuth, ..._args: unknown[]) => onVerified()
            ),
            GObject.signal_connect(
                this.#fingerprint,
                'status-changed',
                (_source: FingerprintAuth, ...args: unknown[]) =>
                    onStatus(_source, args.length > 0 ? String(args[0]) : '')
            ),
        ];

        void Promise.resolve()
            .then(() => {
                if (this.#disposed || this.#completed) return;
                return this.#fingerprint.init();
            })
            .then(() => {
                if (!this.#disposed && !this.#completed && this.#fingerprint.available) {
                    this.#fingerprint.start();
                }
            })
            .catch((e) => {
                if (!this.#disposed && !this.#completed) {
                    logger.warn('auth', 'fingerprint unavailable; password auth remains active:', e);
                }
            });
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

    /** Start the auth session: save brightness and initialize fingerprint auth. */
    async start(): Promise<void> {
        if (this.#initialized || this.#disposed || this.#completed) return;
        this.#initialized = true;
        this.#saveBrightness();
        this.#setupFingerprint();
    }

    /** Cancel/cleanup the auth session. Safe to call multiple times. */
    cancel(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#complete();
    }
}
