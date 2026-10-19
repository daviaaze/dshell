import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {generalSettings} from '@shade/core/settings/general.gschema';
import type {Accessor} from 'gnim';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';

export enum DarkModes {
    AUTO,
    LIGHT,
    DARK,
}

const TIME_HANDLER_KEYS: Array<'changed::weather-sunrise-time' | 'changed::weather-sunset-time'> = [
    'changed::weather-sunrise-time',
    'changed::weather-sunset-time',
];

const COLOR_SCHEME_KEY = 'color-scheme';

interface ColorSchemeDependencies {
    generalSettings?: Gio.Settings;
    systemSettings?: Gio.Settings;
    getStyleManager?: () => Adw.StyleManager;
    getGtkSettings?: () => Gtk.Settings | null;
}

@register
export class ColorScheme extends Object {
    private static instance: ColorScheme;
    static get_default() {
        if (!ColorScheme.instance) ColorScheme.instance = new ColorScheme();
        return ColorScheme.instance;
    }

    #daytime: boolean = true;
    #colorScheme: DarkModes = 0;
    #initialized = false;
    #timerId: GLib.Source | null = null;
    #generalHandlerId = 0;
    #busSubscriptions: (() => void)[];
    #timeHandlerIds: number[];
    #styleManagerHandlerIds: number[];
    #settingsSubscription: (() => void) | null = null;
    #getStyleManager: () => Adw.StyleManager;
    #getGtkSettings: () => Gtk.Settings | null;
    #applyError: string | null = null;
    #shadeSettings: {
        colorScheme: Accessor<DarkModes>;
        setColorScheme: (v: DarkModes) => void;
    } | null = null;
    /** Re-entrancy guard — silently drops recursive calls to the
     *  setter. This prevents ANY loop path where writing causes a
     *  cascade that writes back. */
    #settingColorScheme = false;
    /** Adw.StyleManager singleton — used to check current dark
     *  state before writing to org.gnome.desktop.interface. */
    #styleManager: Adw.StyleManager | null = null;
    @property
    get effectiveDark(): boolean {
        return this.#styleManager?.dark ?? false;
    }

    @property
    get systemScheme(): string {
        return this.#systemSettings.get_string(COLOR_SCHEME_KEY);
    }

    @property
    get applyError(): string | null {
        return this.#applyError;
    }
    #generalSettings: Gio.Settings;
    /** Direct handle on the org.gnome.desktop.interface settings —
     *  the PUSH target: writing color-scheme here drives the
     *  portal, Adw.StyleManager and every other app. */
    #systemSettings: Gio.Settings;
    /** GtkSettings:gtk-interface-color-scheme (GTK ≥ 4.20) — the
     *  ADOPT source: GTK live-mirrors the portal preference into
     *  it, and the GTK Inspector's system color-scheme selector
     *  edits it directly. Values: 0=unsupported, 1=default,
     *  2=dark, 3=light. */
    #gtkSettings: Gtk.Settings | null = null;
    #gtkHandlerId = 0;

    @property
    get colorScheme() {
        return this.#colorScheme;
    }

    @property
    get daytime() {
        return this.#daytime;
    }

    @property
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
        if (this.#settingColorScheme) return;
        this.#settingColorScheme = true;

        try {
            this.#colorScheme = c;
            if (c === DarkModes.AUTO) c = this.#daytime ? DarkModes.LIGHT : DarkModes.DARK;

            const targetKey = c === DarkModes.LIGHT ? 'prefer-light' : 'prefer-dark';
            const targetScheme = c === DarkModes.LIGHT
                ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.FORCE_DARK;
            this.#applyError = null;
            try {
                const written = this.#systemSettings.set_string(COLOR_SCHEME_KEY, targetKey);
                if (!this.#styleManager) throw new Error('Native appearance manager unavailable');
                this.#styleManager.colorScheme = targetScheme;
                if (!written || this.systemScheme !== targetKey ||
                    this.#styleManager.colorScheme !== targetScheme ||
                    this.effectiveDark !== (c === DarkModes.DARK)) {
                    throw new Error('Requested appearance was not fully applied');
                }
            } catch (error) {
                this.#applyError = String(error);
            }
            this.notify('effective-dark');
            this.notify('system-scheme');
            this.notify('apply-error');

            this.notify(COLOR_SCHEME_KEY);
            this.notify('color-scheme-name');
            this.notify('icon-name');

            // Write back to shade GSettings — this is what triggers
            // the subscribe callbacks. The subscribe callback sets
            // #settingColorScheme (via the re-entrant drop) if it
            // tries to call back into the setter.
            this.#shadeSettings?.setColorScheme(this.#colorScheme);
        } finally {
            this.#settingColorScheme = false;
        }
    }

    @property
    get iconName() {
        if (this.#colorScheme === DarkModes.AUTO)
            if (this.#daytime) return 'weather-clear-symbolic';
            else return 'weather-clear-night-symbolic';
        if (this.#colorScheme === DarkModes.LIGHT) return 'weather-clear-symbolic';
        else return 'weather-clear-night-symbolic';
    }

    /** Retry interval when the stored sunrise/sunset schedule is
     *  stale (both times in the past) — the weather service hasn't
     *  updated it yet. */
    private static readonly STALE_SCHEDULE_RETRY_MS = 5 * 60 * 1000;


    /** Adopt the system color-scheme preference mirrored by GTK
     *  into GtkSettings:gtk-interface-color-scheme. This fires for
     *  portal-driven changes (GNOME Settings, other apps writing
     *  the key) AND for direct edits from the GTK Inspector's
     *  system color-scheme selector.
     *
     *  Our own pushes echo back through the portal as the value we
     *  just resolved, so an incoming mode that already matches
     *  shade's current state (or AUTO's current resolution) is
     *  skipped; only genuinely divergent picks are adopted. */
    private onInterfaceColorScheme() {
        if (!this.#gtkSettings) return;
        // GtkInterfaceColorScheme: 0=UNSUPPORTED 1=DEFAULT 2=DARK 3=LIGHT
        const v = Number(
            (this.#gtkSettings as unknown as Record<string, unknown>)['gtk_interface_color_scheme']
        );
        if (v === 0) return; // unsupported — nothing to follow
        let mode: DarkModes;
        if (v === 1) {
            mode = DarkModes.AUTO;
        } else if (v === 2) {
            mode = DarkModes.DARK;
        } else {
            mode = DarkModes.LIGHT;
        }
        if (mode === this.#colorScheme) return;
        if (this.#colorScheme === DarkModes.AUTO) {
            const resolved = this.#daytime ? DarkModes.LIGHT : DarkModes.DARK;
            if (mode === resolved) return; // echo of our own push
        }
        logger.info(
            'colorscheme',
            `system color-scheme changed — adopting ${DarkModes[mode].toLowerCase()}`
        );
        this.colorScheme = mode;
    }

    /** Follows app-local StyleManager overrides (e.g. the GTK
     *  Inspector's per-application force-light/force-dark) while
     *  shade is in an explicit mode. AUTO is owned by the system
     *  color-scheme handler — a boolean dark flip must never
     *  stomp it. */
    private adoptExternalDark(dark: boolean) {
        if (this.#colorScheme === DarkModes.AUTO) return;
        if ((this.#colorScheme === DarkModes.DARK) === dark) return;
        logger.info(
            'colorscheme',
            `external dark-mode override — adopting ${dark ? 'dark' : 'light'}`
        );
        this.colorScheme = dark ? DarkModes.DARK : DarkModes.LIGHT;
    }

    private timeout() {
        if (this.#timerId !== null) {
            clearTimeout(this.#timerId);
            this.#timerId = null;
        }

        const now = GLib.DateTime.new_now_local()!.to_unix();
        const sunrise = this.#generalSettings.get_double('weather-sunrise-time');
        const sunset = this.#generalSettings.get_double('weather-sunset-time');
        if (sunrise <= 0 || sunset <= 0) return;

        // Derive daytime from the wall clock. A blind toggle never
        // converges when the stored schedule is stale — it flip-flops
        // on every timer fire, switching the theme back and forth.
        const isDay = now >= sunrise && now < sunset;
        if (isDay !== this.#daytime) {
            this.#daytime = isDay;
            this.notify('daytime');
            if (this.#colorScheme === DarkModes.AUTO) this.colorScheme = DarkModes.AUTO;
        }

        // Schedule the NEXT future transition. If both times are in
        // the past, the schedule is stale — retry periodically
        // instead of refiring immediately (which caused the
        // dark/light flip-flop loop).
        const next = [sunrise, sunset].filter((t) => t > now).sort((a, b) => a - b)[0];
        const delayMs =
            next !== undefined
                ? Math.max((next - now) * 1000, 1000)
                : ColorScheme.STALE_SCHEDULE_RETRY_MS;

        this.#timerId = setTimeout(() => {
            this.#timerId = null;
            this.timeout();
        }, delayMs);
    }

    init(settings: {colorScheme: Accessor<DarkModes>; setColorScheme: (v: DarkModes) => void}) {
        if (this.#initialized) {
            logger.warn('colorscheme', 'init() called but already initialized — skipping');
            return;
        }
        this.#initialized = true;
        try {
            this.#styleManager = this.#getStyleManager();
        } catch {
            this.#styleManager = null;
        }
        this.#shadeSettings = settings;
        // Load daytime BEFORE the initial push below — otherwise
        // AUTO resolves with the default #daytime=true and the
        // wrong mode gets pushed to the system key at night.
        this.#daytime = this.#generalSettings.get_boolean('weather-is-daytime');
        this.notify('daytime');
        const colorSchemeSetting = settings.colorScheme;
        this.colorScheme = colorSchemeSetting();

        this.#settingsSubscription = colorSchemeSetting.subscribe(() => {
            const newValue = colorSchemeSetting();
            if (newValue !== this.#colorScheme) {
                this.colorScheme = newValue;
            }
        });

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

        // Reschedule when the weather service refreshes the
        // sunrise/sunset times (e.g. new day, location change),
        // even if is-daytime itself didn't flip.
        for (const key of TIME_HANDLER_KEYS) {
            this.#timeHandlerIds.push(this.#generalSettings.connect(key, () => this.timeout()));
        }

        // Follow Adw.StyleManager as the source of truth after
        // startup: external dark-mode changes (GTK Inspector,
        // GNOME Settings, portal) are mirrored into shade state.
        const sm = this.#styleManager;
        if (sm) {
            this.#styleManagerHandlerIds.push(
                sm.connect('notify::dark', () => this.adoptExternalDark(sm.dark))
            );
            this.#styleManagerHandlerIds.push(
                sm.connect('notify::color-scheme', () => {
                    if (this.#settingColorScheme) return;
                    if (sm.colorScheme === Adw.ColorScheme.FORCE_LIGHT) {
                        this.colorScheme = DarkModes.LIGHT;
                    } else if (sm.colorScheme === Adw.ColorScheme.FORCE_DARK) {
                        this.colorScheme = DarkModes.DARK;
                    } else {
                        this.colorScheme = DarkModes.AUTO;
                    }
                })
            );
        }

        // GtkSettings:gtk-interface-color-scheme (GTK ≥ 4.20) is
        // the unified system source of truth: GTK mirrors the
        // portal preference into it live, and the GTK Inspector's
        // system color-scheme selector edits it directly.
        const gtkSettings = this.#getGtkSettings();
        if (gtkSettings) {
            try {
                // eslint-disable-next-line sonarjs/void-use
                void (gtkSettings as unknown as Record<string, unknown>)[
                    'gtk_interface_color_scheme'
                ];
                this.#gtkSettings = gtkSettings;
                this.#gtkHandlerId = gtkSettings.connect('notify::gtk-interface-color-scheme', () =>
                    this.onInterfaceColorScheme()
                );
            } catch {
                this.#gtkSettings = null;
            }
        }

        // Listen for color scheme commands from widgets via the bus
        this.#busSubscriptions.push(
            bus.on('display:colorscheme:set', (v) => {
                this.colorScheme = v;
            })
        );
    }

    dispose() {
        logger.debug('colorscheme', 'disposing');
        this.#settingsSubscription?.();
        this.#settingsSubscription = null;
        for (const unsubscribe of this.#busSubscriptions) unsubscribe();
        this.#busSubscriptions = [];
        if (this.#generalHandlerId !== 0) {
            try {
                this.#generalSettings.disconnect(this.#generalHandlerId);
            } catch {
                /* ignore */
            }
            this.#generalHandlerId = 0;
        }
        for (const id of this.#timeHandlerIds) {
            try {
                this.#generalSettings.disconnect(id);
            } catch {
                /* ignore */
            }
        }
        this.#timeHandlerIds = [];
        if (this.#styleManager) {
            for (const id of this.#styleManagerHandlerIds) {
                try {
                    this.#styleManager.disconnect(id);
                } catch {
                    /* ignore */
                }
            }
        }
        this.#styleManagerHandlerIds = [];
        if (this.#gtkHandlerId !== 0 && this.#gtkSettings) {
            try {
                this.#gtkSettings.disconnect(this.#gtkHandlerId);
            } catch {
                /* ignore */
            }
            this.#gtkHandlerId = 0;
        }
        if (this.#timerId) {
            clearTimeout(this.#timerId);
            this.#timerId = null;
        }
        this.#initialized = false;
    }

    constructor(dependencies: ColorSchemeDependencies = {}) {
        super();
        this.#busSubscriptions = [];
        this.#timeHandlerIds = [];
        this.#styleManagerHandlerIds = [];
        this.#getStyleManager = dependencies.getStyleManager ?? (() => Adw.StyleManager.get_default());
        this.#getGtkSettings = dependencies.getGtkSettings ?? (() => Gtk.Settings.get_default());
        this.#generalSettings = dependencies.generalSettings ?? new Gio.Settings({
            schemaId: `${import.meta.domain}.general`,
        });
        this.#systemSettings = dependencies.systemSettings ?? new Gio.Settings({
            schemaId: 'org.gnome.desktop.interface',
        });
    }
}

defineService({
    name: 'ColorScheme',
    service: ColorScheme.get_default(),
    initArgs: () => [generalSettings()],
});
