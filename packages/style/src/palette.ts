/**
 * Matugen Palette Generator — extracts a full Material 3 color palette from
 * the current wallpaper and applies it via the Theme manager using only
 * native Adwaita CSS variables.
 */

import Gdk from 'gi://Gdk?version=4.0';
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

interface Generation {
    epoch: number;
    wallpaper: string;
    promise: Promise<void>;
    reject: (error: Error) => void;
}

class PaletteGenerationCancelledError extends Error {
    constructor() {
        super('Wallpaper color generation was cancelled.');
        this.name = 'PaletteGenerationCancelledError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    #unsubs: Array<() => void>;
    #debounceSourceId: number | null = null;
    #activeStylesheet: Stylesheet | null = null;
    #generationBusy = false;
    #generationError: string | null = null;
    #generation: Generation | null = null;
    #generationEpoch = 0;
    #disposed = false;

    static readonly DEBOUNCE_SECONDS = 1;

    constructor() {
        super();
        this.#unsubs = [];
    }

    @property
    get enabled() {
        return this.#enabled;
    }

    @property
    get available() {
        return GLib.find_program_in_path('matugen') !== null;
    }

    @property
    get generationBusy(): boolean {
        return this.#generationBusy;
    }

    @property
    get generationError(): string | null {
        return this.#generationError;
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
        // Base semantic roles are required even when wallpaper generation is off.
        Theme.get_default();
        this.#initialized = true;
        this.#disposed = false;
        this.#settings = settings;
        this.#enabled = settings.dynamicThemingEnabled();

        const unsubEnabled = settings.dynamicThemingEnabled.subscribe(() => {
            const newEnabled = settings.dynamicThemingEnabled();
            if (newEnabled !== this.#enabled) {
                this.#enabled = newEnabled;
                this.#cancelDebounce();
                this.#invalidateGeneration();
                if (newEnabled) {
                    this.#generateAutomatically();
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
            this.#generateAutomatically();
        }
    }

    /** Resolve only once the current wallpaper's palette has been applied. */
    regenerate(): Promise<void> {
        if (this.#disposed) return Promise.reject(new PaletteGenerationCancelledError());
        if (!this.#settings) {
            return this.#failGeneration('Dynamic theming has not been initialized.');
        }

        const wallpaper = this.#settings.wallpaperDay();
        if (this.#generation?.wallpaper === wallpaper) return this.#generation.promise;

        this.#cancelDebounce();
        if (this.#generation) this.#invalidateGeneration();

        const executable = GLib.find_program_in_path('matugen');
        if (!executable) {
            return this.#failGeneration('Matugen is unavailable. Install matugen to generate colors.');
        }
        if (!wallpaper || !GLib.file_test(wallpaper, GLib.FileTest.IS_REGULAR)) {
            return this.#failGeneration('The day wallpaper is unavailable. Choose an existing image file.');
        }

        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((onResolve, onReject) => {
            resolve = onResolve;
            reject = onReject;
        });
        const generation: Generation = {
            epoch: this.#generationEpoch,
            wallpaper,
            promise,
            reject,
        };
        this.#generation = generation;
        this.#setGenerationState(true, null);
        void this.#generate(generation, executable).then(resolve, reject);
        return promise;
    }

    // ── Internals ──

    #setGenerationState(busy: boolean, error: string | null): void {
        const busyChanged = busy !== this.#generationBusy;
        const errorChanged = error !== this.#generationError;
        this.#generationBusy = busy;
        this.#generationError = error;
        if (busyChanged) this.notify('generation-busy');
        if (errorChanged) this.notify('generation-error');
    }

    #failGeneration(message: string): Promise<void> {
        this.#setGenerationState(false, message);
        logger.warn('palette', message);
        return Promise.reject(new Error(message));
    }

    #cancelDebounce(): void {
        if (this.#debounceSourceId !== null) {
            GLib.Source.remove(this.#debounceSourceId);
            this.#debounceSourceId = null;
        }
    }

    #invalidateGeneration(): void {
        this.#generationEpoch++;
        const generation = this.#generation;
        this.#generation = null;
        generation?.reject(new PaletteGenerationCancelledError());
        this.#setGenerationState(false, null);
    }

    #isCurrent(generation: Generation): boolean {
        return !this.#disposed
            && this.#generation === generation
            && this.#generationEpoch === generation.epoch;
    }

    #assertCurrent(generation: Generation): void {
        if (!this.#isCurrent(generation)) throw new PaletteGenerationCancelledError();
    }

    #generateAutomatically(): void {
        void this.regenerate().catch(() => {
            // Current failures are exposed in generationError; supersession is not a failure.
        });
    }

    #onWallpaperChange(): void {
        this.#cancelDebounce();
        this.#invalidateGeneration();
        if (!this.#enabled || this.#disposed) return;
        this.#debounceSourceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            PaletteGenerator.DEBOUNCE_SECONDS,
            () => {
                this.#debounceSourceId = null;
                this.#generateAutomatically();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    async #generate(generation: Generation, executable: string): Promise<void> {
        let failure: string | null = null;
        try {
            this.#assertCurrent(generation);
            const output = await Process.execAsyncv([
                executable, 'image', generation.wallpaper, '--json', 'hex',
            ]);
            this.#assertCurrent(generation);
            this.#applyPalette(this.#parseMatugenJson(output));
            this.#assertCurrent(generation);
        } catch (error) {
            if (!this.#isCurrent(generation)) throw new PaletteGenerationCancelledError();
            const detail = error instanceof Error ? error.message : String(error);
            failure = `Could not generate wallpaper colors: ${detail || 'Matugen failed without an error message.'}`;
            logger.error('palette', failure);
            throw new Error(failure);
        } finally {
            if (this.#isCurrent(generation)) {
                this.#generation = null;
                this.#setGenerationState(false, failure);
            }
        }
    }

    #parseMatugenJson(json: string): {dark: Palette; light: Palette} {
        let data: unknown;
        try {
            data = JSON.parse(json);
        } catch {
            throw new Error('Matugen returned invalid JSON.');
        }
        if (!isRecord(data) || !isRecord(data.colors)
            || !isRecord(data.colors.dark) || !isRecord(data.colors.light)) {
            throw new Error('Matugen output must contain light and dark color maps.');
        }
        return {
            dark: this.#toPalette(data.colors.dark, 'dark'),
            light: this.#toPalette(data.colors.light, 'light'),
        };
    }

    /** Convert supplied colors, retaining fallbacks only for missing keys. */
    #toPalette(raw: Record<string, unknown>, mode: 'dark' | 'light'): Palette {
        const p: Partial<Palette> = {};
        const parsed = new Gdk.RGBA();
        let hasColor = false;
        for (const [m3Key, paletteKey] of Object.entries(M3_TO_PALETTE)) {
            const value = raw[m3Key];
            if (value === undefined) continue;
            if (typeof value !== 'string' || !parsed.parse(value)) {
                throw new Error(`Matugen returned an invalid ${mode} color for "${m3Key}".`);
            }
            hasColor = true;
            if (!p[paletteKey]) p[paletteKey] = value;
        }
        if (!hasColor) throw new Error(`Matugen's ${mode} palette contains no usable colors.`);

        // Fallbacks for individual missing keys.
        if (!p.bg) p.bg = '#1a1a1a';
        if (!p.fg) p.fg = '#ffffff';
        if (!p.primary) p.primary = '#3584e4';
        if (!p.surface) p.surface = '#242424';
        if (!p.shadow) p.shadow = '#000000';

        return p as Palette;
    }

    #applyPalette(palette: {dark: Palette; light: Palette}): void {
        Theme.generateCSS(palette.dark);
        Theme.generateCSS(palette.light);
        const previous = this.#activeStylesheet;
        const sheet = new Stylesheet('matugen', palette);
        const theme = Theme.get_default();
        try {
            theme.addTheme(sheet);
            sheet.activate();
        } catch (error) {
            if (previous) {
                theme.addTheme(previous);
                previous.activate();
            } else {
                theme.deactivateStylesheet(sheet);
                theme.removeTheme(sheet.name);
            }
            throw error;
        }
        this.#activeStylesheet = sheet;
        previous?.delete();
        logger.debug('palette', `applied palette — primary: ${palette.dark.primary}`);
    }

    #clearActiveStylesheet(): void {
        if (this.#activeStylesheet) {
            this.#activeStylesheet.delete();
            this.#activeStylesheet = null;
        }
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#invalidateGeneration();
        for (const unsub of this.#unsubs) {
            try {
                unsub();
            } catch {
                /* ignore */
            }
        }
        this.#unsubs = [];

        this.#cancelDebounce();

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
