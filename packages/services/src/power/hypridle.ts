import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {generalSettings} from '@shade/core/settings/general.gschema';
import type {Accessor} from 'gnim';
import {Object as GObject, property, register} from 'gnim/gobject';
import {
    deleteHypridleConfig,
    HYPRIDLE_CONFIG_PATH,
    type HypridleConfig,
    normaliseTimeouts,
    restoreDimmedBrightness,
    writeHypridleConfig,
} from './hypridleConfig';

type PropKey = keyof HypridleConfig | 'enabled';
/** All hypridle props are either boolean toggles or second-based timeouts. */
type PropValue = boolean | number;

interface HypridleRuntime {
    available?: boolean;
    writeConfig?: () => void;
    restart?: () => void;
    stop?: () => void;
}

/** GObject notify name of each prop. */
const NOTIFY: Record<PropKey, string> = {
    enabled: 'enabled',
    idleTimeout: 'idle-timeout',
    dimTimeout: 'dim-timeout',
    dimEnabled: 'dim-enabled',
    dpmsTimeout: 'dpms-timeout',
    dpmsEnabled: 'dpms-enabled',
    suspendTimeout: 'suspend-timeout',
    suspendEnabled: 'suspend-enabled',
};

const PROP_KEYS = Object.keys(NOTIFY) as PropKey[];

/** A prop's GSettings key: how to read it and write it back. */
interface Binding {
    read: () => PropValue;
    write: (v: PropValue) => void;
}

@register
export default class Hypridle extends GObject {
    private static instance: Hypridle;
    static get_default() {
        if (!Hypridle.instance) Hypridle.instance = new Hypridle();
        return Hypridle.instance;
    }

