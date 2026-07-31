/** Shell UI events — state notifications and command events. */
export interface ShellEvents {
    /** Notifications — emitted by ShellState when state changes */
    'shell:lockscreen': void;
    'shell:launcher:toggle': void;
    'shell:qs:toggle': void;
    'shell:bar:toggle': void;
    'shell:windowswitcher:toggle': void;

    /** Commands — emitted by widgets for the shell state machine */
    'shell:lock': void;
    'shell:unlock': void;
    'shell:qs:close': void;

    /** Commands — delegate to widget actions */
    'shell:clipboard:toggle': void;
    'shell:clipboard:open': void;
    'shell:settings:open': void;
}
