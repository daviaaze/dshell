import type Network from 'gi://AstalNetwork';
import Gtk from 'gi://Gtk?version=4.0';
import {useStyle} from '@shade/style/useStyle';
import {bind, computed, For} from 'gnim';
import ApRow from './apRow';
import {type ApSnapshot, bssidEquals, bssidOf, snapshotAp} from './utils';

interface ApListProps {
    wifi: Network.Wifi;
    connectingAp: import('gnim').Accessor<string | null>;
    setConnectingAp: (v: string | null) => void;
}

function sortAps(aps: ApSnapshot[], activeBssid: string | null): ApSnapshot[] {
    return [...aps].sort((a, b) => {
        const aActive =
            a.bssid !== null && activeBssid !== null && bssidEquals(a.bssid, activeBssid);
        const bActive =
            b.bssid !== null && activeBssid !== null && bssidEquals(b.bssid, activeBssid);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return b.strength - a.strength;
    });
}

export default ({wifi, connectingAp, setConnectingAp}: ApListProps) => {
    const activeBssid = bind(wifi, 'active-access-point').as((active) => {
        if (!active) return null;
        return bssidOf(active);
    });
    const aps = bind(wifi, 'access-points');

    const sortedAps = computed(() => sortAps(aps().map(snapshotAp), activeBssid()));

    const styles = useStyle({padding: '8px'});

    return (
        <Gtk.Box
            ref={styles.$}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            hexpand
            cssClasses={[styles.class]}
        >
            <For each={sortedAps} id={(snap) => snap.bssid ?? snap.ssid}>
                {(snap: ApSnapshot) => {
                    const apBssid = snap.bssid;

                    const isActive = computed(() => {
                        const active = activeBssid();
                        if (!apBssid || !active) return false;
                        return bssidEquals(apBssid, active);
                    });

                    const isConnecting = connectingAp.as(
                        (c) => apBssid !== null && c !== null && bssidEquals(c, apBssid)
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
