/**
 * Power Events — inhibit (keep awake), power profiles, battery conservation.
 *
 * Commands emitted by widgets and consumed by the respective services.
 */
export interface PowerEvents {
    'power:inhibit:set-duration': number;
    'power:inhibit:set-idle': boolean;
    'power:profile:set': 'power-saver' | 'balanced' | 'performance';
    'power:conservation:toggle': void;

    // ── Session control commands ──
    'power:cmd:logout': void;
    'power:cmd:suspend': void;
    'power:cmd:reboot': void;
    'power:cmd:poweroff': void;
}
