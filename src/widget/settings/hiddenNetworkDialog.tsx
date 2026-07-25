import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Network from 'gi://AstalNetwork';
import {createState} from 'gnim';
import {createNMConnection} from '#/widget/quicksettings/network/utils';
import logger from '#/lib/core/logger';

export function showHiddenNetworkDialog(parent: Gtk.Widget) {
    const dialog = new Adw.Window({
        transientFor: parent.get_root() as any,
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
            (network.client.add_and_activate_connection_async as any)(
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
                        ) as any
                    }
                    showEndTitleButtons={false}
                />
                <Adw.PreferencesPage>
                    <Adw.PreferencesGroup title="Network Details">
                        <Adw.EntryRow title="Network Name">
                            <Gtk.Entry
                                placeholderText="SSID"
                                ref={entry =>
                                    entry.connect('notify::text', () =>
                                        setSsid(entry.get_text())
                                    )
                                }
                            />
                        </Adw.EntryRow>
                        <Adw.EntryRow title="Password">
                            <Gtk.Entry
                                placeholderText="Password (optional)"
                                visibility={false}
                                ref={entry =>
                                    entry.connect('notify::text', () =>
                                        setPassword(entry.get_text())
                                    )
                                }
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
        ) as any
    );

    dialog.present();
}
