import {monitors} from '#/lib/services/monitoring/monitors';
import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import AstalAuth from 'gi://AstalAuth?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import SessionLock from 'gi://Gtk4SessionLock';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {
    createBinding,
    createRoot,
    createState,
    For,
    onCleanup,
    onMount,
} from 'gnim';
import WindowManager from '#/lib/services/state/windowManager';
import ShellState from '#/lib/services/state/shellState';
import logger from '#/lib/core/logger';
import FingerprintAuth from '#/lib/services/input/fingerprint';
import {Process} from '#/lib/core/process';
import {LockscreenNotifications} from './notifications';
import {LockscreenWidgets} from './widgets';

const PAM_TIMEOUT_MS = 10000;

// ── Auth helpers (extracted from createLocks to reduce CC) ──

interface PamAuthState {
    pendingPassword: string;
    pamTimeoutId: number;
    pamActive: boolean;
}

function createPamAuth(
    pam: AstalAuth.Pam,
    setAuthStatus: (s: string) => void,
    onSuccess: () => void
) {
    const state: PamAuthState = {
        pendingPassword: '',
        pamTimeoutId: 0,
        pamActive: false,
    };

    const cancelPamTimeout = () => {
        if (state.pamTimeoutId) {
            GLib.source_remove(state.pamTimeoutId);
            state.pamTimeoutId = 0;
        }
    };

    const cleanup = () => {
        cancelPamTimeout();
    };

    const promptId = pam.connect('auth-prompt-hidden', () => {
        pam.supply_secret(state.pendingPassword);
    });

    const successId = pam.connect('success', () => {
        if (!state.pamActive) return;
        state.pamActive = false;
        cancelPamTimeout();
        onSuccess();
    });

    const failId = pam.connect('fail', (_pam: AstalAuth.Pam, msg: string) => {
        if (!state.pamActive) return;
        state.pamActive = false;
        cancelPamTimeout();
        logger.debug('lockscreen', 'PAM auth failed:', msg);
        setAuthStatus('Authentication failed');
    });

    const errorId = pam.connect(
        'auth-error',
        (_pam: AstalAuth.Pam, msg: string) => {
            if (!state.pamActive) return;
            state.pamActive = false;
            cancelPamTimeout();
            logger.debug('lockscreen', 'PAM auth error:', msg);
            setAuthStatus(msg || 'Authentication error');
            pam.supply_secret(null);
        }
    );

    const signalIds = [promptId, successId, failId, errorId];

    const unlock = (self: Gtk.PasswordEntry) => {
        if (state.pamActive) return;
        state.pendingPassword = self.get_text();
        self.set_text('');
        setAuthStatus('Authenticating...');
        state.pamActive = true;
        pam.start_authenticate();

        cancelPamTimeout();
        state.pamTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PAM_TIMEOUT_MS,
            () => {
                state.pamTimeoutId = 0;
                state.pamActive = false;
                setAuthStatus('Authentication timed out');
                return GLib.SOURCE_REMOVE;
            }
        );
    };

    return {unlock, cleanup, signalIds};
}

function createFingerprintAuth(
    fingerprint: FingerprintAuth,
    setAuthStatus: (s: string) => void,
    onVerified: () => void
) {
    fingerprint.init().then(() => {
        if (fingerprint.available) {
            fingerprint.start();
        }
    });

    const verifiedId = fingerprint.connect('verified', () => onVerified());

    const statusId = fingerprint.connect('status-changed', (_, status) => {
        if (status === 'verify-no-match') {
            setAuthStatus('Fingerprint did not match, retrying...');
        } else if (
            status === 'verify-retry' ||
            status === 'verify-swipe-too-short'
        ) {
            setAuthStatus('Try again...');
        }
    });

    const cleanup = () => {
        fingerprint.stop();
        fingerprint.disconnect(verifiedId);
        fingerprint.disconnect(statusId);
    };

    return {signalIds: [verifiedId, statusId], cleanup};
}

// ── Brightness save/restore ──

function saveBrightness(): string {
    try {
        // eslint-disable-next-line sonarjs/publicly-writable-directories
        const resumeFile = Gio.File.new_for_path('/tmp/shade-brightness-resume');
        if (resumeFile.query_exists(null)) {
            const [, contents] = resumeFile.load_contents(null);
            const value = new TextDecoder().decode(contents).trim();
            resumeFile.delete(null);
            return value;
        }
        return Process.exec('brightnessctl get');
    } catch (e) {
        logger.warn('lockscreen', 'could not save brightness:', e);
        return '';
    }
}

function restoreBrightness(value: string) {
    if (!value) return;
    try {
        Process.exec(`brightnessctl set ${value}`);
    } catch (e) {
        logger.warn('lockscreen', 'failed to restore brightness:', e);
    }
}

// ── Main lockscreen creation ──