    #values: Record<PropKey, PropValue> = {
        enabled: true,
        idleTimeout: 300,
        dimTimeout: 240,
        dimEnabled: true,
        dpmsTimeout: 600,
        dpmsEnabled: true,
        suspendTimeout: 1800,
        suspendEnabled: false,
    };

    #bindings: Record<PropKey, Binding> | null = null;
    #process: Process | null = null;
    #runtime: HypridleRuntime = {};

    // ── GObject property accessors ────────────────────────────────────

    @property get enabled() {
        return this.#values.enabled as boolean;
    }
    set enabled(v) {
        this.#set('enabled', v);
    }

    @property get idleTimeout() {
        return this.#values.idleTimeout as number;
    }
    set idleTimeout(v) {
        this.#set('idleTimeout', v);
    }

    @property get dimTimeout() {
        return this.#values.dimTimeout as number;
    }
    set dimTimeout(v) {
        this.#set('dimTimeout', v);
    }

    @property get dimEnabled() {
        return this.#values.dimEnabled as boolean;
    }
    set dimEnabled(v) {
        this.#set('dimEnabled', v);
    }

    @property get dpmsTimeout() {
        return this.#values.dpmsTimeout as number;
    }
    set dpmsTimeout(v) {
        this.#set('dpmsTimeout', v);
    }

    @property get dpmsEnabled() {
        return this.#values.dpmsEnabled as boolean;
    }
    set dpmsEnabled(v) {
        this.#set('dpmsEnabled', v);
    }

    @property get suspendTimeout() {
        return this.#values.suspendTimeout as number;
    }
    set suspendTimeout(v) {
        this.#set('suspendTimeout', v);
    }

    @property get suspendEnabled() {
        return this.#values.suspendEnabled as boolean;
    }
    set suspendEnabled(v) {
        this.#set('suspendEnabled', v);
    }

    @property
    get available() {
        return GLib.find_program_in_path('hypridle') !== null;
    }

    // ── Centralised property write ────────────────────────────────────

    #set(key: PropKey, value: PropValue, apply = true) {
        const before = {...this.#values};
        this.#values[key] = value;
        if (this.#reconcile(before) && apply) this.#apply();
    }

    /**
     * Normalise the timeout chain in one pass, notify every prop that changed
     * from `before`, and write back to GSettings every prop whose stored value
     * differs from the effective one (cascaded values, and clamped writes that
     * left the in-memory value unchanged). Returns whether anything changed.
     */
    #reconcile(before: Record<PropKey, PropValue>): boolean {
        const v = this.#values;
        Object.assign(
            v,
            normaliseTimeouts({
                idleTimeout: v.idleTimeout as number,
                dimTimeout: v.dimTimeout as number,
                dpmsTimeout: v.dpmsTimeout as number,
                suspendTimeout: v.suspendTimeout as number,
            })
        );

        let changed = false;
        for (const key of PROP_KEYS) {
            if (v[key] !== before[key]) {
                changed = true;
                this.notify(NOTIFY[key]);
            }
            const binding = this.#bindings?.[key];
            if (binding && binding.read() !== v[key]) binding.write(v[key]);
        }
        return changed;
    }

    // ── Initialisation ────────────────────────────────────────────────

    init(
        settings: {
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
        },
        runtime: HypridleRuntime = {}
    ) {
        if (this.#bindings) {
            logger.warn('hypridle', 'init() called but already initialized — skipping');
            return;
        }

        this.#runtime = runtime;

        // Wire each GSettings accessor → this.#set() on change
        const bind = <T extends PropValue>(
            key: PropKey,
            acc: Accessor<T>,
            write: (v: T) => void
        ): Binding => {
            acc.subscribe(() => {
                const v = acc();
                if (this.#values[key] !== v) this.#set(key, v);
            });
            return {read: acc, write: write as (v: PropValue) => void};
        };

        this.#bindings = {
            enabled: bind('enabled', settings.autoLockEnabled, settings.setAutoLockEnabled),
            idleTimeout: bind('idleTimeout', settings.idleTimeout, settings.setIdleTimeout),
            dimEnabled: bind('dimEnabled', settings.screenDimEnabled, settings.setScreenDimEnabled),
            dimTimeout: bind('dimTimeout', settings.screenDimTimeout, settings.setScreenDimTimeout),
            dpmsEnabled: bind('dpmsEnabled', settings.dpmsEnabled, settings.setDpmsEnabled),
            dpmsTimeout: bind('dpmsTimeout', settings.dpmsTimeout, settings.setDpmsTimeout),
            suspendEnabled: bind(
                'suspendEnabled',
                settings.suspendEnabled,
                settings.setSuspendEnabled
            ),
            suspendTimeout: bind(
                'suspendTimeout',
                settings.suspendTimeout,
                settings.setSuspendTimeout
            ),
        };

        // Load every stored value first, then normalise once, so a default in
        // memory can never overwrite a stored value that has not been read yet.
        const before = {...this.#values};
        for (const key of PROP_KEYS) this.#values[key] = this.#bindings[key].read();
        this.#reconcile(before);
        this.#apply();
    }

    // ── Process lifecycle ─────────────────────────────────────────────

    #apply() {
        try {
            if (!(this.#runtime.available ?? this.available)) return;
            if (this.#values.enabled) {
                if (this.#runtime.writeConfig) this.#runtime.writeConfig();
                else this.#writeConfig();
                if (this.#runtime.restart) this.#runtime.restart();
                else this.#restart();
            } else if (this.#runtime.stop) {
                this.#runtime.stop();
            } else {
                this.#stop();
            }
        } catch (e) {
            logger.error('hypridle', 'unexpected error in #apply:', e);
        }
    }

    #writeConfig() {
        writeHypridleConfig({
            dimEnabled: this.#values.dimEnabled as boolean,
            dimTimeout: this.#values.dimTimeout as number,
            idleTimeout: this.#values.idleTimeout as number,
            dpmsEnabled: this.#values.dpmsEnabled as boolean,
            dpmsTimeout: this.#values.dpmsTimeout as number,
            suspendEnabled: this.#values.suspendEnabled as boolean,
            suspendTimeout: this.#values.suspendTimeout as number,
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
            logger.debug('hypridle', 'pkill skipped (hypridle not running):', e);
        }
        // The new instance starts with a clean idle state: undo a dim the old one left.
        restoreDimmedBrightness();
        try {
            this.#process = Process.subprocessv(['hypridle', '-c', HYPRIDLE_CONFIG_PATH]);
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
        restoreDimmedBrightness();
        deleteHypridleConfig();
    }

    stop() {
        if (this.#runtime.stop) this.#runtime.stop();
        else this.#stop();
    }
    apply() {
        this.#apply();
    }

    dispose() {
        if (this.#runtime.stop) this.#runtime.stop();
        else this.#stop();
    }
}

defineService({
    name: 'Hypridle',
    service: Hypridle.get_default(),
    initArgs: () => [generalSettings()],
});
