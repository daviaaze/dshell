/**
 * GreetSession — explicit greetd/PAM request lifecycle for the greeter UI.
 *
 * AstalGreet.Greeter hides automatic INFO replies and cancellation side effects.
 * This controller uses the public request types directly so each response,
 * cancellation acknowledgement, and session-start result is checked explicitly.
 */
import Greet from 'gi://AstalGreet';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';

export type GreetState =
    | 'idle'
    | 'creating-session'
    | 'awaiting-input'
    | 'authenticating'
    | 'cancelling-session'
    | 'authenticated'
    | 'starting-session'
    | 'error';

export type GreetAuthResponse =
    | {type: 'success'}
    | {type: 'error'; message: string}
    | {type: 'info'; message: string}
    | {type: 'pam-error'; message: string}
    | {type: 'visible'; message: string}
    | {type: 'secret'; message: string};

export interface GreetSessionBackend {
    createSession(
        username: string,
        callback: (response: GreetAuthResponse | null, error: unknown | null) => void
    ): void;
    postAuth(
        response: string | null,
        callback: (next: GreetAuthResponse | null, error: unknown | null) => void
    ): void;
    cancelSession(callback: (error: unknown | null) => void): void;
    startSession(
        command: string[],
        env: string[],
        callback: (error: unknown | null) => void
    ): void;
}

export interface GreetSessionOptions {
    backend?: GreetSessionBackend;
}

interface AuthRequest {
    generation: number;
}

interface Cancellation {
    requestInFlight: boolean;
    acknowledged: boolean;
    authRequest: AuthRequest | null;
    confirmAfterDrain: boolean;
    nextUsername: string | null;
}

function responseError(response: Greet.Response, operation: string): Error | null {
    if (response instanceof Greet.Success) return null;
    if (response instanceof Greet.Error) {
        return new Error(`${operation}: ${response.description}`);
    }
    return new Error(`${operation}: greetd returned an unexpected response`);
}

function authenticationResponse(response: Greet.Response): GreetAuthResponse {
    if (response instanceof Greet.Success) return {type: 'success'};
    if (response instanceof Greet.Error) return {type: 'error', message: response.description};
    if (!(response instanceof Greet.AuthMessage)) {
        return {type: 'error', message: 'greetd returned an unexpected authentication response'};
    }

    const message = response.message;
    switch (response.get_message_type()) {
        case Greet.AuthMessageType.VISIBLE:
            return {type: 'visible', message};
        case Greet.AuthMessageType.SECRET:
            return {type: 'secret', message};
        case Greet.AuthMessageType.INFO:
            return {type: 'info', message};
        case Greet.AuthMessageType.ERROR:
            return {type: 'pam-error', message};
        default:
            return {type: 'error', message: 'greetd returned an unknown PAM message type'};
    }
}

function sendRequest(
    request: Greet.Request,
    callback: (response: Greet.Response | null, error: unknown | null) => void
): void {
    request.send((_source, result) => {
        let response: Greet.Response;
        try {
            response = request.send_finish(result);
        } catch (error) {
            callback(null, error);
            return;
        }
        callback(response, null);
    });
}

const nativeBackend: GreetSessionBackend = {
    createSession: (username, callback) => {
        sendRequest(Greet.CreateSession.new(username), (response, error) => {
            if (error !== null) {
                callback(null, error);
                return;
            }
            callback(
                response
                    ? authenticationResponse(response)
                    : {type: 'error', message: 'greetd returned no authentication response'},
                null
            );
        });
    },
    postAuth: (answer, callback) => {
        sendRequest(Greet.PostAuthMessage.new(answer), (response, error) => {
            if (error !== null) {
                callback(null, error);
                return;
            }
            callback(
                response
                    ? authenticationResponse(response)
                    : {type: 'error', message: 'greetd returned no authentication response'},
                null
            );
        });
    },
    cancelSession: (callback) => {
        sendRequest(Greet.CancelSession.new(), (response, error) => {
            if (error !== null) {
                callback(error);
                return;
            }
            callback(
                response
                    ? responseError(response, 'Cancelling authentication')
                    : new Error('greetd returned no cancellation response')
            );
        });
    },
    startSession: (command, env, callback) => {
        sendRequest(Greet.StartSession.new(command, env), (response, error) => {
            if (error !== null) {
                callback(error);
                return;
            }
            callback(
                response
                    ? responseError(response, 'Starting session')
                    : new Error('greetd returned no session-start response')
            );
        });
    },
};

