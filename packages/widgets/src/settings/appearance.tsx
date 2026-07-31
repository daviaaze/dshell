import {onCleanup} from 'gnim';
import WindowManager from '@shade/services/state/windowManager';
import {generalSettings} from '@shade/core/settings/general.gschema';
import PaletteGenerator from '@shade/style/palette';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {TEMP_MIN, TEMP_MAX} from '@shade/services/display/nightLight';

export default () => {
    const settings = generalSettings();
    const fileDialog = Gtk.FileDialog.new();
    const paletteGen = PaletteGenerator.get_default();
    fileDialog.set_default_filter(new Gtk.FileFilter({mimeTypes: ['image/*']}));

    return (
        <>
            <Adw.PreferencesGroup
                title={'Appearance'}
                description={'Set cosmetic options'}
            >
                <Adw.ActionRow title={'System Theme'}>
                    <Adw.ToggleGroup
                        slot="suffix"
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self => {
                            const map: Record<string, number> = {
                                auto: 0,
                                light: 1,
                                dark: 2,
                            };
                            const newVal =
                                map[self.activeName ?? 'auto'] ?? 0;
                            // Guard: skip when the value hasn't changed.
                            // Prevents a loop when ColorScheme.setter
                            // writes back to shade GSettings, which
                            // triggers the subscribe below to
                            // programmatically set activeName, which
                            // would fire notify::active-name again.
                            if (newVal !== settings.colorScheme.peek()) {
                                settings.setColorScheme(newVal);
                            }
                        }}
                        ref={self => {
                            const v = settings.colorScheme.peek();
                            self.activeName =
                                ['auto', 'light', 'dark'][v] ?? 'auto';
                            onCleanup(
                                settings.colorScheme.subscribe(() => {
                                    const cur = settings.colorScheme();
                                    self.activeName =
                                        ['auto', 'light', 'dark'][cur] ??
                                        'auto';
                                })
                            );
                        }}
                    >
                        <Adw.Toggle
                            name={'auto'}
                            label={'Auto'}
                            iconName={'night-light-symbolic'}
                        />
                        <Adw.Toggle
                            name={'light'}
                            label={'Light'}
                            iconName={'weather-clear-symbolic'}
                        />
                        <Adw.Toggle
                            name={'dark'}
                            label={'Dark'}
                            iconName={'weather-clear-night-symbolic'}
                        />
                    </Adw.ToggleGroup>
                </Adw.ActionRow>
                <Adw.ActionRow
                    activatable
                    title={'Wallpaper Day'}
                    subtitle={settings.wallpaperDay}
                    iconName={'image-x-generic-symbolic'}
                    onActivated={() => {
                        fileDialog.open(
                            WindowManager.get_default().settings!,
                            null,
                            (_, res) => {
                                try {
                                    const path = fileDialog
                                        .open_finish(res)
                                        ?.get_path();
                                    if (path) settings.setWallpaperDay(path);
                                } catch {
                                    /* user cancelled */
                                }
                            }
                        );
                    }}
                >
                    <Gtk.Image file={settings.wallpaperDay} />
                </Adw.ActionRow>
                <Adw.ActionRow
                    activatable
                    title={'Wallpaper Night'}
                    subtitle={settings.wallpaperNight}
                    iconName={'image-x-generic-symbolic'}
                    onActivated={() => {
                        fileDialog.open(
                            WindowManager.get_default().settings!,
                            null,
                            (_, res) => {
                                try {
                                    const path = fileDialog
                                        .open_finish(res)
                                        ?.get_path();
                                    if (path) settings.setWallpaperNight(path);
                                } catch {
                                    /* user cancelled */
                                }
                            }
                        );
                    }}
                >
                    <Gtk.Image file={settings.wallpaperNight} />
                </Adw.ActionRow>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Dynamic Theming'}
                description={'Extract accent colors from wallpaper'}
            >
                <Adw.SwitchRow
                    title={'Enable Dynamic Theming'}
                    subtitle={
                        PaletteGenerator.get_default().available
                            ? ''
                            : 'Install matugen to enable'
                    }
                    active={settings.dynamicThemingEnabled}
                    onNotifyActive={self =>
                        settings.setDynamicThemingEnabled(self.active)
                    }
                />
                <Gtk.Button
                    cssClasses={['suggested-action', 'popover-padded']}
                    halign={Gtk.Align.CENTER}
                    label="Regenerate from Wallpaper"
                    onClicked={() => paletteGen.regenerate()}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Night Light'}
                description={'Reduce eye strain with warm colors'}
            >
                <Adw.SwitchRow
                    title={'Enable Night Light'}
                    active={settings.nightLightEnabled}
                    onNotifyActive={self =>
                        settings.setNightLightEnabled(self.active)
                    }
                />
                <Adw.SpinRow
                    ref={self => {
                        self.adjustment = new Gtk.Adjustment({
                            lower: TEMP_MIN,
                            upper: TEMP_MAX,
                            stepIncrement: 100,
                            value: settings.nightLightTemperature(),
                        });
                    }}
                    title={'Color Temperature'}
                    subtitle={'Lower values are warmer (redder)'}
                    onNotifyValue={self =>
                        settings.setNightLightTemperature(
                            Math.round(self.value)
                        )
                    }
                />
                <Adw.SwitchRow
                    title={'Auto Schedule'}
                    subtitle={'Enable at sunset, disable at sunrise'}
                    active={settings.nightLightAutoSchedule}
                    onNotifyActive={self =>
                        settings.setNightLightAutoSchedule(self.active)
                    }
                />
            </Adw.PreferencesGroup>
        </>
    );
};
