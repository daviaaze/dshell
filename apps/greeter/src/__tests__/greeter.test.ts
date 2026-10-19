/**
 * Tests for GreetSession — greetd authentication state machine.
 *
 * Run with `gnim run apps/greeter/src/__tests__/greeter.test.ts`
 * (also included in the repository's `scripts/test.sh`).
 */

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import {
    GreetSession,
    type GreetAuthResponse,
    type GreetSessionBackend,
} from '../greeter-ui/GreetSession';
import {discoverSessions, parseExec} from '../greeter-ui/sessions';
import {describe, expect, it, run} from './test-runner';

type AuthCallback = (response: GreetAuthResponse | null, error: unknown | null) => void;
type ErrorCallback = (error: unknown | null) => void;

class ControlledGreetd implements GreetSessionBackend {
    readonly creates: Array<{username: string; callback: AuthCallback}> = [];
    readonly posts: Array<{response: string | null; callback: AuthCallback}> = [];
    readonly cancellations: ErrorCallback[] = [];
    readonly starts: Array<{
        command: string[];
        env: string[];
        callback: ErrorCallback;
    }> = [];

    createSession(username: string, callback: AuthCallback): void {
        this.creates.push({username, callback});
    }

    postAuth(response: string | null, callback: AuthCallback): void {
        this.posts.push({response, callback});
    }

    cancelSession(callback: ErrorCallback): void {
        this.cancellations.push(callback);
    }

    startSession(command: string[], env: string[], callback: ErrorCallback): void {
        this.starts.push({command, env, callback});
    }
}

function createGreetSessionHarness() {
    const backend = new ControlledGreetd();
    return {session: new GreetSession({backend}), backend};
}

describe('sessions', () => {
    it('parseExec strips field codes and splits argv', () => {
        expect(parseExec('/usr/bin/foo --bar %U')).toEqual(['/usr/bin/foo', '--bar']);
    });

    it('parseExec respects quoting', () => {
        expect(parseExec('uwsm start -F -- /run/current-system/sw/bin/start-hyprland')).toEqual([
            'uwsm',
            'start',
            '-F',
            '--',
            '/run/current-system/sw/bin/start-hyprland',
        ]);
    });

    it('parseExec returns empty array for empty Exec', () => {
        expect(parseExec('')).toEqual([]);
        expect(parseExec('%U')).toEqual([]);
    });

    it('discoverSessions finds, filters and dedupes desktop files', () => {
        const base = `${GLib.get_tmp_dir()}/greeter-test-${GLib.get_real_time()}`;
        const wsDir = `${base}/wayland-sessions`;
        GLib.mkdir_with_parents(wsDir, 0o755);
        const enc = new TextEncoder();
        GLib.file_set_contents(
            `${wsDir}/test.desktop`,
            enc.encode('[Desktop Entry]\nName=Test Session\nExec=/usr/bin/test-session --flag %U\n')
        );
        GLib.file_set_contents(
            `${wsDir}/hidden.desktop`,
            enc.encode('[Desktop Entry]\nName=Hidden\nExec=/bin/hidden\nNoDisplay=true\n')
        );

        const sessions = discoverSessions([base]);
        const ids = sessions.map((s) => s.id);
        expect(ids.includes('test.desktop')).toBe(true);
        expect(ids.includes('hidden.desktop')).toBe(false);
        const test = sessions.find((s) => s.id === 'test.desktop')!;
        expect(test.name).toBe('Test Session');
        expect(test.command).toEqual(['/usr/bin/test-session', '--flag']);
    });
});

