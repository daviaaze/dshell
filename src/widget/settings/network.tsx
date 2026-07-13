import Network from 'gi://AstalNetwork';
import NM from 'gi://NM?version=1.0';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed, createState, With, For} from 'gnim';
import {toArray} from '#/lib/core/gjsUtils';
import {
    strengthFraction,
    createNMConnection,
    securityLabelFromKeyMgmt,
    commitChangesAsync,
    deleteConnectionAsync,
} from '#/widget/quicksettings/network/utils';
import logger from '#/lib/core/logger';

// ── Helpers ────────────────────────────────────────────────────────

/** Pixel sizes for network settings icons. */
const NET_ICON_PREFIX = 16;
const NET_ICON_SUFFIX = 14;
const NET_SIGNAL_BAR_WIDTH = 50;

/** Get all known (saved) WiFi connections from NM.Client. */
function getKnownNetworks(
    client: NM.Client
): {
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
                const secLabel = securityLabelFromKeyMgmt(
                    sSec?.get_key_mgmt() ?? null
                );
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

// ── Connection Editor Dialog ───────────────────────────────────────

function showConnectionEditor(
    ssid: string,
    connections: NM.RemoteConnection[],
    parent: Gtk.Widget,
    onForgotten?: () => void
) {
    if (connections.length === 0) return;

    const conn = connections[0]!;
    const settingConn = conn.get_setting_connection();
    const settingSecurity = conn.get_setting_wireless_security();
    const isSecureConn = settingSecurity !== null;

    const dialog = new Adw.Window({
        transientFor: parent.get_root() as Gtk.Window,
        modal: true,
        title: ssid,
        defaultWidth: 400,
        defaultHeight: 300,
        cssClasses: ['background'],
    });

    const [autoConnect, setAutoConnect] = createState(
        settingConn ? settingConn.autoconnect : true
    );
    const [password, setPassword] = createState(
        isSecureConn ? (settingSecurity?.psk ?? '') : ''
    );
    const [showPassword, setShowPassword] = createState(false);
    const [saving, setSaving] = createState(false);
    const [errorMsg, setErrorMsg] = createState<string | null>(null);

    const saveChanges = () => {
        setSaving(true);
        setErrorMsg(null);

        try {
            if (settingConn) {
                settingConn.autoconnect = autoConnect();
            }
            if (settingSecurity && isSecureConn) {
                const pwd = password();
                if (pwd) {
                    settingSecurity.psk = pwd;
                }
            }
            commitChangesAsync(conn, true)
                .then(() => {
                    setSaving(false);
                    dialog.close();
                })
                .catch((e: Error) => {
                    logger.error(
                        'settings-network',
                        'commit failed:',
                        e.message
                    );
                    setErrorMsg(e.message || 'Failed to save');
                    setSaving(false);
                });
        } catch (e) {
            logger.error('settings-network', 'save error:', e);
            setErrorMsg(String(e));
            setSaving(false);
        }
    };

    const forgetNetwork = () => {
        deleteConnectionAsync(conn)
            .then(() => {
                dialog.close();
                onForgotten?.();
            })
            .catch((e: Error) =>
                logger.error('settings-network', 'forget failed:', e.message)
            );
    };

    dialog.set_content(
        (
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                <Adw.HeaderBar
                    titleWidget={
                        (
                            <Adw.WindowTitle
                                title={ssid}
                                cssClasses={['title-3']}
                            />
                        ) as Gtk.Widget
                    }
                    showEndTitleButtons={false}
                />
                <Gtk.ScrolledWindow
                    propagateNaturalHeight
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                >
                    <Adw.PreferencesPage>
                        <Adw.PreferencesGroup
                            title="Connection"
                            description={securityLabelFromKeyMgmt(
                                settingSecurity?.get_key_mgmt() ?? null
                            )}
                        >
                            <Adw.SwitchRow
                                title="Connect automatically"
                                active={autoConnect}
                                onNotifyActive={self =>
                                    setAutoConnect(self.active)
                                }
                            />
                        </Adw.PreferencesGroup>

                        {isSecureConn && (
                            <Adw.PreferencesGroup title="Security">
                                <Adw.EntryRow title="Password">
                                    <Gtk.Entry
                                        placeholderText="WiFi password"
                                        $={entry => {
                                            entry.visibility = !showPassword();
                                            showPassword.subscribe(() => {
                                                entry.visibility =
                                                    !showPassword();
                                            });
                                            entry.connect(
                                                'notify::text',
                                                () => {
                                                    setPassword(
                                                        entry.get_text()
                                                    );
                                                }
                                            );
                                        }}
                                    />
                                    <Gtk.Button
                                        $type="suffix"
                                        cssClasses={['flat']}
                                        onClicked={() =>
                                            setShowPassword(!showPassword())
                                        }
                                    >
                                        <Gtk.Image
                                            iconName={showPassword.as(v =>
                                                v
                                                    ? 'eye-not-looking-symbolic'
                                                    : 'eye-open-negative-filled-symbolic'
                                            )}
                                            pixelSize={NET_ICON_PREFIX}
                                        />
                                    </Gtk.Button>
                                </Adw.EntryRow>
                            </Adw.PreferencesGroup>
                        )}

                        <Gtk.Box
                            orientation={Gtk.Orientation.VERTICAL}
                            spacing={8}
                        >
                            <Gtk.Button
                                hexpand
                                cssClasses={['suggested-action']}
                                label={saving.as(s =>
                                    s ? 'Saving…' : 'Save Changes'
                                )}
                                sensitive={saving.as(s => !s)}
                                onClicked={saveChanges}
                            />
                            <Gtk.Button
                                hexpand
                                cssClasses={['destructive-action']}
                                label="Forget Network"
                                onClicked={forgetNetwork}
                            />
                        </Gtk.Box>

                        <Gtk.Label
                            label={errorMsg.as(e => e ?? '')}
                            cssClasses={['error', 'caption']}
                            visible={errorMsg.as(e => e !== null)}
                            wrap
                            marginStart={12}
                            marginEnd={12}
                            marginBottom={12}
                        />
                    </Adw.PreferencesPage>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        ) as Gtk.Widget
    );

    dialog.present();
}

// ── Hidden Network Dialog ──────────────────────────────────────────

function showHiddenNetworkDialog(parent: Gtk.Widget) {
    const dialog = new Adw.Window({
        transientFor: parent.get_root() as Gtk.Window,
        modal: true,
        title: 'Connect to Hidden Network',
        defaultWidth: 400,
        defaultHeight: 250,
        cssClasses: ['background'],
    });

    const [ssid, setSsid] = createState('');
    const [password, setPassword] = createState('');
    const [connecting, setConnecting] = createState(false);
    const [errorMsg, setErrorMsg] = createState<string | null>(null);

    const connect = () => {
        const name = ssid().trim();
        if (!name) {
            setErrorMsg('Network name is required');
            return;
        }
        setConnecting(true);
        setErrorMsg(null);

        const network = Network.get_default();
        const wifi = network.wifi;
        if (!wifi) {
            setErrorMsg('No WiFi device available');
            setConnecting(false);
            return;
        }

        try {
            const connection = createNMConnection(
                name,
                password().trim() || undefined,
                true
            );
            network.client
                .add_and_activate_connection_async(
                    connection,
                    wifi.device,
                    null,
                    null
                )
                .then(() => {
                    setConnecting(false);
                    dialog.close();
                })
                .catch((e: Error) => {
                    logger.error(
                        'settings-network',
                        'hidden connect failed:',
                        e.message
                    );
                    setErrorMsg(e.message || 'Connection failed');
                    setConnecting(false);
                });
        } catch (e) {
            logger.error('settings-network', 'hidden network error:', e);
            setErrorMsg(String(e));
            setConnecting(false);
        }
    };

    dialog.set_content(
        (
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                <Adw.HeaderBar
                    titleWidget={
                        (
                            <Adw.WindowTitle
                                title="Hidden Network"
                                cssClasses={['title-3']}
                            />
                        ) as Gtk.Widget
                    }
                    showEndTitleButtons={false}
                />
                <Adw.PreferencesPage>
                    <Adw.PreferencesGroup title="Network Details">
                        <Adw.EntryRow title="Network Name">
                            <Gtk.Entry
                                placeholderText="SSID"
                                $={entry => {
                                    entry.connect('notify::text', () =>
                                        setSsid(entry.get_text())
                                    );
                                }}
                            />
                        </Adw.EntryRow>
                        <Adw.EntryRow title="Password">
                            <Gtk.Entry
                                placeholderText="Password (optional)"
                                visibility={false}
                                $={entry => {
                                    entry.connect('notify::text', () =>
                                        setPassword(entry.get_text())
                                    );
                                }}
                            />
                        </Adw.EntryRow>
                    </Adw.PreferencesGroup>

                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <Gtk.Button
                            hexpand
                            cssClasses={['suggested-action']}
                            label={connecting.as(c =>
                                c ? 'Connecting…' : 'Connect'
                            )}
                            sensitive={connecting.as(c => !c)}
                            onClicked={connect}
                        />
                        <Gtk.Button
                            hexpand
                            label="Cancel"
                            onClicked={() => dialog.close()}
                        />
                    </Gtk.Box>

                    <Gtk.Label
                        label={errorMsg.as(e => e ?? '')}
                        cssClasses={['error', 'caption']}
                        visible={errorMsg.as(e => e !== null)}
                        wrap
                        marginStart={12}
                        marginEnd={12}
                        marginBottom={12}
                    />
                </Adw.PreferencesPage>
            </Gtk.Box>
        ) as Gtk.Widget
    );

    dialog.present();
}

// ── Hotspot Controls ───────────────────────────────────────────────

// ── Main Settings Page ─────────────────────────────────────────────

export default () => {
    const network = Network.get_default();
    const wifi = createBinding(network, 'wifi');
    const wired = createBinding(network, 'wired');
    const [knownVersion, bumpKnown] = createState(0);
    const knownNetworks = createComputed(() =>
        getKnownNetworks(network.client)
    );

    return (
        <>
            {wifi() && (
                    /* WiFi Section */
                    <Adw.PreferencesGroup
                        title="Wi-Fi"
                        description="Wireless network connections"
                    >
                        <With value={wifi}>
                            {w =>
                                w ? (
                                    <Adw.SwitchRow
                                        title="Wi-Fi"
                                        subtitle={createBinding(w, 'ssid').as(
                                            ssid =>
                                                ssid
                                                    ? `Connected to ${ssid}`
                                                    : 'Not connected'
                                        )}
                                        active={createBinding(w, 'enabled')}
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
                                        subtitle={createBinding(
                                            w,
                                            'strength'
                                        ).as(s => `${s}%`)}
                                    >
                                        <Gtk.LevelBar
                                            $type="suffix"
                                            valign={Gtk.Align.CENTER}
                                            value={createBinding(
                                                w,
                                                'strength'
                                            ).as(s => strengthFraction(s))}
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
                                $type="prefix"
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
                                $type="prefix"
                                iconName={
                                    net.secure
                                        ? 'network-wireless-encrypted-symbolic'
                                        : 'network-wireless-signal-none-symbolic'
                                }
                                pixelSize={NET_ICON_PREFIX}
                            />
                            <Gtk.Button
                                $type="suffix"
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

            {/* Wired Section */}
            <Adw.PreferencesGroup
                title="Wired"
                description="Ethernet connection"
            >
                <With value={wired}>
                    {w =>
                        w ? (
                            <Adw.ActionRow
                                title="Wired Connection"
                                subtitle={createBinding(w, 'state').as(s =>
                                    s === Network.DeviceState.ACTIVATED
                                        ? 'Connected'
                                        : 'Disconnected'
                                )}
                            >
                                <Gtk.Image
                                    $type="suffix"
                                    iconName={createBinding(w, 'iconName')}
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
                                subtitle={createBinding(w, 'isHotspot').as(h =>
                                    h ? 'Active' : 'Inactive'
                                )}
                            >
                                <Gtk.Switch
                                    $type="suffix"
                                    valign={Gtk.Align.CENTER}
                                    active={createBinding(w, 'isHotspot')}
                                    onNotifyActive={() => {
                                        logger.info(
                                            'settings-network',
                                            'Hotspot toggle not yet implemented'
                                        );
                                    }}
                                />
                            </Adw.ActionRow>
                        ) : null
                    }
                </With>
            </Adw.PreferencesGroup>

            {/* Connectivity Section */}
            <Adw.PreferencesGroup
                title="Connectivity"
                description="Internet access status"
            >
                <Adw.ActionRow
                    title="Connectivity"
                    subtitle={createBinding(network, 'connectivity').as(c => {
                        if (c === Network.Connectivity.FULL) return 'Full internet access';
                        if (c === Network.Connectivity.LIMITED) return 'Limited connectivity';
                        return 'No connectivity';
                    })}
                />
            </Adw.PreferencesGroup>
        </>
    );
};
