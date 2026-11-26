import type Network from 'gi://AstalNetwork';
import type Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import NM from 'gi://NM?version=1.0';
import {IconNames} from '@shade/core/iconNames';
import logger from '@shade/core/logger';
import {type Accessor, computed, createState, effect, onCleanup} from 'gnim';
import {WifiOperationError, wifiErrorMessage} from '../operationError';
import {
    AP_ICON_SIZE,
    AP_TRASH_ICON_SIZE,
    type ApSnapshot,
    bssidEquals,
    bssidOf,
    bytesToString,
    commitChangesAsync,
    createNMConnection,
    deleteConnectionAsync,
    signalIconName,
} from './utils';

// ── Operation guard: prevent concurrent WiFi operations ──
let _opInProgress = false;

async function guardedOp(fn: () => Promise<void>): Promise<void> {
    if (_opInProgress)
        throw new WifiOperationError(
            'Outra operação Wi-Fi está em andamento. Aguarde e tente novamente.'
        );
    _opInProgress = true;
    try {
        await fn();
    } finally {
        _opInProgress = false;
    }
}

interface ApRowProps {
    snap: ApSnapshot;
    strength: Accessor<number>;
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
    if (!device) throw new WifiOperationError('O adaptador Wi-Fi não está mais disponível.');

    const ap = device.get_access_point_by_path(snap.objectPath);
    if (!ap)
        throw new WifiOperationError('A rede não está mais disponível. Busque redes novamente.');
    const currentBssid = bssidOf(ap);
    if (snap.bssid && (!currentBssid || !bssidEquals(snap.bssid, currentBssid))) {
        throw new WifiOperationError('A rede não está mais disponível. Busque redes novamente.');
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
    logger.warn('network', 'Connection activation failed, reason:', reason);
    switch (reason) {
        case NM.ActiveConnectionStateReason.NO_SECRETS:
        case NM.ActiveConnectionStateReason.LOGIN_FAILED:
            return new WifiOperationError('Verifique a senha da rede Wi-Fi e tente novamente.');
        case NM.ActiveConnectionStateReason.CONNECT_TIMEOUT:
        case NM.ActiveConnectionStateReason.SERVICE_START_TIMEOUT:
            return new WifiOperationError('A conexão Wi-Fi demorou demais. Tente novamente.');
        case NM.ActiveConnectionStateReason.IP_CONFIG_INVALID:
            return new WifiOperationError(
                'Não foi possível obter um endereço de rede. Tente novamente.'
            );
        case NM.ActiveConnectionStateReason.DEVICE_DISCONNECTED:
            return new WifiOperationError('O adaptador Wi-Fi foi desconectado.');
        case NM.ActiveConnectionStateReason.USER_DISCONNECTED:
            return new WifiOperationError('A conexão Wi-Fi foi cancelada.');
        default:
            return new WifiOperationError(
                'Não foi possível conectar à rede Wi-Fi. Tente novamente.'
            );
    }
}

function waitForActivation(active: NM.ActiveConnection): Promise<void> {
    if (active.state === NM.ActiveConnectionState.ACTIVATED) return Promise.resolve();
    if (active.state === NM.ActiveConnectionState.DEACTIVATED) {
        return Promise.reject(activationError(NM.ActiveConnectionStateReason.UNKNOWN));
    }

    const {promise, resolve, reject} = Promise.withResolvers<void>();
    let handlerId = 0;
    let timeoutSource = 0;
    let settled = false;
    const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutSource) GLib.source_remove(timeoutSource);
        timeoutSource = 0;
        try {
            active.disconnect(handlerId);
        } catch {
            // The connection may already have been removed from NetworkManager.
        }
        if (error) reject(error);
        else resolve();
    };

    handlerId = active.connect('state-changed', (_active, state: number, reason: number) => {
        if (state === NM.ActiveConnectionState.ACTIVATED) finish();
        else if (state === NM.ActiveConnectionState.DEACTIVATED) {
            finish(activationError(reason));
        }
    });
    timeoutSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
        timeoutSource = 0;
        finish(activationError(NM.ActiveConnectionStateReason.CONNECT_TIMEOUT));
        return GLib.SOURCE_REMOVE;
    });

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
            if (!active) throw new WifiOperationError('Não foi possível iniciar a conexão Wi-Fi.');
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
function deactivateNMConnection(client: NM.Client, active: NM.ActiveConnection): Promise<void> {
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    client.deactivate_connection_async(active, null, (_source, result) => {
        try {
            if (!client.deactivate_connection_finish(result)) {
                throw new WifiOperationError('Não foi possível desconectar da rede Wi-Fi.');
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
    setOperationError: (v: string | null) => void;
}

function runOperation(state: ConnectState, name: string, run: () => Promise<void>): void {
    state.setOperationError(null);
    void guardedOp(run).catch((error: unknown) => {
        logger.warn('network', `${name} failed:`, error);
        state.setOperationError(wifiErrorMessage(error));
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
            const ssid = bytesToString(ap.ssid);
            if (!ssid) {
                throw new WifiOperationError('Para esta rede, use “Conectar à rede oculta”.');
            }

            const saved = savedConnectionsFor(client, ap, ssid);
            if (snap.secure && password === undefined && saved.length === 0) {
                state.setShowPassword(true);
                return;
            }

            state.setConnectingAp(snap.bssid ?? snap.objectPath);
            try {
                if (saved.length > 0) {
                    const connection = saved[0];
                    if (password !== undefined) {
                        const security = connection.get_setting_wireless_security();
                        if (!security) {
                            throw new WifiOperationError(
                                'A conexão salva não tem uma senha Wi-Fi configurada.'
                            );
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
                    const connection = createNMConnection(ssid, snap.secure ? password : undefined);
                    await activateNMConnection(client, connection, device, snap.objectPath, true);
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
                throw new WifiOperationError('A rede não está mais conectada.');
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
function focusPasswordOnOpen(
    showPassword: Accessor<boolean>,
    passwordEntry: Accessor<Gtk.PasswordEntry | null>
): void {
    effect(() => {
        const entry = passwordEntry();
        if (!showPassword() || !entry) return;
        let source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            source = 0;
            if (showPassword() && entry.get_mapped()) entry.grab_focus();
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => {
            if (source) GLib.source_remove(source);
        });
    });
}

// ── ApRow component ──

function ApRow({
    snap,
    strength,
    wifi,
    client,
    connectionRevision,
    isActive,
    isConnecting,
    setConnectingAp,
}: ApRowProps) {
    const apSsid = snap.ssid;
    const secure = snap.secure;
    const secLabel = snap.secLabel;

    const [showPassword, setShowPassword] = createState(false);
    const [passwordEntry, setPasswordEntry] = createState<Gtk.PasswordEntry | null>(null);
    const [operationError, setOperationError] = createState<string | null>(null);
    const [cooldown, setCooldown] = createState(false);
    const [showForgetConfirm, setShowForgetConfirm] = createState(false);
    let cooldownSource = 0;
    const beginCooldown = () => {
        if (cooldown.peek()) return false;
        setCooldown(true);
        cooldownSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            cooldownSource = 0;
            setCooldown(false);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    };
    onCleanup(() => {
        if (cooldownSource) GLib.source_remove(cooldownSource);
    });
    const connectState: ConnectState = {
        lastConnectMs: 0,
        setConnectingAp,
        setShowPassword,
        setOperationError,
    };

    const doConnect = createDoConnect(client, wifi, snap, connectState);
    const doDisconnect = createDoDisconnect(client, wifi, snap, connectState);
    const doForget = createDoForget(client, wifi, snap, connectState);

    focusPasswordOnOpen(showPassword, passwordEntry);
    effect(() => {
        if (!showPassword()) passwordEntry()?.set_text('');
    });

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
    effect(() => {
        if (!canForget()) setShowForgetConfirm(false);
    });

    const strengthIcon = strength.as(signalIconName);
    const strengthTooltip = strength.as((value) => `${value}%`);
    const prefixIcon = secure ? 'network-wireless-encrypted-symbolic' : strengthIcon;

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={0}>
                <Gtk.Button
                    hexpand
                    cssClasses={['flat']}
                    tooltipText={isActive.as((active) =>
                        active ? `Desconectar de ${apSsid}` : `Conectar a ${apSsid}`
                    )}
                    onClicked={() => {
                        if (!beginCooldown()) return;
                        setShowForgetConfirm(false);

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
                                xalign={0}
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
                            iconName={strengthIcon}
                            pixelSize={AP_ICON_SIZE}
                            valign={Gtk.Align.CENTER}
                            visible={secure}
                            tooltipText={strengthTooltip}
                        />
                        <Gtk.Image
                            iconName={strengthIcon}
                            pixelSize={AP_ICON_SIZE}
                            valign={Gtk.Align.CENTER}
                            visible={notActive.as((na) => na && !secure)}
                            tooltipText={strengthTooltip}
                        />

                        <Gtk.Image
                            iconName={IconNames.emblemOk}
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
                        if (!beginCooldown()) return;
                        setShowPassword(false);
                        setShowForgetConfirm(true);
                    }}
                    tooltipText="Esquecer rede"
                    ref={(self) =>
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Esquecer rede')]
                        )
                    }
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
                    <Gtk.PasswordEntry
                        placeholderText="Senha"
                        showPeekIcon
                        hexpand
                        onActivate={(self) => {
                            const password = self.get_text();
                            if (password) doConnect(password);
                        }}
                        onMap={(self) => {
                            if (showPassword()) self.grab_focus();
                        }}
                        ref={(self) => {
                            setPasswordEntry(self);
                            self.update_property(
                                [Gtk.AccessibleProperty.LABEL],
                                [new GObject.Value(GObject.TYPE_STRING, `Senha de ${apSsid}`)]
                            );
                        }}
                    />
                    <Gtk.Button
                        cssClasses={['suggested-action']}
                        tooltipText={`Conectar a ${apSsid}`}
                        ref={(self) =>
                            self.update_property(
                                [Gtk.AccessibleProperty.LABEL],
                                [new GObject.Value(GObject.TYPE_STRING, `Conectar a ${apSsid}`)]
                            )
                        }
                        onClicked={() => {
                            const password = passwordEntry()?.get_text();
                            if (password) doConnect(password);
                        }}
                    >
                        <Gtk.Image iconName="go-next-symbolic" />
                    </Gtk.Button>
                    <Gtk.Button
                        tooltipText={`Ocultar campo de senha de ${apSsid}`}
                        ref={(self) =>
                            self.update_property(
                                [Gtk.AccessibleProperty.LABEL],
                                [
                                    new GObject.Value(
                                        GObject.TYPE_STRING,
                                        `Ocultar campo de senha de ${apSsid}`
                                    ),
                                ]
                            )
                        }
                        onClicked={() => setShowPassword(false)}
                    >
                        <Gtk.Image iconName="window-close-symbolic" />
                    </Gtk.Button>
                </Gtk.Box>
            </Gtk.Revealer>

            <Gtk.Revealer
                revealChild={showForgetConfirm}
                transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
            >
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    marginStart={12}
                    marginEnd={12}
                    marginTop={8}
                    marginBottom={8}
                >
                    <Gtk.Label label={`Esquecer a rede ${apSsid}?`} xalign={0} wrap />
                    <Gtk.Label
                        label="Todos os perfis salvos desta rede e suas senhas serão apagados."
                        cssClasses={['caption']}
                        xalign={0}
                        wrap
                    />
                    <Gtk.Box spacing={8} halign={Gtk.Align.END}>
                        <Gtk.Button
                            label="Cancelar"
                            onClicked={() => setShowForgetConfirm(false)}
                        />
                        <Gtk.Button
                            label="Esquecer"
                            cssClasses={['destructive-action']}
                            onClicked={() => {
                                if (!showForgetConfirm.peek() || !canForget.peek()) return;
                                setShowForgetConfirm(false);
                                doForget();
                            }}
                        />
                    </Gtk.Box>
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
