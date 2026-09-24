import GLib from 'gi://GLib?version=2.0';

const XKB_LAYOUT_NAME = /^[a-zA-Z0-9_-]+$/;

export function getGreeterKeyboardIndicator(): string {
    const xkbLayouts = GLib.getenv('XKB_DEFAULT_LAYOUT');
    if (!xkbLayouts) return 'Configured XKB: unspecified';

    const configuredLayout = xkbLayouts.split(',')[0]?.trim();
    if (!configuredLayout || !XKB_LAYOUT_NAME.test(configuredLayout)) {
        return 'Configured XKB: unavailable';
    }

    return `Configured XKB: ${configuredLayout.toUpperCase()}`;
}
