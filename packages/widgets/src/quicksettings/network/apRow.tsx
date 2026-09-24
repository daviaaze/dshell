import type Network from 'gi://AstalNetwork';
import Gdk from 'gi://Gdk?version=4.0';
import type Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import NM from 'gi://NM?version=1.0';
import logger from '@shade/core/logger';
import {type Accessor, computed, createState} from 'gnim';
import {
    type ApSnapshot,
    bssidEquals,
    bssidOf,
    bytesToString,
    commitChangesAsync,
    createNMConnection,
    deleteConnectionAsync,
    signalIconName,
    AP_ICON_SIZE,
    AP_TRASH_ICON_SIZE,
} from './utils';

// ── Operation guard: prevent concurrent WiFi operations ──
let _opInProgress = false;

async function guardedOp(fn: () => Promise<void>): Promise<void> {
    if (_opInProgress) throw new Error('Another Wi-Fi operation is already in progress');
    _opInProgress = true;
    try {
        await fn();
    } finally {
        _opInProgress = false;
    }
}

interface ApRowProps {
    snap: ApSnapshot;
    wifi: Network.Wifi;
    client: NM.Client;
    connectionRevision: Accessor<number>;
    isActive: Accessor<boolean>;
    isConnecting: Accessor<boolean>;
    setConnectingAp: (v: string | null) => void;
}

// ── NM operations ──

function currentAccessPoint(
    wifi: Network.Wifi,
    snap: ApSnapshot
): {device: NM.DeviceWifi; ap: NM.AccessPoint} {
    const device = (wifi.device as NM.DeviceWifi | null) ?? null;
    if (!device) throw new Error('Wi-Fi device is no longer available');

    const ap = device.get_access_point_by_path(snap.objectPath);
    if (!ap) throw new Error('Network is no longer available');
    const currentBssid = bssidOf(ap);
    if (snap.bssid && (!currentBssid || !bssidEquals(snap.bssid, currentBssid))) {
        throw new Error('Network is no longer available');
    }

    return {device, ap};
}

function savedConnectionsFor(
    client: NM.Client,
    ap: NM.AccessPoint,
    ssid: string
): NM.RemoteConnection[] {
    return client.get_connections().filter((connection) => {
        try {
            const wireless = connection.get_setting_wireless();
            return (
                wireless !== null &&
                bytesToString(wireless.ssid) === ssid &&
                ap.connection_valid(connection)
            );
        } catch {
            return false;
        }
    });
}

function activationError(reason: number): Error {
    const reasonName = Object.entries(NM.ActiveConnectionStateReason).find(
        ([name, value]) => name === name.toUpperCase() && value === reason
    )?.[0];
    const detail = reasonName
        ? reasonName.toLowerCase().replace(/_/g, ' ')
        : `state reason ${reason}`;
    return new Error(`NetworkManager could not activate the connection: ${detail}`);
}

function waitForActivation(active: NM.ActiveConnection): Promise<void> {
    if (active.state === NM.ActiveConnectionState.ACTIVATED) return Promise.resolve();
    if (active.state === NM.ActiveConnectionState.DEACTIVATED) {
        return Promise.reject(activationError(NM.ActiveConnectionStateReason.UNKNOWN));
    }

    const {promise, resolve, reject} = Promise.withResolvers<void>();
    let handlerId = 0;
    let settled = false;
    const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        try {
            active.disconnect(handlerId);
        } catch {
            // The connection may already have been removed from NetworkManager.
        }
        if (error) reject(error);
        else resolve();
    };

    handlerId = active.connect(
        'state-changed',
        (_active, state: number, reason: number) => {
            if (state === NM.ActiveConnectionState.ACTIVATED) finish();
            else if (state === NM.ActiveConnectionState.DEACTIVATED) {
                finish(activationError(reason));
            }
        }
    );

    const state: number = active.state;
    if (state === NM.ActiveConnectionState.ACTIVATED) finish();
    else if (state === NM.ActiveConnectionState.DEACTIVATED) {
        finish(activationError(NM.ActiveConnectionStateReason.UNKNOWN));
    }
    return promise;
}
function activateNMConnection(
    client: NM.Client,
    connection: NM.Connection,
    device: NM.DeviceWifi,
    objectPath: string,
    addConnection: boolean
): Promise<void> {
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    const callback = (_source: unknown, result: Gio.AsyncResult) => {
        let active: NM.ActiveConnection;
        try {
            active = addConnection
                ? client.add_and_activate_connection_finish(result)
                : client.activate_connection_finish(result);
            if (!active) throw new Error('NetworkManager returned no active connection');
        } catch (error) {
            reject(error);
            return;
        }
        waitForActivation(active).then(resolve, reject);
    };

    if (addConnection) {
        client.add_and_activate_connection_async(connection, device, objectPath, null, callback);
    } else {
        client.activate_connection_async(connection, device, objectPath, null, callback);
    }
    return promise;
}
function deactivateNMConnection(
    client: NM.Client,
    active: NM.ActiveConnection
): Promise<void> {
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    client.deactivate_connection_async(active, null, (_source, result) => {
        try {
            if (!client.deactivate_connection_finish(result)) {
                throw new Error('NetworkManager did not deactivate the connection');
            }
            resolve();
        } catch (error) {
            reject(error);
        }
    });
    return promise;
}


