import Gio from 'gi://Gio?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register, signal} from 'gnim/gobject';
import {bus} from '../bus';
import OsdTimer from '../utils/osdTimer';

logger.info('touchpad', 'module loaded');

const EC_TOUCHPAD_PATH = '/sys/bus/platform/devices/VPC2004:00/touchpad';

// EVIOCGRAB only: no input events are read or collected by this child.
// Both parent-death signalling and stdin EOF release the grab after a crash.
const GRAB_SCRIPT = `
import ctypes, fcntl, os, signal, sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_PDEATHSIG")
if os.getppid() != int(sys.argv[2]):
    sys.exit(0)
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_CLOEXEC)
try:
    fcntl.ioctl(fd, 0x40044590, 1)
    sys.stdin.buffer.read()
finally:
    os.close(fd)
`;

@register
export default class Touchpad extends Object {
    private static instance: Touchpad;
    static get_default() {
        if (!Touchpad.instance) Touchpad.instance = new Touchpad();
        return Touchpad.instance;
    }

    #enabled = true;
    #available = false;
    #useEc = false;
    #eventPath: string | null = null;
    #process: Process | null = null;
    #initialized = false;
    #busSubscriptions: (() => void)[] = [];

    // ── OSD state (owned here so osd/bar/quicksettings share one source) ──

    #osd = new OsdTimer(() => this.notify('osd-visible'));

    /** True while the touchpad toggle OSD should be revealed. */
    @property
    get osdVisible(): boolean {
        return this.#osd.visible;
    }

    @property
    get enabled() {
        return this.#enabled;
    }

    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        const previous = this.#enabled;
        this.#enabled = v;
        try {
            this.#apply();
        } catch (error) {
            this.#enabled = previous;
            logger.error('touchpad', 'apply failed:', error);
        }
        if (this.#enabled === previous) return;
        this.notify('enabled');
        this.toggled(this.#enabled);
        this.#osd.trigger();
    }

    @property
    get available() {
        return this.#available;
    }

    @signal
    toggled(_enabled: boolean): void {}

    toggle() {
        logger.info('touchpad', `toggle() called, current enabled=${this.#enabled}`);
        this.enabled = !this.#enabled;
        logger.info('touchpad', `toggle() done, new enabled=${this.#enabled}`);
    }

    init() {
        if (this.#initialized) {
            logger.warn('touchpad', 'init() called but already initialized — skipping');
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
        try {
            this.#apply();
        } catch (error) {
            logger.error('touchpad', 'could not apply initial touchpad state:', error);
        }
        const mode = this.#useEc ? 'EC hardware toggle' : 'EVIOCGRAB fallback';
        logger.info('touchpad', `initialized, mode=${mode}, enabled=${this.#enabled}`);

        // Listen for toggle commands from widgets via the bus
        this.#busSubscriptions.push(bus.on('input:touchpad:toggle', () => this.toggle()));
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
        if (this.#useEc) {
            this.#applyEc();
        } else if (this.#eventPath) {
            this.#applyGrab();
        }
    }

    #applyEc() {
        const value = this.#enabled ? '1' : '0';
        logger.info('touchpad', `applyEc: writing ${value} to ${EC_TOUCHPAD_PATH}`);
        // Sysfs files need direct write via /bin/sh -c, not GLib atomic file IO.
        Process.exec(`/bin/sh -c 'echo ${value} > ${EC_TOUCHPAD_PATH}'`);
        logger.info('touchpad', `applyEc: wrote ${value}`);
    }

    #applyGrab() {
        if (!this.#eventPath) return;
        if (!this.#enabled) {
            // Disable: spawn grabber subprocess
            this.#stopProcess();
            const process = Process.subprocessv([
                'python3',
                '-c',
                GRAB_SCRIPT,
                this.#eventPath,
                String(new Gio.Credentials().get_unix_pid()),
            ]);
            this.#process = process;
            process.connect('exit', (_process, code, signaled) => {
                if (this.#process !== process) return;
                this.#process = null;
                logger.warn(
                    'touchpad',
                    `grabber exited (${signaled ? 'signal' : 'status'} ${code}); touchpad enabled`
                );
                if (this.#enabled) return;
                this.#enabled = true;
                this.notify('enabled');
                this.toggled(true);
                this.#osd.trigger();
            });
        } else {
            // Enable: kill grabber subprocess
            this.#stopProcess();
        }
    }

    #stopProcess() {
        const process = this.#process;
        this.#process = null;
        if (process) {
            try {
                process.kill();
            } catch {
                /* already dead */
            }
        }
    }

    /** Register GAction command for touchpad toggle. */
    registerCommands(app: Gio.Application) {
        const action = Gio.SimpleAction.new('toggle-touchpad', null);
        action.connect('activate', () => this.toggle());
        app.add_action(action);
    }

    dispose() {
        for (const unsubscribe of this.#busSubscriptions) unsubscribe();
        this.#busSubscriptions = [];
        this.#initialized = false;
        this.#stopProcess();
        if (!this.#enabled && !this.#useEc) {
            this.#enabled = true;
            this.notify('enabled');
        }
        this.#osd.dispose();
    }
}

defineService({name: 'Touchpad', service: Touchpad.get_default(), critical: false});
