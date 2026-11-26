/** Shell UI events — state notifications and command events. */
export interface ShellEvents {
    /** Notifications — emitted by ShellState when state changes */
    'shell:lockscreen': void;

    /** Commands — emitted by widgets for the shell state machine */
    'shell:lock': void;
    'shell:unlock': void;
    'shell:qs:close': void;
    'shell:launcher:close': void;
}
