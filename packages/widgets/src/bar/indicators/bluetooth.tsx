import Gtk from 'gi://Gtk?version=4.0';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {bind} from 'gnim';

export default () => {
    const bt = BluetoothService.get_default();

    return (
        <Gtk.Image
            iconName={bind(bt, 'iconName')}
            visible={bind(bt, 'isPowered')}
            tooltipText={bind(bt, 'connectedDeviceNames').as((names) => names || 'Bluetooth')}
            pixelSize={18}
        />
    );
};
