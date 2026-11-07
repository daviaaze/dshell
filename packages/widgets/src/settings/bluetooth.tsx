import Adw from 'gi://Adw?version=1';
import Bluetooth from 'gi://AstalBluetooth';
import Gdk from 'gi://Gdk?version=4.0';
import type GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {bind, computed, createState, For, onCleanup} from 'gnim';

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
    const [operationError, setOperationError] = createState<string | null>(null);
    const [forgetting, setForgetting] = createState(false);
    const deviceConnecting = connectingAddress.as(
        (addr) => addr !== null && addr === device.address
    );
    const connected = bind(device, 'connected');

    const statusText = computed(() => {
        if (deviceConnecting()) return 'Conectando…';
        if (connected()) return 'Conectado';
        return 'Pareado';
    });

    const handleForget = async () => {
        if (forgetting()) return;
        setForgetting(true);
        setOperationError(null);
        try {
            await service.forgetDevice(device);
        } catch (error) {
            logger.error(LOG_TAG, 'Forget failed:', String(error));
            setOperationError(String(error));
        } finally {
            setForgetting(false);
        }
    };
    const confirmForget = (parent: Gtk.Widget) => {
        const root = parent.get_root();
        if (!(root instanceof Gtk.Window)) return;
        const dialog = new Adw.Window({
            transientFor: root,
            modal: true,
            title: 'Esquecer dispositivo?',
            defaultWidth: 420,
            resizable: false,
            cssClasses: ['background'],
        });
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 16,
            marginTop: 20,
            marginBottom: 20,
            marginStart: 20,
            marginEnd: 20,
        });
        content.append(
            new Gtk.Label({
                label: 'Esquecer dispositivo?',
                xalign: 0,
                cssClasses: ['title-2'],
            })
        );
        content.append(
            new Gtk.Label({
                label: `O dispositivo ${device.name || device.address} será removido dos dispositivos pareados.`,
                wrap: true,
                xalign: 0,
                hexpand: true,
            })
        );
        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
        });
        const cancel = new Gtk.Button({label: 'Cancelar'});
        cancel.connect('clicked', () => dialog.close());
        const forget = new Gtk.Button({
            label: 'Esquecer',
            cssClasses: ['destructive-action'],
        });
        let responded = false;
        forget.connect('clicked', () => {
            if (responded) return;
            responded = true;
            dialog.close();
            void handleForget();
        });
        buttons.append(cancel);
        buttons.append(forget);
        content.append(buttons);
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval) => {
            if (keyval !== Gdk.KEY_Escape) return false;
            dialog.close();
            return true;
        });
        dialog.add_controller(keys);
        dialog.set_content(content);
        dialog.present();
    };
    return (
        <Adw.ActionRow title={device.name || device.address} subtitle={statusText}>
            <Gtk.Image iconName={'bluetooth-symbolic'} pixelSize={24} />
            {operationError.as((message) =>
                message ? (
                    <Gtk.Label label={message} cssClasses={['error', 'caption']} wrap />
                ) : null
            )}
            <Gtk.Box spacing={6}>
                <Gtk.Button
                    label={connected.as((value) => (value ? 'Desconectar' : 'Conectar'))}
                    sensitive={deviceConnecting.as((value) => !value)}
                    onClicked={() =>
                        toggleDevice(service, device, setConnectingAddress, setOperationError)
                    }
                />
                <Gtk.Button
                    label="Esquecer"
                    cssClasses={['destructive-action']}
                    sensitive={forgetting.as((value) => !value)}
                    onClicked={(self) => confirmForget(self)}
                />
            </Gtk.Box>
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
    const devicePairing = pairingAddress.as((addr) => addr !== null && addr === device.address);

    const handlePair = async () => {
        setPairingAddress(device.address);
        setOperationError(null);
        try {
            await service.pairDevice(device);
        } catch (error) {
            logger.error(LOG_TAG, 'Pair failed:', error);
            setOperationError(String(error));
        } finally {
            setPairingAddress(null);
        }
    };

    return (
        <Adw.ActionRow
            title={device.name || device.address}
            subtitle={operationError.as((error) => error ?? 'Disponível')}
        >
            <Gtk.Image iconName={'bluetooth-symbolic'} pixelSize={24} />
            <Gtk.Button
                label="Parear"
                sensitive={devicePairing.as((value) => !value)}
                onClicked={handlePair}
            />
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

    const pairedDevices = computed(() => devices().filter((d) => d.paired));

    const availableDevices = computed(() => devices().filter((d) => !d.paired));

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
                if (adapterDiscoveringSignalId)
                    currentAdapter.disconnect(adapterDiscoveringSignalId);
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
                title={adapter.as((value) => (value ? 'Bluetooth' : 'Bluetooth indisponível'))}
                description={adapter.as((value) =>
                    value
                        ? 'Ative o Bluetooth e gerencie dispositivos.'
                        : 'Nenhum adaptador Bluetooth foi detectado.'
                )}
            >
                {adapter.as((value) =>
                    value ? (
                        <Adw.SwitchRow
                            title={'Bluetooth'}
                            subtitle={'Enable Bluetooth adapter'}
                            active={isPowered}
                            onNotifyActive={(self) => handleTogglePower(self)}
                        />
                    ) : (
                        <Adw.ActionRow
                            title="Nenhum adaptador Bluetooth"
                            subtitle="Conecte ou habilite um adaptador Bluetooth para gerenciar dispositivos."
                        />
                    )
                )}
                {operationError.as((message) =>
                    message ? (
                        <Adw.ActionRow
                            title="Não foi possível alterar o Bluetooth"
                            subtitle={message}
                            cssClasses={['error']}
                        />
                    ) : null
                )}
            </Adw.PreferencesGroup>

            {adapter.as((value) =>
                value ? (
                    <>
                        <Adw.PreferencesGroup
                            title="Dispositivos pareados"
                            description="Dispositivos conhecidos; conecte, desconecte ou remova o pareamento."
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
                            {pairedDevices.as((devices) =>
                                devices.length === 0 ? (
                                    <Adw.ActionRow
                                        title="Nenhum dispositivo pareado"
                                        subtitle="Busque dispositivos próximos para parear."
                                    />
                                ) : null
                            )}
                        </Adw.PreferencesGroup>

                        <Adw.PreferencesGroup
                            title="Dispositivos disponíveis"
                            description={scanning.as((value) =>
                                value
                                    ? 'Buscando dispositivos próximos…'
                                    : 'Inicie uma busca para encontrar dispositivos.'
                            )}
                            sensitive={isPowered}
                        >
                            <Gtk.Box halign={Gtk.Align.CENTER}>
                                <Gtk.Button
                                    label={scanning.as((value) =>
                                        value ? 'Parar busca' : 'Buscar dispositivos'
                                    )}
                                    cssClasses={scanning.as((value) =>
                                        value ? ['destructive-action'] : ['suggested-action']
                                    )}
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
                            {computed(() =>
                                !scanning() && availableDevices().length === 0 ? (
                                    <Adw.ActionRow
                                        title="Nenhum dispositivo encontrado"
                                        subtitle="Inicie uma busca para descobrir dispositivos próximos."
                                    />
                                ) : null
                            )}
                        </Adw.PreferencesGroup>
                    </>
                ) : null
            )}
        </>
    );
};
