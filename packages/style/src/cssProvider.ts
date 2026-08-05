/**
 * Global CSS provider management — a single Gtk.CssProvider that feeds
 * the Theme manager's palette overrides.
 *
 * This is the only place that touches Gtk.CssProvider directly.
 * Widgets should use GTK style classes and Adwaita CSS variables instead
 * of registering their own CSS.
 */

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

// ── Single global CSS provider ──

let globalProvider: Gtk.CssProvider | null = null;
let initialized = false;

/** Initialize the global provider once. */
function ensureGlobalProvider(): boolean {
    if (initialized) return !!globalProvider;
    const display = Gdk.Display.get_default();
    if (!display) {
        initialized = true;
        return false;
    }
    globalProvider = new Gtk.CssProvider();
    globalProvider.load_from_string('');
    Gtk.StyleContext.add_provider_for_display(
        display,
        globalProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_USER
    );
    initialized = true;
    return true;
}

function rebuildAllCSS(): void {
    if (!globalProvider) return;
    const allCSS = [...cssRegistry.values()].map((e) => e.css).join('\n');
    globalProvider.load_from_string(allCSS);
}

// ── Named stylesheet registry (mutable entries for Theme) ──

interface CSSEntry {
    css: string;
    refCount: number;
}

const cssRegistry = new Map<string, CSSEntry>();
let sheetCounter = 0;

/**
 * Register a named CSS block that can be updated later.
 * Returns a unique key for updateStyleSheet() / unregisterStyleSheet().
 */
export function registerStyleSheet(css: string): string {
    ensureGlobalProvider();
    const key = `__sheet_${sheetCounter++}`;
    cssRegistry.set(key, {css, refCount: 1});
    rebuildAllCSS();
    return key;
}

/**
 * Update a previously registered stylesheet.
 * Useful for theme changes where the CSS content changes but the key stays.
 */
export function updateStyleSheet(key: string, css: string): void {
    const entry = cssRegistry.get(key);
    if (entry) {
        entry.css = css;
        rebuildAllCSS();
    }
}

/**
 * Remove a named stylesheet from the registry.
 */
export function unregisterStyleSheet(key: string): void {
    if (cssRegistry.delete(key)) {
        rebuildAllCSS();
    }
}
