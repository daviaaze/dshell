// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
/**
 * GreetSession — wraps AstalGreet.Greeter for PAM conversation management.
 *
 * Handles the full greetd authentication lifecycle:
 *   create_session → [visible-request | secret-request]
 *   → post_auth → [authenticated | cancelled | error-message]
 *   → start_session (on success)
 */
import Greet from 'gi://AstalGreet';
import GObject, {getter, register, setter} from 'gnim/gobject';
import logger from '#/lib/core/logger';

export type GreetState =
    | 'idle'
    | 'creating-session'
    | 'awaiting-input'
    | 'authenticating'
    | 'authenticated'
    | 'error';

@register({GTypeName: 'GreetSession'})
export class GreetSession extends GObject.Object {
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

    @getter(String)
    get state() {
        return this.#state;
    }

    @setter(String)
    set state(v: GreetState) {
        this.#state = v;
        this.notify('state');
    }

    @getter(String)
    get errorMessage() {
        return this.#errorMessage;
    }

    @setter(String)
    set errorMessage(v: string) {
        this.#errorMessage = v;
        this.notify('error-message');
    }

    @getter(String)
    get infoMessage() {
        return this.#infoMessage;
    }

    @setter(String)
    set infoMessage(v: string) {
        this.#infoMessage = v;
        this.notify('info-message');
    }

    @getter(Boolean)
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

        this.#greeter = new Greet.Greeter();

        // Connect all signals
        this.#signalIds = [
            this.#greeter.connect('visible-request', (_g: Greet.Greeter, msg: string) => {
                this.#infoMessage = msg;
                this.notify('info-message');
                this.state = 'awaiting-input';
            }),

            this.#greeter.connect('secret-request', (_g: Greet.Greeter, msg: string) => {
                this.#infoMessage = msg || 'Password required';
                this.notify('info-message');
                this.state = 'awaiting-input';
            }),

            this.#greeter.connect('info-message', (_g: Greet.Greeter, msg: string) => {
                this.#infoMessage = msg;
                this.notify('info-message');
            }),

            this.#greeter.connect('error-message', (_g: Greet.Greeter, msg: string) => {
                this.#errorMessage = msg;
                this.notify('error-message');
                this.state = 'error';
            }),

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

        this.#greeter.create_session(username);
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

        this.#greeter.start_session(cmd, env, (_g: Greet.Greeter, res: unknown) => {
            try {
                this.#greeter!.start_session_finish(res);
                // If start_session returns, the session is running.
                // The greeter process (this app) should terminate.
                logger.info('greeter', 'session started successfully');
            } catch (e) {
                this.#errorMessage = `Failed to start session: ${e}`;
                this.notify('error-message');
                this.state = 'error';
            }
        });
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