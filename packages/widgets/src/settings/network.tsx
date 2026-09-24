import Adw from 'gi://Adw?version=1';
import Network from 'gi://AstalNetwork';
import type Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import NM from 'gi://NM?version=1.0';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import {type Accessor, bind, computed, createState, For, onCleanup, With} from 'gnim';
import {
    deleteConnectionAsync,
    securityLabelFromKeyMgmt,
    strengthFraction,
} from '../quicksettings/network/utils';
import {showConnectionEditor} from './connectionEditor';
import {showHiddenNetworkDialog} from './hiddenNetworkDialog';

const NET_ICON_PREFIX = 16;
const NET_ICON_SUFFIX = 14;
const NET_SIGNAL_BAR_WIDTH = 50;

/** Get all known (saved) WiFi connections from NM.Client. */
function getKnownNetworks(client: NM.Client): {
    ssid: string;
    secure: boolean;
    secLabel: string;
    connections: NM.RemoteConnection[];
}[] {
    const bySsid = new Map<
        string,
        {secure: boolean; secLabel: string; connections: NM.RemoteConnection[]}
    >();

    try {
        const allConns = toArray<NM.RemoteConnection>(client.get_connections());
        for (const conn of allConns) {
            try {
                const sWifi = conn.get_setting_wireless();
                if (!sWifi || sWifi.mode === 'ap') continue;
                const ssid = conn.get_id() ?? 'Unknown Network';
                const sSec = conn.get_setting_wireless_security();
                const secLabel = sSec
                    ? (securityLabelFromKeyMgmt(sSec.get_key_mgmt() ?? null) ?? 'Open')
                    : 'Open';
                const secure = secLabel !== 'Open';

                const existing = bySsid.get(ssid);
                if (existing) {
                    existing.connections.push(conn);
                    if (secure && !existing.secure) {
                        existing.secure = secure;
                        existing.secLabel = secLabel;
                    }
                } else {
                    bySsid.set(ssid, {secure, secLabel, connections: [conn]});
                }
            } catch (connErr) {
                logger.debug(LOG_TAG, 'Skipping connection:', connErr);
            }
        }
    } catch (e) {
        logger.error(LOG_TAG, 'getKnownNetworks error:', e);
    }

    return Array.from(bySsid.entries())
        .map(([ssid, info]) => ({ssid, ...info}))
        .sort((a, b) => a.ssid.localeCompare(b.ssid));
}

// ── Main Settings Page ─────────────────────────────────────────────

interface KnownNetwork {
    ssid: string;
    secure: boolean;
    secLabel: string;
    connections: NM.RemoteConnection[];
}

type NetworkService = ReturnType<typeof Network.get_default>;

const HOTSPOT_CONNECTION_ID = 'Shade Wi-Fi Hotspot';

function wifiDevice(wifi: Network.Wifi | null): NM.DeviceWifi | null {
    return (wifi?.device as NM.DeviceWifi | null) ?? null;
}

function deviceIsPresent(client: NM.Client, device: NM.Device): boolean {
    try {
        return toArray<NM.Device>(client.get_devices()).includes(device);
    } catch {
        return false;
    }
}

function hotspotUnavailableReason(
    network: NetworkService,
    client: NM.Client,
    wifi: Network.Wifi | null
): string | null {
    if (!wifi) return 'No Wi-Fi adapter';

    const device = wifiDevice(wifi);
    if (!device || network.wifi?.device !== device || !deviceIsPresent(client, device)) {
        return 'Wi-Fi adapter is unavailable';
    }

    try {
        if ((device.get_capabilities() & NM.DeviceWifiCapabilities.AP) === 0) {
            return 'This adapter does not support hotspot mode';
        }
    } catch (e) {
        logger.error(LOG_TAG, 'unable to check hotspot capability:', e);
        return 'Unable to check Wi-Fi hotspot support';
    }

    return null;
}