describe('GreetSession', () => {
    it('does not create duplicate conversations for repeated starts', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.start('alice');
        expect(backend.creates.length).toBe(1);
        expect(backend.creates[0].username).toBe('alice');
    });

    it('uses PAM INFO replies and waits for a password request before submitting', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.postAuth('too early');
        expect(backend.posts.length).toBe(0);
        backend.creates[0].callback({type: 'info', message: 'Place your finger'}, null);
        expect(session.state).toBe('authenticating');
        expect(backend.posts[0].response).toBeNull();

        backend.posts[0].callback({type: 'secret', message: 'Password:'}, null);
        expect(session.state).toBe('awaiting-input');
        session.postAuth('password');
        expect(backend.posts[1].response).toBe('password');
        backend.posts[1].callback({type: 'success'}, null);
        expect(session.state).toBe('authenticated');
    });

    it('acknowledges PAM error messages without treating them as input questions', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        backend.creates[0].callback({type: 'pam-error', message: 'Try again'}, null);
        expect(session.errorMessage).toBe('Try again');
        expect(session.state).toBe('authenticating');
        expect(backend.posts[0].response).toBeNull();
        backend.posts[0].callback({type: 'error', message: 'Authentication failed'}, null);
        expect(session.state).toBe('error');
    });

    it('drains retired auth and confirms cancellation before another account starts', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        const staleCreateResponse = backend.creates[0].callback;
        session.start('bob');
        expect(session.state).toBe('cancelling-session');
        expect(backend.cancellations.length).toBe(1);
        expect(backend.creates.length).toBe(1);

        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(1);
        staleCreateResponse({type: 'info', message: 'Place your finger'}, null);
        expect(backend.posts.length).toBe(0);
        expect(backend.cancellations.length).toBe(2);
        expect(backend.creates.length).toBe(1);

        backend.cancellations[1](null);
        expect(backend.creates.length).toBe(2);
        expect(backend.creates[1].username).toBe('bob');
        expect(session.state).toBe('creating-session');
    });

    it('does not send an authentication request after a synchronous Back transition', () => {
        const {session, backend} = createGreetSessionHarness();
        GObject.signal_connect(session, 'notify::state', () => {
            if (session.state === 'creating-session') session.reset();
        });
        session.start('alice');
        expect(backend.creates.length).toBe(0);
        backend.cancellations[0](null);
        backend.cancellations[1](null);
        expect(session.state).toBe('idle');
    });

    it('starts only the most recently selected account after cancellation', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.start('bob');
        session.start('carol');
        expect(backend.cancellations.length).toBe(1);
        backend.cancellations[0](null);
        backend.creates[0].callback(null, new Error('cancelled'));
        backend.cancellations[1](null);
        expect(backend.creates.length).toBe(2);
        expect(backend.creates[1].username).toBe('carol');
    });

    it('Back cancellation does not restart PAM; a deliberate retry remains usable', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.reset();
        backend.cancellations[0](null);
        backend.creates[0].callback(null, new Error('cancelled'));
        backend.cancellations[1](null);
        expect(session.state).toBe('idle');
        expect(backend.creates.length).toBe(1);

        session.start('alice');
        expect(backend.creates.length).toBe(2);
    });

    it('drains an outstanding password response before starting a different account', () => {
        const {session, backend} = createGreetSessionHarness();
        GObject.signal_connect(session, 'notify::state', () => {
            if (session.state === 'authenticated') session.startSession(['session']);
        });
        session.start('alice');
        backend.creates[0].callback({type: 'secret', message: 'Password:'}, null);
        session.postAuth('alice-password');
        session.start('bob');
        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(1);

        backend.posts[0].callback({type: 'success'}, null);
        expect(backend.starts.length).toBe(0);
        backend.cancellations[1](null);
        expect(backend.creates[1].username).toBe('bob');
        expect(session.state).toBe('creating-session');
    });

    it('ignores stale success responses instead of starting the old user session', () => {
        const {session, backend} = createGreetSessionHarness();
        GObject.signal_connect(session, 'notify::state', () => {
            if (session.state === 'authenticated') session.startSession(['session']);
        });
        session.start('alice');
        const staleSuccess = backend.creates[0].callback;
        session.start('bob');
        backend.cancellations[0](null);
        staleSuccess({type: 'success'}, null);
        backend.cancellations[1](null);

        expect(session.state).toBe('creating-session');
        expect(backend.starts.length).toBe(0);
    });

    it('shows authentication errors and permits retrying the same account', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        backend.creates[0].callback({type: 'error', message: 'Wrong password'}, null);
        expect(session.state).toBe('error');
        expect(session.errorMessage).toBe('Wrong password');

        session.start('alice');
        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(2);
        expect(backend.creates[1].username).toBe('alice');
    });

    it('calls onSessionStarted only after greetd confirms StartSession success', () => {
        const {session, backend} = createGreetSessionHarness();
        let started = 0;
        session.onSessionStarted = () => {
            started++;
        };
        session.start('alice');
        backend.creates[0].callback({type: 'success'}, null);
        session.startSession(['session']);
        expect(session.state).toBe('starting-session');
        expect(started).toBe(0);

        backend.starts[0].callback(null);
        expect(started).toBe(1);
    });

    it('reports StartSession failures and permits a fresh authentication attempt', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        backend.creates[0].callback({type: 'success'}, null);
        session.startSession(['session']);
        expect(backend.starts.length).toBe(1);
        backend.starts[0].callback(new Error('session launch failed'));
        expect(session.state).toBe('error');

        session.start('alice');
        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(2);
    });

    it('recovers from a failed cancellation request without concurrent PAM', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.reset();
        backend.cancellations[0](new Error('temporary failure'));
        expect(session.state).toBe('error');
        backend.creates[0].callback(null, new Error('cancelled'));

        session.start('bob');
        expect(backend.cancellations.length).toBe(2);
        expect(backend.creates.length).toBe(1);
        backend.cancellations[1](null);
        backend.cancellations[2](null);
        expect(backend.creates.length).toBe(2);
        expect(backend.creates[1].username).toBe('bob');
    });

    it('drains a late transport error after cancellation without waiting for a hidden signal', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        session.start('bob');
        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(1);

        backend.creates[0].callback(null, new Error('connection closed'));
        backend.cancellations[1](null);
        expect(backend.creates.length).toBe(2);
        expect(backend.creates[1].username).toBe('bob');
        expect(session.state).toBe('creating-session');
    });

    it('recovers after a native request transport error', () => {
        const {session, backend} = createGreetSessionHarness();
        session.start('alice');
        backend.creates[0].callback(null, new Error('greetd unavailable'));
        expect(session.state).toBe('error');

        session.start('alice');
        backend.cancellations[0](null);
        expect(backend.creates.length).toBe(2);
        expect(session.state).toBe('creating-session');
    });
});

await run(import.meta.url);
