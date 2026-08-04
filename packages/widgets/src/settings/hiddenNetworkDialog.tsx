import Adw from 'gi://Adw?version=1';
import Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {render} from '@gnim-js/gtk4';
import logger from '@shade/core/logger';
import {type Accessor, createState} from 'gnim';
import {createNMConnection} from '../quicksettings/network/utils';

interface DialogState {
    ssid: Accessor<string>;
    password: Accessor<string>;
    connecting: Accessor<boolean>;
    errorMsg: Accessor<string | null>;
    setConnecting: (v: boolean) => void;
    setErrorMsg: (v: string | null) => void;
}

/** Activate a new NM connection for the hidden SSID, surfacing errors. */
async function connectHidden(state: DialogState, onSuccess: () => void) {
    const name = state.ssid().trim();
    if (!name) {
        state.setErrorMsg('Network name is required');
        return;
    }
    state.setConnecting(true);
    state.setErrorMsg(null);

    const network = Network.get_default();
    const wifi = network.wifi;
    if (!wifi) {
        state.setErrorMsg('No WiFi device available');
        state.setConnecting(false);
        return;
    }

    try {
        const connection = createNMConnection(name, state.password().trim() || undefined, true);
        await new Promise<void>((resolve, reject) => {
            network.client.add_and_activate_connection_async(
                connection,
                wifi.device,
                null,
                null,
                (_, res) => {
                    try {
                        network.client.add_and_activate_connection_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        })
            .then(() => {
                state.setConnecting(false);
                onSuccess();
            })
            .catch((e: Error) => {
                logger.error('settings-network', 'hidden connect failed:', e.message);
                state.setErrorMsg(e.message || 'Connection failed');
                state.setConnecting(false);
            });
    } catch (e) {
        logger.error('settings-network', 'hidden network error:', e);
        state.setErrorMsg(String(e));
        state.setConnecting(false);
    }
}

/** Dialog body: header, SSID/password entries, actions, error label. */
function DialogContent({
    state,
    onConnect,
    onCancel,
    setSsid,
    setPassword,
}: {
    state: DialogState;
    onConnect: () => void;
    onCancel: () => void;
    setSsid: (v: string) => void;
    setPassword: (v: string) => void;
}) {
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Adw.HeaderBar
                ref={(self) => {
                    self.titleWidget = new Adw.WindowTitle({
                        title: 'Hidden Network',
                        cssClasses: ['title-3'],
                    });
                }}
                showEndTitleButtons={false}
            />
            <Adw.PreferencesPage>
                <Adw.PreferencesGroup title="Network Details">
                    <Adw.EntryRow title="Network Name">
                        <Gtk.Entry
                            placeholderText="SSID"
                            ref={(entry) =>
                                entry.connect('notify::text', () => setSsid(entry.get_text()))
                            }
                        />
                    </Adw.EntryRow>
                    <Adw.EntryRow title="Password">
                        <Gtk.Entry
                            placeholderText="Password (optional)"
                            visibility={false}
                            ref={(entry) =>
                                entry.connect('notify::text', () => setPassword(entry.get_text()))
                            }
                        />
                    </Adw.EntryRow>
                </Adw.PreferencesGroup>

                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                    <Gtk.Button
                        hexpand
                        cssClasses={['suggested-action']}
                        label={state.connecting.as((c) => (c ? 'Connecting…' : 'Connect'))}
                        sensitive={state.connecting.as((c) => !c)}
                        onClicked={onConnect}
                    />
                    <Gtk.Button hexpand label="Cancel" onClicked={onCancel} />
                </Gtk.Box>

                <Gtk.Label
                    label={state.errorMsg.as((e) => e ?? '')}
                    cssClasses={['error', 'caption']}
                    visible={state.errorMsg.as((e) => e !== null)}
                    wrap
                    marginStart={12}
                    marginEnd={12}
                    marginBottom={12}
                />
            </Adw.PreferencesPage>
        </Gtk.Box>
    );
}

export async function showHiddenNetworkDialog(parent: Adw.ActionRow) {
    const root = parent.get_root();
    const dialog = new Adw.Window({
        transientFor: root instanceof Gtk.Window ? root : null,
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

    const state: DialogState = {
        ssid,
        password,
        connecting,
        errorMsg,
        setConnecting,
        setErrorMsg,
    };

    const disposeDialog = render(
        () => (
            <DialogContent
                state={state}
                onConnect={() => connectHidden(state, () => dialog.close())}
                onCancel={() => dialog.close()}
                setSsid={setSsid}
                setPassword={setPassword}
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
