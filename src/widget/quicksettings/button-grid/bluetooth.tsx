import AstalBluetooth from 'gi://AstalBluetooth';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed, createState, For} from 'gnim';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import logger from '#/lib/logger';
import {LinkedBox} from '#/widget/common/linkedBox';
import {toArray} from '#/lib/gjsUtils';

export default () => {
    // ButtonGrid items only render when quicksettings opens — D-Bus
    // services are already available by then, so synchronous call is safe.
    const bluetooth = AstalBluetooth.get_default();
    const [connectingAddress, setConnectingAddress] = createState<
        string | null
    >(null);

    const isConnecting = connectingAddress.as(addr => addr !== null);

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <For
                    each={createBinding(bluetooth, 'devices').as(d =>
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
                                        visible={createBinding(
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
    ) as Gtk.Popover;

    return (
        <QuickToggleButton
            visible={createBinding(bluetooth, 'adapters').as(a => a.length > 0)}
            icon={createComputed(
                [isConnecting, createBinding(bluetooth, 'isPowered')],
                (connecting, powered) =>
                    connecting
                        ? 'content-loading-symbolic'
                        : powered
                          ? 'bluetooth-symbolic'
                          : 'bluetooth-disabled-symbolic'
            )}
            cssClasses={createComputed(
                [
                    createBinding(bluetooth, 'isPowered'),
                    createBinding(bluetooth, 'is-connected'),
                ],
                (powered, connected) =>
                    powered && connected
                        ? ['raised', 'suggested-action']
                        : ['raised']
            )}
            label={createComputed(
                [
                    createBinding(bluetooth, 'isPowered'),
                    createBinding(bluetooth, 'is-connected'),
                    createBinding(bluetooth, 'devices'),
                ],
                (powered, _connected) => {
                    if (!powered) return 'Bluetooth Off';
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
                bluetooth.adapter.powered = !bluetooth.adapter.powered;
            }}
            popover={popover}
        />
    );
};
