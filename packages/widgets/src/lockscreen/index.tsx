import Astal from 'gi://Astal?version=4.0';
import type Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {render} from '@gnim-js/gtk4';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import FingerprintAuth from '@shade/services/input/fingerprint';
import AuthSession from '@shade/services/session/authSession';
import SessionLockService from '@shade/services/session/sessionLockService';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import Clock from '@shade/services/time/clock';

import {bind, createState, For, onCleanup} from 'gnim';
import {LockscreenAuthPanel} from './authPanel';
import {LockscreenNotifications} from './notifications';
import {LockscreenWidgets} from './widgets';

// ── Main lockscreen creation ──

const createLocks = (onUnlock: () => void) => {
    const lockService = SessionLockService.get_default();
    const time = Clock.get_default().time;
    const fingerprint = FingerprintAuth.get_default();
    const authSession = new AuthSession();
    const [lockMonitors, setLockMonitors] = createState<Gdk.Monitor[]>([]);
    const monitorSignals: {monitor: Gdk.Monitor; id: number}[] = [];
    let disposed = false;
    let retrySource = 0;

    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        authSession.cancel();
        if (retrySource) GLib.source_remove(retrySource);
        for (const {monitor, id} of monitorSignals) monitor.disconnect(id);
    };
    onCleanup(cleanup);

    const successId = GObject.signal_connect(authSession, 'success', () => {
        if (disposed || !lockService.isLocked) return;
        cleanup();
        // Tear down GTK surfaces while their native session still exists.
        // Shutdown takes this same disposal path, but never calls unlock().
        onUnlock();
        lockService.unlock();
        bus.emit('shell:unlock');
    });
    onCleanup(() => authSession.disconnect(successId));

    const monitorId = lockService.connect(
        'monitor',
        (_service, monitor) => {
            if (disposed || lockMonitors().includes(monitor)) return;
            const id = monitor.connect('invalidate', () => {
                setLockMonitors(lockMonitors().filter((item) => item !== monitor));
            });
            monitorSignals.push({monitor, id});
            setLockMonitors([...lockMonitors(), monitor]);
        }
    );
    const lockedId = GObject.signal_connect(lockService, 'locked', () => {
        if (!disposed) void authSession.start();
    });
    const failedId = GObject.signal_connect(lockService, 'failed', () => {
        if (disposed || retrySource) return;
        setLockMonitors([]);
        retrySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            retrySource = 0;
            if (!disposed) lockService.lock();
            return GLib.SOURCE_REMOVE;
        });
    });
    const unlockedId = GObject.signal_connect(lockService, 'unlocked', () => {
        if (disposed || lockService.isLocked) return;
        cleanup();
        onUnlock();
        bus.emit('shell:unlock');
    });
    onCleanup(() => {
        lockService.disconnect(monitorId);
        lockService.disconnect(lockedId);
        lockService.disconnect(failedId);
        lockService.disconnect(unlockedId);
    });

    const fpStateBinding = bind(fingerprint, 'state');
    const fpErrorBinding = bind(fingerprint, 'errorMessage');
    const onRef = (self: Gtk.Window, monitor: Gdk.Monitor) => {
        const wm = WindowManager.get_default();
        wm.registerLockscreen(self);
        onCleanup(() => wm.unregisterLockscreen(self));
        lockService.assignWindow(self, monitor);
    };

    // The native ::monitor signal is emitted only after requesting the protocol
    // lock. assignWindow() maps each still-unrealized Gtk.Window itself.
    lockService.lock();

    return (
        <For each={lockMonitors}>
            {(monitor: Gdk.Monitor) => (
                <Gtk.Window
                    title="Session lock"
                    ref={(self) => onRef(self, monitor)}
                    application={getApp()}
                    cssClasses={['background']}
                >
                    <Gtk.Box
                        vexpand
                        hexpand
                        orientation={Gtk.Orientation.VERTICAL}
                        halign={Gtk.Align.CENTER}
                    >
                        <Gtk.Box
                            vexpand
                            valign={Gtk.Align.START}
                            marginTop={120}
                            marginBottom={48}
                        />
                        <Gtk.Box vexpand valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER}>
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={16}
                                marginTop={48}
                                marginBottom={48}
                                marginStart={48}
                                marginEnd={48}
                                cssClasses={['card']}
                                css={'background-color: @window_bg_color;'}
                            >
                                <Gtk.Label
                                    cssClasses={['title-1', 'numeric']}
                                    label={time.as((t) => t.format('%R')!)}
                                />
                                <Gtk.Label
                                    cssClasses={['title-3', 'numeric']}
                                    label={time.as((t) => t.format('%A, %x')!)}
                                />
                                <LockscreenAuthPanel
                                    authSession={authSession}
                                    fingerprint={fingerprint}
                                    fpStateBinding={fpStateBinding}
                                    fpErrorBinding={fpErrorBinding}
                                />
                            </Gtk.Box>
                        </Gtk.Box>
                        <Gtk.Box
                            vexpand
                            valign={Gtk.Align.END}
                            halign={Gtk.Align.CENTER}
                            orientation={Gtk.Orientation.VERTICAL}
                            marginBottom={64}
                        >
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                                marginTop={24}
                                marginBottom={24}
                                marginStart={24}
                                marginEnd={24}
                                cssClasses={['card']}
                                css={'background-color: @window_bg_color;'}
                            >
                                <LockscreenWidgets position="end" />
                                <LockscreenNotifications />
                            </Gtk.Box>
                        </Gtk.Box>
                    </Gtk.Box>
                </Gtk.Window>
            )}
        </For>
    );
};

export const LockScreen = () => {
    let disposeLocks: (() => void) | null = null;
    const app = getApp();
    const state = ShellState.get_default();
    const wm = WindowManager.get_default();
    let hiddenWindows: Gtk.Window[] = [];
    const screenlocked = bind(ShellState.get_default(), 'screenlocked');
    const syncLock = () => {
        if (!screenlocked()) {
            const restore = hiddenWindows;
            hiddenWindows = [];
            // Restore focus only after authenticated protocol unlock, never on
            // disposal/restart while the compositor still owns the lock.
            for (const window of restore.reverse()) {
                if (window.get_application() === app) window.present();
            }
            return;
        }
        if (disposeLocks) return;
        state.closeAll();
        // Normal same-process GTK toplevels can retain keyboard ownership even
        // when the session-lock entry reports focused. Suspend those windows;
        // layer-shell surfaces and native lock windows have separate lifetimes.
        hiddenWindows = app.get_windows().filter((window) =>
            window.visible && !(window instanceof Astal.Window) && !wm.lockscreens.includes(window));
        for (const window of hiddenWindows) window.set_visible(false);
        disposeLocks = render(
            () =>
                createLocks(() => {
                    const dispose = disposeLocks;
                    disposeLocks = null;
                    dispose?.();
                }),
            getApp()
        );
    };
    onCleanup(screenlocked.subscribe(syncLock));
    onCleanup(() => {
        disposeLocks?.();
        disposeLocks = null;
        hiddenWindows = [];
    });
    // A restarted shell must render the compositor's existing lock immediately.
    syncLock();
    return <></>;
};
