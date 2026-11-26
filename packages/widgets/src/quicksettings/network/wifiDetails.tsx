import Adw from 'gi://Adw?version=1';
import type Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import WindowManager from '@shade/services/state/windowManager';
import {type Accessor, bind, computed} from 'gnim';
import {SURFACE_SECTION_SPACING} from '../../common/surface';
import {showHiddenNetworkDialog} from '../../settings/hiddenNetworkDialog';
import {openSettings} from '../../settings/settingsOpen';
import ApList from './apList';

interface WifiDetailsProps {
    wifi: Network.Wifi;
    connectingAp: Accessor<string | null>;
    setConnectingAp: (value: string | null) => void;
    status: Accessor<string>;
    radioActive: Accessor<boolean>;
    radioPending: Accessor<boolean>;
    operationError: Accessor<string | null>;
    onSetEnabled: (enabled: boolean) => void;
    onScan: () => void;
}
export default ({
    wifi,
    connectingAp,
    setConnectingAp,
    status,
    radioActive,
    radioPending,
    operationError,
    onSetEnabled,
    onScan,
}: WifiDetailsProps) => {
    const enabled = bind(wifi, 'enabled');
    const scanning = bind(wifi, 'scanning');

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={SURFACE_SECTION_SPACING}>
            <Gtk.Label
                label={operationError.as((message) => message ?? '')}
                visible={operationError.as(Boolean)}
                cssClasses={['error', 'caption']}
                xalign={0}
                wrap
            />
            <Adw.PreferencesGroup title="Conexão">
                <Adw.SwitchRow
                    title="Wi-Fi"
                    active={radioActive}
                    sensitive={radioPending.as((pending) => !pending)}
                    onNotifyActive={(self) => onSetEnabled(self.active)}
                />
                <Adw.ActionRow title="Estado" subtitle={status} useMarkup={false} />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title="Redes disponíveis"
                visible={enabled}
                sensitive={radioPending.as((pending) => !pending)}
            >
                <ApList wifi={wifi} connectingAp={connectingAp} setConnectingAp={setConnectingAp} />
            </Adw.PreferencesGroup>
            <Gtk.Button
                label={scanning.as((active) => (active ? 'Buscando redes…' : 'Buscar redes'))}
                sensitive={computed(() => enabled() && !scanning() && !radioPending())}
                onClicked={onScan}
            />
            <Gtk.Button
                label="Conectar à rede oculta"
                sensitive={computed(() => enabled() && !radioPending())}
                onClicked={() => {
                    openSettings('network');
                    const parent = WindowManager.get_default().settings;
                    if (parent) showHiddenNetworkDialog(parent);
                }}
            />
        </Gtk.Box>
    );
};
