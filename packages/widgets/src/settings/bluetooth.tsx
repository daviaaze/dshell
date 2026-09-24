import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Bluetooth from 'gi://AstalBluetooth';
import {bind, computed, createState, For, onCleanup} from 'gnim';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import logger from '@shade/core/logger';

const LOG_TAG = 'settings-bluetooth';
type ScanTimeout = GLib.Source;

/** Toggle device connection, tracking in-flight address. */
function toggleDevice(
    device: Bluetooth.Device,
    setConnectingAddress: (addr: string | null) => void
) {
    if (device.connected) {
        device.disconnect_device((_, res) => {
            try {
                device.disconnect_device_finish(res);
            } catch (e) {
                logger.error(LOG_TAG, 'Disconnect failed:', e);
            }
            setConnectingAddress(null);
        });
    } else {
        device.connect_device((_, res) => {
            try {
                device.connect_device_finish(res);
            } catch (e) {
                logger.error(LOG_TAG, 'Connect failed:', e);
            }
            setConnectingAddress(null);
        });
    }
    setConnectingAddress(device.address);
}

/** Row for a paired device: icon, name, status, connect/disconnect, forget. */
function PairedDeviceRow({
    device,
    connectingAddress,
    setConnectingAddress,
}: {
    device: Bluetooth.Device;
    connectingAddress: ReturnType<typeof createState<string | null>>[0];
    setConnectingAddress: (addr: string | null) => void;
}) {
    const [showConfirmForget, setShowConfirmForget] = createState(false);
    const deviceConnecting = connectingAddress.as(
        (addr) => addr !== null && addr === device.address
    );

    const statusText = computed(() => {
        if (deviceConnecting()) return 'Connecting...';
        if (device.connected) return 'Connected';
        return 'Paired';
    });

    const handleForget = () => {
        const bt = Bluetooth.get_default();
        const adapter = bt.adapter;
        if (!adapter) {
            logger.error(LOG_TAG, 'Cannot forget a device without a Bluetooth adapter');
            setShowConfirmForget(false);
            return;
        }
        try {
            adapter.remove_device(device);
        } catch (e) {
            logger.error(LOG_TAG, 'Forget failed:', e);
        }
        setShowConfirmForget(false);
    };

    return (
        <Adw.ActionRow
            title={device.name || device.address}
            subtitle={statusText}
        >
            <Gtk.Image
                iconName={'bluetooth-symbolic'}
                pixelSize={24}
            />
            {showConfirmForget() ? (
                <Gtk.Box spacing={6}>
                    <Gtk.Button
                        label={'Cancel'}
                        onClicked={() => setShowConfirmForget(false)}
                    />
                    <Gtk.Button
                        label={'Confirm'}
                        cssClasses={['destructive-action']}
                        onClicked={handleForget}
                    />
                </Gtk.Box>
            ) : (
                <Gtk.Box spacing={6}>
                    <Gtk.Button
                        label={device.connected ? 'Disconnect' : 'Connect'}
                        sensitive={!deviceConnecting()}
                        onClicked={() => toggleDevice(device, setConnectingAddress)}
                    />
                    <Gtk.Button
                        label={'Forget'}
                        cssClasses={['destructive-action']}
                        onClicked={() => setShowConfirmForget(true)}
                    />
                </Gtk.Box>
            )}
            {deviceConnecting() && <Gtk.Spinner spinning={true} />}
        </Adw.ActionRow>
    );
}

/** Row for an available (unpaired) device: icon, name, pair button. */
function AvailableDeviceRow({
    device,
    pairingAddress,
    setPairingAddress,
}: {
    device: Bluetooth.Device;
    pairingAddress: ReturnType<typeof createState<string | null>>[0];
    setPairingAddress: (addr: string | null) => void;
}) {
    const devicePairing = pairingAddress.as(
        (addr) => addr !== null && addr === device.address
    );

    const handlePair = () => {
        setPairingAddress(device.address);
        device.connect_device((_, res) => {
            try {
                device.connect_device_finish(res);
            } catch (e) {
                logger.error(LOG_TAG, 'Pair failed:', e);
            }
            setPairingAddress(null);
        });
    };

    return (
        <Adw.ActionRow
            title={device.name || device.address}
            subtitle={'Available'}
        >
            <Gtk.Image
                iconName={'bluetooth-symbolic'}
                pixelSize={24}
            />
            <Gtk.Button
                label={'Pair'}
                sensitive={!devicePairing()}
                onClicked={handlePair}
            />
            {devicePairing() && <Gtk.Spinner spinning={true} />}
        </Adw.ActionRow>
    );
}

