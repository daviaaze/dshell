import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import ShellState from '@shade/services/state/shellState';
import {type Accessor, bind} from 'gnim';
import {setAccessibleName} from '../common/iconButton';

export default ({visible = true}: {visible?: boolean | Accessor<boolean>}) => {
    const shellState = ShellState.get_default();
    return (
        <Gtk.ToggleButton
            visible={visible}
            cssClasses={['flat']}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            tooltipText="Abrir aplicativos"
            ref={setAccessibleName('Abrir aplicativos')}
            active={bind(shellState, 'launcherOpen')}
            onClicked={() => shellState.toggleLauncher()}
        >
            <Gtk.Image iconName={'nix-snowflake'} pixelSize={24} />
        </Gtk.ToggleButton>
    );
};
