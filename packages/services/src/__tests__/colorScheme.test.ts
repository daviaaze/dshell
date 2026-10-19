import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {createState} from 'gnim';
import {ColorScheme, DarkModes} from '../display/colorScheme';
import {describe, expect, it, run} from './test-runner';

function fixture(rejectWrite = false) {
    const handlers = new Map<number, () => void>();
    let id = 0;
    let stored = 'default';
    let native: Adw.ColorScheme = Adw.ColorScheme.DEFAULT;
    let acquired = false;
    let daytime = true;
    const manager = {
        get dark() { return native === Adw.ColorScheme.FORCE_DARK; },
        get colorScheme() { return native; },
        set colorScheme(value: Adw.ColorScheme) {
            native = value;
            for (const callback of handlers.values()) callback();
        },
        connect(_signal: string, callback: () => void) { handlers.set(++id, callback); return id; },
        disconnect(key: number) { handlers.delete(key); },
    };
    const generalHandlers = new Map<number, {signal: string; callback: () => void}>();
    const general = {
        get_boolean() { return daytime; },
        get_double() { return 0; },
        connect(signal: string, callback: () => void) {
            generalHandlers.set(++id, {signal, callback}); return id;
        },
        disconnect(key: number) { generalHandlers.delete(key); },
    };
    const [preference, setPreference] = createState(DarkModes.AUTO);
    const service = new ColorScheme({
        generalSettings: general as unknown as Gio.Settings,
        systemSettings: {
            get_string: () => stored,
            set_string(_key: string, value: string) {
                if (!rejectWrite) stored = value;
                return !rejectWrite;
            },
        } as unknown as Gio.Settings,
        getStyleManager() { acquired = true; return manager as unknown as Adw.StyleManager; },
        getGtkSettings: () => null as Gtk.Settings | null,
    });
    return {service, manager, preference, setPreference,
        get acquired() { return acquired; },
        init() { service.init({colorScheme: preference, setColorScheme: setPreference}); },
        setDaytime(value: boolean) {
            daytime = value;
            for (const handler of generalHandlers.values()) {
                if (handler.signal === 'changed::weather-is-daytime') handler.callback();
            }
        },
    };
}

describe('coordinated appearance', () => {
    it('defers native acquisition and preserves Auto through its own resolved echoes', () => {
        const f = fixture();
        expect(f.acquired).toBe(false);
        f.init();
        expect(f.service.systemScheme).toBe('prefer-light');
        expect(f.service.effectiveDark).toBe(false);
        f.setDaytime(false);
        expect(f.service.systemScheme).toBe('prefer-dark');
        expect(f.service.effectiveDark).toBe(true);
        expect(f.preference()).toBe(DarkModes.AUTO);
        expect(f.service.applyError).toBe(null);
        f.service.dispose();
    });
    it('adopts an external native override and stops listening after disposal', () => {
        const f = fixture();
        f.init();
        f.service.colorScheme = DarkModes.LIGHT;
        f.manager.colorScheme = Adw.ColorScheme.FORCE_DARK;
        expect(f.preference()).toBe(DarkModes.DARK);
        expect(f.service.systemScheme).toBe('prefer-dark');
        f.service.dispose();
        f.manager.colorScheme = Adw.ColorScheme.FORCE_LIGHT;
        expect(f.preference()).toBe(DarkModes.DARK);
    });
    it('adopts a deliberate native override while Auto is selected', () => {
        const f = fixture();
        f.init();
        f.manager.colorScheme = Adw.ColorScheme.FORCE_DARK;
        expect(f.preference()).toBe(DarkModes.DARK);
        expect(f.service.systemScheme).toBe('prefer-dark');
        f.service.dispose();
    });
    it('reports a rejected system write without pretending the requested mode applied', () => {
        const f = fixture(true);
        f.init();
        f.service.colorScheme = DarkModes.DARK;
        expect(f.service.systemScheme).toBe('default');
        expect(f.service.applyError !== null).toBe(true);
        expect(f.preference()).toBe(DarkModes.DARK);
        f.service.dispose();
    });
});

await run(import.meta.url);
