import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import DndService from '#/lib/services/notifications/dnd';

export default () => {
    const dnd = DndService.get_default();

    return (
        <Gtk.Image
            visible={createBinding(dnd, 'dnd')}
            iconName="notifications-disabled-symbolic"
            pixelSize={18}
        />
    );
};
