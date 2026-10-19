import type AstalNetwork from 'gi://AstalNetwork?version=0.1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import NetworkService from '@shade/services/network/networkService';
import {bind, computed, createState, With} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from '../button-grid/quickButton';
import {wifiIconName} from './utils';
import WifiPopover from './wifiPopover';

const WifiQuicksettingsButton = (): QuickButton => {
    const net = NetworkService.get_default();
    const [connectingAp, setConnectingAp] = createState<string | null>(null);

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
        if (!wifiEnabled()) return 'Off';
        const ssid = wifiSsid();
        if (wifiState() !== 100 || !ssid || ssid === '...' || ssid.trim() === '') {
            return 'Not connected';
        }
        return ssid;
    });

    const popover = (
        <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
            <LinkedBox>
                <With value={bind(net, 'wifi')}>
                    {(w: AstalNetwork.Wifi | null) =>
                        w ? (
                            <WifiPopover
                                wifi={w}
                                connectingAp={connectingAp}
                                setConnectingAp={setConnectingAp}
                            />
                        ) : (
                            <Gtk.Label label={net.wifiReady ? 'No WiFi device' : 'Loading…'} />
                        )
                    }
                </With>
            </LinkedBox>
        </Gtk.Popover>
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
                menu={{label: 'Wi-Fi options', popover}}
            />
        ),
        visible: bind(net, 'wifiReady'),
    };
};

export default WifiQuicksettingsButton;
