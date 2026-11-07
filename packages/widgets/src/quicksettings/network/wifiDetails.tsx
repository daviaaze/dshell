import Adw from 'gi://Adw?version=1';
import type Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import WindowManager from '@shade/services/state/windowManager';
import {type Accessor, bind, computed} from 'gnim';
import {showHiddenNetworkDialog} from '../../settings/hiddenNetworkDialog';
import {openSettings} from '../../settings/settingsOpen';
import ApList from './apList';

interface WifiDetailsProps {
    wifi: Network.Wifi;
    connectingAp: Accessor<string | null>;
    setConnectingAp: (value:string|null)=>void;
    status: Accessor<string>;
}
export default ({wifi,connectingAp,setConnectingAp,status}:WifiDetailsProps) => {
    const enabled=bind(wifi,'enabled');
    const scanning=bind(wifi,'scanning');
    return <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={16}>
        <Adw.PreferencesGroup title="Conexão">
            <Adw.SwitchRow title="Wi-Fi" active={enabled} onNotifyActive={self=>{
                if(self.active===wifi.enabled) return;
                try { bus.emit('network:wifi:toggle'); }
                finally { self.active=wifi.enabled; }
            }}/>
            <Adw.ActionRow title="Estado" subtitle={status} useMarkup={false}/>
        </Adw.PreferencesGroup>
        <Adw.PreferencesGroup title="Redes disponíveis" visible={enabled}>
            <ApList wifi={wifi} connectingAp={connectingAp} setConnectingAp={setConnectingAp}/>
        </Adw.PreferencesGroup>
        <Gtk.Button label={scanning.as(active=>active?'Buscando redes…':'Buscar redes')}
            sensitive={computed(()=>enabled()&&!scanning())} onClicked={()=>wifi.scan()}/>
        <Gtk.Button label="Conectar à rede oculta" sensitive={enabled} onClicked={()=>{
            openSettings('network');
            const parent=WindowManager.get_default().settings;
            if(parent) showHiddenNetworkDialog(parent);
        }}/>
    </Gtk.Box>;
};
