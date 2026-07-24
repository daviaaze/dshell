/**
 * Theme Manager — CSS custom properties system for the shell.
 *
 * Manages a Gtk.CssProvider at PRIORITY_USER that sets `--shade-*` CSS
 * custom properties on `*`. Hosts multiple named Stylesheets, each with
 * light and dark variants, and auto-switches based on Adw.StyleManager.
 *
 * Usage:
 * ```ts
 * const theme = Theme.get_default()
 * const catppuccin = new Theme.Stylesheet("Catppuccin", {
 *   stylesheet: {
 *     dark: { bg: "#1e1e2e", fg: "#cdd6f4", primary: "#cba6f7", surface: "#313244" },
 *     light: { bg: "#eff1f5", fg: "#4c4f69", primary: "#8839ef", surface: "#e6e9ef" },
 *   },
 * })
 * theme.addTheme(catppuccin)
 * catppuccin.activate()
 * ```
 */
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import logger from '#/lib/core/logger';
import {Object as GObject, register, property} from 'gnim/gobject';

// ── CSS custom property names ──

export const CSS_VARS = {
    bg: '--shade-bg',
    surface: '--shade-surface',
    surfaceDim: '--shade-surface-dim',
    surfaceContainer: '--shade-surface-container',
    fg: '--shade-fg',
    fgDim: '--shade-fg-dim',
    primary: '--shade-primary',
    primaryContainer: '--shade-primary-container',
    onPrimary: '--shade-on-primary',
    secondary: '--shade-secondary',
    tertiary: '--shade-tertiary',
    error: '--shade-error',
    onError: '--shade-on-error',
    outline: '--shade-outline',
    outlineVariant: '--shade-outline-variant',
    shadow: '--shade-shadow',
    radius: '--shade-radius',
    radiusFull: '--shade-radius-full',
    spacing: '--shade-spacing',
    hoverBg: '--shade-hover-bg',
    activeBg: '--shade-active-bg',
} as const;

export type ThemeColors = Record<string, string>;

// ── Default Adwaita-inspired palette ──

const ADWAITA_COLORS: ThemeColors = {
    bg: '#1a1a1a',
    surface: '#242424',
    'surface-dim': '#1e1e1e',
    'surface-container': '#303030',
    fg: '#ffffff',
    'fg-dim': '#9a9a9a',
    primary: '#3584e4',
    'primary-container': '#1e5fb4',
    'on-primary': '#ffffff',
    secondary: '#7a7a7a',
    tertiary: '#9866c7',
    error: '#e55f86',
    'on-error': '#ffffff',
    outline: '#505050',
    'outline-variant': '#3a3a3a',
    shadow: '#000000',
    radius: '8px',
    'radius-full': '999px',
    spacing: '4px',
    'hover-bg': 'rgba(128,128,128,0.15)',
    'active-bg': 'rgba(128,128,128,0.25)',
};

const ADWAITA_COLORS_LIGHT: ThemeColors = {
    ...ADWAITA_COLORS,
    bg: '#fafafa',
    surface: '#ffffff',
    'surface-dim': '#f0f0f0',
    'surface-container': '#e8e8e8',
    fg: '#1a1a1a',
    'fg-dim': '#707070',
    primary: '#3584e4',
    'primary-container': '#cfe1fa',
    'on-primary': '#ffffff',
    secondary: '#585858',
    tertiary: '#813d9b',
    error: '#c01c28',
    'on-error': '#ffffff',
    outline: '#c0c0c0',
    'outline-variant': '#d4d4d4',
    shadow: '#00000040',
    'hover-bg': 'rgba(255,255,255,0.12)',
    'active-bg': 'rgba(255,255,255,0.20)',
};

// ── Stylesheet class ──

export class Stylesheet {
    readonly name: string;
    readonly config: {
        stylesheet: {
            dark: ThemeColors;
            light: ThemeColors;
        };
    };
    /** @internal accessed by Theme */
    _active = false;

    constructor(
        name: string,
        config: {
            stylesheet: {
                dark: ThemeColors;
                light: ThemeColors;
            };
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

@register({GTypeName: 'ShadeTheme'})
export class Theme extends GObject {
    static instance: Theme;

    static get_default(): Theme {
        if (!this.instance) this.instance = new Theme();
        return this.instance;
    }

    #provider: Gtk.CssProvider;
    #darkProvider: Gtk.CssProvider;
    #styleManager: Adw.StyleManager;
    #activeStylesheet: Stylesheet | null = null;
    #themes: Map<string, Stylesheet> = new Map();
    #isDark = false;

    /** Whether dark mode is active. */
    @property
    get dark(): boolean {
        return this.#isDark;
    }

    constructor() {
        super();

        this.#provider = new Gtk.CssProvider();
        this.#darkProvider = new Gtk.CssProvider();
        this.#styleManager = Adw.StyleManager.get_default();
        this.#isDark = this.#styleManager.dark;

        // Register providers
        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.StyleContext.add_provider_for_display(
                display,
                this.#provider,
                Gtk.STYLE_PROVIDER_PRIORITY_USER
            );
            // Dark-mode override at a slightly higher priority
            Gtk.StyleContext.add_provider_for_display(
                display,
                this.#darkProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_USER + 1
            );
        }

        // Apply default theme
        this.#applyTheme(ADWAITA_COLORS);

        // Watch dark mode changes
        this.#styleManager.connect('notify::dark', () => {
            this.#isDark = this.#styleManager.dark;
            this.notify('dark');
            this.#reevaluate();
        });

        // Also listen for color-scheme changes (system preference)
        this.#styleManager.connect('notify::color-scheme', () => {
            this.#isDark = this.#styleManager.dark;
            this.notify('dark');
            this.#reevaluate();
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

    /** Get the current resolved palette (for use in code, e.g. matugen). */
    getCurrentPalette(): ThemeColors {
        if (this.#activeStylesheet) {
            const sheet = this.#activeStylesheet.config.stylesheet;
            return this.#isDark ? sheet.dark : sheet.light;
        }
        return this.#isDark ? ADWAITA_COLORS : ADWAITA_COLORS_LIGHT;
    }

    // ── Internals ──

    #reevaluate(): void {
        if (this.#activeStylesheet) {
            const sheet = this.#activeStylesheet.config.stylesheet;
            const colors = this.#isDark ? sheet.dark : sheet.light;
            this.#applyTheme(colors);
        } else {
            this.#applyTheme(this.#isDark ? ADWAITA_COLORS : ADWAITA_COLORS_LIGHT);
        }
    }

    #applyTheme(colors: ThemeColors): void {
        const rules: string[] = [];
        for (const [key, value] of Object.entries(colors)) {
            if (value === undefined || value === null || value === 'undefined') {
                logger.warn('theme', `skipping undefined color: --shade-${key}`);
                continue;
            }
            const varName = `--shade-${key}`;
            rules.push(`  ${varName}: ${value};`);
        }
        const css = `* {\n${rules.join('\n')}\n}`;
        this.#provider.load_from_string(css);

        // Re-apply with dark mode variant
        if (this.#isDark) {
            const darkRules: string[] = [];
            for (const [key, value] of Object.entries(colors)) {
                if (value === undefined || value === null || value === 'undefined') {
                    continue;
                }
                const varName = `--shade-${key}`;
                darkRules.push(`  ${varName}: ${value};`);
            }
            this.#darkProvider.load_from_string(`* {\n${darkRules.join('\n')}\n}`);
        } else {
            this.#darkProvider.load_from_string('');
        }
    }
}