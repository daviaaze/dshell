import Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {createState, onMount, onCleanup} from 'gnim';
import {wifiIconName} from '#/widget/quicksettings/network/utils';
import {connectFor, cleanupNode} from '#/lib/connectFor';

export default () => {
    const network = Network.get_default();
    const [iconName, setIconName] = createState('network-no-route-symbolic');
    const [visible, setVisible] = createState(false);

    onMount(() => {
        const _hn = {};
        let wifiSignalIds: number[] = [];

        const cleanupWifiSignals = () => {
            const w = network.wifi;
            if (!w) {
                wifiSignalIds = [];
                return;
            }
            for (const id of wifiSignalIds) {
                try {
                    w.disconnect(id);
                } catch {
                    /* already dead */
                }
            }
            wifiSignalIds = [];
        };

        const connectWifiSignals = () => {
            cleanupWifiSignals();
            const w = network.wifi;
            if (w) {
                wifiSignalIds.push(w.connect('notify::state', update));
                wifiSignalIds.push(w.connect('notify::strength', update));
                wifiSignalIds.push(w.connect('notify::enabled', update));
            }
        };

        const update = () => {
            const primary = network.primary;
            setVisible(primary !== Network.Primary.UNKNOWN);

            if (primary === Network.Primary.WIFI) {
                const w = network.wifi;
                if (!w) {
                    setIconName('network-wireless-offline-symbolic');
                    return;
                }
                setIconName(wifiIconName(w.strength, w.enabled, w.state));
            } else if (primary === Network.Primary.WIRED) {
                const wired = network.wired;
                setIconName(
                    wired?.iconName || 'network-wired-offline-symbolic'
                );
            } else {
                setIconName('network-no-route-symbolic');
            }
        };

        connectFor(_hn, network, 'notify::primary', update);
        connectFor(_hn, network, 'notify::wifi', () => {
            connectWifiSignals();
            update();
        });
        connectFor(_hn, network, 'notify::wired', update);
        connectWifiSignals();
        update();

        onCleanup(() => {
            cleanupWifiSignals();
            cleanupNode(_hn);
        });
    });

    return <Gtk.Image iconName={iconName} visible={visible} pixelSize={18} />;
};
