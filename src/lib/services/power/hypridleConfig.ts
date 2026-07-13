import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '#/lib/core/logger';

const CONFIG_PATH = `${GLib.get_user_config_dir()}/hypr/hypridle.conf`;

export interface HypridleConfig {
    dimEnabled: boolean;
    dimTimeout: number;
    idleTimeout: number;
    dpmsEnabled: boolean;
    dpmsTimeout: number;
    suspendEnabled: boolean;
    suspendTimeout: number;
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
        '  after_sleep_cmd = hyprctl dispatch dpms on',
        '}',
    ];

    // Tier 1: dim screen before lock
    if (cfg.dimEnabled && cfg.dimTimeout < cfg.idleTimeout) {
        lines.push(
            '',
            'listener {',
            `  timeout = ${cfg.dimTimeout}`,
            "  on-timeout = sh -c 'brightnessctl get > /tmp/shade-brightness-resume && brightnessctl set 10%'",
            "  on-resume = sh -c '[ -f /tmp/shade-brightness-resume ] && brightnessctl set $(cat /tmp/shade-brightness-resume) && rm -f /tmp/shade-brightness-resume'",
            '}'
        );
    }

    // Tier 2: lock screen
    lines.push(
        '',
        'listener {',
        `  timeout = ${cfg.idleTimeout}`,
        '  on-timeout = shade-shell lockscreen',
        '}'
    );

    // Tier 3: turn off display (DPMS)
    if (cfg.dpmsEnabled && cfg.dpmsTimeout > cfg.idleTimeout) {
        lines.push(
            '',
            'listener {',
            `  timeout = ${cfg.dpmsTimeout}`,
            '  on-timeout = hyprctl dispatch dpms off',
            '  on-resume = hyprctl dispatch dpms on',
            '}'
        );
    }

    // Tier 4: suspend system
    if (cfg.suspendEnabled && cfg.suspendTimeout > cfg.dpmsTimeout) {
        lines.push(
            '',
            'listener {',
            `  timeout = ${cfg.suspendTimeout}`,
            '  on-timeout = systemctl suspend',
            '}'
        );
    }

    return lines;
}

/**
 * Write the hypridle.conf file to disk.
 */
export function writeHypridleConfig(cfg: HypridleConfig): void {
    try {
        const dir = Gio.File.new_for_path(`${GLib.get_user_config_dir()}/hypr`);
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }
        const lines = buildHypridleConfigLines(cfg);
        const config = lines.join('\n') + '\n';
        GLib.file_set_contents(CONFIG_PATH, new TextEncoder().encode(config));
    } catch (e) {
        logger.error('hypridle', 'failed to write config:', e);
    }
}

/**
 * Delete the hypridle.conf file from disk.
 */
export function deleteHypridleConfig(): void {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        if (file.query_exists(null)) {
            file.delete(null);
        }
    } catch (e) {
        logger.error('hypridle', 'failed to delete config file:', e);
    }
}