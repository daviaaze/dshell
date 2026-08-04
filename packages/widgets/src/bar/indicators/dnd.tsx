import Gtk from 'gi://Gtk?version=4.0';
import DndService from '@shade/services/notifications/dnd';
import {bind} from 'gnim';

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
