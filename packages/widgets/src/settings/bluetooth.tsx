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
async function toggleDevice(
    service: BluetoothService,
    device: Bluetooth.Device,
    setConnectingAddress: (addr: string | null) => void,
    setOperationError: (error: string | null) => void
) {
    setConnectingAddress(device.address);
    setOperationError(null);
    try {
        if (device.connected) await service.disconnectDevice(device);
        else await service.connectDevice(device);
    } catch (error) {
        logger.error(LOG_TAG, 'Device connection change failed:', error);
        setOperationError(String(error));
    } finally {
        setConnectingAddress(null);
    }
}

/** Row for a paired device: icon, name, status, connect/disconnect, forget. */
function PairedDeviceRow({
    device,
    service,
    connectingAddress,
    setConnectingAddress,
}: {
    device: Bluetooth.Device;
    service: BluetoothService;
    connectingAddress: ReturnType<typeof createState<string | null>>[0];
    setConnectingAddress: (addr: string | null) => void;
}) {
    const [showConfirmForget, setShowConfirmForget] = createState(false);
    const [operationError, setOperationError] = createState<string | null>(null);
    const deviceConnecting = connectingAddress.as(
        (addr) => addr !== null && addr === device.address
    );
    const connected = bind(device, 'connected');

    const statusText = computed(() => {
        if (deviceConnecting()) return 'Connecting...';
        if (connected()) return 'Connected';
        return 'Paired';
    });

    const handleForget = () => {
        setOperationError(null);
        const bt = Bluetooth.get_default();
        const adapter = bt.adapter;
        if (!adapter) {
            const error = 'Bluetooth adapter is unavailable';
            logger.error(LOG_TAG, 'Cannot forget a device without a Bluetooth adapter');
            setOperationError(error);
            return;
        }
        try {
            adapter.remove_device(device);
            setShowConfirmForget(false);
        } catch (error) {
            logger.error(LOG_TAG, 'Forget failed:', error);
            setOperationError(String(error));
        }
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
            {operationError.as((message) => message ? (
                <Gtk.Label label={message} cssClasses={['error', 'caption']} wrap />
            ) : null)}
            {showConfirmForget.as((show) => show ? (
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
                        label={connected.as((value) => value ? 'Disconnect' : 'Connect')}
                        sensitive={deviceConnecting.as((value) => !value)}
                        onClicked={() =>
                            toggleDevice(service, device, setConnectingAddress, setOperationError)
                        }
                    />
                    <Gtk.Button
                        label={'Forget'}
                        cssClasses={['destructive-action']}
                        onClicked={() => {
                            setOperationError(null);
                            setShowConfirmForget(true);
                        }}
                    />
                </Gtk.Box>
            ))}
            <Gtk.Spinner visible={deviceConnecting} spinning={deviceConnecting} />
        </Adw.ActionRow>
    );
}

