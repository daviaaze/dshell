import Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed, For} from 'gnim';
import {toArray} from '#/lib/core/gjsUtils';
import {
    bssidOf,
    bssidEquals,
    ApSnapshot,
    snapshotAp,
    signalIconName,
} from './utils';
import {useStyle} from '#/style/useStyle';
import ApRow from './apRow';

interface ApListProps {
    wifi: Network.Wifi;
    connectingAp: import('gnim').Accessor<string | null>;
    setConnectingAp: (v: string | null) => void;
}

function sortAps(aps: ApSnapshot[], activeBssid: string | null): ApSnapshot[] {
    return [...aps].sort((a, b) => {
        const aActive = a.bssid !== null && activeBssid !== null && bssidEquals(a.bssid, activeBssid);
        const bActive = b.bssid !== null && activeBssid !== null && bssidEquals(b.bssid, activeBssid);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return b.strength - a.strength;
    });
}

export default ({wifi, connectingAp, setConnectingAp}: ApListProps) => {
    const listStyle = useStyle({});
    const activeBssid = createBinding(wifi, 'activeAccessPoint').as(active => {
        if (!active) return null;
        return bssidOf(active);
    });

    const sortedAps = createComputed(
        [createBinding(wifi, 'accessPoints'), activeBssid],
        (points, active) => {
            const list = toArray<Network.AccessPoint>(points);
            const snaps = list.map(snapshotAp);
            return sortAps(snaps, active);
        }
    );

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            hexpand
            cssClasses={['network-list', listStyle.class]}
            $={listStyle.$}
        >
            <For each={sortedAps} id={snap => snap.bssid ?? snap.ssid}>
                {(snap: ApSnapshot) => {
                    const apBssid = snap.bssid;

                    const isActive = createComputed(() => {
                        const active = activeBssid();
                        if (!apBssid || !active) return false;
                        return bssidEquals(apBssid, active);
                    });

                    const isConnecting = connectingAp.as(c =>
                        apBssid !== null && c !== null && bssidEquals(c, apBssid)
                    );

                    return (
                        <ApRow
                            snap={snap}
                            wifi={wifi}
                            isActive={isActive}
                            isConnecting={isConnecting}
                            setConnectingAp={setConnectingAp}
                        />
                    );
                }}
            </For>
        </Gtk.Box>
    );
};