interface ConnectState {
    lastConnectMs: number;
    setConnectingAp: (v: string | null) => void;
    setShowPassword: (v: boolean) => void;
    showPassword: Accessor<boolean>;
    setOperationError: (v: string | null) => void;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) {
        const {message} = error as {message?: unknown};
        if (typeof message === 'string') return message;
    }
    return String(error);
}

function runOperation(state: ConnectState, name: string, run: () => Promise<void>): void {
    state.setOperationError(null);
    void guardedOp(run).catch((error: unknown) => {
        const message = errorMessage(error);
        logger.warn('network', `${name} failed:`, message);
        state.setOperationError(message || `${name} failed`);
    });
}

function createDoConnect(
    client: NM.Client,
    wifi: Network.Wifi,
    snap: ApSnapshot,
    state: ConnectState
) {
    const DEBOUNCE_MS = 1500;

    return (password?: string) => {
        const now = Date.now();
        if (now - state.lastConnectMs < DEBOUNCE_MS) return;
        state.lastConnectMs = now;

        runOperation(state, 'connect', async () => {
            const {device, ap} = currentAccessPoint(wifi, snap);
            if (!snap.ssid || snap.ssid === 'Hidden Network') {
                throw new Error('Network name is hidden; use the Hidden Network action');
            }

            const saved = savedConnectionsFor(client, ap, snap.ssid);
            if (snap.secure && password === undefined && saved.length === 0) {
                state.setShowPassword(!state.showPassword());
                return;
            }

            state.setConnectingAp(snap.bssid ?? snap.objectPath);
            try {
                if (saved.length > 0) {
                    const connection = saved[0];
                    if (password !== undefined) {
                        const security = connection.get_setting_wireless_security();
                        if (!security) {
                            throw new Error('Saved connection has no Wi-Fi password setting');
                        }
                        security.psk = password;
                        await commitChangesAsync(connection, true);
                    }

                    try {
                        await activateNMConnection(
                            client,
                            connection,
                            device,
                            snap.objectPath,
                            false
                        );
                    } catch (error) {
                        if (snap.secure && password === undefined) {
                            state.setShowPassword(true);
                        }
                        throw error;
                    }
                } else {
                    const connection = createNMConnection(
                        snap.ssid,
                        snap.secure ? password : undefined
                    );
                    await activateNMConnection(
                        client,
                        connection,
                        device,
                        snap.objectPath,
                        true
                    );
                }
                state.setShowPassword(false);
            } finally {
                state.setConnectingAp(null);
            }
        });
    };
}

function createDoDisconnect(
    client: NM.Client,
    wifi: Network.Wifi,
    snap: ApSnapshot,
    state: ConnectState
): () => void {
    return () => {
        runOperation(state, 'disconnect', async () => {
            const {device} = currentAccessPoint(wifi, snap);
            const active = device.get_active_connection();
            if (!active || active.specificObjectPath !== snap.objectPath) {
                throw new Error('Network is no longer active');
            }

            state.setConnectingAp(snap.bssid ?? snap.objectPath);
            try {
                await deactivateNMConnection(client, active);
            } finally {
                state.setConnectingAp(null);
            }
        });
    };
}

function createDoForget(
    client: NM.Client,
    wifi: Network.Wifi,
    snap: ApSnapshot,
    state: ConnectState
): () => void {
    return () => {
        runOperation(state, 'forget', async () => {
            const {ap} = currentAccessPoint(wifi, snap);
            const saved = savedConnectionsFor(client, ap, snap.ssid);
            for (const connection of saved) {
                await deleteConnectionAsync(connection);
            }
        });
    };
}
// ── ApRow component ──

function ApRow({snap, wifi, client, connectionRevision, isActive, isConnecting, setConnectingAp}: ApRowProps) {
    const apSsid = snap.ssid;
    const apBssid = snap.bssid;
    const secure = snap.secure;
    const secLabel = snap.secLabel;

    const [showPassword, setShowPassword] = createState(false);
    const [passwordEntry, setPasswordEntry] = createState<Gtk.Entry | null>(null);
    const [operationError, setOperationError] = createState<string | null>(null);
    const [cooldown, setCooldown] = createState(false);
    const connectState: ConnectState = {
        lastConnectMs: 0,
        setConnectingAp,
        setShowPassword,
        showPassword,
        setOperationError,
    };

    const doConnect = createDoConnect(client, wifi, snap, connectState);
    const doDisconnect = createDoDisconnect(client, wifi, snap, connectState);
    const doForget = createDoForget(client, wifi, snap, connectState);

    const notActive = computed(() => !isActive());
    const canForget = computed(() => {
        connectionRevision();
        if (isActive()) return false;
        try {
            const {ap} = currentAccessPoint(wifi, snap);
            return savedConnectionsFor(client, ap, apSsid).length > 0;
        } catch {
            return false;
        }
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
                        if (cooldown()) return;
                        setCooldown(true);
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            setCooldown(false);
                            return GLib.SOURCE_REMOVE;
                        });

                        if (isActive()) doDisconnect();
                        else doConnect();
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
                                cssClasses={['dimmed', 'caption']}
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
                    onClicked={() => {
                        if (cooldown()) return;
                        setCooldown(true);
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            setCooldown(false);
                            return GLib.SOURCE_REMOVE;
                        });
                        doForget();
                    }}
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
                label={operationError.as((e) => e ?? '')}
                cssClasses={['error', 'caption']}
                marginStart={28}
                marginBottom={4}
                visible={operationError.as((e) => e !== null)}
                wrap
            />
        </Gtk.Box>
    );
}

export default ApRow;
