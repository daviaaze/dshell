import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {getHyprland} from '@shade/services/hyprland';
import {getAppIcon} from '@shade/services/state/apps';
import {type Accessor, bind, computed, With} from 'gnim';

export default ({
    visible: settingsVisible,
    vertical,
}: {
    visible: Accessor<boolean>;
    vertical: Accessor<boolean>;
}) => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const client = bind(hyprland, 'focused-client');

    return (
        <With value={client}>
            {(focused) => {
                if (!focused || focused.address === '0x0') return null;
                const clientTitle = bind(focused, 'title');
                const clientClass = bind(focused, 'class');
                const title = computed(() => clientTitle() || clientClass() || '');
                const appIcon = computed(() => {
                    clientTitle();
                    clientClass();
                    return getAppIcon(focused);
                });
                return (
                    <Gtk.Box
                        visible={settingsVisible}
                        spacing={8}
                        orientation={vertical.as((v) =>
                            v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                        )}
                        valign={Gtk.Align.CENTER}
                        halign={Gtk.Align.CENTER}
                        cssClasses={['linked']}
                    >
                        <Gtk.Image iconName={appIcon} pixelSize={16} />
                        <Gtk.Label
                            label={title}
                            maxWidthChars={vertical.as((v) => (v ? 4 : 40))}
                            ellipsize={Pango.EllipsizeMode.END}
                            tooltipText={title}
                        />
                    </Gtk.Box>
                );
            }}
        </With>
    );
};
