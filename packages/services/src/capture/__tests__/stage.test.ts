import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Process} from '@shade/core/process';
import {bus} from '../../bus';
import ShellState from '../../state/shellState';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import Screenshot from '../screenshot';
import {Stage} from '../stage';

const PNG = Gdk.MemoryTexture.new(
    1,
    1,
    Gdk.MemoryFormat.R8G8B8A8,
    new GLib.Bytes(new Uint8Array([255, 0, 0, 255])),
    4
)
    .save_to_png_bytes()
    .toArray();

function parentDirectory(path: string): Gio.File {
    const directory = Gio.File.new_for_path(path).get_parent();
    if (!directory) throw new Error(`No parent directory for ${path}`);
    return directory;
}

function writeFrame(path: string, bytes = PNG): void {
    Gio.File.new_for_path(path).replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        null
    );
}

async function drainCapture(): Promise<void> {
    for (let turn = 0; turn < 6; turn++) await Promise.resolve();
}

describe('Private screenshot stage', () => {
    it.async(
        'keeps the stage in a private runtime directory and deletes it on cleanup',
        async () => {
            const original = Process.execAsyncv;
            const state = ShellState.get_default();
            const wasLocked = state.screenlocked;
            const stage = new Stage(() => {});
            let path = '';
            Process.execAsyncv = async (argv, _silence, limits) => {
                path = argv[argv.length - 1];
                expect(limits?.timeoutMs).toBe(5_000);
                writeFrame(path);
                return '';
            };
            try {
                state.screenlocked = false;
                expect(await stage.capture()).toBe(true);
                expect(stage.pixPath).toBe(path);
                const directory = parentDirectory(path);
                expect(directory.get_path()?.startsWith(`${GLib.get_user_runtime_dir()}/`)).toBe(
                    true
                );
                const mode = directory.query_info(
                    'unix::mode',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    null
                );
                expect(mode.get_attribute_uint32('unix::mode') & 0o777).toBe(0o700);
                const fileMode = Gio.File.new_for_path(path).query_info(
                    'unix::mode',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                expect(fileMode.get_attribute_uint32('unix::mode') & 0o777).toBe(0o600);
                stage.cleanup();
                expect(Gio.File.new_for_path(path).query_exists(null)).toBe(false);
                expect(directory.query_exists(null)).toBe(false);
                expect(stage.texture).toBeNull();
            } finally {
                stage.cleanup();
                state.screenlocked = wasLocked;
                Process.execAsyncv = original;
            }
        }
    );

    it.async('deletes undecodable captures rather than leaving a full desktop behind', async () => {
        const original = Process.execAsyncv;
        const state = ShellState.get_default();
        const wasLocked = state.screenlocked;
        const stage = new Stage(() => {});
        let path = '';
        Process.execAsyncv = async (argv) => {
            path = argv[argv.length - 1];
            writeFrame(path, new TextEncoder().encode('not an image'));
            return '';
        };
        try {
            state.screenlocked = false;
            expect(await stage.capture()).toBe(false);
            expect(stage.pixPath).toBeNull();
            expect(Gio.File.new_for_path(path).query_exists(null)).toBe(false);
            expect(parentDirectory(path).query_exists(null)).toBe(false);
        } finally {
            stage.cleanup();
            state.screenlocked = wasLocked;
            Process.execAsyncv = original;
        }
    });

    it.async('cancels an in-flight capture without publishing its frame', async () => {
        const original = Process.execAsyncv;
        const state = ShellState.get_default();
        const wasLocked = state.screenlocked;
        const stage = new Stage(() => {});
        const pending = Promise.withResolvers<string>();
        let path = '';
        let cancellation: Gio.Cancellable | undefined;
        Process.execAsyncv = (argv, _silence, limits) => {
            path = argv[argv.length - 1];
            cancellation = limits?.cancellable;
            writeFrame(path);
            return pending.promise;
        };
        try {
            state.screenlocked = false;
            const capture = stage.capture();
            stage.cleanup();
            expect(cancellation?.is_cancelled()).toBe(true);
            pending.resolve('');
            expect(await capture).toBe(false);
            expect(stage.pixPath).toBeNull();
            expect(parentDirectory(path).query_exists(null)).toBe(false);
        } finally {
            pending.resolve('');
            stage.cleanup();
            state.screenlocked = wasLocked;
            Process.execAsyncv = original;
        }
    });
});

describe('Overlay completion event', () => {
    it.async(
        'emits only after a successful open, not on duplicate opens, closes or failed captures',
        async () => {
            const original = Process.execAsyncv;
            const state = ShellState.get_default();
            const wasLocked = state.screenlocked;
            const screenshot = new Screenshot();
            let validFrame = true;
            let opened = 0;
            const unsubscribe = bus.on('capture:screenshot:overlay', () => opened++);
            Process.execAsyncv = async (argv) => {
                writeFrame(argv[argv.length - 1], validFrame ? PNG : new Uint8Array());
                return '';
            };
            try {
                state.screenlocked = false;
                screenshot.overlayOpen = true;
                expect(screenshot.overlayOpen).toBe(false);
                expect(opened).toBe(0);
                await drainCapture();
                expect(screenshot.overlayOpen).toBe(true);
                expect(opened).toBe(1);
                screenshot.overlayOpen = true;
                screenshot.hideOverlay();
                expect(opened).toBe(1);
                validFrame = false;
                screenshot.showOverlay();
                await drainCapture();
                expect(screenshot.overlayOpen).toBe(false);
                expect(opened).toBe(1);
            } finally {
                unsubscribe();
                screenshot.dispose();
                state.screenlocked = wasLocked;
                Process.execAsyncv = original;
            }
        }
    );
});

await run(import.meta.url);