export default () => {
    const service = BluetoothService.get_default();
    const bt = Bluetooth.get_default();
    const [connectingAddress, setConnectingAddress] = createState<string | null>(null);
    const [pairingAddress, setPairingAddress] = createState<string | null>(null);
    const [adapter, setAdapter] = createState<Bluetooth.Adapter | null>(bt.adapter ?? null);
    const [isPowered, setIsPowered] = createState(bt.adapter?.powered ?? false);
    const [scanning, setScanning] = createState(bt.adapter?.discovering ?? false);
    const [scanTimeoutId, setScanTimeoutId] = createState<ScanTimeout | null>(null);
    let currentAdapter: Bluetooth.Adapter | null = null;
    let adapterPoweredSignalId = 0;
    let adapterDiscoveringSignalId = 0;

    const devices = bind(service, 'devices');

    const pairedDevices = computed(() =>
        devices().filter((d) => d.paired)
    );

    const availableDevices = computed(() =>
        devices().filter((d) => !d.paired)
    );

    const clearScanTimeout = () => {
        const timeoutId = scanTimeoutId();
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            setScanTimeoutId(null);
        }
    };

    const updateAdapter = () => {
        const nextAdapter = bt.adapter ?? null;
        if (currentAdapter !== nextAdapter) {
            clearScanTimeout();
            if (currentAdapter) {
                if (adapterPoweredSignalId) currentAdapter.disconnect(adapterPoweredSignalId);
                if (adapterDiscoveringSignalId) currentAdapter.disconnect(adapterDiscoveringSignalId);
            }
            currentAdapter = nextAdapter;
            adapterPoweredSignalId = 0;
            adapterDiscoveringSignalId = 0;
            setAdapter(nextAdapter);
            if (nextAdapter) {
                adapterPoweredSignalId = nextAdapter.connect('notify::powered', () => {
                    setIsPowered(nextAdapter.powered);
                    if (!nextAdapter.powered) clearScanTimeout();
                });
                adapterDiscoveringSignalId = nextAdapter.connect('notify::discovering', () =>
                    setScanning(nextAdapter.discovering)
                );
            }
        }
        setIsPowered(nextAdapter?.powered ?? false);
        setScanning(nextAdapter?.discovering ?? false);
        if (!nextAdapter) clearScanTimeout();
    };

    const adapterAddedSignalId = bt.connect('adapter-added', updateAdapter);
    const adapterRemovedSignalId = bt.connect('adapter-removed', updateAdapter);
    updateAdapter();

    const handleTogglePower = (self: Adw.SwitchRow) => {
        const current = currentAdapter;
        if (!current) return;
        try {
            current.powered = self.active;
        } catch (e) {
            logger.error(LOG_TAG, 'Toggle power failed:', e);
        }
    };

    const handleScan = () => {
        const current = currentAdapter;
        if (!current || !current.powered) return;

        if (current.discovering) {
            try {
                current.stop_discovery();
                setScanning(current.discovering);
                clearScanTimeout();
            } catch (e) {
                logger.error(LOG_TAG, 'Stop discovery failed:', e);
            }
            return;
        }

        try {
            current.start_discovery();
            setScanning(current.discovering);
            const id = setTimeout(() => {
                if (currentAdapter === current && current.discovering) {
                    try {
                        current.stop_discovery();
                    } catch (e) {
                        logger.error(LOG_TAG, 'Auto-stop discovery failed:', e);
                    }
                    setScanning(current.discovering);
                }
                setScanTimeoutId(null);
            }, 30000);
            setScanTimeoutId(id);
        } catch (e) {
            logger.error(LOG_TAG, 'Start discovery failed:', e);
        }
    };

    onCleanup(() => {
        clearScanTimeout();
        if (currentAdapter) {
            if (adapterPoweredSignalId) currentAdapter.disconnect(adapterPoweredSignalId);
            if (adapterDiscoveringSignalId) currentAdapter.disconnect(adapterDiscoveringSignalId);
            if (currentAdapter.discovering) {
                try {
                    currentAdapter.stop_discovery();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
        bt.disconnect(adapterAddedSignalId);
        bt.disconnect(adapterRemovedSignalId);
    });

    return (
        <Adw.PreferencesPage
            title={'Bluetooth'}
            iconName={'bluetooth-symbolic'}
        >
            <Adw.PreferencesGroup
                title={adapter() ? 'Bluetooth' : 'Bluetooth unavailable'}
                description={adapter() ? 'Enable Bluetooth and manage devices' : 'No Bluetooth adapter is available'}
            >
                {adapter() ? (
                    <Adw.SwitchRow
                        title={'Bluetooth'}
                        subtitle={'Enable Bluetooth adapter'}
                        active={isPowered}
                        onNotifyActive={(self) => handleTogglePower(self)}
                    />
                ) : (
                    <Adw.ActionRow
                        title={'No Bluetooth adapter'}
                        subtitle={'Connect or enable a Bluetooth adapter to manage devices'}
                    />
                )}
            </Adw.PreferencesGroup>

            {adapter() && (
                <>
                    <Adw.PreferencesGroup
                        title={'Paired Devices'}
                        description={'Previously paired devices'}
                        sensitive={isPowered}
                    >
                        <For each={pairedDevices}>
                            {(device) => (
                                <PairedDeviceRow
                                    device={device}
                                    connectingAddress={connectingAddress}
                                    setConnectingAddress={setConnectingAddress}
                                />
                            )}
                        </For>
                        {pairedDevices().length === 0 && (
                            <Adw.ActionRow
                                title={'No paired devices'}
                                subtitle={'Scan to find and pair new devices'}
                            />
                        )}
                    </Adw.PreferencesGroup>

                    <Adw.PreferencesGroup
                        title={'Available Devices'}
                        description={scanning() ? 'Scanning for devices...' : 'Start scan to discover devices'}
                        sensitive={isPowered}
                    >
                        <Gtk.Box halign={Gtk.Align.CENTER}>
                            <Gtk.Button
                                label={scanning() ? 'Stop Scan' : 'Scan for Devices'}
                                cssClasses={scanning() ? ['destructive-action'] : ['suggested-action']}
                                sensitive={isPowered}
                                onClicked={handleScan}
                            />
                        </Gtk.Box>
                        {scanning() && <Gtk.Spinner spinning={true} />}
                        <For each={availableDevices}>
                            {(device) => (
                                <AvailableDeviceRow
                                    device={device}
                                    pairingAddress={pairingAddress}
                                    setPairingAddress={setPairingAddress}
                                />
                            )}
                        </For>
                        {!scanning() && availableDevices().length === 0 && (
                            <Adw.ActionRow
                                title={'No devices found'}
                                subtitle={'Click "Scan for Devices" to discover nearby devices'}
                            />
                        )}
                    </Adw.PreferencesGroup>
                </>
            )}
        </Adw.PreferencesPage>
    );
};

