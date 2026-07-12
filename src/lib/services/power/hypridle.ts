import GObject, {getter, register, setter} from 'gnim/gobject';
import {Process} from '#/lib/core/process';
import GLib from 'gi://GLib?version=2.0';
import logger from '#/lib/core/logger';
import {Accessor} from 'gnim';
import {writeHypridleConfig, deleteHypridleConfig, type HypridleConfig} from './hypridleConfig';


@register({GTypeName: 'Hypridle'})
export default class Hypridle extends GObject.Object {
    static readonly instance: Hypridle;
    static get_default() {
        if (!this.instance) this.instance = new Hypridle();
        return this.instance;
    }

    #enabled = true;
    #idleTimeout = 300;
    #dimTimeout = 240;
    #dimEnabled = true;
    #dpmsEnabled = true;
    #dpmsTimeout = 600;
    #suspendEnabled = false;
    #suspendTimeout = 1800;
    #process: Process | null = null;
    #settings: {
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
    } | null = null;

    @getter(Boolean)
    get enabled() {
        return this.#enabled;
    }

    @setter(Boolean)
    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        this.#enabled = v;
        this.#settings?.setAutoLockEnabled(v);
        this.#apply();
        this.notify('enabled');
    }

    @getter(Number)
    get idleTimeout() {
        return this.#idleTimeout;
    }

    @setter(Number)
    set idleTimeout(v: number) {
        v = Math.max(60, Math.min(1800, v));
        if (this.#idleTimeout === v) return;
        this.#idleTimeout = v;
        // Cross-validate: keep dim < idle < dpms < suspend
        if (this.#dimTimeout >= v) {
            this.#dimTimeout = Math.max(30, v - 10);
            this.notify('dim-timeout');
        }
        if (this.#dpmsTimeout <= v) {
            this.#dpmsTimeout = v + 10;
            this.notify('dpms-timeout');
        }
        if (this.#suspendTimeout <= this.#dpmsTimeout) {
            this.#suspendTimeout = this.#dpmsTimeout + 10;
            this.notify('suspend-timeout');
        }
        this.#settings?.setIdleTimeout(v);
        this.#apply();
        this.notify('idle-timeout');
    }

    @getter(Number)
    get dimTimeout() {
        return this.#dimTimeout;
    }

    @setter(Number)
    set dimTimeout(v: number) {
        v = Math.max(30, Math.min(this.#idleTimeout - 10, v));
        if (this.#dimTimeout === v) return;
        this.#dimTimeout = v;
        this.#settings?.setScreenDimTimeout(v);
        this.#apply();
        this.notify('dim-timeout');
    }

    @getter(Boolean)
    get dimEnabled() {
        return this.#dimEnabled;
    }

    @setter(Boolean)
    set dimEnabled(v: boolean) {
        if (this.#dimEnabled === v) return;
        this.#dimEnabled = v;
        this.#settings?.setScreenDimEnabled(v);
        this.#apply();
        this.notify('dim-enabled');
    }

    @getter(Boolean)
    get dpmsEnabled() {
        return this.#dpmsEnabled;
    }

    @setter(Boolean)
    set dpmsEnabled(v: boolean) {
        if (this.#dpmsEnabled === v) return;
        this.#dpmsEnabled = v;
        this.#settings?.setDpmsEnabled(v);
        this.#apply();
        this.notify('dpms-enabled');
    }

    @getter(Number)
    get dpmsTimeout() {
        return this.#dpmsTimeout;
    }

    @setter(Number)
    set dpmsTimeout(v: number) {
        v = Math.max(this.#idleTimeout + 10, Math.min(3600, v));
        if (this.#dpmsTimeout === v) return;
        this.#dpmsTimeout = v;
        // Cross-validate: keep dpms < suspend
        if (this.#suspendTimeout <= v) {
            this.#suspendTimeout = v + 10;
            this.notify('suspend-timeout');
        }
        this.#settings?.setDpmsTimeout(v);
        this.#apply();
        this.notify('dpms-timeout');
    }

    @getter(Boolean)
    get suspendEnabled() {
        return this.#suspendEnabled;
    }

    @setter(Boolean)
    set suspendEnabled(v: boolean) {
        if (this.#suspendEnabled === v) return;
        this.#suspendEnabled = v;
        this.#settings?.setSuspendEnabled(v);
        this.#apply();
        this.notify('suspend-enabled');
    }

    @getter(Number)
    get suspendTimeout() {
        return this.#suspendTimeout;
    }

    @setter(Number)
    set suspendTimeout(v: number) {
        v = Math.max(this.#dpmsTimeout + 10, Math.min(7200, v));
        if (this.#suspendTimeout === v) return;
        this.#suspendTimeout = v;
        this.#settings?.setSuspendTimeout(v);
        this.#apply();
        this.notify('suspend-timeout');
    }

    @getter(Boolean)
    get available() {
        return GLib.find_program_in_path('hypridle') !== null;
    }

    #subscribeSetting<T>(
        accessor: Accessor<T>,
        onChange: (value: T) => void,
    ) {
        accessor.subscribe(() => {
            const v = accessor();
            onChange(v);
        });
    }

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
            logger.warn('hypridle', 'init() called but already initialized — skipping');
            return;
        }
        this.#settings = settings;
        this.#enabled = settings.autoLockEnabled();
        this.#idleTimeout = settings.idleTimeout();
        this.#dimEnabled = settings.screenDimEnabled();
        this.#dimTimeout = settings.screenDimTimeout();
        this.#dpmsEnabled = settings.dpmsEnabled();
        this.#dpmsTimeout = settings.dpmsTimeout();
        this.#suspendEnabled = settings.suspendEnabled();
        this.#suspendTimeout = settings.suspendTimeout();

        this.#subscribeSetting(settings.autoLockEnabled, v => {
            if (this.#enabled === v) return;
            this.#enabled = v;
            this.notify('enabled');
            this.#apply();
        });

        this.#subscribeSetting(settings.idleTimeout, v => {
            if (this.#idleTimeout === v) return;
            this.#idleTimeout = v;
            this.notify('idle-timeout');
            if (this.#dpmsTimeout < v + 10) {
                this.#dpmsTimeout = v + 10;
                this.notify('dpms-timeout');
            }
            if (this.#suspendTimeout < this.#dpmsTimeout + 10) {
                this.#suspendTimeout = this.#dpmsTimeout + 10;
                this.notify('suspend-timeout');
            }
            this.#apply();
        });

        this.#subscribeSetting(settings.screenDimEnabled, v => {
            if (this.#dimEnabled === v) return;
            this.#dimEnabled = v;
            this.notify('dim-enabled');
            this.#apply();
        });

        this.#subscribeSetting(settings.screenDimTimeout, v => {
            if (this.#dimTimeout === v) return;
            this.#dimTimeout = v;
            this.notify('dim-timeout');
            this.#apply();
        });

        this.#subscribeSetting(settings.dpmsEnabled, v => {
            if (this.#dpmsEnabled === v) return;
            this.#dpmsEnabled = v;
            this.notify('dpms-enabled');
            this.#apply();
        });

        this.#subscribeSetting(settings.dpmsTimeout, v => {
            if (this.#dpmsTimeout === v) return;
            this.#dpmsTimeout = v;
            this.notify('dpms-timeout');
            if (this.#suspendTimeout < v + 10) {
                this.#suspendTimeout = v + 10;
                this.notify('suspend-timeout');
            }
            this.#apply();
        });

        this.#subscribeSetting(settings.suspendEnabled, v => {
            if (this.#suspendEnabled === v) return;
            this.#suspendEnabled = v;
            this.notify('suspend-enabled');
            this.#apply();
        });

        this.#subscribeSetting(settings.suspendTimeout, v => {
            if (this.#suspendTimeout === v) return;
            this.#suspendTimeout = v;
            this.notify('suspend-timeout');
            this.#apply();
        });

        this.#apply();
    }

    #apply() {
        try {
            if (!this.available) return;
            if (this.#enabled) {
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
        const cfg: HypridleConfig = {
            dimEnabled: this.#dimEnabled,
            dimTimeout: this.#dimTimeout,
            idleTimeout: this.#idleTimeout,
            dpmsEnabled: this.#dpmsEnabled,
            dpmsTimeout: this.#dpmsTimeout,
            suspendEnabled: this.#suspendEnabled,
            suspendTimeout: this.#suspendTimeout,
        };
        writeHypridleConfig(cfg);
    }

    #restart() {
        // Kill any existing hypridle process (don't call #stop() which
        // would delete the config we just wrote)
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
            // pkill may fail if hypridle is not running — that's normal
        }
        // Remove the config file so external hypridle instances
        // (e.g. systemd services) don't pick up the lock listener
        deleteHypridleConfig();
    }

    dispose() {
        this.#stop();
    }
}
