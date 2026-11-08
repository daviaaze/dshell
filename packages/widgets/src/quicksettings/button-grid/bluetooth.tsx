import AstalBluetooth from 'gi://AstalBluetooth';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {
    type Accessor,
    bind,
    computed,
    createState,
    For,
    type GnimNode,
    onCleanup,
    With,
} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';

/** Pair, connect or disconnect a device, tracking the in-flight address. */
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
        else if (!device.paired) await service.pairDevice(device);
        else await service.connectDevice(device);
    } catch (error) {
        logger.error('bluetooth', 'Device connection change failed:', error);
        setOperationError(String(error));
    } finally {
        setConnectingAddress(null);
    }
}

/** A device action pairs new devices and toggles paired connections. */
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
                <Gtk.Image
                    visible={bind(device, 'connected')}
                    iconName="selection-mode-symbolic"
                    pixelSize={16}
                />
            </Gtk.Box>
        </Gtk.Button>
    );
}

/** Device content remains mounted while the adapter is available. */
function DeviceList({
    bluetooth,
    service,
    connectingAddress,
    setConnectingAddress,
    setOperationError,
}: {
    bluetooth: AstalBluetooth.Bluetooth;
    service: BluetoothService;
    connectingAddress: Accessor<string | null>;
    setConnectingAddress: (addr: string | null) => void;
    setOperationError: (message: string | null) => void;
}) {
    const devices = bind(bluetooth, 'devices').as((items) => toArray<AstalBluetooth.Device>(items));
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <Gtk.Label label="Dispositivos" cssClasses={['heading']} xalign={0} />
            <Gtk.Label
                label="Nenhum dispositivo encontrado. Busque dispositivos próximos ou abra as configurações para parear."
                visible={devices.as((items) => items.length === 0)}
                wrap
                xalign={0}
            />
            <For each={devices}>
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
        </Gtk.Box>
    );
}

export default (onOpen: (self: Gtk.Button) => void): {widget: GnimNode; detail: GnimNode} => {
    const bluetooth = AstalBluetooth.get_default();
    const service = BluetoothService.get_default();
    const [operationError, setOperationError] = createState<string | null>(null);
    const [connectingAddress, setConnectingAddress] = createState<string | null>(null);

    const isConnecting = connectingAddress.as((addr) => addr !== null);
    const [adapter, setAdapter] = createState<AstalBluetooth.Adapter | null>(
        bluetooth.adapter ?? null
    );
    const [isPowered, setIsPowered] = createState(adapter()?.powered ?? false);
    let currentAdapter: AstalBluetooth.Adapter | null = null;
    let adapterPoweredSignalId = 0;
    const updateAdapter = () => {
        const nextAdapter =
            bluetooth.adapter ?? toArray<AstalBluetooth.Adapter>(bluetooth.adapters)[0] ?? null;
        if (currentAdapter !== nextAdapter) {
            if (currentAdapter && adapterPoweredSignalId)
                currentAdapter.disconnect(adapterPoweredSignalId);
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
        if (currentAdapter && adapterPoweredSignalId)
            currentAdapter.disconnect(adapterPoweredSignalId);
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
        if (!adapter()) return 'Indisponível';
        if (!isPowered()) return 'Desativado';
        const connectedDevices = devices().filter((device) => device.connected());
        if (connectedDevices.length === 0) return 'Ativado, sem dispositivos';
        if (connectedDevices.length === 1) return connectedDevices[0].name();
        return `${connectedDevices.length} conectados`;
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
                    powered ? 'Desativar Bluetooth' : 'Ativar Bluetooth'
                )}
                actionSensitive={adapter.as((current) => current !== null)}
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
                detail={{label: 'Detalhes do Bluetooth', onOpen}}
            />
        ),
        detail: (
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                <Gtk.Label
                    label={operationError.as((message) => message ?? '')}
                    visible={operationError.as((message) => !!message)}
                    cssClasses={['error']}
                    wrap
                />
                <With value={adapter}>
                    {(current) =>
                        current ? (
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                                <Gtk.Box spacing={12}>
                                    <Gtk.Label
                                        label="Bluetooth"
                                        hexpand
                                        xalign={0}
                                        cssClasses={['heading']}
                                    />
                                    <Gtk.Switch
                                        active={isPowered}
                                        onNotifyActive={(self) => {
                                            if (current.powered === self.active) return;
                                            setOperationError(null);
                                            try {
                                                current.powered = self.active;
                                            } catch (error) {
                                                setOperationError(String(error));
                                            } finally {
                                                self.active = current.powered;
                                            }
                                        }}
                                    />
                                </Gtk.Box>
                                <Gtk.Box
                                    visible={isPowered}
                                    orientation={Gtk.Orientation.VERTICAL}
                                    spacing={12}
                                >
                                    <Gtk.Button
                                        label={bind(current, 'discovering').as((scanning) =>
                                            scanning ? 'Parar busca' : 'Buscar dispositivos'
                                        )}
                                        onClicked={() => {
                                            setOperationError(null);
                                            try {
                                                if (current.discovering) current.stop_discovery();
                                                else current.start_discovery();
                                            } catch (error) {
                                                setOperationError(String(error));
                                            }
                                        }}
                                    />
                                    <DeviceList
                                        bluetooth={bluetooth}
                                        service={service}
                                        connectingAddress={connectingAddress}
                                        setConnectingAddress={setConnectingAddress}
                                        setOperationError={setOperationError}
                                    />
                                </Gtk.Box>
                                <Gtk.Label
                                    visible={isPowered.as((powered) => !powered)}
                                    label="Bluetooth desativado. Ative para conectar um dispositivo."
                                    wrap
                                />
                            </Gtk.Box>
                        ) : (
                            <Gtk.Label
                                label="Bluetooth indisponível: conecte ou habilite um adaptador."
                                wrap
                            />
                        )
                    }
                </With>
            </Gtk.Box>
        ),
    };
};
