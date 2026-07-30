import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';

export default () => {
    const bt = BluetoothService.get_default();

    return (
        <Gtk.Image
            iconName={bind(bt, 'iconName')}
            visible={bind(bt, 'isPowered')}
            tooltipText={bind(bt, 'connectedDeviceNames').as(
                names => names || 'Bluetooth'
            )}
            pixelSize={18}
        />
    );
};
