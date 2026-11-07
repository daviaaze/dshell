import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import type NM from 'gi://NM?version=1.0';
import {render} from '@gnim-js/gtk4';
import logger from '@shade/core/logger';
import {type Accessor, createState} from 'gnim';
import {
    commitChangesAsync,
    deleteConnectionAsync,
    securityLabelFromKeyMgmt,
} from '../quicksettings/network/utils';

const LOG_TAG = 'settings-network';

/** Password entry for the saved network credential. */
function SecurityGroup({
    password,
    setPassword,
}: {
    password: Accessor<string>;
    setPassword: (v: string) => void;
}) {
    return (
        <Adw.PreferencesGroup title="Segurança">
            <Adw.PasswordEntryRow
                title="Senha da rede"
                text={password}
                onNotifyText={(entry) => setPassword(entry.text)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Save / forget buttons plus the error label. */
function ActionsBox({
    saving,
    errorMsg,
    onSave,
    onForget,
}: {
    saving: Accessor<boolean>;
    errorMsg: Accessor<string | null>;
    onSave: () => void;
    onForget: () => void;
}) {
    return (
        <>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <Gtk.Button
                    hexpand
                    cssClasses={['suggested-action']}
                    label={saving.as((s) => (s ? 'Salvando…' : 'Salvar alterações'))}
                    sensitive={saving.as((s) => !s)}
                    onClicked={onSave}
                />
                <Gtk.Button
                    hexpand
                    cssClasses={['destructive-action']}
                    label="Esquecer rede"
                    sensitive={saving.as((value) => !value)}
                    onClicked={onForget}
                />
            </Gtk.Box>

            <Gtk.Label
                label={errorMsg.as((e) => e ?? '')}
                cssClasses={['error', 'caption']}
                visible={errorMsg.as((e) => e !== null)}
                wrap
                marginStart={12}
                marginEnd={12}
                marginBottom={12}
            />
        </>
    );
}

/** Full dialog body: header, connection group, security, actions. */
function EditorContent({
    ssid,
    settingSecurity,
    isSecureConn,
    autoConnect,
    setAutoConnect,
    password,
    setPassword,
    saving,
    errorMsg,
    onSave,
    onForget,
}: {
    ssid: string;
    settingSecurity: NM.SettingWirelessSecurity | null;
    isSecureConn: boolean;
    autoConnect: Accessor<boolean>;
    setAutoConnect: (v: boolean) => void;
    password: Accessor<string>;
    setPassword: (v: string) => void;
    saving: Accessor<boolean>;
    errorMsg: Accessor<string | null>;
    onSave: () => void;
    onForget: () => void;
}) {
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Adw.HeaderBar
                ref={(self) => {
                    self.titleWidget = new Adw.WindowTitle({
                        title: ssid,
                        cssClasses: ['title-3'],
                    });
                }}
                showEndTitleButtons={false}
            />
            <Gtk.ScrolledWindow propagateNaturalHeight vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                <Adw.PreferencesPage>
                    <Adw.PreferencesGroup
                        title="Conexão"
                        description={securityLabelFromKeyMgmt(
                            settingSecurity?.get_key_mgmt() ?? null
                        ) ?? 'Rede aberta'}
                    >
                        <Adw.SwitchRow
                            title="Conectar automaticamente"
                            subtitle="Conectar a esta rede quando estiver ao alcance"
                            active={autoConnect}
                            onNotifyActive={(self) => setAutoConnect(self.active)}
                        />
                    </Adw.PreferencesGroup>
                    {isSecureConn && <SecurityGroup password={password} setPassword={setPassword} />}
                    <ActionsBox
                        saving={saving}
                        errorMsg={errorMsg}
                        onSave={onSave}
                        onForget={onForget}
                    />
                </Adw.PreferencesPage>
            </Gtk.ScrolledWindow>
        </Gtk.Box>
    );
}

export function showConnectionEditor(
    ssid: string,
    connections: NM.RemoteConnection[],
    parent: Gtk.Widget | Gtk.Window,
    onForgotten?: () => void
) {
    if (connections.length === 0) return;

    const conn = connections[0]!;
    const settingConn = conn.get_setting_connection();
    const settingSecurity = conn.get_setting_wireless_security();
    const isSecureConn = settingSecurity !== null;

    const root = parent instanceof Gtk.Window ? parent : parent.get_root();
    if (!(root instanceof Gtk.Window)) return;
    const dialog = new Adw.Window({
        transientFor: root,
        modal: true,
        title: ssid,
        defaultWidth: 400,
        defaultHeight: 300,
        cssClasses: ['background'],
    });

    const [autoConnect, setAutoConnect] = createState(settingConn ? settingConn.autoconnect : true);
    const [password, setPassword] = createState(isSecureConn ? (settingSecurity?.psk ?? '') : '');
    const [saving, setSaving] = createState(false);
    const [errorMsg, setErrorMsg] = createState<string | null>(null);

    const saveChanges = () => {
        if (saving()) return;
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
                    logger.error(LOG_TAG, 'commit failed:', e.message);
                    setErrorMsg(e.message || 'Failed to save');
                    setSaving(false);
                });
        } catch (e) {
            logger.error(LOG_TAG, 'save error:', e);
            setErrorMsg(String(e));
            setSaving(false);
        }
    };

    const forgetNetwork = () => {
        if (saving()) return;
        setSaving(true);
        setErrorMsg(null);
        deleteConnectionAsync(conn)
            .then(() => {
                dialog.close();
                onForgotten?.();
            })
            .catch((e: Error) => {
                logger.error(LOG_TAG, 'forget failed:', e.message);
                setErrorMsg(e.message);
                setSaving(false);
            });
    };

    const disposeDialog = render(
        () => (
            <EditorContent
                ssid={ssid}
                settingSecurity={settingSecurity}
                isSecureConn={isSecureConn}
                autoConnect={autoConnect}
                setAutoConnect={setAutoConnect}
                password={password}
                setPassword={setPassword}
                saving={saving}
                errorMsg={errorMsg}
                onSave={saveChanges}
                onForget={forgetNetwork}
            />
        ),
        dialog
    );

    dialog.connect('close-request', () => {
        disposeDialog();
        return false; // allow default close handling
    });
    dialog.present();
}
