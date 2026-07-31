import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {register, Object, property} from 'gnim/gobject';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {bus} from '../bus';
import {createSettings, Schema} from 'gnim/schema';
import {Accessor, Setter} from 'gnim';
import logger from '@shade/core/logger';
import {defineService} from '@shade/core/define';
import {generalSettings} from '@shade/core/settings/general.gschema';

export enum DarkModes {
    AUTO,
    LIGHT,
    DARK,
}

const TIME_HANDLER_KEYS: Array<'changed::weather-sunrise-time' | 'changed::weather-sunset-time'> = [
    'changed::weather-sunrise-time',
    'changed::weather-sunset-time',
]

@register
export class ColorScheme extends Object {
    private static instance: ColorScheme;
    static get_default() {
        if (!this.instance) this.instance = new ColorScheme();
        return this.instance;
    }

    #daytime: boolean = true;
    #colorScheme: DarkModes = 0;
    #initialized = false;
    #timerId: GLib.Source | null = null;
    #generalHandlerId = 0;
    #busSubscriptions: (() => void)[] = [];
    #timeHandlerIds: number[] = [];
    #styleManagerHandlerIds: number[] = [];
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
    #gsettings: {
        setColorScheme: Setter<string>;
    };
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
        // ── Re-entrancy guard ──
        // Silently drop ANY recursive call. The initial caller
        // already updated this.#colorScheme, so a dropped
        // re-entrant call is always redundant.
        if (this.#settingColorScheme) {
            logger.warn(
                'colorscheme',
                `re-entrant setter dropped (c=${c}, current=${this.#colorScheme})`
            );
            return;
        }
        this.#settingColorScheme = true;

        try {
            this.#colorScheme = c;
            if (c === DarkModes.AUTO)
                c = this.#daytime ? DarkModes.LIGHT : DarkModes.DARK;

            // Push the resolved mode to the system key unless it
            // already matches. Compare the KEY itself — not
            // StyleManager.dark — so a 'default' (no-preference)
            // key never suppresses a needed push.
            const targetKey =
                c === DarkModes.LIGHT ? 'prefer-light' : 'prefer-dark';
            if (
                this.#systemSettings.get_string('color-scheme') !==
                targetKey
            ) {
                this.#pushSystemScheme(targetKey);
            }

            this.notify('color-scheme');
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
        if (this.#colorScheme === DarkModes.LIGHT)
            return 'weather-clear-symbolic';
        else return 'weather-clear-night-symbolic';
    }

    /** Retry interval when the stored sunrise/sunset schedule is
     *  stale (both times in the past) — the weather service hasn't
     *  updated it yet. */
    private static readonly STALE_SCHEDULE_RETRY_MS = 5 * 60 * 1000;

    /** Push shade's resolved mode to the system key. */
    #pushSystemScheme(value: 'prefer-light' | 'prefer-dark') {
        this.#gsettings.setColorScheme(value);
    }

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
            (this.#gtkSettings as unknown as Record<string, unknown>)[
                'gtk_interface_color_scheme'
            ]
        );
        if (v === 0) return; // unsupported — nothing to follow
        const mode =
            v === 1
                ? DarkModes.AUTO
                : v === 2
                  ? DarkModes.DARK
                  : DarkModes.LIGHT;
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
        const sunrise = this.#generalSettings.get_double(
            'weather-sunrise-time'
        );
        const sunset = this.#generalSettings.get_double('weather-sunset-time');
        if (sunrise <= 0 || sunset <= 0) return;

        // Derive daytime from the wall clock. A blind toggle never
        // converges when the stored schedule is stale — it flip-flops
        // on every timer fire, switching the theme back and forth.
        const isDay = now >= sunrise && now < sunset;
        if (isDay !== this.#daytime) {
            this.#daytime = isDay;
            this.notify('daytime');
            if (this.#colorScheme === DarkModes.AUTO)
                this.colorScheme = DarkModes.AUTO;
        }

        // Schedule the NEXT future transition. If both times are in
        // the past, the schedule is stale — retry periodically
        // instead of refiring immediately (which caused the
        // dark/light flip-flop loop).
        const next = [sunrise, sunset]
            .filter(t => t > now)
            .sort((a, b) => a - b)[0];
        const delayMs =
            next !== undefined
                ? Math.max((next - now) * 1000, 1000)
                : ColorScheme.STALE_SCHEDULE_RETRY_MS;

        this.#timerId = setTimeout(() => {
            this.#timerId = null;
            this.timeout();
        }, delayMs);
    }

    init(settings: {
        colorScheme: Accessor<DarkModes>;
        setColorScheme: (v: DarkModes) => void;
    }) {
        if (this.#initialized) {
            logger.warn(
                'colorscheme',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        this.#shadeSettings = settings;
        // Load daytime BEFORE the initial push below — otherwise
        // AUTO resolves with the default #daytime=true and the
        // wrong mode gets pushed to the system key at night.
        this.#daytime = this.#generalSettings.get_boolean('weather-is-daytime');
        this.notify('daytime');
        const colorSchemeSetting = settings.colorScheme;
        this.colorScheme = colorSchemeSetting();

        colorSchemeSetting.subscribe(() => {
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
                const newDaytime =
                    this.#generalSettings.get_boolean('weather-is-daytime');
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
            this.#timeHandlerIds.push(
                this.#generalSettings.connect(key, () => this.timeout())
            );
        }

        // Follow Adw.StyleManager as the source of truth after
        // startup: external dark-mode changes (GTK Inspector,
        // GNOME Settings, portal) are mirrored into shade state.
        const sm = this.#styleManager;
        if (sm) {
            this.#styleManagerHandlerIds.push(
                sm.connect('notify::dark', () =>
                    this.adoptExternalDark(sm.dark)
                )
            );
        }

        // GtkSettings:gtk-interface-color-scheme (GTK ≥ 4.20) is
        // the unified system source of truth: GTK mirrors the
        // portal preference into it live, and the GTK Inspector's
        // system color-scheme selector edits it directly.
        const gtkSettings = Gtk.Settings.get_default();
        if (gtkSettings) {
            try {
                // eslint-disable-next-line sonarjs/void-use
                void (gtkSettings as unknown as Record<string, unknown>)[
                    'gtk_interface_color_scheme'
                ];
                this.#gtkSettings = gtkSettings;
                this.#gtkHandlerId = gtkSettings.connect(
                    'notify::gtk-interface-color-scheme',
                    () => this.onInterfaceColorScheme()
                );
            } catch {
                this.#gtkSettings = null;
            }
        }

        // Listen for color scheme commands from widgets via the bus
        this.#busSubscriptions.push(
            bus.on('display:colorscheme:set', v => { this.colorScheme = v; })
        );
    }

    dispose() {
        logger.debug('colorscheme', 'disposing');
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

    constructor() {
        super();

        // Must happen early — guards the setter against writing
        // to org.gnome.desktop.interface when the StyleManager
        // already reflects the target mode.
        try {
            this.#styleManager = Adw.StyleManager.get_default();
        } catch {
            this.#styleManager = null;
        }

        this.#generalSettings = new Gio.Settings({
            schemaId: `${import.meta.domain}.general`,
        });

        this.#systemSettings = new Gio.Settings({
            schemaId: 'org.gnome.desktop.interface',
        });

        this.#gsettings = createSettings(
            this.#systemSettings,
            new Schema({
                id: 'org.gnome.desktop.interface',
                path: '/org/gnome/desktop/interface/',
            }).key('color-scheme', 's', {default: 'prefer-light'})
        );
    }
}

defineService({name: 'ColorScheme', service: ColorScheme.get_default(), initArgs: () => [generalSettings()]});