function findManagedHotspot(
    client: NM.Client,
    device: NM.DeviceWifi
): NM.ActiveConnection | null {
    try {
        for (const active of toArray<NM.ActiveConnection>(client.get_active_connections())) {
            if (
                active.get_id() !== HOTSPOT_CONNECTION_ID ||
                !toArray<NM.Device>(active.get_devices()).includes(device)
            ) {
                continue;
            }

            if (active.get_connection()?.get_setting_wireless()?.mode === 'ap') return active;
        }
    } catch (e) {
        logger.error(LOG_TAG, 'unable to find active hotspot connection:', e);
    }

    return null;
}

function createHotspotConnection(ssid: string, password: string): NM.SimpleConnection {
    const connection = new NM.SimpleConnection();

    const settingConnection = new NM.SettingConnection();
    settingConnection.type = '802-11-wireless';
    settingConnection.uuid = GLib.uuid_string_random() ?? undefined;
    settingConnection.id = HOTSPOT_CONNECTION_ID;
    settingConnection.autoconnect = false;
    connection.add_setting(settingConnection);

    const settingWireless = new NM.SettingWireless();
    settingWireless.ssid = new GLib.Bytes(new TextEncoder().encode(ssid));
    settingWireless.mode = 'ap';
    connection.add_setting(settingWireless);

    const settingSecurity = new NM.SettingWirelessSecurity();
    settingSecurity.keyMgmt = 'wpa-psk';
    settingSecurity.psk = password;
    settingSecurity.proto = ['rsn'];
    settingSecurity.pairwise = ['ccmp'];
    settingSecurity.group = ['ccmp'];
    connection.add_setting(settingSecurity);

    const settingIp4 = new NM.SettingIP4Config();
    settingIp4.method = 'shared';
    connection.add_setting(settingIp4);

    return connection;
}

function addAndActivateHotspot(
    client: NM.Client,
    connection: NM.SimpleConnection,
    device: NM.DeviceWifi
): Promise<NM.ActiveConnection> {
    const {promise, resolve, reject} = Promise.withResolvers<NM.ActiveConnection>();
    client.add_and_activate_connection_async(
        connection,
        device,
        null,
        null,
        (_source: unknown, result: Gio.AsyncResult) => {
            try {
                const active = client.add_and_activate_connection_finish(result);
                if (!active) throw new Error('NetworkManager returned no active connection');
                resolve(active);
            } catch (e) {
                reject(e);
            }
        }
    );
    return promise;
}

function deactivateHotspot(
    client: NM.Client,
    active: NM.ActiveConnection
): Promise<void> {
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    client.deactivate_connection_async(
        active,
        null,
        (_source: unknown, result: Gio.AsyncResult) => {
            try {
                if (!client.deactivate_connection_finish(result)) {
                    throw new Error('NetworkManager did not deactivate the hotspot');
                }
                resolve();
            } catch (e) {
                reject(e);
            }
        }
    );
    return promise;
}


