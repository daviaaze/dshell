import {Object as GObject, register, property} from 'gnim/gobject';
import {Process} from '#/lib/core/process';
import GLib from 'gi://GLib?version=2.0';
import logger from '#/lib/core/logger';
import {Accessor} from 'gnim';
import {
    writeHypridleConfig,
    deleteHypridleConfig,
    type HypridleConfig,
} from './hypridleConfig';

type PropKey = keyof HypridleConfig | 'enabled';

/**
 * Descriptor for a single hypridle property: its GObject notify name,
 * clamp range, settings accessor key, and how changing it may bump
 * dependent values to maintain dim < idle < dpms < suspend ordering.
 */
interface PropDef {
    notify: string;
    settingsKey: string;
    /** Compute clamped value from raw input + current props. Return raw value if no change needed. */
    clamp?: (raw: number, current: Record<PropKey, number>) => number;
    /** Called after the value is set; return overrides for dependent props. */
    cascade?: (
        val: number,
        current: Record<PropKey, number>
    ) => Partial<Record<PropKey, number>>;
}

const PROPS: Record<string, PropDef> = {
    enabled: {notify: 'enabled', settingsKey: 'autoLockEnabled'},
    idleTimeout: {
        notify: 'idle-timeout',
        settingsKey: 'idleTimeout',
        clamp: (v, _cur) => Math.max(60, Math.min(v, 1800)),
        cascade: (v, cur) => {
            const r: Partial<Record<PropKey, number>> = {};
            if (cur.dimTimeout >= v) r.dimTimeout = Math.max(30, v - 10);
            if (cur.dpmsTimeout <= v) r.dpmsTimeout = v + 10;
            return r;
        },
    },
    dimTimeout: {
        notify: 'dim-timeout',
        settingsKey: 'screenDimTimeout',
        clamp: (v, cur) => Math.max(30, Math.min(v, cur.idleTimeout - 10)),
        cascade: (v, cur) =>
            v >= cur.idleTimeout ? {idleTimeout: v + 10} : {},
    },
    dimEnabled: {notify: 'dim-enabled', settingsKey: 'screenDimEnabled'},
    dpmsTimeout: {
        notify: 'dpms-timeout',
        settingsKey: 'dpmsTimeout',
        clamp: (v, cur) => Math.max(cur.idleTimeout + 10, Math.min(v, 3600)),
        cascade: (v, cur) =>
            cur.suspendTimeout <= v ? {suspendTimeout: v + 10} : {},
    },
    dpmsEnabled: {notify: 'dpms-enabled', settingsKey: 'dpmsEnabled'},
    suspendTimeout: {
        notify: 'suspend-timeout',
        settingsKey: 'suspendTimeout',
        clamp: (v, cur) => Math.max(cur.dpmsTimeout + 10, Math.min(v, 7200)),
    },
    suspendEnabled: {notify: 'suspend-enabled', settingsKey: 'suspendEnabled'},
};

@register({GTypeName: 'Hypridle'})
export default class Hypridle extends GObject {
    static instance: Hypridle;
    static get_default() {
        if (!this.instance) this.instance = new Hypridle();
        return this.instance;
    }