/** Row for an available (unpaired) device: icon, name, pair button. */
function AvailableDeviceRow({
    device,
    service,
    pairingAddress,
    setPairingAddress,
}: {
    device: Bluetooth.Device;
    service: BluetoothService;
    pairingAddress: ReturnType<typeof createState<string | null>>[0];
    setPairingAddress: (addr: string | null) => void;
}) {
    const [operationError, setOperationError] = createState<string | null>(null);
    const devicePairing = pairingAddress.as(
        (addr) => addr !== null && addr === device.address
    );

    const handlePair = async () => {
        setPairingAddress(device.address);
        setOperationError(null);
        try {
            await service.connectDevice(device);
        } catch (error) {
            logger.error(LOG_TAG, 'Pair failed:', error);
            setOperationError(String(error));
        } finally {
            setPairingAddress(null);
        }
    };

    return (
        <Adw.ActionRow title={device.name || device.address} subtitle={operationError.as((error) => error ?? 'Available')}>
            <Gtk.Image iconName={'bluetooth-symbolic'} pixelSize={24} />
            <Gtk.Button label={'Pair'} sensitive={devicePairing.as((value) => !value)} onClicked={handlePair} />
            <Gtk.Spinner visible={devicePairing} spinning={devicePairing} />
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
    const [operationError, setOperationError] = createState<string | null>(null);
    const [scanBusy, setScanBusy] = createState(false);
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
    let restoringPower = false;
    const handleTogglePower = (self: Adw.SwitchRow) => {
        const current = currentAdapter;
        if (restoringPower || (current && self.active === current.powered)) return;
        setOperationError(null);
        try {
            if (!current) throw new Error('Bluetooth adapter is unavailable');
            current.powered = self.active;
        } catch (error) {
            logger.error(LOG_TAG, 'Toggle power failed:', error);
            setOperationError(String(error));
        } finally {
            restoringPower = true;
            self.active = current?.powered ?? false;
            setIsPowered(self.active);
            restoringPower = false;
        }
    };
    const handleScan = () => {
        const current = currentAdapter;
        if (!current || !current.powered) return;
        setScanBusy(true);
        setOperationError(null);
        try {
            if (current.discovering) {
                current.stop_discovery();
                setScanning(current.discovering);
                clearScanTimeout();
                return;
            }
            current.start_discovery();
            setScanning(current.discovering);
            const id = setTimeout(() => {
                if (currentAdapter === current && current.discovering) {
                    try {
                        current.stop_discovery();
                    } catch (error) {
                        logger.error(LOG_TAG, 'Auto-stop discovery failed:', error);
                        setOperationError(String(error));
                    }
                    setScanning(current.discovering);
                }
                setScanTimeoutId(null);
            }, 30000);
            setScanTimeoutId(id);
        } catch (error) {
            logger.error(LOG_TAG, 'Bluetooth scan failed:', error);
            setScanning(current.discovering);
            setOperationError(String(error));
        } finally {
            setScanBusy(false);
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
        <>
            <Adw.PreferencesGroup
                title={adapter.as((value) => value ? 'Bluetooth' : 'Bluetooth unavailable')}
                description={adapter.as((value) => value ? 'Enable Bluetooth and manage devices' : 'No Bluetooth adapter is available')}
            >
                {adapter.as((value) => value ? (
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
                ))}
            {operationError.as((message) => message ? (
                <Gtk.Label label={message} cssClasses={['error', 'caption']} wrap />
            ) : null)}
            </Adw.PreferencesGroup>

            {adapter.as((value) => value ? (
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
                                    service={service}
                                    setConnectingAddress={setConnectingAddress}
                                />
                            )}
                        </For>
                        {pairedDevices.as((devices) => devices.length === 0 ? (
                            <Adw.ActionRow
                                title={'No paired devices'}
                                subtitle={'Scan to find and pair new devices'}
                            />
                        ) : null)}
                    </Adw.PreferencesGroup>

                    <Adw.PreferencesGroup
                        title={'Available Devices'}
                        description={scanning.as((value) => value ? 'Scanning for devices...' : 'Start scan to discover devices')}
                        sensitive={isPowered}
                    >
                        <Gtk.Box halign={Gtk.Align.CENTER}>
                            <Gtk.Button
                                label={scanning.as((value) => value ? 'Stop Scan' : 'Scan for Devices')}
                                cssClasses={scanning.as((value) => value ? ['destructive-action'] : ['suggested-action'])}
                                sensitive={isPowered.as((powered) => powered && !scanBusy())}
                                onClicked={handleScan}
                            />
                        </Gtk.Box>
                        <Gtk.Spinner visible={scanning} spinning={scanning} />
                        <For each={availableDevices}>
                            {(device) => (
                                <AvailableDeviceRow
                                    device={device}
                                    service={service}
                                    pairingAddress={pairingAddress}
                                    setPairingAddress={setPairingAddress}
                                />
                            )}
                        </For>
                        {computed(() => !scanning() && availableDevices().length === 0 ? (
                            <Adw.ActionRow
                                title={'No devices found'}
                                subtitle={'Click "Scan for Devices" to discover nearby devices'}
                            />
                        ) : null)}
                    </Adw.PreferencesGroup>
                </>
            ) : null)}
        </>
    );
};

