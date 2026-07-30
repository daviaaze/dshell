import Network from 'gi://AstalNetwork';
import NM from 'gi://NM?version=1.0';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, createState, With, For} from 'gnim';
import {toArray} from '../../lib/core/gjsUtils';
import {
    strengthFraction,
    securityLabelFromKeyMgmt,
    deleteConnectionAsync,
} from '../quicksettings/network/utils';
import logger from '../../lib/core/logger';
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
                if (!sWifi) continue;
                const ssid = conn.get_id() ?? 'Unknown Network';
                const sSec = conn.get_setting_wireless_security();
                const secLabel = sSec
                    ? (securityLabelFromKeyMgmt(sSec.get_key_mgmt() ?? null) ??
                      'Open')
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
                logger.debug(
                    'settings-network',
                    'Skipping connection:',
                    connErr
                );
            }
        }
    } catch (e) {
        logger.error('settings-network', 'getKnownNetworks error:', e);
    }

    return Array.from(bySsid.entries())
        .map(([ssid, info]) => ({ssid, ...info}))
        .sort((a, b) => a.ssid.localeCompare(b.ssid));
}

// ── Main Settings Page ─────────────────────────────────────────────

export default () => {
    const network = Network.get_default();
    const wifi = bind(network, 'wifi');
    const wired = bind(network, 'wired');
    const [knownVersion, bumpKnown] = createState(0);
    const knownNetworks = computed(() => {
        knownVersion(); // track dependency for recompute on bumpKnown
        return getKnownNetworks(network.client);
    });

    return (
        <>
            {wifi() && (
                <Adw.PreferencesGroup
                    title="Wi-Fi"
                    description="Wireless network connections"
                >
                    <With value={wifi}>
                        {w =>
                            w ? (
                                <Adw.SwitchRow
                                    title="Wi-Fi"
                                    subtitle={bind(w, 'ssid').as(ssid =>
                                        ssid
                                            ? `Connected to ${ssid}`
                                            : 'Not connected'
                                    )}
                                    active={bind(w, 'enabled')}
                                    onNotifyActive={self => {
                                        w.enabled = self.active;
                                    }}
                                />
                            ) : null
                        }
                    </With>
                    <With value={wifi}>
                        {w =>
                            w ? (
                                <Adw.ActionRow
                                    title="Signal Strength"
                                    subtitle={bind(w, 'strength').as(
                                        s => `${s}%`
                                    )}
                                >
                                    <Gtk.LevelBar
                                        valign={Gtk.Align.CENTER}
                                        value={bind(w, 'strength').as(s =>
                                            strengthFraction(s)
                                        )}
                                        widthRequest={NET_SIGNAL_BAR_WIDTH}
                                    />
                                </Adw.ActionRow>
                            ) : null
                        }
                    </With>
                    <Adw.ActionRow
                        title="Connect to Hidden Network…"
                        activatable
                        onActivated={self => showHiddenNetworkDialog(self)}
                    >
                        <Gtk.Image
                            iconName="network-wireless-symbolic"
                            pixelSize={NET_ICON_PREFIX}
                        />
                    </Adw.ActionRow>
                </Adw.PreferencesGroup>
            )}

            <Adw.PreferencesGroup
                title="Known Networks"
                description="Saved Wi-Fi networks"
                visible={wifi.as(w => w !== null)}
            >
                <For each={knownNetworks}>
                    {(net: {
                        ssid: string;
                        secure: boolean;
                        secLabel: string;
                        connections: NM.RemoteConnection[];
                    }) => (
                        <Adw.ActionRow
                            title={net.ssid}
                            subtitle={net.secLabel}
                            activatable
                            onActivated={self =>
                                showConnectionEditor(
                                    net.ssid,
                                    net.connections,
                                    self,
                                    () => bumpKnown(knownVersion() + 1)
                                )
                            }
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
                                        .then(() =>
                                            bumpKnown(knownVersion() + 1)
                                        )
                                        .catch((e: Error) =>
                                            logger.error(
                                                'settings-network',
                                                'forget failed:',
                                                e.message
                                            )
                                        );
                                }}
                                tooltipText="Forget Network"
                            >
                                <Gtk.Image
                                    iconName="user-trash-symbolic"
                                    pixelSize={NET_ICON_SUFFIX}
                                />
                            </Gtk.Button>
                        </Adw.ActionRow>
                    )}
                </For>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Wired"
                description="Ethernet connection"
            >
                <With value={wired}>
                    {w =>
                        w ? (
                            <Adw.ActionRow
                                title="Wired Connection"
                                subtitle={bind(w, 'state').as(s =>
                                    s === Network.DeviceState.ACTIVATED
                                        ? 'Connected'
                                        : 'Disconnected'
                                )}
                            >
                                <Gtk.Image
                                    iconName={bind(w, 'icon-name')}
                                />
                            </Adw.ActionRow>
                        ) : null
                    }
                </With>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Hotspot"
                description="Share your internet connection over Wi-Fi"
                visible={wifi.as(w => w !== null)}
            >
                <With value={wifi}>
                    {w =>
                        w ? (
                            <Adw.ActionRow
                                title="Hotspot"
                                subtitle={bind(w, 'is-hotspot').as(h =>
                                    h ? 'Active' : 'Inactive'
                                )}
                            >
                                <Gtk.Switch
                                    valign={Gtk.Align.CENTER}
                                    active={bind(w, 'is-hotspot')}
                                    onNotifyActive={() =>
                                        logger.info(
                                            'settings-network',
                                            'Hotspot toggle not yet implemented'
                                        )
                                    }
                                />
                            </Adw.ActionRow>
                        ) : null
                    }
                </With>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Connectivity"
                description="Internet access status"
            >
                <Adw.ActionRow
                    title="Connectivity"
                    subtitle={bind(network, 'connectivity').as(c => {
                        if (c === Network.Connectivity.FULL)
                            return 'Full internet access';
                        if (c === Network.Connectivity.LIMITED)
                            return 'Limited connectivity';
                        return 'No connectivity';
                    })}
                />
            </Adw.PreferencesGroup>
        </>
    );
};
