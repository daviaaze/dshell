import {register, Object, property} from 'gnim/gobject';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {createSettings, Schema} from 'gnim/schema';
import {Accessor, Setter} from 'gnim';
import logger from '#/lib/core/logger';

export enum DarkModes {
    AUTO,
    LIGHT,
    DARK,
}

@register({GTypeName: 'ColorScheme'})
export class ColorScheme extends Object {
    static instance: ColorScheme;
    static get_default() {
        if (!this.instance) this.instance = new ColorScheme();
        return this.instance;
    }

    #daytime: boolean = true;
    #colorScheme: DarkModes = 0;
    #initialized = false;
    #timerId: GLib.Source | null = null;
    #generalHandlerId = 0;
    #shadeSettings: {
        colorScheme: Accessor<DarkModes>;
        setColorScheme: (v: DarkModes) => void;
    } | null = null;
    #gsettings: {
        setColorScheme: Setter<string>;
        setGtkTheme: Setter<string>;
    };
    #generalSettings: Gio.Settings;

    @property(Object)
    get colorScheme() {
        return this.#colorScheme;
    }

    @property(Object)
    get daytime() {
        return this.#daytime;
    }

    @property(String)
    get colorSchemeName() {
        switch (this.#colorScheme) {
            case DarkModes.AUTO:
                return 'Auto';
            case DarkModes.LIGHT:
                return 'Light';
            case DarkModes.DARK:
                return 'Dark';
            default:
                return 'Auto';
        }
    }

    
    set colorScheme(c: DarkModes) {
        this.#colorScheme = c;
        if (c === DarkModes.AUTO)
            c = this.#daytime ? DarkModes.LIGHT : DarkModes.DARK;
        if (c === DarkModes.LIGHT) {
            this.#gsettings.setColorScheme('prefer-light');
            this.#gsettings.setGtkTheme('Adwaita');
        } else {
            this.#gsettings.setColorScheme('prefer-dark');
            this.#gsettings.setGtkTheme('Adwaita-dark');
        }
        this.notify('color-scheme');
        this.notify('color-scheme-name');
        this.notify('icon-name');
        this.#shadeSettings?.setColorScheme(this.#colorScheme);
    }

    @property(String)
    get iconName() {
        if (this.#colorScheme === DarkModes.AUTO)
            if (this.#daytime) return 'weather-clear-symbolic';
            else return 'weather-clear-night-symbolic';
        if (this.#colorScheme === DarkModes.LIGHT)
            return 'weather-clear-symbolic';
        else return 'weather-clear-night-symbolic';
    }

    private timeout() {
        if (this.#timerId !== null) {
            clearTimeout(this.#timerId);
            this.#timerId = null;
        }

        const msUntil = (unixTime: number) =>
            Math.abs(Number(
                GLib.DateTime.new_from_unix_local(unixTime)
                    .difference(GLib.DateTime.new_now_local())
                    .valueOf()
            ));

        const sunrise = this.#generalSettings.get_double('weather-sunrise-time');
        const sunset = this.#generalSettings.get_double('weather-sunset-time');
        if (sunrise <= 0 || sunset <= 0) return;

        const interval = this.#daytime
            ? msUntil(sunset)
            : msUntil(sunrise);

        this.#timerId = setTimeout(() => {
            this.#timerId = null;
            this.#daytime = !this.#daytime;
            this.notify('daytime');
            if (this.#colorScheme === DarkModes.AUTO) {
                this.colorScheme = DarkModes.AUTO;
            }
            this.timeout();
        }, interval / GLib.TIME_SPAN_MILLISECOND);
    }

    init(
        settings: {
            colorScheme: Accessor<DarkModes>;
            setColorScheme: (v: DarkModes) => void;
        }
    ) {
        if (this.#initialized) {
            logger.warn(
                'colorscheme',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        this.#shadeSettings = settings;
        const colorSchemeSetting = settings.colorScheme;
        this.colorScheme = colorSchemeSetting();

        colorSchemeSetting.subscribe(() => {
            const newValue = colorSchemeSetting();
            if (newValue !== this.#colorScheme) {
                this.colorScheme = newValue;
            }
        });

        // Read initial daytime from GSettings
        this.#daytime = this.#generalSettings.get_boolean('weather-is-daytime');
        this.notify('daytime');
        this.timeout();

        // Listen for weather-derived changes
        this.#generalHandlerId = this.#generalSettings.connect(
            'changed::weather-is-daytime',
            () => {
                const newDaytime = this.#generalSettings.get_boolean('weather-is-daytime');
                if (newDaytime !== this.#daytime) {
                    this.#daytime = newDaytime;
                    this.notify('daytime');
                    if (this.#colorScheme === DarkModes.AUTO) {
                        this.colorScheme = DarkModes.AUTO;
                    }
                }
                this.timeout();
            }
        );
    }

    dispose() {
        logger.debug('colorscheme', 'disposing');
        if (this.#generalHandlerId !== 0) {
            try {
                this.#generalSettings.disconnect(this.#generalHandlerId);
            } catch { /* ignore */ }
            this.#generalHandlerId = 0;
        }
        if (this.#timerId) {
            clearTimeout(this.#timerId);
            this.#timerId = null;
        }
        this.#initialized = false;
    }

    constructor() {
        super();

        this.#generalSettings = new Gio.Settings({
            schema_id: `${import.meta.domain}.general`,
        });

        this.#gsettings = createSettings(
            new Gio.Settings({
                schema_id: 'org.gnome.desktop.interface',
            }),
            new Schema({
                id: 'org.gnome.desktop.interface',
                path: '/org/gnome/desktop/interface/',
            })
                .key('color-scheme', 's', {default: 'prefer-light'})
                .key('gtk-theme', 's', {default: 'Adwaita'})
        );
    }
}
