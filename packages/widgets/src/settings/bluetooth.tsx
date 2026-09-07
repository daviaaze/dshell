import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Bluetooth from 'gi://AstalBluetooth';
import {bind, computed, createState, For, onCleanup} from 'gnim';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import logger from '@shade/core/logger';

const LOG_TAG = 'settings-bluetooth';

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
        const service = BluetoothService.get_default();
        const bt = Bluetooth.get_default();
        try {
            bt.remove_device(device);
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
                iconName={device.iconName || 'bluetooth-symbolic'}
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
                iconName={device.iconName || 'bluetooth-symbolic'}
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
    const [connectingAddress, setConnectingAddress] = createState<string | null>(null);
    const [pairingAddress, setPairingAddress] = createState<string | null>(null);
    const [scanning, setScanning] = createState(false);
    const [scanTimeoutId, setScanTimeoutId] = createState<number | null>(null);

    const devices = bind(service, 'devices');
    const isPowered = bind(service, 'isPowered');

    const pairedDevices = computed(() =>
        devices().filter((d) => d.paired)
    );

    const availableDevices = computed(() =>
        devices().filter((d) => !d.paired)
    );

    const handleTogglePower = (self: Adw.SwitchRow) => {
        const bt = Bluetooth.get_default();
        try {
            bt.isPowered = self.active;
        } catch (e) {
            logger.error(LOG_TAG, 'Toggle power failed:', e);
        }
    };

    const handleScan = () => {
        if (scanning()) {
            // Stop scanning
            const bt = Bluetooth.get_default();
            try {
                bt.stopDiscovery();
            } catch (e) {
                logger.error(LOG_TAG, 'Stop discovery failed:', e);
            }
            setScanning(false);
            const timeoutId = scanTimeoutId();
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                setScanTimeoutId(null);
            }
        } else {
            // Start scanning
            const bt = Bluetooth.get_default();
            try {
                bt.startDiscovery();
                setScanning(true);
                // Auto-stop after 30 seconds
                const id = setTimeout(() => {
                    try {
                        bt.stopDiscovery();
                    } catch (e) {
                        logger.error(LOG_TAG, 'Auto-stop discovery failed:', e);
                    }
                    setScanning(false);
                    setScanTimeoutId(null);
                }, 30000);
                setScanTimeoutId(id);
            } catch (e) {
                logger.error(LOG_TAG, 'Start discovery failed:', e);
            }
        }
    };

    onCleanup(() => {
        const timeoutId = scanTimeoutId();
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        if (scanning()) {
            const bt = Bluetooth.get_default();
            try {
                bt.stopDiscovery();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });

    return (
        <Adw.PreferencesPage
            title={'Bluetooth'}
            iconName={'bluetooth-symbolic'}
        >
            <Adw.PreferencesGroup
                title={'Bluetooth'}
                description={'Enable Bluetooth and manage devices'}
            >
                <Adw.SwitchRow
                    title={'Bluetooth'}
                    subtitle={'Enable Bluetooth adapter'}
                    active={isPowered}
                    onNotifyActive={(self) => handleTogglePower(self)}
                />
            </Adw.PreferencesGroup>

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
        </Adw.PreferencesPage>
    );
};
