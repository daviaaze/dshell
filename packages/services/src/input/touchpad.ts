import {Object, register, signal, property} from 'gnim/gobject';
import Gio from 'gi://Gio?version=2.0';
import {bus} from '../bus';
import {Process} from '@shade/core/process';
import logger from '@shade/core/logger';

logger.info('touchpad', 'module loaded');

const EC_TOUCHPAD_PATH = '/sys/bus/platform/devices/VPC2004:00/touchpad';

// EVIOCGRAB fallback: grab input device at kernel level via Python stdlib ioctl
const GRAB_SCRIPT = `
import fcntl, os, signal
fd = os.open("__DEVICE__", os.O_RDWR)
fcntl.ioctl(fd, 0x40044590, 1)
signal.pause()
`;

@register
export default class Touchpad extends Object {
    private static instance: Touchpad;
    static get_default() {
        if (!this.instance) this.instance = new Touchpad();
        return this.instance;
    }

    #enabled = true;
    #available = false;
    #useEc = false;
    #eventPath: string | null = null;
    #process: Process | null = null;
    #initialized = false;
    #busSubscriptions: (() => void)[] = [];

    @property
    get enabled() {
        return this.#enabled;
    }

    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        this.#enabled = v;
        this.#apply();
        this.notify('enabled');
        this.toggled(v);
    }

    @property
    get available() {
        return this.#available;
    }

    @signal
    toggled(_enabled: boolean): void {}

    toggle() {
        logger.info(
            'touchpad',
            `toggle() called, current enabled=${this.#enabled}`
        );
        this.enabled = !this.#enabled;
        logger.info('touchpad', `toggle() done, new enabled=${this.#enabled}`);
    }

    init() {
        if (this.#initialized) {
            logger.warn(
                'touchpad',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        logger.info('touchpad', 'init() called');
        this.#detectDevice();
        logger.info(
            'touchpad',
            `detectDevice done: available=${this.#available}, useEc=${this.#useEc}, eventPath=${this.#eventPath}`
        );
        if (!this.#available) {
            logger.info('touchpad', 'no touchpad detected, skipping init');
            return;
        }
        const mode = this.#useEc ? 'EC hardware toggle' : 'EVIOCGRAB fallback';
        logger.info(
            'touchpad',
            `initialized, mode=${mode}, enabled=${this.#enabled}`
        );

        // Listen for toggle commands from widgets via the bus
        this.#busSubscriptions.push(
            bus.on('input:touchpad:toggle', () => this.toggle())
        );
    }

    #detectDevice() {
        // Prefer EC hardware toggle (ideapad_laptop touchpad_ctrl_via_ec=1)
        try {
            Process.exec(`test -f ${EC_TOUCHPAD_PATH}`);
            logger.info('touchpad', 'EC touchpad file found');
            this.#useEc = true;
            this.#available = true;
            return;
        } catch (e) {
            logger.warn('touchpad', 'EC detection failed:', e);
        }

        // Fall back to EVIOCGRAB via /proc/bus/input/devices
        try {
            const out = Process.exec('cat /proc/bus/input/devices');
            if (!out) return;

            const blocks = out.split('\n\n');
            for (const block of blocks) {
                if (!block.toLowerCase().includes('touchpad')) continue;
                const match = block.match(/H:\s*Handlers=.*?(event\d+)/);
                if (match) {
                    this.#eventPath = `/dev/input/${match[1]}`;
                    this.#available = true;
                    return;
                }
            }
        } catch (e) {
            logger.warn('touchpad', 'device detection failed:', e);
        }
    }

    #apply() {
        try {
            if (this.#useEc) {
                this.#applyEc();
            } else if (this.#eventPath) {
                this.#applyGrab();
            }
        } catch (e) {
            logger.error('touchpad', 'apply failed:', e);
        }
    }

    #applyEc() {
        const value = this.#enabled ? '1' : '0';
        logger.info(
            'touchpad',
            `applyEc: writing ${value} to ${EC_TOUCHPAD_PATH}`
        );
        try {
            // Sysfs files need direct write via /bin/sh -c, not GLib atomic file IO
            Process.exec(`/bin/sh -c 'echo ${value} > ${EC_TOUCHPAD_PATH}'`);
            logger.info('touchpad', `applyEc: wrote ${value}`);
        } catch (e) {
            logger.error('touchpad', 'applyEc failed:', e);
        }
    }

    #applyGrab() {
        if (!this.#eventPath) return;
        if (!this.#enabled) {
            // Disable: spawn grabber subprocess
            this.#stopProcess();
            const script = GRAB_SCRIPT.replace('__DEVICE__', this.#eventPath);
            this.#process = Process.subprocessv(['python3', '-c', script]);
        } else {
            // Enable: kill grabber subprocess
            this.#stopProcess();
        }
    }

    #stopProcess() {
        if (this.#process) {
            try {
                this.#process.kill();
            } catch {
                /* already dead */
            }
            this.#process = null;
        }
    }

    /** Register GAction command for touchpad toggle. */
    registerCommands(app: Gio.Application) {
        const action = Gio.SimpleAction.new('toggle-touchpad', null);
        action.connect('activate', () => this.toggle());
        app.add_action(action);
    }

    dispose() {
        this.#stopProcess();
    }
}
