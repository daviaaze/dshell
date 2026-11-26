import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'shade']);
/**
 * Shade-owned config, handed to hypridle with `-c`. The user's own
 * `~/.config/hypr/hypridle.conf` is never read, written or deleted.
 */
export const HYPRIDLE_CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'hypridle.conf']);

/** Brightness saved before dimming, so it can be restored after resume or a hypridle restart. */
const BRIGHTNESS_RESUME_PATH = GLib.build_filenamev([
    GLib.get_user_runtime_dir(),
    'shade-brightness-resume',
]);
const BRIGHTNESS_RESUME_SHELL = '"$XDG_RUNTIME_DIR/shade-brightness-resume"';
const LISTENER_OPEN = 'listener {';

export interface IdleTimeouts {
    idleTimeout: number;
    dimTimeout: number;
    dpmsTimeout: number;
    suspendTimeout: number;
}

export interface HypridleConfig extends IdleTimeouts {
    dimEnabled: boolean;
    dpmsEnabled: boolean;
    suspendEnabled: boolean;
}

const MIN_DIM = 30;
const MIN_IDLE = 60;
const MAX_IDLE = 1800;
const MAX_DPMS = 3600;
const MAX_SUSPEND = 7200;
const TIER_GAP = 10;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Enforce `dim < idle < dpms < suspend` in one ordered pass, each tier
 * bounded by the already-normalised tier below it:
 * `60 ≤ idle ≤ 1800`, `30 ≤ dim ≤ idle−10`, `idle+10 ≤ dpms ≤ 3600`,
 * `dpms+10 ≤ suspend ≤ 7200`.
 */
export function normaliseTimeouts(raw: IdleTimeouts): IdleTimeouts {
    const idleTimeout = clamp(raw.idleTimeout, MIN_IDLE, MAX_IDLE);
    const dimTimeout = clamp(raw.dimTimeout, MIN_DIM, idleTimeout - TIER_GAP);
    const dpmsTimeout = clamp(raw.dpmsTimeout, idleTimeout + TIER_GAP, MAX_DPMS);
    const suspendTimeout = clamp(raw.suspendTimeout, dpmsTimeout + TIER_GAP, MAX_SUSPEND);
    return {idleTimeout, dimTimeout, dpmsTimeout, suspendTimeout};
}

/**
 * Build the hypridle.conf content as an array of lines.
 * Tiered approach: dim → lock → DPMS → suspend.
 */
export function buildHypridleConfigLines(cfg: HypridleConfig): string[] {
    const lines = [
        'general {',
        '  lock_cmd = shade-shell lockscreen',
        '  before_sleep_cmd = shade-shell lockscreen',
        '  after_sleep_cmd = shade-shell compositor dpms on',
        '  ignore_dbus_inhibit = false',
        '}',
    ];

    // Tier 1: dim screen before lock. An existing resume file is kept: it holds
    // the real brightness when a previous dim was never resumed.
    if (cfg.dimEnabled && cfg.dimTimeout < cfg.idleTimeout) {
        lines.push(
            '',
            LISTENER_OPEN,
            `  timeout = ${cfg.dimTimeout}`,
            `  on-timeout = sh -c '[ -f ${BRIGHTNESS_RESUME_SHELL} ] || brightnessctl get > ${BRIGHTNESS_RESUME_SHELL}; brightnessctl set 10%'`,
            `  on-resume = sh -c '[ -f ${BRIGHTNESS_RESUME_SHELL} ] && brightnessctl set "$(cat ${BRIGHTNESS_RESUME_SHELL})" && rm -f ${BRIGHTNESS_RESUME_SHELL}'`,
            '}'
        );
    }

    // Tier 2: lock screen
    lines.push(
        '',
        LISTENER_OPEN,
        `  timeout = ${cfg.idleTimeout}`,
        '  on-timeout = shade-shell lockscreen',
        '}'
    );

    // Tier 3: turn off display (DPMS)
    if (cfg.dpmsEnabled && cfg.dpmsTimeout > cfg.idleTimeout) {
        lines.push(
            '',
            LISTENER_OPEN,
            `  timeout = ${cfg.dpmsTimeout}`,
            '  on-timeout = shade-shell compositor dpms off',
            '  on-resume = shade-shell compositor dpms on',
            '}'
        );
    }

    // Tier 4: suspend system
    if (cfg.suspendEnabled && cfg.suspendTimeout > cfg.dpmsTimeout) {
        lines.push(
            '',
            LISTENER_OPEN,
            `  timeout = ${cfg.suspendTimeout}`,
            '  on-timeout = systemctl suspend',
            '}'
        );
    }

    return lines;
}

/**
 * Write Shade's hypridle config to disk.
 */
export function writeHypridleConfig(cfg: HypridleConfig): void {
    try {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        const config = `${buildHypridleConfigLines(cfg).join('\n')}\n`;
        GLib.file_set_contents(HYPRIDLE_CONFIG_PATH, new TextEncoder().encode(config));
    } catch (e) {
        logger.error('hypridle', 'failed to write config:', e);
    }
}

/**
 * Delete Shade's own hypridle config from disk.
 */
export function deleteHypridleConfig(): void {
    try {
        const file = Gio.File.new_for_path(HYPRIDLE_CONFIG_PATH);
        if (file.query_exists(null)) {
            file.delete(null);
        }
    } catch (e) {
        logger.error('hypridle', 'failed to delete config file:', e);
    }
}

/**
 * Put the brightness saved by the dim listener back. hypridle forgets its
 * idle state when it is restarted, so a restart while dimmed would otherwise
 * leave the screen at 10% with no resume event coming.
 */
export function restoreDimmedBrightness(): void {
    try {
        const file = Gio.File.new_for_path(BRIGHTNESS_RESUME_PATH);
        if (!file.query_exists(null)) return;
        const [, bytes] = file.load_contents(null);
        const saved = new TextDecoder().decode(bytes).trim();
        file.delete(null);
        if (!/^\d+$/.test(saved)) return;
        Process.execAsyncv(['brightnessctl', 'set', saved], true).catch((e) =>
            logger.warn('hypridle', 'failed to restore brightness:', e)
        );
    } catch (e) {
        logger.warn('hypridle', 'failed to restore brightness:', e);
    }
}
