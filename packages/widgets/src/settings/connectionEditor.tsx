import NM from 'gi://NM?version=1.0';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createState, onCleanup} from 'gnim';
import {render} from '@gnim-js/gtk4';
import {
    securityLabelFromKeyMgmt,
    commitChangesAsync,
    deleteConnectionAsync,
} from '../quicksettings/network/utils';
import logger from '@shade/core/logger';

const NET_ICON_PREFIX = 16;

export function showConnectionEditor(
    ssid: string,
    connections: NM.RemoteConnection[],
    parent: Adw.ActionRow,
    onForgotten?: () => void
) {
    if (connections.length === 0) return;

    const conn = connections[0]!;
    const settingConn = conn.get_setting_connection();
    const settingSecurity = conn.get_setting_wireless_security();
    const isSecureConn = settingSecurity !== null;

    const root = parent.get_root();
    const dialog = new Adw.Window({
        transientFor: root instanceof Gtk.Window ? root : null,
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
            if (settingConn) settingConn.autoconnect = autoConnect();
            if (settingSecurity && isSecureConn) {
                const pwd = password();
                if (pwd) settingSecurity.psk = pwd;
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

    const disposeDialog = render(
        () => (
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                <Adw.HeaderBar
                    ref={self => {
                        self.titleWidget = new Adw.WindowTitle({
                            title: ssid,
                            cssClasses: ['title-3'],
                        });
                    }}
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
                                        ref={entry => {
                                            entry.visibility = !showPassword();
                                            onCleanup(
                                                showPassword.subscribe(() => {
                                                    entry.visibility =
                                                        !showPassword();
                                                })
                                            );
                                            entry.connect('notify::text', () =>
                                                setPassword(entry.get_text())
                                            );
                                        }}
                                    />
                                    <Gtk.Button
                                        slot="suffix"
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
        ),
        dialog
    );

    dialog.connect('close-request', () => {
        disposeDialog();
        return false; // allow default close handling
    });
    dialog.present();
}
