/**
 * GreetSession — wraps AstalGreet.Greeter for PAM conversation management.
 *
 * Handles the full greetd authentication lifecycle:
 *   create_session → [visible-request | secret-request]
 *   → post_auth → [authenticated | cancelled | error-message]
 *   → start_session (on success)
 */
import Greet from 'gi://AstalGreet';
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import logger from '../../lib/core/logger';

export type GreetState =
    | 'idle'
    | 'creating-session'
    | 'awaiting-input'
    | 'authenticating'
    | 'authenticated'
    | 'error';

@register
export class GreetSession extends Object {
    static instance: GreetSession;

    static get_default() {
        if (!this.instance) this.instance = new GreetSession();
        return this.instance;
    }

    #greeter: Greet.Greeter | null = null;
    #state: GreetState = 'idle';
    #username: string = '';
    #errorMessage: string = '';
    #infoMessage: string = '';
    #signalIds: number[] = [];
    #onSessionStarted: (() => void) | null = null;

    /**
     * Callback invoked after the user session starts successfully.
     * The caller (e.g. main.ts via index.tsx) should quit the app here.
     */
    set onSessionStarted(cb: (() => void) | null) {
        this.#onSessionStarted = cb;
    }

    @property
    get state() {
        return this.#state;
    }

    set state(v: GreetState) {
        this.#state = v;
        this.notify('state');
    }

    @property
    get errorMessage() {
        return this.#errorMessage;
    }

    set errorMessage(v: string) {
        this.#errorMessage = v;
        this.notify('error-message');
    }

    @property
    get infoMessage() {
        return this.#infoMessage;
    }

    set infoMessage(v: string) {
        this.#infoMessage = v;
        this.notify('info-message');
    }

    @property
    get available(): boolean {
        try {
            // Quick availability check
            return typeof Greet !== 'undefined';
        } catch {
            return false;
        }
    }

    /**
     * Start the login flow for a given username.
     */
    start(username: string): void {
        this.#username = username;
        this.#errorMessage = '';
        this.#infoMessage = '';
        this.state = 'creating-session';

        if (this.#greeter) {
            this.#disconnectAll();
        }

        try {
            this.#greeter = new Greet.Greeter();
        } catch (e) {
            this.#errorMessage = `Failed to connect to greetd: ${e}`;
            this.notify('error-message');
            this.state = 'error';
            return;
        }

        // Connect all signals
        this.#signalIds = [
            this.#greeter.connect(
                'visible-request',
                (_g: Greet.Greeter, msg: string) => {
                    this.#infoMessage = msg;
                    this.notify('info-message');
                    this.state = 'awaiting-input';
                }
            ),

            this.#greeter.connect(
                'secret-request',
                (_g: Greet.Greeter, msg: string) => {
                    this.#infoMessage = msg || 'Password required';
                    this.notify('info-message');
                    this.state = 'awaiting-input';
                }
            ),

            this.#greeter.connect(
                'info-message',
                (_g: Greet.Greeter, msg: string) => {
                    this.#infoMessage = msg;
                    this.notify('info-message');
                }
            ),

            this.#greeter.connect(
                'error-message',
                (_g: Greet.Greeter, msg: string) => {
                    this.#errorMessage = msg;
                    this.notify('error-message');
                    this.state = 'error';
                }
            ),

            this.#greeter.connect('cancelled', () => {
                this.#errorMessage = 'Authentication cancelled';
                this.notify('error-message');
                this.state = 'idle';
                // Retry: create session again
                this.#greeter?.create_session(this.#username);
            }),

            this.#greeter.connect('authenticated', () => {
                this.state = 'authenticated';
            }),
        ];

        try {
            this.#greeter.create_session(username);
        } catch (e) {
            this.#errorMessage = `Failed to create session: ${e}`;
            this.notify('error-message');
            this.state = 'error';
        }
    }

    /**
     * Submit a password (or other PAM response).
     */
    postAuth(response: string): void {
        if (!this.#greeter) return;
        this.state = 'authenticating';
        this.#errorMessage = '';
        this.notify('error-message');
        this.#greeter.post_auth(response);
    }

    /**
     * Start the user session (after successful authentication).
     */
    startSession(cmd: string[], env: string[] = []): void {
        if (!this.#greeter) return;

        this.#greeter.start_session(
            cmd,
            env,
            (_g: GObject.Object | null, res: Gio.AsyncResult) => {
                try {
                    this.#greeter!.start_session_finish(res);
                    // If start_session returns, the session is running.
                    // The greeter process (this app) should terminate.
                    logger.info('greeter', 'session started successfully');
                    this.#onSessionStarted?.();
                } catch (e) {
                    this.#errorMessage = `Failed to start session: ${e}`;
                    this.notify('error-message');
                    this.state = 'error';
                }
            }
        );
    }

    /**
     * Cancel the current authentication flow.
     */
    cancel(): void {
        this.#disconnectAll();
        this.#greeter = null;
        this.state = 'idle';
        this.#errorMessage = '';
        this.#infoMessage = '';
    }

    #disconnectAll(): void {
        if (this.#greeter) {
            for (const id of this.#signalIds) {
                this.#greeter.disconnect(id);
            }
        }
        this.#signalIds = [];
    }

    dispose(): void {
        this.cancel();
    }
}
