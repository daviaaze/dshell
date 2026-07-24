import Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, For} from 'gnim';
import {
    bssidOf,
    bssidEquals,
    ApSnapshot,
    snapshotAp,
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
    const activeBssid = bind(wifi, 'activeAccessPoint').as(active => {
        if (!active) return null;
        return bssidOf(active);
    });
    const aps = bind(wifi, 'accessPoints');

    const sortedAps = computed(
        () => sortAps(aps().map(snapshotAp), activeBssid())
    );

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            hexpand
            cssClasses={['network-list', listStyle.class]}
            ref={listStyle.$}
        >
            <For each={sortedAps} id={snap => snap.bssid ?? snap.ssid}>
                {(snap: ApSnapshot) => {
                    const apBssid = snap.bssid;

                    const isActive = computed(() => {
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
