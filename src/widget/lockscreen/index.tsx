import {monitors} from '../../lib/services/monitoring/monitors';
import GObject from 'gi://GObject?version=2.0';
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import SessionLockService from '../../lib/services/session/sessionLockService';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, For, onCleanup} from 'gnim';
import {render} from '@gnim-js/gtk4';
import {app} from '../../apps/shell/App';
import WindowManager from '../../lib/services/state/windowManager';
import ShellState from '../../lib/services/state/shellState';
import Clock from '../../lib/services/time/clock';
import FingerprintAuth from '../../lib/services/input/fingerprint';
import AuthSession from '../../lib/services/session/authSession';
import {LockscreenNotifications} from './notifications';
import {LockscreenWidgets} from './widgets';
import {LockscreenAuthPanel} from './authPanel';

// ── Layout constants ──────────────────────────────────────────────

const CLOCK_MARGIN_BOTTOM = 8;

// ── Main lockscreen creation ──

const createLocks = (onUnlock: () => void) => {
    const {LEFT, RIGHT, TOP, BOTTOM} = Astal.WindowAnchor;
    const lockService = SessionLockService.get_default();
    const time = Clock.get_default().time;
    const fingerprint = FingerprintAuth.get_default();
    const authSession = new AuthSession();
    authSession.start();

    let sharedCleanedUp = false;

    const cleanupAll = () => {
        if (sharedCleanedUp) return;
        sharedCleanedUp = true;
        authSession.cancel();
    };

    const doUnlock = () => {
        cleanupAll();
        lockService.unlock();
        WindowManager.get_default().lockscreens.forEach(w => w.close());
        ShellState.get_default().unlock();
        onUnlock();
    };

    GObject.signal_connect(authSession, 'success', () => doUnlock());

    const fpStateBinding = bind(fingerprint, 'state');
    const fpErrorBinding = bind(fingerprint, 'errorMessage');

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    ref={self => {
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
                        lockService.lock();
                        for (const window of WindowManager.get_default()
                            .lockscreens) {
                            lockService.assignWindow(
                                window,
                                window.get_current_monitor()
                            );
                        }
                    }}
                    gdkmonitor={monitor}
                    application={app}
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
                            slot="start"
                            orientation={Gtk.Orientation.VERTICAL}
                            marginBottom={CLOCK_MARGIN_BOTTOM}
                        >
                            <Gtk.Label
                                cssClasses={['title-1', 'numeric']}
                                label={time.as(t => t.format('%R')!)}
                                css={'font-size: 4em;'}
                            />
                            <Gtk.Label
                                marginBottom={CLOCK_MARGIN_BOTTOM}
                                cssClasses={['title-3', 'numeric']}
                                label={time.as(t => t.format('%A, %x')!)}
                            />
                        </Gtk.Box>
                        <LockscreenAuthPanel
                            authSession={authSession}
                            fingerprint={fingerprint}
                            fpStateBinding={fpStateBinding}
                            fpErrorBinding={fpErrorBinding}
                        />
                        <Gtk.Box
                            slot="end"
                            valign={Gtk.Align.END}
                            halign={Gtk.Align.CENTER}
                            orientation={Gtk.Orientation.VERTICAL}
                            marginTop={CLOCK_MARGIN_BOTTOM}
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

    const screenlocked = bind(ShellState.get_default(), 'screenlocked');

    onCleanup(
        screenlocked.subscribe(() => {
            if (screenlocked() && !locked) {
                locked = true;
                const dispose = render(
                    () =>
                        createLocks(() => {
                            locked = false;
                            dispose();
                        }),
                    app
                );
            }
        })
    );
    return <></>;
};
