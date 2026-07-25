/**
 * Matugen Palette Generator — extracts a full Material 3 color palette from
 * the current wallpaper and applies it via the Theme manager.
 *
 * Replaces the old `Theming` service (3-color accent → full palette).
 */
import {Object as GObject, register, property} from 'gnim/gobject';
import {Accessor} from 'gnim';
import {Process} from '#/lib/core/process';
import GLib from 'gi://GLib?version=2.0';
import logger from '#/lib/core/logger';
import {Theme, Stylesheet, type ThemeColors} from '#/style/theme';

// ── Material 3 → shade CSS variable mapping ──

const M3_MAP: Record<string, string> = {
    background: 'bg',
    surface_container_lowest: 'bg',
    surface_container: 'surface-container',
    surface_container_low: 'surface-dim',
    surface_container_high: 'surface',
    on_background: 'fg',
    on_surface: 'fg-dim',
    primary: 'primary',
    on_primary: 'on-primary',
    primary_container: 'primary-container',
    secondary: 'secondary',
    tertiary: 'tertiary',
    error: 'error',
    on_error: 'on-error',
    outline: 'outline',
    outline_variant: 'outline-variant',
    shadow: 'shadow',
};

// ── Matugen JSON types ──

interface MatugenJson {
    colors?: {
        light?: Record<string, string>;
        dark?: Record<string, string>;
    };
}

// ── The service ──

@register({GTypeName: 'PaletteGenerator'})
export default class PaletteGenerator extends GObject {
    static instance: PaletteGenerator;

    static get_default() {
        if (!this.instance) this.instance = new PaletteGenerator();
        return this.instance;
    }

    #enabled = false;
    #settings: {
        dynamicThemingEnabled: Accessor<boolean>;
        wallpaperDay: Accessor<string>;
        wallpaperNight: Accessor<string>;
    } | null = null;
    #initialized = false;
    #unsubs: Array<() => void> = [];
    #debounceSourceId: number | null = null;
    #activeStylesheet: Stylesheet | null = null;

    static readonly DEBOUNCE_SECONDS = 1;

    @property(Object)
    get enabled() {
        return this.#enabled;
    }

    @property(Object)
    get available() {
        return GLib.find_program_in_path('matugen') !== null;
    }

    init(settings: {
        dynamicThemingEnabled: Accessor<boolean>;
        wallpaperDay: Accessor<string>;
        wallpaperNight: Accessor<string>;
    }) {
        if (this.#initialized) {
            logger.warn('palette', 'init() called but already initialized — skipping');
            return;
        }
        this.#initialized = true;
        this.#settings = settings;
        this.#enabled = settings.dynamicThemingEnabled();

        const unsubEnabled = settings.dynamicThemingEnabled.subscribe(() => {
            const newEnabled = settings.dynamicThemingEnabled();
            if (newEnabled !== this.#enabled) {
                this.#enabled = newEnabled;
                if (newEnabled) {
                    this.#generate();
                } else {
                    this.#clearActiveStylesheet();
                }
                this.notify('enabled');
            }
        });

        const unsubDay = settings.wallpaperDay.subscribe(() =>
            this.#onWallpaperChange()
        );
        const unsubNight = settings.wallpaperNight.subscribe(() =>
            this.#onWallpaperChange()
        );

        this.#unsubs = [unsubEnabled, unsubDay, unsubNight];

        if (this.#enabled) {
            this.#generate();
        }
    }

    /** Public regenerate trigger (e.g. from settings panel). */
    regenerate(): void {
        if (!this.available) {
            logger.warn('palette', 'matugen not available');
            return;
        }
        this.#generate();
    }

    // ── Internals ──

    #onWallpaperChange(): void {
        if (!this.#enabled) return;
        if (this.#debounceSourceId !== null) {
            GLib.Source.remove(this.#debounceSourceId);
        }
        this.#debounceSourceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            PaletteGenerator.DEBOUNCE_SECONDS,
            () => {
                this.#debounceSourceId = null;
                this.#generate();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    #generate(): void {
        if (!this.#settings) return;
        const wallpaper = this.#settings.wallpaperDay();
        if (!wallpaper || !GLib.file_test(wallpaper, GLib.FileTest.EXISTS)) {
            logger.warn('palette', `wallpaper not found: ${wallpaper}`);
            return;
        }

        Process.execAsyncv(['matugen', 'image', wallpaper, '--json', 'hex'])
            .then(out => {
                const palette = this.#parseMatugenJson(out);
                if (palette) {
                    this.#applyPalette(palette);
                }
            })
            .catch(e => {
                logger.error('palette', 'matugen execution failed:', e);
            });
    }

    #parseMatugenJson(json: string): {dark: ThemeColors; light: ThemeColors} | null {
        try {
            const data: MatugenJson = JSON.parse(json);
            const rawDark = data.colors?.dark;
            const rawLight = data.colors?.light;
            if (!rawDark || !rawLight) {
                logger.warn('palette', 'matugen JSON missing colors.dark or colors.light');
                return null;
            }

            const dark = this.#normalizeColors(rawDark);
            const light = this.#normalizeColors(rawLight);
            return {dark, light};
        } catch (e) {
            logger.error('palette', 'failed to parse matugen output:', e);
            return null;
        }
    }

    #normalizeColors(raw: Record<string, string>): ThemeColors {
        const out: ThemeColors = {};

        // Map known keys
        for (const [m3Key, shadeKey] of Object.entries(M3_MAP)) {
            const rawValue = raw[m3Key];
            if (rawValue) {
                out[shadeKey] = rawValue;
            }
        }

        // Fill in any missing keys with fallbacks
        if (!out.bg) out.bg = out['surface'] ?? '#1a1a1a';
        if (!out.fg) out.fg = out['on-background'] ?? '#ffffff';
        if (!out['on-primary']) out['on-primary'] = '#ffffff';
        if (!out['on-error']) out['on-error'] = '#ffffff';
        if (!out.shadow) out.shadow = '#000000';

        return out;
    }

    #applyPalette(palette: {dark: ThemeColors; light: ThemeColors}): void {
        // Remove previous dynamic stylesheet
        this.#clearActiveStylesheet();

        // Create and activate a matugen-derived stylesheet
        const sheet = new Stylesheet('matugen', {
            stylesheet: {dark: palette.dark, light: palette.light},
        });

        const theme = Theme.get_default();
        theme.addTheme(sheet);
        sheet.activate();
        this.#activeStylesheet = sheet;

        logger.debug(
            'palette',
            `applied palette — primary: ${palette.dark.primary ?? 'unknown'}`
        );
    }

    #clearActiveStylesheet(): void {
        if (this.#activeStylesheet) {
            this.#activeStylesheet.delete();
            this.#activeStylesheet = null;
        }
    }

    dispose(): void {
        for (const unsub of this.#unsubs) {
            try {
                unsub();
            } catch {
                /* ignore */
            }
        }
        this.#unsubs = [];

        if (this.#debounceSourceId !== null) {
            GLib.Source.remove(this.#debounceSourceId);
            this.#debounceSourceId = null;
        }

        this.#clearActiveStylesheet();
        this.#initialized = false;
        this.#settings = null;
        logger.debug('palette', 'PaletteGenerator disposed');
    }
}