import Gtk from 'gi://Gtk?version=4.0';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {bind, computed} from 'gnim';

export default () => {
    const bt = BluetoothService.get_default();
    const available = bind(bt, 'adapterAvailable');
    const powered = bind(bt, 'isPowered');

    return (
        <Gtk.Image
            iconName={bind(bt, 'iconName')}
            visible={computed(() => available() && powered())}
            tooltipText={bind(bt, 'connectedDeviceNames').as((names) => names || 'Bluetooth')}
            pixelSize={18}
        />
    );
};
