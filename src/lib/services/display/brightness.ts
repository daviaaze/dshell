import {Process} from '#/lib/process';
import {readFile, monitorFile} from '#/lib/file';
import GLib from 'gi://GLib?version=2.0';
import {register, Object, getter, setter} from 'gnim/gobject';
import logger from '#/lib/logger';

@register({GTypeName: 'Brightness'})
export default class Brightness extends Object {
    static instance: Brightness;
    static get_default() {
        if (!this.instance) this.instance = new Brightness();
        return this.instance;
    }

    #screenName = '';
    #kbdName = '';
    #kbdMax = 0;
    #kbd = 0;
    #screenMax = 0;
    #screen = 0;
    #screenMonitor: any = null;
    #kbdMonitor: any = null;
    #ready = false;

    @getter(Number)
    get kbd() {
        return this.#kbd;
    }

    @setter(Number)
    set kbd(value: number) {
        if (!this.#kbdName || value < 0 || value > this.#kbdMax) return;

        Process.execAsync(
            `brightnessctl -d ${this.#kbdName} s ${Math.floor(value * 100)}% -q`
        )
            .then(() => {
                this.#kbd = value / (this.#kbdMax || 1);
                this.notify('kbd');
            })
            .catch(e => logger.error('hw', 'failed to set kbd brightness:', e));
    }

    @getter(Number)
    get screen() {
        return this.#screen;
    }

    @setter(Number)
    set screen(percent: number) {
        if (!this.#screenName) return;
        if (percent < 0) percent = 0;
        if (percent > 1) percent = 1;

        Process.execAsync(`brightnessctl set ${Math.floor(percent * 100)}% -q`)
            .then(() => {
                this.#screen = percent;
                this.notify('screen');
            })
            .catch(e =>
                logger.error('hw', 'failed to set screen brightness:', e)
            );
    }

    constructor() {
        super();
        // Defer all blocking hardware probes to avoid freezing the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#init();
            return GLib.SOURCE_REMOVE;
        });
    }

    #init() {
        try {
            this.#screenName = Process.exec(
                `bash -c "ls -w1 /sys/class/backlight | head -1"`
            );
        } catch {
            /* no screen backlight */
        }
        try {
            this.#kbdName = Process.exec(
                `bash -c "ls -w1 /sys/class/leds | head -1"`
            );
        } catch {
            /* no keyboard backlight */
        }

        if (this.#screenName) {
            try {
                this.#screenMax = Number(Process.exec('brightnessctl max'));
                this.#screen =
                    Number(Process.exec('brightnessctl get')) /
                    (this.#screenMax || 1);
                this.notify('screen');
            } catch (e) {
                logger.error('hw', 'failed to read screen brightness:', e);
            }
        }

        if (this.#kbdName) {
            try {
                this.#kbdMax = Number(
                    Process.exec(`brightnessctl --device ${this.#kbdName} max`)
                );
                this.#kbd =
                    Number(
                        Process.exec(
                            `brightnessctl --device ${this.#kbdName} get`
                        )
                    ) / (this.#kbdMax || 1);
                this.notify('kbd');
            } catch (e) {
                logger.error('hw', 'failed to read kbd brightness:', e);
            }
        }

        // Set up file monitors for real-time brightness updates
        if (this.#screenName) {
            const screenPath = `/sys/class/backlight/${this.#screenName}/brightness`;
            this.#screenMonitor = monitorFile(
                screenPath,
                (f: string, _event: unknown) => {
                    try {
                        const v = readFile(f);
                        this.#screen = Number(v) / this.#screenMax;
                        this.notify('screen');
                    } catch (e: any) {
                        logger.error(
                            'hw',
                            'failed to read screen brightness:',
                            e
                        );
                    }
                }
            );
        }

        if (this.#kbdName) {
            const kbdPath = `/sys/class/leds/${this.#kbdName}/brightness`;
            this.#kbdMonitor = monitorFile(
                kbdPath,
                (f: string, _event: unknown) => {
                    try {
                        const v = readFile(f);
                        this.#kbd = Number(v) / this.#kbdMax;
                        this.notify('kbd');
                    } catch (e: any) {
                        logger.error('hw', 'failed to read kbd brightness:', e);
                    }
                }
            );
        }

        this.#ready = true;
    }
}
