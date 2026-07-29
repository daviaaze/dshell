/**
 * Scoped CSS hook — Marble-style `useStyle()` for per-component styling.
 *
 * Uses a single global Gtk.CssProvider to avoid the deprecated
 * Gtk.StyleContext API. All CSS (static + scoped) feeds into one
 * provider via load_from_string() on every change.
 *
 * Usage:
 * ```tsx
 * const styles = useStyle({
 *   padding: "8px",
 *   "background-color": "var(--shade-card-bg)",
 *   "&:hover": { "background-color": "var(--shade-primary)" },
 *   "& > label": { "font-weight": "bold" },
 * })
 *
 * <Box cssClasses={["card", styles.class]} ref={styles.$}>
 * ```
 */
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {onCleanup} from 'gnim';

// ── Types ──

type CSSValue = string | number;
interface StyleObject {
    [key: string]: CSSValue | StyleObject;
}

interface CSSEntry {
    css: string;
    refCount: number;
    className?: string;
}

export interface StyleHandle {
    /** The generated scoped CSS class name (e.g. "shade-s-0"). */
    class: string;
    /**
     * Pass to the widget's `$` prop to auto-register cleanup on destroy.
     * Each call increments the ref count; destroy decrements it.
     */
    $: (self: Gtk.Widget) => void;
}

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

/** Rebuild the full CSS string from all registry entries. */
function rebuildAllCSS(): void {
    if (!globalProvider) return;
    const allCSS = [...cssRegistry.values()].map(e => e.css).join('\n');
    globalProvider.load_from_string(allCSS);
}

// ── StyleSheet registry (named, mutable entries for App/theme/share-picker) ──

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

// ── Scoped style registry (internal, for useStyle) ──

const scopedRegistry = new Map<string, CSSEntry>();
let classCounter = 0;

// ── CSS helpers ──

/** Convert camelCase to kebab-case. */
function toKebab(prop: string): string {
    return prop.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Escape special CSS characters in a class name. */
function escapeClass(name: string): string {
    return name.replace(/([\\!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

/** Flatten a style object into CSS text for a given class name. */
function flattenStyles(className: string, styles: StyleObject): string {
    const escaped = escapeClass(className);
    const blocks: string[] = [];

    // Collect flat property rules
    const flatRules: string[] = [];
    // Collect nested selectors
    const nestedSelectors: Array<[string, StyleObject]> = [];

    for (const [key, value] of Object.entries(styles)) {
        if (key.startsWith('&')) {
            if (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value)
            ) {
                nestedSelectors.push([key, value as StyleObject]);
            }
        } else if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            // Treat any non-& object as a nested rule too (e.g., @media)
            nestedSelectors.push([key, value as StyleObject]);
        } else {
            const prop = toKebab(key);
            flatRules.push(`  ${prop}: ${value};`);
        }
    }

    if (flatRules.length > 0) {
        blocks.push(`.${escaped} {\n${flatRules.join('\n')}\n}`);
    }

    // Recursively handle nested selectors
    for (const [selector, subStyles] of nestedSelectors) {
        const resolvedSel = selector.replace('&', `.${escaped}`);
        const subCSS = flattenSubSelector(resolvedSel, subStyles);
        if (subCSS) blocks.push(subCSS);
    }

    return blocks.join('\n');
}

/** Flatten nested selector rules (no further &-replacement needed). */
function flattenSubSelector(selector: string, styles: StyleObject): string {
    const rules: string[] = [];
    for (const [key, value] of Object.entries(styles)) {
        if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            continue; // skip deeper nesting for simplicity
        }
        const prop = toKebab(key);
        rules.push(`  ${prop}: ${value};`);
    }
    if (rules.length === 0) return '';
    return `${selector} {\n${rules.join('\n')}\n}`;
}

/** Deterministic serialization for dedup key. */
function serializeStyles(styles: StyleObject): string {
    return JSON.stringify(styles, Object.keys(styles).sort());
}

// ── Main API ──

/**
 * Create a scoped CSS class from a style object.
 *
 * @param styles - Flat CSS properties and nested selectors (prefixed with `&`).
 * @returns A handle with `class` (the CSS class name) and `$` (widget lifecycle binder).
 */
export function useStyle(styles: StyleObject): StyleHandle {
    const key = serializeStyles(styles);
    const existing = scopedRegistry.get(key);

    if (existing) {
        // Dedup hit — create a handle that increments the ref count
        const handle: StyleHandle = {
            class: existing.className!,
            $: () => {
                existing.refCount++;
                onCleanup(() => {
                    existing.refCount--;
                    if (existing.refCount <= 0) {
                        scopedRegistry.delete(key);
                        rebuildAllCSS();
                    }
                });
            },
        };
        return handle;
    }

    // Generate new class name and CSS
    const className = `shade-s-${classCounter++}`;
    const css = flattenStyles(className, styles);

    if (!ensureGlobalProvider()) {
        // No display yet — return a no-op handle
        return {
            class: className,
            $: () => {},
        };
    }

    const entry: CSSEntry = {
        css,
        refCount: 0,
        className,
    };

    scopedRegistry.set(key, entry);
    rebuildAllCSS();

    const handle: StyleHandle = {
        class: className,
        $: () => {
            entry.refCount++;
            onCleanup(() => {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    scopedRegistry.delete(key);
                    rebuildAllCSS();
                }
            });
        },
    };
    return handle;
}

/**
 * Pre-register a CSS class string directly (for global styles).
 * Useful for utility classes that don't need scoping.
 */
export function registerGlobalCSS(css: string): void {
    registerStyleSheet(css);
}