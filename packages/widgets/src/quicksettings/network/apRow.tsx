import Network from 'gi://AstalNetwork';
import Gdk from 'gi://Gdk?version=4.0';
import type Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type NM from 'gi://NM?version=1.0';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import {type Accessor, computed, createState} from 'gnim';
import {type ApSnapshot, createNMConnection, findLiveAp, isSaved, signalIconName} from './utils';

const AP_ICON_SIZE = 16;
const AP_TRASH_ICON_SIZE = 14;

interface ApRowProps {
    snap: ApSnapshot;
    wifi: Network.Wifi;
    isActive: Accessor<boolean>;
    isConnecting: Accessor<boolean>;
    setConnectingAp: (v: string | null) => void;
}

// ── Connection / Forget helpers ──

async function connectViaNM(
    wifi: Network.Wifi,
    apSsid: string,
    secure: boolean,
    password?: string
): Promise<void> {
    if (!apSsid || apSsid === 'Hidden Network') throw new Error('Network not found');

    if (!wifi.device) throw new Error('No WiFi device');

    const connection = createNMConnection(apSsid, secure ? password : undefined);
    const client = Network.get_default().client as NM.Client;

    return new Promise((resolve, reject) => {
        client.add_and_activate_connection_async(
            connection,
            wifi.device,
            null,
            null,
            (_source: unknown, res: Gio.AsyncResult) => {
                try {
                    client.add_and_activate_connection_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

interface ConnectState {
    lastConnectMs: number;
    setConnectingAp: (v: string | null) => void;
    setShowPassword: (v: boolean) => void;
    showPassword: Accessor<boolean>;
    setPasswordError: (v: string | null) => void;
}

function createDoConnect(
    wifi: Network.Wifi,
    apBssid: string | null,
    apSsid: string,
    secure: boolean,
    state: ConnectState
) {
    const DEBOUNCE_MS = 1500;

    return (password?: string) => {
        const now = Date.now();
        if (now - state.lastConnectMs < DEBOUNCE_MS) return;
        state.lastConnectMs = now;

        state.setPasswordError(null);

        const run = async () => {
            const liveAp = findLiveAp(wifi, apBssid, apSsid);

            if (liveAp) {
                if (apBssid) state.setConnectingAp(apBssid);

                if (!secure) {
                    liveAp.activate(null, null);
                } else if (password !== undefined) {
                    liveAp.activate(password || null, null);
                } else if (isSaved(liveAp)) {
                    liveAp.activate(null, null);
                } else {
                    state.setShowPassword(!state.showPassword());
                    return;
                }

                state.setShowPassword(false);
                return;
            }

            if (!apSsid || apSsid === 'Hidden Network') {
                throw new Error('Network no longer available');
            }

            if (apBssid) state.setConnectingAp(apBssid);
            await connectViaNM(wifi, apSsid, secure, password);
            state.setShowPassword(false);
        };

        run()
            .then(() => state.setConnectingAp(null))
            .catch((e: Error) => {
                state.setConnectingAp(null);
                logger.warn('network', 'connect failed:', e.message);
                state.setPasswordError(e.message || 'Connection failed');
            });
    };
}

function createDoForget(wifi: Network.Wifi, apBssid: string | null, apSsid: string) {
    return () => {
        const liveAp = findLiveAp(wifi, apBssid, apSsid);
        if (!liveAp) {
            logger.warn('network', 'AP no longer available for forget');
            return;
        }
        try {
            const conns = liveAp.get_connections();
            if (!conns) return;
            for (const conn of toArray<NM.RemoteConnection>(conns)) {
                conn.delete_async(null, (_source: unknown, res: Gio.AsyncResult) => {
                    try {
                        conn.delete_finish(res);
                    } catch (e) {
                        logger.error(
                            'network',
                            'forget failed:',
                            e instanceof Error ? e.message : String(e)
                        );
                    }
                });
            }
        } catch (e) {
            logger.error('network', 'forget error:', e);
        }
    };
}

// ── ApRow component ──

function ApRow({snap, wifi, isActive, isConnecting, setConnectingAp}: ApRowProps) {
    const apSsid = snap.ssid;
    const apBssid = snap.bssid;
    const secure = snap.secure;
    const secLabel = snap.secLabel;

    const [showPassword, setShowPassword] = createState(false);
    const [passwordEntry, setPasswordEntry] = createState<Gtk.Entry | null>(null);
    const [passwordError, setPasswordError] = createState<string | null>(null);

    const connectState: ConnectState = {
        lastConnectMs: 0,
        setConnectingAp,
        setShowPassword,
        showPassword,
        setPasswordError,
    };

    const doConnect = createDoConnect(wifi, apBssid, apSsid, secure, connectState);
    const doForget = createDoForget(wifi, apBssid, apSsid);

    const notActive = computed(() => !isActive());
    const canForget = computed(() => {
        if (isActive()) return false;
        const liveAp = findLiveAp(wifi, apBssid, apSsid);
        if (!liveAp) return false;
        return isSaved(liveAp);
    });

    const prefixIcon = secure
        ? 'network-wireless-encrypted-symbolic'
        : signalIconName(snap.strength);

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={0}>
                <Gtk.Button
                    hexpand
                    cssClasses={['flat']}
                    onClicked={() => {
                        if (isActive()) {
                            try {
                                wifi.deactivate_connection(null);
                            } catch (e) {
                                logger.error(
                                    'network',
                                    'deactivate failed:',
                                    e instanceof Error ? e.message : String(e)
                                );
                            }
                            return;
                        }
                        doConnect();
                    }}
                >
                    <Gtk.Box spacing={12}>
                        <Gtk.Image iconName={prefixIcon} pixelSize={AP_ICON_SIZE} />

                        <Gtk.Box
                            hexpand
                            halign={Gtk.Align.FILL}
                            orientation={Gtk.Orientation.VERTICAL}
                            spacing={2}
                        >
                            <Gtk.Label
                                hexpand
                                halign={Gtk.Align.FILL}
                                label={apSsid}
                                ellipsize={3}
                            />
                            <Gtk.Label
                                halign={Gtk.Align.START}
                                label={secLabel}
                                cssClasses={['dim-label', 'caption']}
                            />
                        </Gtk.Box>

                        <Gtk.Image
                            iconName={signalIconName(snap.strength)}
                            pixelSize={AP_ICON_SIZE}
                            valign={Gtk.Align.CENTER}
                            visible={secure}
                            tooltipText={`${snap.strength}%`}
                        />
                        <Gtk.Image
                            iconName={signalIconName(snap.strength)}
                            pixelSize={AP_ICON_SIZE}
                            valign={Gtk.Align.CENTER}
                            visible={notActive.as((na) => na && !secure)}
                            tooltipText={`${snap.strength}%`}
                        />

                        <Gtk.Image
                            iconName="emblem-ok-symbolic"
                            pixelSize={AP_ICON_SIZE}
                            visible={isActive}
                        />
                        <Gtk.Spinner spinning visible={isConnecting} />
                    </Gtk.Box>
                </Gtk.Button>

                <Gtk.Button
                    visible={canForget}
                    cssClasses={['flat', 'circular']}
                    onClicked={doForget}
                    tooltipText="Forget Network"
                    valign={Gtk.Align.CENTER}
                >
                    <Gtk.Image iconName="user-trash-symbolic" pixelSize={AP_TRASH_ICON_SIZE} />
                </Gtk.Button>
            </Gtk.Box>

            <Gtk.Revealer
                revealChild={showPassword}
                transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
            >
                <Gtk.Box spacing={4} marginStart={28} marginEnd={4} marginTop={4} marginBottom={4}>
                    <Gtk.Entry
                        placeholderText="Password"
                        visibility={false}
                        hexpand
                        ref={(self) => {
                            setPasswordEntry(self);
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                self.grab_focus();
                                return GLib.SOURCE_REMOVE;
                            });

                            const controller = new Gtk.EventControllerKey();
                            controller.connect('key-pressed', (_ctrl, keyval) => {
                                if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
                                    doConnect(self.get_text() || undefined);
                                    return true;
                                }
                                return false;
                            });
                            self.add_controller(controller);
                        }}
                    />
                    <Gtk.Button
                        cssClasses={['suggested-action']}
                        onClicked={() => {
                            const entry = passwordEntry();
                            doConnect(entry?.get_text() || undefined);
                        }}
                    >
                        <Gtk.Image iconName="go-next-symbolic" />
                    </Gtk.Button>
                    <Gtk.Button onClicked={() => setShowPassword(false)}>
                        <Gtk.Image iconName="window-close-symbolic" />
                    </Gtk.Button>
                </Gtk.Box>
            </Gtk.Revealer>

            <Gtk.Label
                label={passwordError.as((e) => e ?? '')}
                cssClasses={['error', 'caption']}
                marginStart={28}
                marginBottom={4}
                visible={passwordError.as((e) => e !== null)}
                wrap
            />
        </Gtk.Box>
    );
}

export default ApRow;
