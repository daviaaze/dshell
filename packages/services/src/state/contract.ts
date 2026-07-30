/** Shell UI events — emitted by the shell state machine, listened to by widgets. */
export interface ShellEvents {
    'shell:launcher:toggle': void;
    'shell:qs:toggle': void;
    'shell:bar:toggle': void;
    'shell:clipboard:toggle': void;
    'shell:clipboard:open': void;
    'shell:lockscreen': void;
    'shell:settings:open': void;
    'shell:windowswitcher:toggle': void;
}
