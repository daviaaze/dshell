import type AstalNetwork from 'gi://AstalNetwork?version=0.1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import NetworkService from '@shade/services/network/networkService';
import {bind, computed, createState, type GnimNode, With} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import {wifiIconName} from './utils';
import WifiDetails from './wifiDetails';

export default (onOpen: (self: Gtk.Button) => void): {widget: GnimNode; detail: GnimNode} => {
    const net = NetworkService.get_default();
    const [connectingAp, setConnectingAp] = createState<string | null>(null);

    const wifi = bind(net, 'wifi');
    const ready = bind(net, 'wifiReady');
    const wifiSsid = bind(net, 'wifiSsid');
    const wifiEnabled = bind(net, 'wifiEnabled');
    const wifiState = bind(net, 'wifiState');
    const wifiStrength = bind(net, 'wifiStrength');

    const icon = computed(() =>
        connectingAp()
            ? 'content-loading-symbolic'
            : wifiEnabled()
              ? wifiIconName(wifiStrength(), wifiEnabled(), wifiState())
              : 'network-wireless-offline-symbolic'
    );

    const value = computed(() => {
        if (!wifi()) return ready() ? 'Indisponível' : 'Carregando…';
        if (!wifiEnabled()) return 'Desativado';
        if (connectingAp()) return 'Conectando…';
        if (wifiState() !== 100) return 'Não conectado';
        const ssid = wifiSsid()?.trim();
        return ssid && ssid !== '...' ? ssid : 'Conectado';
    });

    const detail = (
        <With value={wifi}>
            {(device: AstalNetwork.Wifi | null) => device ? (
                <WifiDetails wifi={device} connectingAp={connectingAp} setConnectingAp={setConnectingAp} status={value} />
            ) : <Gtk.Label label={ready.as(value => value ? 'Nenhum adaptador Wi-Fi disponível.' : 'Carregando Wi-Fi…')} wrap />}
        </With>
    );

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                domain="Wi-Fi"
                icon={icon}
                value={value}
                active={wifiEnabled}
                actionLabel={wifiEnabled.as((enabled) => enabled ? 'Turn Wi-Fi off' : 'Turn Wi-Fi on')}
                onClick={() => bus.emit('network:wifi:toggle')}
                actionSensitive={wifi.as(device => device !== null)}
                detail={{label: 'Wi-Fi details', onOpen}}
            />
        ),
        detail,
    };
};
