import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import DndService from '../../../lib/services/notifications/dnd';

export default () => {
    const dnd = DndService.get_default();

    return (
        <Gtk.Image
            visible={bind(dnd, 'dnd')}
            iconName="notifications-disabled-symbolic"
            pixelSize={18}
        />
    );
};
