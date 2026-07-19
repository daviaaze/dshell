import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import BluetoothService from '#/lib/services/bluetooth/bluetoothService';

export default () => {
    const bt = BluetoothService.get_default();

    return (
        <Gtk.Image
            iconName={createBinding(bt, 'icon-name')}
            visible={createBinding(bt, 'is-powered')}
            tooltipMarkup={createBinding(bt, 'connected-device-names').as(
                names => names || 'Bluetooth'
            )}
            pixelSize={18}
        />
    );
};