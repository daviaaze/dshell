/**
 * Minimal default-Adwaita palette applier for standalone apps (share-picker)
 * that may not depend on @shade/style. Emits the same native libadwaita CSS
 * variables as the shell Theme does for its default palette, following the
 * Adw.StyleManager dark state. Accent roles are pre-resolved (WCAG 4.5:1
 * standalone accent) for the two fixed palettes.
 */
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

interface DefaultPalette {
    bg: string;
    fg: string;
    surface: string;
    shadow: string;
    accentBg: string;
    accentFg: string;
    accent: string;
}

const DARK: DefaultPalette = {
    bg: '#1a1a1a',
    fg: '#ffffff',
    surface: '#242424',
    shadow: '#000000',
    accentBg: '#3584e4',
    accentFg: '#000000',
    accent: '#3584e4',
};

const LIGHT: DefaultPalette = {
    bg: '#fafafa',
    fg: '#1a1a1a',
    surface: '#ffffff',
    shadow: '#000000',
    accentBg: '#3584e4',
    accentFg: '#000000',
    accent: '#2f74c9',
};

function css(p: DefaultPalette): string {
    return `* {
  --window-bg-color: ${p.bg};
  --window-fg-color: ${p.fg};
  --accent-bg-color: ${p.accentBg};
  --accent-fg-color: ${p.accentFg};
  --accent-color: ${p.accent};
  --card-bg-color: ${p.surface};
  --shade-color: ${p.shadow};
}`;
}

let provider: Gtk.CssProvider | null = null;

/** Apply the default Adwaita palette to the display and track light/dark changes. */
export function applyDefaultAdwaitaPalette(): void {
    if (provider) return;
    const display = Gdk.Display.get_default();
    if (!display) return;
    const styleManager = Adw.StyleManager.get_default();
    const next = new Gtk.CssProvider();
    Gtk.StyleContext.add_provider_for_display(display, next, Gtk.STYLE_PROVIDER_PRIORITY_USER);
    provider = next;
    const update = () => next.load_from_string(css(styleManager.dark ? DARK : LIGHT));
    update();
    styleManager.connect('notify::dark', update);
}
