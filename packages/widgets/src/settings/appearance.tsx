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
                self.add(new Adw.Toggle({name: 'auto', label: 'Automático', iconName: 'night-light-symbolic'}));
                self.add(new Adw.Toggle({name: 'light', label: 'Claro', iconName: 'weather-clear-symbolic'}));
                self.add(new Adw.Toggle({name: 'dark', label: 'Escuro', iconName: 'weather-clear-night-symbolic'}));
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
    const status = computed(() => requested() === DarkModes.AUTO
        ? `O modo automático está usando a aparência ${dark() ? 'escura' : 'clara'}.`
        : `Aparência ${dark() ? 'escura' : 'clara'} ativa.`);

    return (
        <>
            <Adw.PreferencesGroup title="Tema" description="Escolha o tema e consulte a aparência efetiva.">
                <Adw.ActionRow title="Tema solicitado">
                    <ThemeToggle settings={settings} />
                </Adw.ActionRow>
                <Adw.ActionRow title="Aparência efetiva" subtitle={status} />
                <Adw.ActionRow
                    visible={error.as(Boolean)}
                    title="Aplicação parcial"
                    subtitle={error.as((message) => message
                        ? `A solicitação foi mantida. ${message}`
                        : '')}
                >
                    <Gtk.Button
                        slot="suffix"
                        label="Tentar aplicar novamente"
                        valign={Gtk.Align.CENTER}
                        onClicked={() => { scheme.colorScheme = requested(); }}
                    />
                </Adw.ActionRow>
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup title="Wallpaper" description="Imagens para o dia e para a noite.">
                <Adw.ActionRow
                    activatable
                    title="Wallpaper do dia"
                    subtitle={settings.wallpaperDay}
                    iconName={'image-x-generic-symbolic'}
                    onActivated={() => pickWallpaper(fileDialog, (p) => settings.setWallpaperDay(p))}
                >
                    <Gtk.Image file={settings.wallpaperDay} />
                </Adw.ActionRow>
                <Adw.ActionRow
                    activatable
                    title="Wallpaper da noite"
                    subtitle={settings.wallpaperNight}
                    iconName={'image-x-generic-symbolic'}
                    onActivated={() => pickWallpaper(fileDialog, (p) => settings.setWallpaperNight(p))}
                >
                    <Gtk.Image file={settings.wallpaperNight} />
                </Adw.ActionRow>
            </Adw.PreferencesGroup>
        </>
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
        if (busy()) return 'Gerando cores do wallpaper do dia…';
        if (error()) return `Não foi possível gerar as cores: ${error()}`;
        if (!available()) return 'O gerador matugen não está disponível. O tema nativo continua utilizável.';
        if (!wallpaperReady()) return 'Escolha uma imagem do dia existente para gerar as cores.';
        return 'Pronto para gerar. A geração usa o wallpaper do dia.';
    });
    const statusClasses = computed(() =>
        error() || !available() ? ['error', 'caption'] : ['caption']
    );

    return (
        <Adw.PreferencesGroup
            title="Cores do wallpaper"
            description="Geração dinâmica de cores a partir do wallpaper do dia."
        >
            <Adw.SwitchRow
                title="Usar cores do wallpaper"
                sensitive={available}
                subtitle={available.as((isAvailable) =>
                    isAvailable ? '' : 'Requer o gerador matugen.'
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
                label="Regenerar do wallpaper"
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
            title="Luz noturna"
            description="Temperatura de cor e agenda."
        >
            <Adw.SwitchRow
                title="Luz noturna"
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
                title="Temperatura de cor"
                subtitle="Em kelvin (K). Valores menores produzem cores mais quentes."
                sensitive={settings.nightLightEnabled}
                onNotifyValue={(self) => settings.setNightLightTemperature(Math.round(self.value))}
            />
            <Adw.SwitchRow
                title="Do pôr ao nascer do sol"
                subtitle="A agenda depende da localização e dos horários calculados."
                sensitive={settings.nightLightEnabled}
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
