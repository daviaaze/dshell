import GObject from 'gi://GObject?version=2.0';
import Network from 'gi://AstalNetwork';
import type NM from 'gi://NM?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';
import {type Accessor, computed, createState, For, onCleanup} from 'gnim';
import ApRow from './apRow';
import {type ApSnapshot, bssidEquals, bssidOf, snapshotNMAccessPoint} from './utils';

interface ApListProps {
    wifi: Network.Wifi;
    connectingAp: Accessor<string | null>;
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
    const [aps, setAps] = createState<ApSnapshot[]>([]);
    const [activeAp, setActiveAp] = createState<{bssid: string | null; objectPath: string} | null>(null);
    const [connectionRevision, setConnectionRevision] = createState(0);
    const client = Network.get_default().client as NM.Client;
    const apSnapshots = new Map<string, ApSnapshot>();
    const apSignals = new Map<string, {ap: NM.AccessPoint; handlerId: number}>();

    let device: NM.DeviceWifi | null = null;
    let deviceSignalIds: number[] = [];
    let ignoredDevicePath: string | null = null;

    const disconnect = (source: unknown, handlerId: number) => {
        try {
            GObject.signal_handler_disconnect(source as GObject.Object, handlerId);
        } catch {
            // NetworkManager may already have finalized a removed object.
        }
    };

    const publishAps = () => setAps([...apSnapshots.values()]);

    const updateActiveAp = () => {
        const active = device?.get_active_access_point() ?? null;
        let objectPath = '';
        try {
            objectPath = active?.get_path() ?? '';
        } catch {
            // The AP may be removed between the NM notification and this read.
        }
        setActiveAp(active ? {bssid: bssidOf(active), objectPath} : null);
    };

    const upsertAp = (ap: NM.AccessPoint) => {
        const objectPath = ap.get_path();
        if (!objectPath) return;

        if (!apSignals.has(objectPath)) {
            const handlerId = ap.connect('notify', () => {
                apSnapshots.set(objectPath, snapshotNMAccessPoint(ap));
                publishAps();
                updateActiveAp();
            });
            apSignals.set(objectPath, {ap, handlerId});
        }

        apSnapshots.set(objectPath, snapshotNMAccessPoint(ap));
        publishAps();
        updateActiveAp();
    };

    const removeAp = (ap: NM.AccessPoint) => {
        const objectPath = ap.get_path();
        const watched = apSignals.get(objectPath);
        if (watched) disconnect(watched.ap, watched.handlerId);
        apSignals.delete(objectPath);
        apSnapshots.delete(objectPath);
        publishAps();
        updateActiveAp();
    };

    const detachDevice = (updateState = true) => {
        if (device) {
            for (const handlerId of deviceSignalIds) disconnect(device, handlerId);
        }
        deviceSignalIds = [];

        for (const {ap, handlerId} of apSignals.values()) disconnect(ap, handlerId);
        apSignals.clear();
        apSnapshots.clear();
        device = null;
        if (updateState) {
            publishAps();
            setActiveAp(null);
        }
    };

    const attachDevice = (next: NM.DeviceWifi | null) => {
        if (device === next) return;
        detachDevice();
        if (!next) return;

        device = next;
        deviceSignalIds = [
            next.connect('access-point-added', (_source, ap) => upsertAp(ap as NM.AccessPoint)),
            next.connect('access-point-removed', (_source, ap) => removeAp(ap as NM.AccessPoint)),
            next.connect('notify::active-access-point', updateActiveAp),
        ];

        try {
            for (const ap of next.get_access_points()) upsertAp(ap);
            updateActiveAp();
        } catch {
            detachDevice();
        }
    };

    const readWifiDevice = (): NM.DeviceWifi | null => {
        try {
            const current = (wifi.device as NM.DeviceWifi | null) ?? null;
            if (!current || current.get_path() === ignoredDevicePath) return null;
            ignoredDevicePath = null;
            return current;
        } catch {
            return null;
        }
    };

    const syncDevice = () => attachDevice(readWifiDevice());
    const wifiDeviceId = wifi.connect('notify::device', syncDevice);
    const addedDeviceId = client.connect('device-added', (_client, added) => {
        if (added.get_path() === ignoredDevicePath) ignoredDevicePath = null;
        syncDevice();
    });
    const removedDeviceId = client.connect('device-removed', (_client, removed) => {
        const removedPath = removed.get_path();
        if (device?.get_path() === removedPath) {
            ignoredDevicePath = removedPath;
            detachDevice();
        }
        syncDevice();
    });
    const connectionAddedId = client.connect('connection-added', () =>
        setConnectionRevision(connectionRevision() + 1)
    );
    const connectionRemovedId = client.connect('connection-removed', () =>
        setConnectionRevision(connectionRevision() + 1)
    );

    syncDevice();
    onCleanup(() => {
        disconnect(wifi, wifiDeviceId);
        disconnect(client, addedDeviceId);
        disconnect(client, removedDeviceId);
        disconnect(client, connectionAddedId);
        disconnect(client, connectionRemovedId);
        detachDevice(false);
    });

    const sortedAps = computed(() => sortAps(aps(), activeAp()?.bssid ?? null));

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['card']} spacing={0} hexpand>
            <For each={sortedAps} id={(snap) => snap.objectPath}>
                {(snap: ApSnapshot) => {
                    const apBssid = snap.bssid;

                    const isActive = computed(() => {
                        const active = activeAp();
                        return !!active &&
                            (active.objectPath === snap.objectPath ||
                                (apBssid !== null &&
                                    active.bssid !== null &&
                                    bssidEquals(apBssid, active.bssid)));
                    });

                    const isConnecting = connectingAp.as((c) =>
                        apBssid === null
                            ? c === snap.objectPath
                            : c !== null && bssidEquals(c, apBssid)
                    );

                    return (
                        <ApRow
                            snap={snap}
                            wifi={wifi}
                            client={client}
                            connectionRevision={connectionRevision}
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