const STATE_AWAITING_INPUT = 'awaiting-input';
const NOTIFY_ERROR_MSG = 'error-message';
const NOTIFY_INFO_MSG = 'info-message';

@register
export class GreetSession extends Object {
    private static instance: GreetSession;

    static get_default() {
        if (!GreetSession.instance) GreetSession.instance = new GreetSession();
        return GreetSession.instance;
    }

    #backend: GreetSessionBackend;
    #state: GreetState = 'idle';
    #errorMessage = '';
    #infoMessage = '';
    #generation = 0;
    #activeUsername: string | null = null;
    #cancellation: Cancellation | null = null;
    #pendingAuth: AuthRequest | null = null;
    #onSessionStarted: (() => void) | null = null;

    constructor(options: GreetSessionOptions = {}) {
        super();
        this.#backend = options.backend ?? nativeBackend;
    }

    /** Callback invoked only after greetd confirms the requested session started. */
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
        this.notify(NOTIFY_ERROR_MSG);
    }

    @property
    get infoMessage() {
        return this.#infoMessage;
    }

    set infoMessage(v: string) {
        this.#infoMessage = v;
        this.notify(NOTIFY_INFO_MSG);
    }

    @property
    get available(): boolean {
        try {
            return typeof Greet !== 'undefined';
        } catch {
            return false;
        }
    }

    /** Start one PAM conversation for the selected account. */
    start(username: string): void {
        const account = username.trim();
        if (!account || this.#state === 'authenticated' || this.#state === 'starting-session')
            return;

        if (this.#cancellation) {
            this.#cancellation.nextUsername = account;
            this.#retryCancellation(this.#cancellation);
            return;
        }

        if (this.#activeUsername !== null) {
            if (this.#activeUsername === account && this.#state !== 'error') return;
            this.#beginCancellation(account);
            return;
        }

        this.#beginAttempt(account);
    }

    #beginAttempt(username: string): void {
        const generation = ++this.#generation;
        const request: AuthRequest = {generation};
        this.#activeUsername = username;
        this.#pendingAuth = request;
        this.errorMessage = '';
        this.infoMessage = '';
        this.state = 'creating-session';
        if (!this.#isCurrent(generation)) {
            this.#completeAuthRequest(request, null, new Error('Authentication cancelled'));
            return;
        }

        try {
            this.#backend.createSession(username, (response, error) => {
                this.#completeAuthRequest(request, response, error);
            });
        } catch (error) {
            this.#completeAuthRequest(request, null, error);
        }
    }

    #completeAuthRequest(
        request: AuthRequest,
        response: GreetAuthResponse | null,
        error: unknown | null
    ): void {
        if (this.#pendingAuth === request) this.#pendingAuth = null;
        const cancellation = this.#cancellation;
        if (cancellation?.authRequest === request) {
            cancellation.authRequest = null;
            this.#finishCancellation(cancellation);
            return;
        }
        this.#consumeResponse(request.generation, response, error);
    }

    #consumeResponse(
        generation: number,
        response: GreetAuthResponse | null,
        error: unknown | null
    ): void {
        if (!this.#isCurrent(generation)) return;
        if (error !== null) {
            this.errorMessage = `Authentication error: ${error}`;
            this.infoMessage = '';
            this.state = 'error';
            return;
        }
        if (response === null) {
            this.errorMessage = 'greetd returned no authentication response';
            this.state = 'error';
            return;
        }

        switch (response.type) {
            case 'success':
                this.errorMessage = '';
                this.infoMessage = '';
                this.state = 'authenticated';
                break;
            case 'error':
                this.errorMessage = response.message;
                this.infoMessage = '';
                this.state = 'error';
                break;
            case 'visible':
            case 'secret':
                this.errorMessage = '';
                this.infoMessage = response.message || 'Input required';
                this.state = STATE_AWAITING_INPUT;
                break;
            case 'info':
                this.infoMessage = response.message;
                this.#postPamResponse(null, generation, false);
                break;
            case 'pam-error':
                this.errorMessage = response.message;
                this.#postPamResponse(null, generation, false);
                break;
        }
    }

    #isCurrent(generation: number): boolean {
        return (
            this.#generation === generation &&
            this.#activeUsername !== null &&
            this.#cancellation === null
        );
    }

    /** Submit a response only while greetd is waiting for visible/secret input. */
    postAuth(response: string): void {
        if (this.#state !== STATE_AWAITING_INPUT) {
            logger.warn(
                'greeter',
                `postAuth ignored — no auth question pending (state=${this.#state})`
            );
            return;
        }
        this.#postPamResponse(response, this.#generation, true);
    }

    #postPamResponse(response: string | null, generation: number, clearError: boolean): void {
        if (!this.#isCurrent(generation)) return;
        const request: AuthRequest = {generation};
        this.#pendingAuth = request;
        if (clearError) this.errorMessage = '';
        this.state = 'authenticating';
        if (!this.#isCurrent(generation)) {
            this.#completeAuthRequest(request, null, new Error('Authentication cancelled'));
            return;
        }

        try {
            this.#backend.postAuth(response, (next, error) => {
                this.#completeAuthRequest(request, next, error);
            });
        } catch (error) {
            this.#completeAuthRequest(request, null, error);
        }
    }

    /** Start a session and exit only after greetd confirms success. */
    startSession(command: string[], env: string[] = []): void {
        if (this.#state !== 'authenticated' || this.#activeUsername === null) return;

        const generation = this.#generation;
        this.state = 'starting-session';
        try {
            this.#backend.startSession(command, env, (error) => {
                if (!this.#isCurrent(generation)) return;
                if (error !== null) {
                    this.errorMessage = `Failed to start session: ${error}`;
                    this.state = 'error';
                    return;
                }
                logger.info('greeter', 'session started successfully');
                this.#onSessionStarted?.();
            });
        } catch (error) {
            if (!this.#isCurrent(generation)) return;
            this.errorMessage = `Failed to start session: ${error}`;
            this.state = 'error';
        }
    }

    /** Cancel through greetd and return to account selection without restarting. */
    cancel(): void {
        this.#beginCancellation(null);
    }

    reset(): void {
        this.cancel();
    }

    #beginCancellation(nextUsername: string | null): void {
        if (this.#state === 'authenticated' || this.#state === 'starting-session') return;

        const existing = this.#cancellation;
        if (existing) {
            existing.nextUsername = nextUsername;
            this.errorMessage = '';
            this.infoMessage = 'Cancelling authentication…';
            this.state = 'cancelling-session';
            this.#retryCancellation(existing);
            return;
        }

        if (this.#activeUsername === null) {
            this.errorMessage = '';
            this.infoMessage = '';
            this.state = 'idle';
            if (nextUsername) this.#beginAttempt(nextUsername);
            return;
        }

        const cancellation: Cancellation = {
            requestInFlight: false,
            acknowledged: false,
            authRequest: this.#pendingAuth,
            confirmAfterDrain: this.#pendingAuth !== null,
            nextUsername,
        };
        this.#cancellation = cancellation;
        this.#generation++;
        this.errorMessage = '';
        this.infoMessage = 'Cancelling authentication…';
        this.state = 'cancelling-session';
        this.#retryCancellation(cancellation);
    }

    #retryCancellation(cancellation: Cancellation): void {
        if (
            this.#cancellation !== cancellation ||
            cancellation.requestInFlight ||
            cancellation.acknowledged
        )
            return;

        cancellation.requestInFlight = true;
        try {
            this.#backend.cancelSession((error) => {
                if (this.#cancellation !== cancellation) return;
                cancellation.requestInFlight = false;
                if (error !== null) {
                    this.errorMessage = `Failed to cancel authentication: ${error}`;
                    this.state = 'error';
                    return;
                }

                cancellation.acknowledged = true;
                this.#finishCancellation(cancellation);
            });
        } catch (error) {
            cancellation.requestInFlight = false;
            this.errorMessage = `Failed to cancel authentication: ${error}`;
            this.state = 'error';
        }
    }

    #finishCancellation(cancellation: Cancellation): void {
        if (
            this.#cancellation !== cancellation ||
            !cancellation.acknowledged ||
            cancellation.requestInFlight ||
            cancellation.authRequest !== null
        )
            return;

        if (cancellation.confirmAfterDrain) {
            // Separate greetd connections can be dispatched out of order. Once
            // the retired request has completed, confirm cancellation again so
            // a late CreateSession cannot survive an earlier acknowledgement.
            cancellation.confirmAfterDrain = false;
            cancellation.acknowledged = false;
            this.#retryCancellation(cancellation);
            return;
        }

        const nextUsername = cancellation.nextUsername;
        this.#activeUsername = null;
        this.#cancellation = null;
        this.errorMessage = '';
        this.infoMessage = '';
        this.state = 'idle';
        if (nextUsername) this.#beginAttempt(nextUsername);
    }

    dispose(): void {
        this.cancel();
    }
}
