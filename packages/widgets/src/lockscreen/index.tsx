import Astal from 'gi://Astal?version=4.0';
import type Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {render} from '@gnim-js/gtk4';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import FingerprintAuth from '@shade/services/input/fingerprint';
import {monitors} from '@shade/services/monitoring/monitors';
import AuthSession from '@shade/services/session/authSession';
import SessionLockService from '@shade/services/session/sessionLockService';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import Clock from '@shade/services/time/clock';
import {useStyle} from '@shade/style/useStyle';
import {bind, For, onCleanup} from 'gnim';
import {LockscreenAuthPanel} from './authPanel';
import {LockscreenNotifications} from './notifications';
import {LockscreenWidgets} from './widgets';

// ── Frosted card style — backdrop blur + translucent surface + shadow ──

const CARD_RADIUS = '24px';

const mainCardStyle = useStyle({
    padding: '48px',
    borderRadius: CARD_RADIUS,
    backdropFilter: 'blur(24px) brightness(0.8)',
    backgroundColor: 'color-mix(in srgb, var(--shade-surface) 55%, transparent)',
    boxShadow: '0 8px 32px color-mix(in srgb, var(--shade-shadow) 40%, transparent)',
});

const bottomCardStyle = useStyle({
    padding: '24px',
    borderRadius: CARD_RADIUS,
    backdropFilter: 'blur(24px) brightness(0.8)',
    backgroundColor: 'color-mix(in srgb, var(--shade-surface) 55%, transparent)',
    boxShadow: '0 8px 32px color-mix(in srgb, var(--shade-shadow) 40%, transparent)',
});

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
        for (const w of WindowManager.get_default().lockscreens) {
            w.close();
        }
        bus.emit('shell:unlock');
        onUnlock();
    };

    GObject.signal_connect(authSession, 'success', () => doUnlock());

    const fpStateBinding = bind(fingerprint, 'state');
    const fpErrorBinding = bind(fingerprint, 'errorMessage');

    const onRealize = () => {
        const wm = WindowManager.get_default();
        for (const window of wm.lockscreens) {
            if (!window.get_realized()) return;
        }
        lockService.lock();
        for (const window of wm.lockscreens) {
            lockService.assignWindow(window, window.get_current_monitor());
        }
    };

    const onRef = (self: Astal.Window) => {
        const wm = WindowManager.get_default();
        wm.registerLockscreen(self);
        onCleanup(() => {
            cleanupAll();
            wm.unregisterLockscreen(self);
        });
    };

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    ref={onRef}
                    onRealize={onRealize}
                    gdkmonitor={monitor}
                    application={getApp()}
                    anchor={TOP | BOTTOM | LEFT | RIGHT}
                    visible
                    exclusivity={Astal.Exclusivity.IGNORE}
                    keymode={Astal.Keymode.EXCLUSIVE}
                    css={'background: transparent;'}
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
                                cssClasses={[mainCardStyle.class]}
                                ref={mainCardStyle.$}
                            >
                                <Gtk.Label
                                    cssClasses={['title-1', 'numeric']}
                                    label={time.as((t) => t.format('%R')!)}
                                    css={'font-size: 5em;'}
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
                                cssClasses={[bottomCardStyle.class]}
                                ref={bottomCardStyle.$}
                            >
                                <LockscreenWidgets position="end" />
                                <LockscreenNotifications />
                            </Gtk.Box>
                        </Gtk.Box>
                    </Gtk.Box>
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
                    getApp()
                );
            }
        })
    );
    return <></>;
};