/** Wi-Fi group: adapter state, signal level, and hidden-network entry. */
function WifiGroup({wifi}: {wifi: Accessor<Network.Wifi | null>}) {
    return (
        <Adw.PreferencesGroup title="Wi-Fi" description="Wireless network connections">
            <With value={wifi}>
                {(w) =>
                    w ? (
                        <Adw.SwitchRow
                            title="Wi-Fi"
                            subtitle={bind(w, 'ssid').as((ssid) =>
                                ssid ? `Connected to ${ssid}` : 'Not connected'
                            )}
                            active={bind(w, 'enabled')}
                            onNotifyActive={(self) => {
                                w.enabled = self.active;
                            }}
                        />
                    ) : (
                        <Adw.ActionRow
                            title="No Wi-Fi adapter"
                            subtitle="Wireless features are unavailable"
                        />
                    )
                }
            </With>
            <With value={wifi}>
                {(w) =>
                    w ? (
                        <Adw.ActionRow
                            title="Signal Strength"
                            subtitle={bind(w, 'strength').as((s) => `${s}%`)}
                        >
                            <Gtk.LevelBar
                                valign={Gtk.Align.CENTER}
                                value={bind(w, 'strength').as((s) => strengthFraction(s))}
                                widthRequest={NET_SIGNAL_BAR_WIDTH}
                            />
                        </Adw.ActionRow>
                    ) : null
                }
            </With>
            <Adw.ActionRow
                title="Connect to Hidden Network…"
                subtitle={wifi.as((w) =>
                    w
                        ? 'Connect to a network not broadcasting its name'
                        : 'No Wi-Fi adapter available'
                )}
                activatable={wifi.as((w) => w !== null)}
                sensitive={wifi.as((w) => w !== null)}
                onActivated={(self) => {
                    if (wifi()) showHiddenNetworkDialog(self);
                }}
            >
                <Gtk.Image iconName="network-wireless-symbolic" pixelSize={NET_ICON_PREFIX} />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

/** One saved-network row: opens the editor, with a forget button. */
function KnownNetworkRow({net, onChanged}: {net: KnownNetwork; onChanged: () => void}) {
    return (
        <Adw.ActionRow
            title={net.ssid}
            subtitle={net.secLabel}
            activatable
            onActivated={(self) => showConnectionEditor(net.ssid, net.connections, self, onChanged)}
        >
            <Gtk.Image
                iconName={
                    net.secure
                        ? 'network-wireless-encrypted-symbolic'
                        : 'network-wireless-signal-none-symbolic'
                }
                pixelSize={NET_ICON_PREFIX}
            />
            <Gtk.Button
                cssClasses={['flat', 'circular']}
                onClicked={() => {
                    const first = net.connections[0];
                    if (!first) return;
                    deleteConnectionAsync(first)
                        .then(onChanged)
                        .catch((e: Error) => logger.error(LOG_TAG, 'forget failed:', e.message));
                }}
                tooltipText="Forget Network"
            >
                <Gtk.Image iconName="user-trash-symbolic" pixelSize={NET_ICON_SUFFIX} />
            </Gtk.Button>
        </Adw.ActionRow>
    );
}

/** Wired group: ethernet state row. */
function WiredGroup({wired}: {wired: Accessor<Network.Wired | null>}) {
    return (
        <Adw.PreferencesGroup title="Wired" description="Ethernet connection">
            <With value={wired}>
                {(w) =>
                    w ? (
                        <Adw.ActionRow
                            title="Wired Connection"
                            subtitle={bind(w, 'state').as((s) =>
                                s === Network.DeviceState.ACTIVATED ? 'Connected' : 'Disconnected'
                            )}
                        >
                            <Gtk.Image iconName={bind(w, 'icon-name')} />
                        </Adw.ActionRow>
                    ) : null
                }
            </With>
        </Adw.PreferencesGroup>
    );
}

/** Hotspot group: create and manage a WPA2-protected shared connection. */
function HotspotGroup({
    wifi,
    network,
    client,
    deviceVersion,
}: {
    wifi: Accessor<Network.Wifi | null>;
    network: NetworkService;
    client: NM.Client;
    deviceVersion: Accessor<number>;
}) {
    const [ssid, setSsid] = createState('Shade Hotspot');
    const [password, setPassword] = createState('');
    const [pending, setPending] = createState(false);
    const [pendingTarget, setPendingTarget] = createState(false);
    const [errorMsg, setErrorMsg] = createState<string | null>(null);
    const [toggleRevision, bumpToggleRevision] = createState(0);
    const reportToggleError = (message: string) => {
        setErrorMsg(message);
        bumpToggleRevision(toggleRevision() + 1);
    };

    const setHotspot = async (enabled: boolean, expectedWifi: Network.Wifi | null) => {
        if (pending()) return;
        setErrorMsg(null);

        const device = wifiDevice(expectedWifi);
        if (!device || network.wifi?.device !== device || !deviceIsPresent(client, device)) {
            reportToggleError('Wi-Fi adapter is unavailable');
            return;
        }

        if (enabled) {
            const reason = hotspotUnavailableReason(network, client, expectedWifi);
            if (reason) {
                reportToggleError(reason);
                return;
            }
            if (!network.wifi?.enabled) {
                reportToggleError('Turn on Wi-Fi before starting a hotspot');
                return;
            }

            const ssidValue = ssid();
            const ssidBytes = new TextEncoder().encode(ssidValue);
            if (!ssidValue.trim() || ssidBytes.length > 32) {
                reportToggleError('Enter a network name no longer than 32 UTF-8 bytes');
                return;
            }

            const passwordValue = password();
            const passwordBytes = new TextEncoder().encode(passwordValue);
            const rawPsk = /^[0-9a-fA-F]{64}$/.test(passwordValue);
            if (!rawPsk && (passwordBytes.length < 8 || passwordBytes.length > 63)) {
                reportToggleError(
                    'Password must be 8–63 UTF-8 bytes or a 64-digit hexadecimal PSK'
                );
                return;
            }

            setPendingTarget(true);
            setPending(true);
            try {
                if (network.wifi?.device !== device || !deviceIsPresent(client, device)) {
                    throw new Error('Wi-Fi adapter was removed before hotspot activation');
                }

                const active = await addAndActivateHotspot(
                    client,
                    createHotspotConnection(ssidValue, passwordValue),
                    device
                );
                if (
                    network.wifi?.device !== device ||
                    !deviceIsPresent(client, device)
                ) {
                    throw new Error('Wi-Fi adapter was removed during hotspot activation');
                }
                if (
                    active.get_id() !== HOTSPOT_CONNECTION_ID ||
                    !toArray<NM.Device>(active.get_devices()).includes(device)
                ) {
                    throw new Error('NetworkManager activated an unexpected hotspot connection');
                }
            } catch (e) {
                logger.error(LOG_TAG, 'hotspot activation failed:', e);
                const message = e instanceof Error ? e.message : String(e);
                reportToggleError(message || 'Hotspot activation failed');
            } finally {
                setPending(false);
            }
            return;
        }

        const active = findManagedHotspot(client, device);
        if (!active) {
            reportToggleError(
                'No Settings-managed hotspot connection was found; the active hotspot was left unchanged'
            );
            return;
        }

        setPendingTarget(false);
        setPending(true);
        try {
            if (network.wifi?.device !== device || !deviceIsPresent(client, device)) {
                throw new Error('Wi-Fi adapter was removed before hotspot deactivation');
            }
            await deactivateHotspot(client, active);
        } catch (e) {
            logger.error(LOG_TAG, 'hotspot deactivation failed:', e);
            const message = e instanceof Error ? e.message : String(e);
            reportToggleError(message || 'Hotspot deactivation failed');
        } finally {
            setPending(false);
        }
    };

    return (
        <With value={wifi}>
            {(w) => {
                const actualHotspot = w ? bind(w, 'is-hotspot') : null;
                const wifiEnabled = w ? bind(w, 'enabled') : null;
                const capabilityError = computed(() => {
                    deviceVersion();
                    return hotspotUnavailableReason(network, client, w);
                });
                const switchActive = computed(() => {
                    toggleRevision();
                    return pending() ? pendingTarget() : (actualHotspot?.() ?? false);
                });
                const controlsEnabled = computed(
                    () =>
                        !pending() &&
                        !actualHotspot?.() &&
                        capabilityError() === null &&
                        (wifiEnabled?.() ?? false)
                );
                const switchEnabled = computed(() => {
                    deviceVersion();
                    if (pending()) return false;
                    const device = wifiDevice(w);
                    if (actualHotspot?.()) {
                        return (
                            !!device &&
                            network.wifi?.device === device &&
                            deviceIsPresent(client, device)
                        );
                    }
                    return capabilityError() === null && (wifiEnabled?.() ?? false);
                });
                const subtitle = computed(() => {
                    if (pending()) return pendingTarget() ? 'Starting…' : 'Stopping…';
                    if (actualHotspot?.()) return 'Active';
                    return (
                        capabilityError() ??
                        ((wifiEnabled?.() ?? false)
                            ? 'Inactive'
                            : 'Turn on Wi-Fi to start a hotspot')
                    );
                });

                return (
                    <>
                        <Adw.PreferencesGroup
                            title="Hotspot"
                            description="Create a WPA2-protected Wi-Fi access point"
                        >
                            <Adw.ActionRow title="Hotspot" subtitle={subtitle}>
                                <Gtk.Switch
                                    valign={Gtk.Align.CENTER}
                                    active={switchActive}
                                    sensitive={switchEnabled}
                                    onNotifyActive={(self) => {
                                        if (pending()) return;
                                        const current = network.wifi?.isHotspot ?? false;
                                        if (self.active !== current) {
                                            void setHotspot(self.active, w);
                                        }
                                    }}
                                />
                            </Adw.ActionRow>
                            <Adw.EntryRow title="Network name" sensitive={controlsEnabled}>
                                <Gtk.Entry
                                    placeholderText="SSID (1–32 bytes)"
                                    text={ssid}
                                    ref={(entry) =>
                                        entry.connect('notify::text', () => {
                                            setSsid(entry.get_text());
                                            setErrorMsg(null);
                                        })
                                    }
                                />
                            </Adw.EntryRow>
                            <Adw.EntryRow title="Password" sensitive={controlsEnabled}>
                                <Gtk.Entry
                                    placeholderText="8–63 bytes"
                                    text={password}
                                    visibility={false}
                                    ref={(entry) =>
                                        entry.connect('notify::text', () => {
                                            setPassword(entry.get_text());
                                            setErrorMsg(null);
                                        })
                                    }
                                />
                            </Adw.EntryRow>
                        </Adw.PreferencesGroup>
                        <Gtk.Label
                            label={errorMsg.as((error) => error ?? '')}
                            cssClasses={['error', 'caption']}
                            visible={errorMsg.as((error) => error !== null)}
                            wrap
                            marginStart={12}
                            marginEnd={12}
                            marginBottom={12}
                        />
                    </>
                );
            }}
        </With>
    );
}

/** Connectivity group: internet access status. */
function ConnectivityGroup({network}: {network: NetworkService}) {
    return (
        <Adw.PreferencesGroup title="Connectivity" description="Internet access status">
            <Adw.ActionRow
                title="Connectivity"
                subtitle={bind(network, 'connectivity').as((c) => {
                    if (c === Network.Connectivity.FULL) return 'Full internet access';
                    if (c === Network.Connectivity.LIMITED) return 'Limited connectivity';
                    return 'No connectivity';
                })}
            />
        </Adw.PreferencesGroup>
    );
}

const LOG_TAG = 'settings-network';

export default () => {
    const network = Network.get_default();
    const client = network.client as NM.Client;
    const wifi = bind(network, 'wifi');
    const wired = bind(network, 'wired');
    const [knownVersion, bumpKnown] = createState(0);
    const [deviceVersion, bumpDeviceVersion] = createState(0);
    const knownNetworks = computed(() => {
        knownVersion(); // track dependency for recompute on bumpKnown
        return getKnownNetworks(client);
    });
    const onKnownChanged = () => bumpKnown(knownVersion() + 1);
    const onDevicesChanged = () => bumpDeviceVersion(deviceVersion() + 1);
    const deviceAddedSignal = client.connect('device-added', onDevicesChanged);
    const deviceRemovedSignal = client.connect('device-removed', onDevicesChanged);
    onCleanup(() => {
        client.disconnect(deviceAddedSignal);
        client.disconnect(deviceRemovedSignal);
    });

    return (
        <>
            <WifiGroup wifi={wifi} />
            <Adw.PreferencesGroup
                title="Known Networks"
                description="Saved Wi-Fi networks"
                visible={wifi.as((w) => w !== null)}
            >
                <For each={knownNetworks}>
                    {(net: KnownNetwork) => (
                        <KnownNetworkRow net={net} onChanged={onKnownChanged} />
                    )}
                </For>
            </Adw.PreferencesGroup>
            <WiredGroup wired={wired} />
            <HotspotGroup
                wifi={wifi}
                network={network}
                client={client}
                deviceVersion={deviceVersion}
            />
            <ConnectivityGroup network={network} />
        </>
    );
};
