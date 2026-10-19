import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {TEMP_MAX, TEMP_MIN} from '@shade/services/display/nightLight';
import WindowManager from '@shade/services/state/windowManager';
import PaletteGenerator from '@shade/style/palette';
import {bind, computed, onCleanup} from 'gnim';

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
            ref={(self) => {
                self.add(new Adw.Toggle({name: 'auto', label: 'Auto', iconName: 'night-light-symbolic'}));
                self.add(new Adw.Toggle({name: 'light', label: 'Light', iconName: 'weather-clear-symbolic'}));
                self.add(new Adw.Toggle({name: 'dark', label: 'Dark', iconName: 'weather-clear-night-symbolic'}));
                self.activeName = NAMES[settings.colorScheme.peek()] ?? 'auto';
                const changed = self.connect('notify::active-name', () => {
                    const requested = map[self.activeName ?? 'auto'] ?? 0;
                    if (requested !== settings.colorScheme.peek()) settings.setColorScheme(requested);
                });
                const unsubscribe = settings.colorScheme.subscribe(() => {
                    self.activeName = NAMES[settings.colorScheme()] ?? 'auto';
                });
                onCleanup(() => {
                    unsubscribe();
                    self.disconnect(changed);
                    self.remove_all();
                });
            }}
        />
    );
}

/** Appearance group: theme toggle plus day/night wallpaper pickers. */
function AppearanceGroup({settings}: {settings: Settings}) {
    const fileDialog = Gtk.FileDialog.new();
    fileDialog.set_default_filter(new Gtk.FileFilter({mimeTypes: ['image/*']}));
    const scheme = ColorScheme.get_default();
    const requested = bind(scheme, 'colorScheme');
    const dark = bind(scheme, 'effectiveDark');
    const error = bind(scheme, 'applyError');
    const status = computed(() => error()
        ? `Not fully applied: ${error()}`
        : requested() === DarkModes.AUTO
            ? `Auto using ${dark() ? 'Dark' : 'Light'}`
            : `${dark() ? 'Dark' : 'Light'} active`);

    return (
        <Adw.PreferencesGroup title={'Appearance'} description={'Set cosmetic options'}>
            <Adw.ActionRow title={'System Theme'}>
                <ThemeToggle settings={settings} />
            </Adw.ActionRow>
            <Adw.ActionRow title={'Effective Appearance'} subtitle={status} />
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

/** Dynamic theming group: matugen toggle + completion-aware regeneration. */
function ThemingGroup({settings}: {settings: Settings}) {
    const paletteGen = PaletteGenerator.get_default();
    const busy = bind(paletteGen, 'generationBusy');
    const error = bind(paletteGen, 'generationError');
    const available = bind(paletteGen, 'available');
    const wallpaperReady = computed(() => {
        const wallpaper = settings.wallpaperDay();
        return !!wallpaper && GLib.file_test(wallpaper, GLib.FileTest.IS_REGULAR);
    });
    const status = computed(() => {
        if (busy()) return 'Generating colors from the day wallpaper…';
        if (error()) return error() ?? '';
        if (!available()) return 'Matugen is unavailable. Install matugen to generate colors.';
        if (!wallpaperReady()) return 'Choose an existing day wallpaper to generate colors.';
        return 'Ready to generate colors from the day wallpaper.';
    });
    const statusClasses = computed(() =>
        error() || !available() ? ['error', 'caption'] : ['caption']
    );

    return (
        <Adw.PreferencesGroup
            title={'Dynamic Theming'}
            description={'Extract accent colors from wallpaper'}
        >
            <Adw.SwitchRow
                title={'Enable Dynamic Theming'}
                subtitle={available.as((isAvailable) =>
                    isAvailable ? '' : 'Install matugen to enable'
                )}
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
                sensitive={computed(() => available() && wallpaperReady() && !busy())}
                onClicked={() => {
                    void paletteGen.regenerate().catch(() => {
                        // The service publishes the failure beside this action.
                    });
                }}
            />
            <Gtk.Label
                label={status}
                cssClasses={statusClasses}
                wrap
                xalign={0}
                marginStart={12}
                marginEnd={12}
                marginBottom={12}
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
