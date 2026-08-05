/**
 * Theme Manager — overrides native libadwaita CSS variables.
 *
 * Manages a single Gtk.CssProvider at PRIORITY_USER that sets the
 * standard Adwaita CSS custom properties (`--window-bg-color`,
 * `--accent-bg-color`, etc.) on `*`. Hosts multiple named Stylesheets,
 * each with light and dark variants, and auto-switches based on
 * Adw.StyleManager.
 *
 * The matugen-driven PaletteGenerator produces palettes that map
 * directly onto these native variables — no custom `--shade-*` properties.
 *
 * Usage:
 * ```ts
 * const theme = Theme.get_default()
 * const catppuccin = new Theme.Stylesheet("Catppuccin", {
 *   dark:   { bg: "#1e1e2e", fg: "#cdd6f4", primary: "#cba6f7", surface: "#313244" },
 *   light:  { bg: "#eff1f5", fg: "#4c4f69", primary: "#8839ef", surface: "#e6e9ef" },
 * })
 * theme.addTheme(catppuccin)
 * catppuccin.activate()
 * ```
 */
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Object as GObject, property, register} from 'gnim/gobject';
import {registerStyleSheet, updateStyleSheet} from './cssProvider';

// ── Palette → native Adwaita CSS variables ──

/** A minimal palette that fully drives the Adwaita look. */
export interface Palette {
    /** Window / background color → --window-bg-color */
    bg: string;
    /** Window foreground → --window-fg-color */
    fg: string;
    /** Accent background → --accent-bg-color (also derives --accent-color) */
    primary: string;
    /** Card / surface color → --card-bg-color */
    surface: string;
    /** Shadow / shade → --shade-color */
    shadow: string;
}

export type PaletteKey = keyof Palette;

/** The set of keys a palette must provide. */
export const PALETTE_KEYS: PaletteKey[] = ['bg', 'fg', 'primary', 'surface', 'shadow'];

// ── Default Adwaita-inspired palettes ──

const ADWAITA_DARK: Palette = {
    bg: '#1a1a1a',
    fg: '#ffffff',
    primary: '#3584e4',
    surface: '#242424',
    shadow: '#000000',
};

const ADWAITA_LIGHT: Palette = {
    ...ADWAITA_DARK,
    bg: '#fafafa',
    fg: '#1a1a1a',
    primary: '#3584e4',
    surface: '#ffffff',
    shadow: '#000000',
};

// ── Stylesheet class ──

export class Stylesheet {
    readonly name: string;
    readonly config: {
        dark: Palette;
        light: Palette;
    };
    /** @internal accessed by Theme */
    _active = false;

    constructor(
        name: string,
        config: {
            dark: Palette;
            light: Palette;
        }
    ) {
        this.name = name;
        this.config = config;
    }

    get active(): boolean {
        return this._active;
    }

    activate(): void {
        Theme.get_default().activateStylesheet(this);
        this._active = true;
    }

    delete(): void {
        if (this._active) {
            Theme.get_default().deactivateStylesheet(this);
            this._active = false;
        }
    }
}

// ── Theme Manager ──

@register
export class Theme extends GObject {
    private static instance: Theme;

    static get_default(): Theme {
        if (!Theme.instance) Theme.instance = new Theme();
        return Theme.instance;
    }

    #paletteKey: string;
    #styleManager: Adw.StyleManager;
    #activeStylesheet: Stylesheet | null = null;
    #themes: Map<string, Stylesheet> = new Map();
    #isDark = false;
    #reevaluateQueued = false;

    /** Whether dark mode is active. */
    @property
    get dark(): boolean {
        return this.#isDark;
    }

