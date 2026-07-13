/**
 * Scoped CSS hook — Marble-style `useStyle()` for per-component styling.
 *
 * Generates a unique CSS class, injects scoped rules into a dedicated
 * Gtk.CssProvider, and returns a handle with auto-cleanup.
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
 * <Box cssClasses={["card", styles.class]} $={styles.$}>
 * ```
 */
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {onCleanup} from 'gnim';

// ── Types ──

type CSSValue = string | number;
type StyleObject = Record<string, CSSValue | StyleObject>;

interface StyleEntry {
    class: string;
    provider: Gtk.CssProvider;
    refCount: number;
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

// ── Registry ──

const registry = new Map<string, StyleEntry>();
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
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                nestedSelectors.push([key, value as StyleObject]);
            }
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
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
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
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

// ── Provider helper ──

function getDisplayProvider(display: Gdk.Display): Gtk.CssProvider {
    // Use a dedicated provider for all scoped styles at a custom priority.
    // We create a fresh provider per unique style so cleanup is easy.
    // Dedup prevents duplicates.
    const provider = new Gtk.CssProvider();
    Gtk.StyleContext.add_provider_for_display(
        display,
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_USER + 10
    );
    return provider;
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
    const existing = registry.get(key);

    if (existing) {
        // Dedup hit — create a handle that increments the ref count
        const handle: StyleHandle = {
            class: existing.class,
            $: () => {
                existing.refCount++;
                onCleanup(() => {
                    existing.refCount--;
                    if (existing.refCount <= 0) {
                        const display = Gdk.Display.get_default();
                        if (display) {
                            Gtk.StyleContext.remove_provider_for_display(
                                display,
                                existing.provider
                            );
                        }
                        registry.delete(key);
                    }
                });
            },
        };
        return handle;
    }

    // Generate new class name and CSS
    const className = `shade-s-${classCounter++}`;
    const css = flattenStyles(className, styles);
    const display = Gdk.Display.get_default();

    if (!display) {
        // No display yet — return a no-op handle
        return {
            class: className,
            $: () => {},
        };
    }

    const provider = getDisplayProvider(display);
    provider.load_from_string(css);

    const entry: StyleEntry = {
        class: className,
        provider,
        refCount: 0,
    };

    registry.set(key, entry);

    const handle: StyleHandle = {
        class: className,
        $: () => {
            entry.refCount++;
            onCleanup(() => {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    const d = Gdk.Display.get_default();
                    if (d) {
                        Gtk.StyleContext.remove_provider_for_display(d, provider);
                    }
                    registry.delete(key);
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
    const display = Gdk.Display.get_default();
    if (!display) return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(css);
    Gtk.StyleContext.add_provider_for_display(
        display,
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_USER + 10
    );
}