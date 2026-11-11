import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {setBoundaryInputPassthrough} from '@shade/services/capture/boundaryInput';
import KeystrokeOverlay from '@shade/services/input/keystrokeOverlay';
import {getHyprland} from '@shade/services/hyprland';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, For, onCleanup} from 'gnim';
import {getApp} from '@shade/services/appHandle';

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const overlay = KeystrokeOverlay.get_default();
    const keys = bind(overlay, 'recent-keys-json').as((json) => JSON.parse(json) as string[]);

    return (
        <Astal.Window
            name="keystroke-overlay"
            namespace="shade-keystroke-overlay"
            application={getApp()}
            visible={keys.as((entries) => entries.length > 0)}
            keymode={Astal.Keymode.NONE}
            layer={Astal.Layer.OVERLAY}
            exclusivity={Astal.Exclusivity.IGNORE}
            anchor={Astal.WindowAnchor.BOTTOM}
            margin={64}
            monitor={bind(hyprland, 'focused-monitor').as(monitorIndexFromHyprland)}
            css="background-color: transparent;"
            ref={(self) => {
                const passthrough = () => {
                    const surface = self.get_surface();
                    if (surface) setBoundaryInputPassthrough(surface);
                };
                const realized = self.connect('realize', passthrough);
                passthrough();
                onCleanup(() => self.disconnect(realized));
            }}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.HORIZONTAL}
                spacing={8}
                cssClasses={['card', 'background']}
                css="padding: 10px;"
            >
                <For each={keys}>
                    {(key: string) => (
                        <Gtk.Label
                            label={key}
                            cssClasses={['title-4']}
                            css="padding: 6px 10px; border-radius: 6px; background-color: alpha(@window_fg_color, 0.08);"
                        />
                    )}
                </For>
            </Gtk.Box>
        </Astal.Window>
    );
};
