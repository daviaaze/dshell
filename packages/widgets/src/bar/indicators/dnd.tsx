import Gtk from 'gi://Gtk?version=4.0';
import DndService from '@shade/services/notifications/dnd';
import {bind} from 'gnim';
import {setAccessibleName} from '../../common/iconButton';

export default () => {
    const dnd = DndService.get_default();

    return (
        <Gtk.Image
            visible={bind(dnd, 'dnd')}
            iconName="notifications-disabled-symbolic"
            pixelSize={18}
            tooltipText="Não perturbe ativado"
            accessibleRole={Gtk.AccessibleRole.IMG}
            ref={setAccessibleName('Não perturbe ativado')}
        />
    );
};
