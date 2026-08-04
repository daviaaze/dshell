import Astal from 'gi://Astal?version=4.0';
import type Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {getApp} from '@shade/services/appHandle';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {monitors} from '@shade/services/monitoring/monitors';
import WindowManager from '@shade/services/state/windowManager';
import {bind, computed, For, onCleanup} from 'gnim';

export const Wallpaper = () => {
    const settings = generalSettings();
    const color = bind(ColorScheme.get_default(), 'colorScheme');
    const daytime = bind(ColorScheme.get_default(), 'daytime');
    const wp = computed(() => {
        if (color() === DarkModes.AUTO)
            return Gio.File.new_for_path(
                daytime() ? settings.wallpaperDay() : settings.wallpaperNight()
            );
        if (color() === DarkModes.LIGHT) return Gio.File.new_for_path(settings.wallpaperDay());
        else return Gio.File.new_for_path(settings.wallpaperNight());
    });

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    ref={(self) => {
                        WindowManager.get_default().registerWallpaper(self);
                        onCleanup(() => {
                            WindowManager.get_default().unregisterWallpaper(self);
                            self.close();
                        });
                    }}
                    application={getApp()}
                    gdkmonitor={monitor}
                    layer={Astal.Layer.BACKGROUND}
                    anchor={
                        Astal.WindowAnchor.TOP |
                        Astal.WindowAnchor.RIGHT |
                        Astal.WindowAnchor.BOTTOM |
                        Astal.WindowAnchor.LEFT
                    }
                    exclusivity={Astal.Exclusivity.IGNORE}
                    visible
                >
                    <Gtk.Picture contentFit={Gtk.ContentFit.COVER} file={wp} />
                </Astal.Window>
            )}
        </For>
    );
};