const createLocks = (onUnlock: () => void) => {
    const {LEFT, RIGHT, TOP, BOTTOM} = Astal.WindowAnchor;
    const lock = SessionLock.Instance.new();
    const [time, setTime] = createState(GLib.DateTime.new_now_local());
    const [authStatus, setAuthStatus] = createState('');
    const fingerprint = FingerprintAuth.get_default();
    const savedBrightness = saveBrightness();

    const lockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        setTime(GLib.DateTime.new_now_local());
        return GLib.SOURCE_CONTINUE;
    });

    let sharedCleanedUp = false;

    const cleanupAll = () => {
        if (sharedCleanedUp) return;
        sharedCleanedUp = true;
        pamAuth.cleanup();
        fpAuth.cleanup();
        if (lockTimeout) GLib.source_remove(lockTimeout);
    };

    const doUnlock = () => {
        cleanupAll();
        lock.unlock();
        WindowManager.get_default().lockscreens.forEach(w => w.destroy());
        ShellState.get_default().screenlocked = false;
        onUnlock();
        restoreBrightness(savedBrightness);
    };

    const pam = new AstalAuth.Pam();
    const pamAuth = createPamAuth(pam, setAuthStatus, doUnlock);

    const fpAuth = createFingerprintAuth(fingerprint, setAuthStatus, doUnlock);

    const fpStateBinding = createBinding(fingerprint, 'state');
    const fpErrorBinding = createBinding(fingerprint, 'error-message');

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    $={self => {
                        WindowManager.get_default().registerLockscreen(self);
                        onCleanup(() => {
                            cleanupAll();
                            WindowManager.get_default().unregisterLockscreen(
                                self
                            );
                        });
                    }}
                    onRealize={() => {
                        for (const window of WindowManager.get_default()
                            .lockscreens) {
                            if (!window.get_realized()) return;
                        }
                        lock.lock();
                        for (const window of WindowManager.get_default()
                            .lockscreens) {
                            lock.assign_window_to_monitor(
                                window,
                                window.get_current_monitor()
                            );
                        }
                    }}
                    gdkmonitor={monitor}
                    anchor={TOP | BOTTOM | LEFT | RIGHT}
                    visible
                    exclusivity={Astal.Exclusivity.IGNORE}
                    keymode={Astal.Keymode.EXCLUSIVE}
                >
                    <Gtk.CenterBox
                        halign={Gtk.Align.CENTER}
                        valign={Gtk.Align.CENTER}
                        orientation={Gtk.Orientation.VERTICAL}
                    >
                        <Gtk.Box
                            $type="start"
                            orientation={Gtk.Orientation.VERTICAL}
                            marginBottom={12}
                        >
                            <Gtk.Label
                                cssClasses={['title-1', 'numeric']}
                                label={time.as(t => t.format('%R')!)}
                                css={'font-size: 4em;'}
                            />
                            <Gtk.Label
                                marginBottom={12}
                                cssClasses={['title-3', 'numeric']}
                                label={time.as(t => t.format('%A, %x')!)}
                            />
                        </Gtk.Box>
                        <Gtk.Box
                            $type="center"
                            valign={Gtk.Align.CENTER}
                            halign={Gtk.Align.CENTER}
                            spacing={4}
                            css={'padding:8px;'}
                            orientation={Gtk.Orientation.VERTICAL}
                            cssClasses={['card']}
                        >
                            <Adw.Avatar size={64} />
                            <Gtk.Label
                                label={GLib.get_real_name()}
                                cssClasses={['title-3']}
                            />
                            <Gtk.PasswordEntry
                                $={self => onMount(() => self.grab_focus())}
                                placeholderText={'password'}
                                showPeekIcon
                                onActivate={unlock}
                            />
                            <Gtk.Label
                                visible={authStatus.as(s => s.length > 0)}
                                cssClasses={['caption']}
                                label={authStatus}
                            />
                            <Gtk.Spinner
                                visible={fpStateBinding.as(
                                    s =>
                                        s === 'verifying' ||
                                        s === 'initializing'
                                )}
                                spinning
                            />
                            <Gtk.Button
                                visible={fpStateBinding.as(s => s === 'error')}
                                label={fpErrorBinding.as(
                                    msg => msg || 'Retry fingerprint'
                                )}
                                cssClasses={['flat']}
                                onClicked={() => fingerprint.retry()}
                            />
                            <LockscreenWidgets position="center" />
                        </Gtk.Box>
                        <Gtk.Box
                            $type="end"
                            valign={Gtk.Align.END}
                            halign={Gtk.Align.CENTER}
                            orientation={Gtk.Orientation.VERTICAL}
                            marginTop={12}
                        >
                            <LockscreenWidgets position="end" />
                            <LockscreenNotifications />
                        </Gtk.Box>
                    </Gtk.CenterBox>
                </Astal.Window>
            )}
        </For>
    );
};

export const LockScreen = () => {
    let locked = false;

    const screenlocked = createBinding(
        ShellState.get_default(),
        'screenlocked'
    );

    onCleanup(
        screenlocked.subscribe(() => {
            if (screenlocked() && !locked) {
                locked = true;
                createRoot(dispose => {
                    createLocks(() => {
                        locked = false;
                        dispose();
                    });
                });
            }
        })
    );
    return <></>;
};