    constructor() {
        super();

        this.#paletteKey = registerStyleSheet('');
        this.#styleManager = Adw.StyleManager.get_default();
        this.#isDark = this.#styleManager.dark;

        // Apply the correct initial palette based on current dark mode
        this.#reevaluate();

        // Watch dark mode changes
        this.#styleManager.connect('notify::dark', () => {
            this.#isDark = this.#styleManager.dark;
            this.notify('dark');
            this.#debouncedReevaluate();
        });

        // Also listen for color-scheme changes (system preference)
        this.#styleManager.connect('notify::color-scheme', () => {
            this.#isDark = this.#styleManager.dark;
            this.notify('dark');
            this.#debouncedReevaluate();
        });
    }

    /** Add a named stylesheet to the registry. */
    addTheme(stylesheet: Stylesheet): void {
        this.#themes.set(stylesheet.name, stylesheet);
    }

    /** Remove a named stylesheet from the registry. */
    removeTheme(name: string): void {
        const sheet = this.#themes.get(name);
        if (sheet) {
            sheet.delete();
            this.#themes.delete(name);
        }
    }

    /** Activate a stylesheet (called internally and by Stylesheet.activate()). */
    activateStylesheet(stylesheet: Stylesheet): void {
        // Deactivate existing
        if (this.#activeStylesheet) {
            this.#activeStylesheet._active = false;
        }
        this.#activeStylesheet = stylesheet;
        this.#reevaluate();
    }

    /** Deactivate the current stylesheet and revert to defaults. */
    deactivateStylesheet(_stylesheet: Stylesheet): void {
        if (this.#activeStylesheet === _stylesheet) {
            this.#activeStylesheet = null;
            this.#reevaluate();
        }
    }

    /** Force re-evaluation of the current theme.
     *  Useful when the system color scheme changes and the
     *  StyleManager's `dark` property may not have changed yet. */
    forceReevaluate(): void {
        this.#isDark = this.#styleManager.dark;
        this.#reevaluate();
    }

    /** Get the current resolved palette (for use in code, e.g. matugen). */
    getCurrentPalette(): Palette {
        if (this.#activeStylesheet) {
            const sheet = this.#activeStylesheet.config;
            return this.#isDark ? sheet.dark : sheet.light;
        }
        return this.#isDark ? ADWAITA_DARK : ADWAITA_LIGHT;
    }

    // ── Internals ──

    /** Debounced variant — merges multiple rapid calls into one.
     *  Both notify::dark and notify::color-scheme fire when the
     *  system colour preference changes; this avoids applying CSS
     *  twice in the same microtask. */
    #debouncedReevaluate(): void {
        if (this.#reevaluateQueued) return;
        this.#reevaluateQueued = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            this.#reevaluateQueued = false;
            this.#reevaluate();
            return GLib.SOURCE_REMOVE;
        });
    }

    #reevaluate(): void {
        const colors = this.#activeStylesheet
            ? (this.#isDark ? this.#activeStylesheet.config.dark : this.#activeStylesheet.config.light)
            : (this.#isDark ? ADWAITA_DARK : ADWAITA_LIGHT);
        this.#applyPalette(colors);
    }

    /**
     * Apply a palette by overriding native Adwaita CSS custom properties.
     *
     * Sets `--window-bg-color`, `--window-fg-color`, `--accent-bg-color`,
     * `--accent-fg-color`, `--accent-color`, `--card-bg-color`, and
     * `--shade-color` on `*`. No custom `--shade-*` properties are emitted.
     */
    #applyPalette(p: Palette): void {
        // Validate required keys
        for (const key of PALETTE_KEYS) {
            const value = p[key];
            if (!value || value === 'undefined') {
                logger.warn('theme', `skipping invalid palette key: ${key}`);
                return;
            }
        }

        const css = Theme.generateCSS(p);
        updateStyleSheet(this.#paletteKey, css);
        logger.debug('theme', `applied palette (dark=${this.#isDark}) — primary: ${p.primary}`);
    }

    /**
     * Generate the CSS string for a palette — a pure function for testing.
     *
     * @throws if any required palette key is missing or invalid.
     */
    static generateCSS(p: Palette): string {
        for (const key of PALETTE_KEYS) {
            const value = p[key];
            if (!value || value === 'undefined') {
                throw new Error(`Invalid palette key "${key}": missing or undefined`);
            }
        }

        // Derive --accent-color (standalone) from --accent-bg-color.
        // Adwaita normally does this with oklab; we approximate by
        // declaring it to match the accent background for consistency.
        const accentFg = '#ffffff'; // Adwaita default accent foreground

        return `* {
  --window-bg-color: ${p.bg};
  --window-fg-color: ${p.fg};
  --accent-bg-color: ${p.primary};
  --accent-fg-color: ${accentFg};
  --accent-color: ${p.primary};
  --card-bg-color: ${p.surface};
  --shade-color: ${p.shadow};
}`;
    }
}