    #values: Record<PropKey, any> = {
        enabled: true,
        idleTimeout: 300,
        dimTimeout: 240,
        dimEnabled: true,
        dpmsTimeout: 600,
        dpmsEnabled: true,
        suspendTimeout: 1800,
        suspendEnabled: false,
    };

    #settings: Record<string, (v: any) => void> | null = null;
    #process: Process | null = null;

    // ── GObject property accessors ────────────────────────────────────

    @property(Object) get enabled() {
        return this.#values.enabled;
    }
    set enabled(v) {
        this.#set('enabled', v);
    }

    @property(Object) get idleTimeout() {
        return this.#values.idleTimeout;
    }
    set idleTimeout(v) {
        this.#set('idleTimeout', v);
    }

    @property(Object) get dimTimeout() {
        return this.#values.dimTimeout;
    }
    set dimTimeout(v) {
        this.#set('dimTimeout', v);
    }

    @property(Object) get dimEnabled() {
        return this.#values.dimEnabled;
    }
    set dimEnabled(v) {
        this.#set('dimEnabled', v);
    }

    @property(Object) get dpmsTimeout() {
        return this.#values.dpmsTimeout;
    }
    set dpmsTimeout(v) {
        this.#set('dpmsTimeout', v);
    }

    @property(Object) get dpmsEnabled() {
        return this.#values.dpmsEnabled;
    }
    set dpmsEnabled(v) {
        this.#set('dpmsEnabled', v);
    }

    @property(Object) get suspendTimeout() {
        return this.#values.suspendTimeout;
    }
    set suspendTimeout(v) {
        this.#set('suspendTimeout', v);
    }

    @property(Object) get suspendEnabled() {
        return this.#values.suspendEnabled;
    }
    set suspendEnabled(v) {
        this.#set('suspendEnabled', v);
    }

    @property(Object)
    get available() {
        return GLib.find_program_in_path('hypridle') !== null;
    }

    // ── Centralised property write ────────────────────────────────────

    #set(key: PropKey, value: any) {
        const def = PROPS[key];
        if (!def) return;

        // Clamp (may reference other current values for dynamic bounds)
        if (def.clamp && typeof value === 'number') {
            const cur = this.#values as Record<PropKey, number>;
            value = def.clamp(value, cur);
        }

        if (this.#values[key] === value) return;
        this.#values[key] = value;

        // Cascade — adjust dependent values to maintain ordering invariants
        if (def.cascade && typeof value === 'number') {
            const cur = this.#values as Record<PropKey, number>;
            const overrides = def.cascade(value, cur);
            for (const [depKey, depVal] of Object.entries(overrides)) {
                const k = depKey as PropKey;
                if (depVal !== undefined && this.#values[k] !== depVal) {
                    this.#values[k] = depVal;
                    const depDef = PROPS[k];
                    if (depDef) this.notify(depDef.notify);
                }
            }
        }

        // Sync to GSettings accessor
        const acc = this.#settings?.[def.settingsKey];
        if (acc && typeof acc === 'function') acc(value);

        this.notify(def.notify);
        this.#apply();
    }

    // ── Initialisation ────────────────────────────────────────────────

    init(settings: {
        autoLockEnabled: Accessor<boolean>;
        idleTimeout: Accessor<number>;
        screenDimEnabled: Accessor<boolean>;
        screenDimTimeout: Accessor<number>;
        dpmsEnabled: Accessor<boolean>;
        dpmsTimeout: Accessor<number>;
        suspendEnabled: Accessor<boolean>;
        suspendTimeout: Accessor<number>;
        setAutoLockEnabled: (v: boolean) => void;
        setIdleTimeout: (v: number) => void;
        setScreenDimEnabled: (v: boolean) => void;
        setScreenDimTimeout: (v: number) => void;
        setDpmsEnabled: (v: boolean) => void;
        setDpmsTimeout: (v: number) => void;
        setSuspendEnabled: (v: boolean) => void;
        setSuspendTimeout: (v: number) => void;
    }) {
        if (this.#settings) {
            logger.warn(
                'hypridle',
                'init() called but already initialized — skipping'
            );
            return;
        }

        this.#settings = {};
        const s = this.#settings; // local ref — always non-null after guard above

        // Wire each GSettings accessor → this.#set() on change
        const link = <T>(
            acc: Accessor<T>,
            setterFn: (v: T) => void,
            key: PropKey
        ) => {
            const def = PROPS[key];
            s[def.settingsKey] = setterFn;
            acc.subscribe(() => {
                const v = acc();
                if (this.#values[key] !== v) this.#set(key, v);
            });
        };

        link(settings.autoLockEnabled, settings.setAutoLockEnabled, 'enabled');
        link(settings.idleTimeout, settings.setIdleTimeout, 'idleTimeout');
        link(
            settings.screenDimEnabled,
            settings.setScreenDimEnabled,
            'dimEnabled'
        );
        link(
            settings.screenDimTimeout,
            settings.setScreenDimTimeout,
            'dimTimeout'
        );
        link(settings.dpmsEnabled, settings.setDpmsEnabled, 'dpmsEnabled');
        link(settings.dpmsTimeout, settings.setDpmsTimeout, 'dpmsTimeout');
        link(
            settings.suspendEnabled,
            settings.setSuspendEnabled,
            'suspendEnabled'
        );
        link(
            settings.suspendTimeout,
            settings.setSuspendTimeout,
            'suspendTimeout'
        );

        // Load initial values
        this.#set('enabled', settings.autoLockEnabled());
        this.#set('idleTimeout', settings.idleTimeout());
        this.#set('dimTimeout', settings.screenDimTimeout());
        this.#set('dimEnabled', settings.screenDimEnabled());
        this.#set('dpmsTimeout', settings.dpmsTimeout());
        this.#set('dpmsEnabled', settings.dpmsEnabled());
        this.#set('suspendTimeout', settings.suspendTimeout());
        this.#set('suspendEnabled', settings.suspendEnabled());
    }

    // ── Process lifecycle ─────────────────────────────────────────────

    #apply() {
        try {
            if (!this.available) return;
            if (this.#values.enabled) {
                this.#writeConfig();
                this.#restart();
            } else {
                this.#stop();
            }
        } catch (e) {
            logger.error('hypridle', 'unexpected error in #apply:', e);
        }
    }

    #writeConfig() {
        writeHypridleConfig({
            dimEnabled: this.#values.dimEnabled,
            dimTimeout: this.#values.dimTimeout,
            idleTimeout: this.#values.idleTimeout,
            dpmsEnabled: this.#values.dpmsEnabled,
            dpmsTimeout: this.#values.dpmsTimeout,
            suspendEnabled: this.#values.suspendEnabled,
            suspendTimeout: this.#values.suspendTimeout,
        });
    }

    #restart() {
        if (this.#process) {
            try {
                this.#process.kill();
            } catch (e) {
                logger.warn('hypridle', 'failed to kill old process:', e);
            }
            this.#process = null;
        }
        try {
            Process.exec('pkill -x hypridle');
        } catch (e) {
            logger.debug(
                'hypridle',
                'pkill skipped (hypridle not running):',
                e
            );
        }
        try {
            this.#process = Process.subprocessv(['hypridle']);
        } catch (e) {
            logger.error('hypridle', 'failed to start:', e);
        }
    }

    #stop() {
        if (this.#process) {
            try {
                this.#process.kill();
            } catch (e) {
                logger.warn('hypridle', 'failed to kill process:', e);
            }
            this.#process = null;
        }
        try {
            Process.exec('pkill -x hypridle');
        } catch {
            /* ok */
        }
        deleteHypridleConfig();
    }

    dispose() {
        this.#stop();
    }
}
