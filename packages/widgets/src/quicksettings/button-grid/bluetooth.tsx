import AstalBluetooth from 'gi://AstalBluetooth';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {type Accessor, bind, computed, createState, For, onCleanup} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

/** Connect or disconnect a device, tracking the in-flight address. */
async function toggleDevice(
    service: BluetoothService,
    device: AstalBluetooth.Device,
    setConnectingAddress: (addr: string | null) => void,
    setOperationError: (message: string | null) => void
) {
    setConnectingAddress(device.address);
    setOperationError(null);
    try {
        if (device.connected) await service.disconnectDevice(device);
        else await service.connectDevice(device);
    } catch (error) {
        logger.error('bluetooth', 'Device connection change failed:', error);
        setOperationError(String(error));
    } finally {
        setConnectingAddress(null);
    }
}

/** One device row in the popover: icon, name, spinner, connected check. */
function DeviceButton({
    device,
    service,
    connectingAddress,
    setConnectingAddress,
    setOperationError,
}: {
    device: AstalBluetooth.Device;
    service: BluetoothService;
    connectingAddress: Accessor<string | null>;
    setConnectingAddress: (addr: string | null) => void;
    setOperationError: (message: string | null) => void;
}) {
    const deviceConnecting = connectingAddress.as(
        (addr) => addr !== null && addr === device.address
    );

    return (
        <Gtk.Button
            sensitive={connectingAddress.as((addr) => addr === null)}
            onClicked={() => toggleDevice(service, device, setConnectingAddress, setOperationError)}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Image iconName={device.icon || 'bluetooth-symbolic'} pixelSize={16} />
                <Gtk.Label hexpand halign={Gtk.Align.START} label={device.name} />
                <Gtk.Spinner visible={deviceConnecting} spinning marginEnd={4} />
                <Gtk.Image visible={bind(device, 'connected')} iconName="selection-mode-symbolic" pixelSize={16} />
            </Gtk.Box>
        </Gtk.Button>
    );
}

/** Popover listing all known bluetooth devices. */
function DevicePopover({
    bluetooth,
    service,
    connectingAddress,
    setConnectingAddress,
    operationError,
    setOperationError,
}: {
    bluetooth: AstalBluetooth.Bluetooth;
    service: BluetoothService;
    connectingAddress: Accessor<string | null>;
    setConnectingAddress: (addr: string | null) => void;
    operationError: Accessor<string | null>;
    setOperationError: (message: string | null) => void;
}) {
    return (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                {operationError.as((message) => message ? (
                    <Gtk.Label label={message} cssClasses={['error', 'caption']} wrap />
                ) : null)}
                <For each={bind(bluetooth, 'devices').as((d) => toArray<AstalBluetooth.Device>(d))}>
                    {(device: AstalBluetooth.Device) => (
                        <DeviceButton
                            service={service}
                            setOperationError={setOperationError}
                            device={device}
                            connectingAddress={connectingAddress}
                            setConnectingAddress={setConnectingAddress}
                        />
                    )}
                </For>
            </LinkedBox>
        </Gtk.Popover>
    );
}

export default (): QuickButton => {
    // ButtonGrid items only render when quicksettings opens — D-Bus
    // services are already available by then, so synchronous call is safe.
    const bluetooth = AstalBluetooth.get_default();
    const service = BluetoothService.get_default();
    const [operationError, setOperationError] = createState<string | null>(null);
    const [connectingAddress, setConnectingAddress] = createState<string | null>(null);

    const isConnecting = connectingAddress.as((addr) => addr !== null);
    const isVisible = bind(bluetooth, 'adapters').as((a) => a.length > 0);
    const [adapter, setAdapter] = createState<AstalBluetooth.Adapter | null>(bluetooth.adapter ?? null);
    const [isPowered, setIsPowered] = createState(adapter()?.powered ?? false);
    let currentAdapter: AstalBluetooth.Adapter | null = null;
    let adapterPoweredSignalId = 0;
    const updateAdapter = () => {
        const nextAdapter = bluetooth.adapter
            ?? toArray<AstalBluetooth.Adapter>(bluetooth.adapters)[0]
            ?? null;
        if (currentAdapter !== nextAdapter) {
            if (currentAdapter && adapterPoweredSignalId) currentAdapter.disconnect(adapterPoweredSignalId);
            currentAdapter = nextAdapter;
            adapterPoweredSignalId = 0;
            setAdapter(nextAdapter);
            if (nextAdapter) {
                adapterPoweredSignalId = nextAdapter.connect('notify::powered', () =>
                    setIsPowered(nextAdapter.powered)
                );
            }
        }
        setIsPowered(nextAdapter?.powered ?? false);
    };
    const adapterAddedSignalId = bluetooth.connect('adapter-added', updateAdapter);
    const adapterRemovedSignalId = bluetooth.connect('adapter-removed', updateAdapter);
    const adapterListSignalId = bluetooth.connect('notify::adapters', updateAdapter);
    const selectedAdapterSignalId = bluetooth.connect('notify::adapter', updateAdapter);
    updateAdapter();
    onCleanup(() => {
        if (currentAdapter && adapterPoweredSignalId) currentAdapter.disconnect(adapterPoweredSignalId);
        bluetooth.disconnect(adapterAddedSignalId);
        bluetooth.disconnect(adapterRemovedSignalId);
        bluetooth.disconnect(adapterListSignalId);
        bluetooth.disconnect(selectedAdapterSignalId);
    });
    const devices = bind(bluetooth, 'devices').as((items) =>
        toArray<AstalBluetooth.Device>(items).map((device) => ({
            connected: bind(device, 'connected'),
            name: bind(device, 'name'),
        }))
    );
    const icon = computed(() => {
        if (isConnecting()) return 'content-loading-symbolic';
        return isPowered() ? 'bluetooth-symbolic' : 'bluetooth-disabled-symbolic';
    });

    const value = computed(() => {
        if (!isPowered()) return 'Off';
        const connectedDevices = devices().filter((device) => device.connected());
        if (connectedDevices.length === 0) return 'On, no devices';
        if (connectedDevices.length === 1) return connectedDevices[0].name();
        return `${connectedDevices.length} connected`;
    });

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                active={isPowered}
                icon={icon}
                cssClasses={['raised']}
                domain="Bluetooth"
                value={value}
                actionLabel={isPowered.as((powered) =>
                    powered ? 'Turn Bluetooth off' : 'Turn Bluetooth on'
                )}
                onClick={() => {
                    const current = adapter();
                    if (!current) return;
                    setOperationError(null);
                    try {
                        current.powered = !current.powered;
                    } catch (error) {
                        logger.error('bluetooth', 'Toggle power failed:', error);
                        setOperationError(String(error));
                    }
                }}
                menu={{
                    label: 'Bluetooth devices',
                    popover: (
                        <DevicePopover
                            bluetooth={bluetooth}
                            service={service}
                            connectingAddress={connectingAddress}
                            setConnectingAddress={setConnectingAddress}
                            operationError={operationError}
                            setOperationError={setOperationError}
                        />
                    ),
                }}
            />
        ),
        visible: isVisible,
    };
};
