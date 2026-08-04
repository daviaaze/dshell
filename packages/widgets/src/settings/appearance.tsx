import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {TEMP_MAX, TEMP_MIN} from '@shade/services/display/nightLight';
import WindowManager from '@shade/services/state/windowManager';
import PaletteGenerator from '@shade/style/palette';
import {onCleanup} from 'gnim';

type Settings = ReturnType<typeof generalSettings>;

/** Open an image file dialog and apply the chosen path. */
function pickWallpaper(fileDialog: Gtk.FileDialog, apply: (path: string) => void) {
    fileDialog.open(WindowManager.get_default().settings!, null, (_, res) => {
        try {
            const path = fileDialog.open_finish(res)?.get_path();
            if (path) apply(path);
        } catch {
            /* user cancelled */
        }
    });
}

/** System theme toggle group. The notify guard prevents a write-back loop
 *  when ColorScheme.setter updates GSettings, which re-triggers the
 *  subscribe that sets activeName programmatically. */
function ThemeToggle({settings}: {settings: Settings}) {
    const NAMES = ['auto', 'light', 'dark'];
    const map: Record<string, number> = {auto: 0, light: 1, dark: 2};

    return (
        <Adw.ToggleGroup
            slot="suffix"
            cssClasses={['round']}
            valign={Gtk.Align.CENTER}
            onNotifyActiveName={(self) => {
                const newVal = map[self.activeName ?? 'auto'] ?? 0;
                if (newVal !== settings.colorScheme.peek()) {
                    settings.setColorScheme(newVal);
                }
            }}
            ref={(self) => {
                self.activeName = NAMES[settings.colorScheme.peek()] ?? 'auto';
                onCleanup(
                    settings.colorScheme.subscribe(() => {
                        self.activeName = NAMES[settings.colorScheme()] ?? 'auto';
                    })
                );
            }}
        >
            <Adw.Toggle name={'auto'} label={'Auto'} iconName={'night-light-symbolic'} />
            <Adw.Toggle name={'light'} label={'Light'} iconName={'weather-clear-symbolic'} />
            <Adw.Toggle name={'dark'} label={'Dark'} iconName={'weather-clear-night-symbolic'} />
        </Adw.ToggleGroup>
    );
}

/** Appearance group: theme toggle plus day/night wallpaper pickers. */
function AppearanceGroup({settings}: {settings: Settings}) {
    const fileDialog = Gtk.FileDialog.new();
    fileDialog.set_default_filter(new Gtk.FileFilter({mimeTypes: ['image/*']}));

    return (
        <Adw.PreferencesGroup title={'Appearance'} description={'Set cosmetic options'}>
            <Adw.ActionRow title={'System Theme'}>
                <ThemeToggle settings={settings} />
            </Adw.ActionRow>
            <Adw.ActionRow
                activatable
                title={'Wallpaper Day'}
                subtitle={settings.wallpaperDay}
                iconName={'image-x-generic-symbolic'}
                onActivated={() => pickWallpaper(fileDialog, (p) => settings.setWallpaperDay(p))}
            >
                <Gtk.Image file={settings.wallpaperDay} />
            </Adw.ActionRow>
            <Adw.ActionRow
                activatable
                title={'Wallpaper Night'}
                subtitle={settings.wallpaperNight}
                iconName={'image-x-generic-symbolic'}
                onActivated={() => pickWallpaper(fileDialog, (p) => settings.setWallpaperNight(p))}
            >
                <Gtk.Image file={settings.wallpaperNight} />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

/** Dynamic theming group: matugen toggle + manual regenerate. */
function ThemingGroup({settings}: {settings: Settings}) {
    const paletteGen = PaletteGenerator.get_default();

    return (
        <Adw.PreferencesGroup
            title={'Dynamic Theming'}
            description={'Extract accent colors from wallpaper'}
        >
            <Adw.SwitchRow
                title={'Enable Dynamic Theming'}
                subtitle={paletteGen.available ? '' : 'Install matugen to enable'}
                active={settings.dynamicThemingEnabled}
                onNotifyActive={(self) => settings.setDynamicThemingEnabled(self.active)}
            />
            <Gtk.Button
                cssClasses={['suggested-action']}
                marginTop={8}
                marginBottom={8}
                marginStart={8}
                marginEnd={8}
                halign={Gtk.Align.CENTER}
                label="Regenerate from Wallpaper"
                onClicked={() => paletteGen.regenerate()}
            />
        </Adw.PreferencesGroup>
    );
}

/** Night light group: enable toggle, temperature, auto schedule. */
function NightLightGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Night Light'}
            description={'Reduce eye strain with warm colors'}
        >
            <Adw.SwitchRow
                title={'Enable Night Light'}
                active={settings.nightLightEnabled}
                onNotifyActive={(self) => settings.setNightLightEnabled(self.active)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: TEMP_MIN,
                        upper: TEMP_MAX,
                        stepIncrement: 100,
                        value: settings.nightLightTemperature(),
                    });
                }}
                title={'Color Temperature'}
                subtitle={'Lower values are warmer (redder)'}
                onNotifyValue={(self) => settings.setNightLightTemperature(Math.round(self.value))}
            />
            <Adw.SwitchRow
                title={'Auto Schedule'}
                subtitle={'Enable at sunset, disable at sunrise'}
                active={settings.nightLightAutoSchedule}
                onNotifyActive={(self) => settings.setNightLightAutoSchedule(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const settings = generalSettings();

    return (
        <>
            <AppearanceGroup settings={settings} />
            <ThemingGroup settings={settings} />
            <NightLightGroup settings={settings} />
        </>
    );
};
