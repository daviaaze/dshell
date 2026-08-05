/**
 * Matugen Palette Generator — extracts a full Material 3 color palette from
 * the current wallpaper and applies it via the Theme manager using only
 * native Adwaita CSS variables.
 */

import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {generalSettings} from '@shade/core/settings/general.gschema';
import type {Accessor} from 'gnim';
import {Object as GObject, property, register} from 'gnim/gobject';
import {type Palette, Stylesheet, Theme} from './theme';

// ── Matugen JSON → native Palette key mapping ──

const M3_TO_PALETTE: Record<string, keyof Palette> = {
    background: 'bg',
    on_background: 'fg',
    primary: 'primary',
    surface_container: 'surface',
    surface: 'surface',
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

@register
export default class PaletteGenerator extends GObject {
    private static instance: PaletteGenerator;

    static get_default() {
        if (!PaletteGenerator.instance) PaletteGenerator.instance = new PaletteGenerator();
        return PaletteGenerator.instance;
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

    @property
    get enabled() {
        return this.#enabled;
    }

    @property
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

        const unsubDay = settings.wallpaperDay.subscribe(() => this.#onWallpaperChange());
        const unsubNight = settings.wallpaperNight.subscribe(() => this.#onWallpaperChange());

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
            .then((out) => {
                const palette = this.#parseMatugenJson(out);
                if (palette) {
                    this.#applyPalette(palette);
                }
            })
            .catch((e) => {
                logger.error('palette', 'matugen execution failed:', e);
            });
    }

    #parseMatugenJson(json: string): {dark: Palette; light: Palette} | null {
        try {
            const data: MatugenJson = JSON.parse(json);
            const rawDark = data.colors?.dark;
            const rawLight = data.colors?.light;
            if (!rawDark || !rawLight) {
                logger.warn('palette', 'matugen JSON missing colors.dark or colors.light');
                return null;
            }

            const dark = this.#toPalette(rawDark);
            const light = this.#toPalette(rawLight);
            return {dark, light};
        } catch (e) {
            logger.error('palette', 'failed to parse matugen output:', e);
            return null;
        }
    }

    /** Convert a matugen color map into a minimal native Palette. */
    #toPalette(raw: Record<string, string>): Palette {
        const p: Partial<Palette> = {};

        for (const [m3Key, paletteKey] of Object.entries(M3_TO_PALETTE)) {
            const value = raw[m3Key];
            if (value && !p[paletteKey]) {
                p[paletteKey] = value;
            }
        }

        // Fallbacks for any missing keys
        if (!p.bg) p.bg = '#1a1a1a';
        if (!p.fg) p.fg = '#ffffff';
        if (!p.primary) p.primary = '#3584e4';
        if (!p.surface) p.surface = '#242424';
        if (!p.shadow) p.shadow = '#000000';

        return p as Palette;
    }

    #applyPalette(palette: {dark: Palette; light: Palette}): void {
        // Remove previous dynamic stylesheet
        this.#clearActiveStylesheet();

        // Create and activate a matugen-derived stylesheet
        const sheet = new Stylesheet('matugen', {
            dark: palette.dark,
            light: palette.light,
        });

        const theme = Theme.get_default();
        theme.addTheme(sheet);
        sheet.activate();
        this.#activeStylesheet = sheet;

        logger.debug('palette', `applied palette — primary: ${palette.dark.primary}`);
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

defineService({
    name: 'PaletteGenerator',
    service: PaletteGenerator.get_default(),
    initArgs: () => [generalSettings()],
});
