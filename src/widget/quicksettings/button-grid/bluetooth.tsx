import AstalBluetooth from 'gi://AstalBluetooth';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, createState, For} from 'gnim';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import logger from '#/lib/core/logger';
import {LinkedBox} from '#/widget/common/linkedBox';
import {toArray} from '#/lib/core/gjsUtils';

export default (): QuickButton => {
    // ButtonGrid items only render when quicksettings opens — D-Bus
    // services are already available by then, so synchronous call is safe.
    const bluetooth = AstalBluetooth.get_default();
    const [connectingAddress, setConnectingAddress] = createState<
        string | null
    >(null);

    const isConnecting = connectingAddress.as(addr => addr !== null);
    const isVisible = bind(bluetooth, 'adapters').as(a => a.length > 0);
    const isConnected = bind(bluetooth, 'isConnected');
    const isPowered = bind(bluetooth, 'isPowered');
    const icon = computed(
        () => {
            if (isConnecting()) return 'content-loading-symbolic';
            return isPowered() ? 'bluetooth-symbolic' : 'bluetooth-disabled-symbolic';
        }
    )

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <For
                    each={bind(bluetooth, 'devices').as(d =>
                        toArray<AstalBluetooth.Device>(d)
                    )}
                >
                    {(device: AstalBluetooth.Device) => {
                        const deviceConnecting = connectingAddress.as(
                            addr => addr !== null && addr === device.address
                        );

                        return (
                            <Gtk.Button
                                onClicked={() => {
                                    if (device.connected) {
                                        device.disconnect_device((_, res) => {
                                            try {
                                                device.disconnect_device_finish(
                                                    res
                                                );
                                            } catch (e) {
                                                logger.error(
                                                    'bluetooth',
                                                    'disconnect failed:',
                                                    e
                                                );
                                            }
                                        });
                                    } else {
                                        setConnectingAddress(device.address);
                                        device.connect_device((_, res) => {
                                            setConnectingAddress(null);
                                            try {
                                                device.connect_device_finish(
                                                    res
                                                );
                                            } catch (e) {
                                                logger.error(
                                                    'bluetooth',
                                                    'connect failed:',
                                                    e
                                                );
                                            }
                                        });
                                    }
                                }}
                            >
                                <Gtk.Box spacing={8}>
                                    <Gtk.Image
                                        iconName={
                                            device.icon || 'bluetooth-symbolic'
                                        }
                                        pixelSize={16}
                                    />
                                    <Gtk.Label
                                        hexpand
                                        halign={Gtk.Align.START}
                                        label={device.name}
                                    />
                                    <Gtk.Spinner
                                        visible={deviceConnecting}
                                        spinning
                                        marginEnd={4}
                                    />
                                    <Gtk.Image
                                        visible={bind(
                                            device,
                                            'connected'
                                        )}
                                        iconName="selection-mode-symbolic"
                                        pixelSize={16}
                                    />
                                </Gtk.Box>
                            </Gtk.Button>
                        );
                    }}
                </For>
            </LinkedBox>
        </Gtk.Popover>
    ) as unknown as Gtk.Popover;

    return {
        widget: (
            <QuickToggleButton
                icon={icon}
                cssClasses={computed(
                    () =>
                        isPowered() && isConnected()
                            ? ['raised', 'suggested-action']
                            : ['raised']
                )}
                label={computed(
                    () => {
                        if (!isPowered()) return 'Bluetooth Off';
                        const connectedDevices = toArray<AstalBluetooth.Device>(
                            bluetooth.devices
                        ).filter((d: AstalBluetooth.Device) => d.connected);
                        if (connectedDevices.length === 0) return 'Bluetooth';
                        if (connectedDevices.length === 1)
                            return connectedDevices[0].name;
                        return `${connectedDevices.length} connected`;
                    }
                )}
                onClick={() => {
                    if(!bluetooth?.adapter) return;
                    bluetooth.adapter.powered = !bluetooth.adapter.powered;
                }}
                popover={popover}
            />
        ) as unknown as Gtk.Widget,
        visible: isVisible,
    };
};
