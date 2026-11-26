import Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import {IconNames} from '@shade/core/iconNames';
import NetworkService from '@shade/services/network/networkService';
import {createState, effect, onCleanup} from 'gnim';
import {setAccessibleName} from '../../common/iconButton';
import {wifiIconName} from '../../quicksettings/network/utils';

export default () => {
    const network = Network.get_default();
    const networkService = NetworkService.get_default();
    const [iconName, setIconName] = createState('network-no-route-symbolic');
    const [visible, setVisible] = createState(false);
    const [tooltip, setTooltip] = createState('Sem conexão');

    effect(() => {
        const _hn = {};
        let wifiSignals: Array<{obj: Network.Wifi; id: number}> = [];

        const cleanupWifiSignals = () => {
            for (const {obj, id} of wifiSignals) {
                try {
                    obj.disconnect(id);
                } catch {
                    /* already dead */
                }
            }
            wifiSignals = [];
        };

        const connectWifiSignals = () => {
            cleanupWifiSignals();
            const w = network.wifi;
            if (w) {
                for (const signal of [
                    'notify::state',
                    'notify::strength',
                    'notify::enabled',
                    'notify::ssid',
                ] as const) {
                    wifiSignals.push({obj: w, id: w.connect(signal, update)});
                }
            }
        };

        const update = () => {
            const primary = network.primary;
            setVisible(primary === Network.Primary.WIRED || networkService.wifiAvailable);

            if (primary === Network.Primary.WIFI) {
                const w = network.wifi;
                if (!w) {
                    setIconName('network-wireless-offline-symbolic');
                    setTooltip('Wi-Fi indisponível');
                    return;
                }
                setIconName(wifiIconName(w.strength, w.enabled, w.state));
                setTooltip(w.ssid ? `Wi-Fi: ${w.ssid}` : 'Rede Wi-Fi');
            } else if (primary === Network.Primary.WIRED) {
                const wired = network.wired;
                setIconName(wired?.iconName || IconNames.networkWiredOffline);
                setTooltip('Rede cabeada');
            } else {
                setIconName('network-no-route-symbolic');
                setTooltip('Sem conexão');
            }
        };

        connectFor(_hn, network, 'notify::primary', update);
        connectFor(_hn, network, 'notify::wifi', () => {
            connectWifiSignals();
            update();
        });
        connectFor(_hn, network, 'notify::wired', update);
        connectFor(_hn, networkService, 'notify::wifi-available', () => {
            update();
        });
        connectWifiSignals();
        update();

        onCleanup(() => {
            cleanupWifiSignals();
            cleanupNode(_hn);
        });
    });

    return (
        <Gtk.Image
            iconName={iconName}
            visible={visible}
            tooltipText={tooltip}
            pixelSize={18}
            accessibleRole={Gtk.AccessibleRole.IMG}
            ref={(self) => effect(() => setAccessibleName(tooltip())(self))}
        />
    );
};
