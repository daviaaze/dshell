import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {createState, type Accessor} from 'gnim';
export function useGreeterKeyboard(): {layout: Accessor<string>; cycle: () => void} {
    const [layout, setLayout] = createState('BR');

    // Try to read from GSettings input-sources
    try {
        const settings = Gio.Settings.new('org.gnome.desktop.input-sources');
        const sources = settings.get_value('sources');
        if (sources) {
            const unpacked = sources.deep_unpack() as [string, string][] | undefined;
            if (unpacked && unpacked.length > 0) {
                const first = unpacked[0];
                if (first) setLayout(first[1].toUpperCase());
            }
        }
    } catch {
        // Fallback: read from XKB_DEFAULT_LAYOUT env
        const xkb = GLib.getenv('XKB_DEFAULT_LAYOUT');
        if (xkb) {
            const first = xkb.split(',')[0]?.split(':')[0];
            if (first) setLayout(first.toUpperCase());
        }
    }
    const cycle = () => {
        try {
            const settings = Gio.Settings.new('org.gnome.desktop.input-sources');
            const sources = settings.get_value('sources');
            if (sources) {
                const unpacked = sources.deep_unpack() as [string, string][] | undefined;
                if (unpacked && unpacked.length > 1) {
                    const next = unpacked[1]?.[1]?.toUpperCase();
                    if (next) {
                        setLayout(next);
                        settings.set_value('sources', new GLib.Variant('(a(ss))', [unpacked[1], unpacked[0]]));
                    }
                }
            }
        } catch {
            // No cycle available
        }
    };

    return {layout, cycle};
}
