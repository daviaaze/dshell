import type AstalNetwork from 'gi://AstalNetwork?version=0.1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import NetworkService from '@shade/services/network/networkService';
import {bind, computed, createState, With} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from '../button-grid/quickButton';
import {wifiIconName} from './utils';
import WifiPopover from './wifiPopover';

const WifiQuicksettingsButton = (): QuickButton => {
    const net = NetworkService.get_default();
    const [connectingAp, setConnectingAp] = createState<string | null>(null);

    const wifiIconName_ = computed(() => {
        const enabled = net.wifiEnabled;
        const strength = net.wifiStrength;
        const state = net.wifiState;
        if (!enabled) return 'network-wireless-offline-symbolic';
        return wifiIconName(strength, enabled, state);
    });

    const icon = computed(() => {
        const isConnecting = connectingAp();
        return isConnecting ? 'content-loading-symbolic' : wifiIconName_();
    });

    const wifiCssClasses = computed(() => {
        const state = net.wifiState;
        // Network.DeviceState.ACTIVATED = 100
        if (state === 100) {
            return ['raised', 'suggested-action'];
        }
        return ['raised'];
    });

    const wifiSsid = bind(net, 'wifiSsid');
    const wifiEnabled = bind(net, 'wifiEnabled');

    const label = computed(() => {
        const ssid = wifiSsid();
        const enabled = wifiEnabled();

        if (!ssid || ssid === '...' || ssid.trim() === '') return enabled ? 'WiFi' : 'WiFi Off';
        return ssid.length > 24 ? ssid.slice(0, 24) + '…' : ssid;
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
                            <Gtk.Label
                                cssClasses={['popover-padded-lg']}
                                label={net.wifiReady ? 'No WiFi device' : 'Loading…'}
                            />
                        )
                    }
                </With>
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                icon={icon}
                cssClasses={wifiCssClasses}
                label={label}
                onClick={() => {
                    bus.emit('network:wifi:toggle');
                    return true;
                }}
                popover={popover}
            />
        ),
        visible: bind(net, 'wifiReady'),
    };
};

export default WifiQuicksettingsButton;
