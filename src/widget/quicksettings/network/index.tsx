import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed, createState, With} from 'gnim';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import {LinkedBox} from '#/widget/common/linkedBox';
import WifiPopover from './wifiPopover';
import {wifiIconName} from './utils';
import NetworkService from '#/lib/services/network/networkService';
import AstalNetwork from 'gi://AstalNetwork?version=0.1';

const WifiQuicksettingsButton = (): QuickButton => {
    const net = NetworkService.get_default();
    const [connectingAp, setConnectingAp] = createState<string | null>(null);

    const wifiIconName_ = createComputed(() => {
        const enabled = net.wifiEnabled;
        const strength = net.wifiStrength;
        const state = net.wifiState;
        if (!enabled) return 'network-wireless-offline-symbolic';
        return wifiIconName(strength, enabled, state);
    });

    const icon = createComputed(() => {
        const isConnecting = connectingAp();
        return isConnecting ? 'content-loading-symbolic' : wifiIconName_();
    });

    const wifiCssClasses = createComputed(() => {
        const state = net.wifiState;
        // Network.DeviceState.ACTIVATED = 100
        if (state === 100) {
            return ['raised', 'suggested-action'];
        }
        return ['raised'];
    });

    const wifiSsid = createBinding(net, 'wifiSsid');
    const wifiEnabled = createBinding(net, 'wifiEnabled');

    const label = createComputed(() => {
        const ssid = wifiSsid();
        const enabled = wifiEnabled();

        if (!ssid || ssid === '...' || ssid.trim() === '')
            return enabled ? 'WiFi' : 'WiFi Off';
        return ssid.length > 24 ? ssid.slice(0, 24) + '…' : ssid;
    });

    const popover = (
        <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
            <LinkedBox>
                <With value={createBinding(net, 'wifi')}>
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
                                label={
                                    net.wifiReady
                                        ? 'No WiFi device'
                                        : 'Loading…'
                                }
                            />
                        )
                    }
                </With>
            </LinkedBox>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return {
        widget: (
            <QuickToggleButton
                icon={icon}
                cssClasses={wifiCssClasses}
                label={label}
                onClick={() => {
                    net.toggleWifi();
                    return true;
                }}
                popover={popover}
            />
        ) as Gtk.Widget,
        visible: createBinding(net, 'wifiReady'),
    };
};

export default WifiQuicksettingsButton;
