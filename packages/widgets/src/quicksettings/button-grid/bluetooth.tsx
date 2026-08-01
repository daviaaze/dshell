import AstalBluetooth from 'gi://AstalBluetooth';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind, computed, createState, For} from 'gnim';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from './quickButton';
import logger from '@shade/core/logger';
import {LinkedBox} from '../../common/linkedBox';
import {toArray} from '@shade/core/gjsUtils';

/** Connect or disconnect a device, tracking the in-flight address. */
function toggleDevice(
    device: AstalBluetooth.Device,
    setConnectingAddress: (addr: string | null) => void
) {
    if (device.connected) {
        device.disconnect_device((_, res) => {
            try {
                device.disconnect_device_finish(res);
            } catch (e) {
                logger.error('bluetooth', 'disconnect failed:', e);
            }
        });
        return;
    }

    setConnectingAddress(device.address);
    device.connect_device((_, res) => {
        setConnectingAddress(null);
        try {
            device.connect_device_finish(res);
        } catch (e) {
            logger.error('bluetooth', 'connect failed:', e);
        }
    });
}

/** One device row in the popover: icon, name, spinner, connected check. */
function DeviceButton({
    device,
    connectingAddress,
    setConnectingAddress,
}: {
    device: AstalBluetooth.Device;
    connectingAddress: Accessor<string | null>;
    setConnectingAddress: (addr: string | null) => void;
}) {
    const deviceConnecting = connectingAddress.as(
        addr => addr !== null && addr === device.address
    );

    return (
        <Gtk.Button
            onClicked={() => toggleDevice(device, setConnectingAddress)}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Image
                    iconName={device.icon || 'bluetooth-symbolic'}
                    pixelSize={16}
                />
                <Gtk.Label hexpand halign={Gtk.Align.START} label={device.name} />
                <Gtk.Spinner
                    visible={deviceConnecting}
                    spinning
                    marginEnd={4}
                />
                <Gtk.Image
                    visible={bind(device, 'connected')}
                    iconName="selection-mode-symbolic"
                    pixelSize={16}
                />
            </Gtk.Box>
        </Gtk.Button>
    );
}

/** Popover listing all known bluetooth devices. */
function DevicePopover({
    bluetooth,
    connectingAddress,
    setConnectingAddress,
}: {
    bluetooth: AstalBluetooth.Bluetooth;
    connectingAddress: Accessor<string | null>;
    setConnectingAddress: (addr: string | null) => void;
}) {
    return (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <For
                    each={bind(bluetooth, 'devices').as(d =>
                        toArray<AstalBluetooth.Device>(d)
                    )}
                >
                    {(device: AstalBluetooth.Device) => (
                        <DeviceButton
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
    const [connectingAddress, setConnectingAddress] = createState<
        string | null
    >(null);

    const isConnecting = connectingAddress.as(addr => addr !== null);
    const isVisible = bind(bluetooth, 'adapters').as(a => a.length > 0);
    const isConnected = bind(bluetooth, 'is-connected');
    const isPowered = bind(bluetooth, 'is-powered');
    const icon = computed(() => {
        if (isConnecting()) return 'content-loading-symbolic';
        return isPowered()
            ? 'bluetooth-symbolic'
            : 'bluetooth-disabled-symbolic';
    });

    const label = computed(() => {
        if (!isPowered()) return 'Bluetooth Off';
        const connectedDevices = toArray<AstalBluetooth.Device>(
            bluetooth.devices
        ).filter((d: AstalBluetooth.Device) => d.connected);
        if (connectedDevices.length === 0) return 'Bluetooth';
        if (connectedDevices.length === 1) return connectedDevices[0].name;
        return `${connectedDevices.length} connected`;
    });

    return {
        widget: (
            <QuickToggleButton
                icon={icon}
                cssClasses={computed(() =>
                    isPowered() && isConnected()
                        ? ['raised', 'suggested-action']
                        : ['raised']
                )}
                label={label}
                onClick={() => {
                    if (!bluetooth?.adapter) return;
                    bluetooth.adapter.powered = !bluetooth.adapter.powered;
                }}
                popover={
                    <DevicePopover
                        bluetooth={bluetooth}
                        connectingAddress={connectingAddress}
                        setConnectingAddress={setConnectingAddress}
                    />
                }
            />
        ),
        visible: isVisible,
    };
};