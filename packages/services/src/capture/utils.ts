import AstalWp from 'gi://AstalWp?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {bus} from '../bus';
import {RecorderBackend, RecordingFormat} from './types';

// ── Constants ─────────────────────────────────────────────────────

export const SCREENSHOT_DIR = `${GLib.get_home_dir()}/Pictures/Screenshots`;
export const RECORDING_DIR = `${GLib.get_home_dir()}/Videos`;

export const GRIM_BIN = Process.findBinary('grim');
export const MAGICK_BIN = Process.findBinary('magick');

// ── Directory helpers ─────────────────────────────────────────────

/**
 * Ensure SCREENSHOT_DIR exists. If it cannot be created, falls back to /tmp
 * and updates SCREENSHOT_DIR. Logs errors via logger.
 */
export function ensureScreenshotDir(): string {
    const dir = Gio.File.new_for_path(SCREENSHOT_DIR);
    try {
        if (dir.query_exists(null)) return SCREENSHOT_DIR;
        dir.make_directory_with_parents(null);
        logger.info('screenshot', `created screenshot directory: ${SCREENSHOT_DIR}`);
        return SCREENSHOT_DIR;
    } catch (e) {
        logger.error(
            'screenshot',
            `failed to create ${SCREENSHOT_DIR}: ${e instanceof Error ? e.message : String(e)}, falling back to /tmp`
        );
        return `${GLib.get_tmp_dir()}/shade-screenshots`;
    }
}

// ── Recording backend args builder ───────────────────────────────

export interface RecordingArgs {
    args: string[];
    backendName: string;
}

function resolveQualityWlScreenrec(quality: number): number {
    if (quality === 0) return 3;
    if (quality === 2) return 8;
    return 5;
}

function resolveQualityWfRecorder(quality: number): number {
    if (quality === 0) return 33;
    if (quality === 2) return 23;
    return 28;
}

function resolveAudioInputName(audioInputId: number): string | undefined {
    if (audioInputId === -1) return undefined;
    const wp = AstalWp.get_default();
    const mic = wp?.audio.get_microphone(audioInputId);
    return mic?.name ?? undefined;
}

const WL_SCREENREC = 'wl-screenrec';

function buildWlScreenrecArgs(
    filename: string,
    geometry: string | undefined,
    output: string | undefined,
    audio: boolean,
    isWebm: boolean,
    audioInputId: number,
    quality: number
): RecordingArgs {
    const args = [WL_SCREENREC, '-f', filename];
    if (geometry) args.push('-g', geometry);
    if (output) args.push('-o', output);
    if (audio) args.push('--audio');

    const micName = resolveAudioInputName(audioInputId);
    if (micName) args.push('--audio-device', micName);

    args.push('--quality', String(resolveQualityWlScreenrec(quality)));
    if (isWebm) args.push('--codec', 'vp9');

    return {args, backendName: WL_SCREENREC};
}

function buildWfRecorderArgs(
    filename: string,
    geometry: string | undefined,
    output: string | undefined,
    audio: boolean,
    isWebm: boolean,
    audioInputId: number,
    quality: number
): RecordingArgs {
    const args = ['wf-recorder', '-f', filename, '-y'];
    if (geometry) args.push('-g', geometry);
    if (output) args.push('-o', output);
    if (audio) {
        args.push('-a');
        if (isWebm) args.push('-C', 'libopus');
    }

    if (audioInputId !== -1) {
        args.push('--audio', `pipewire_node.restore.id=${audioInputId}`);
    }

    args.push('--codec-param', `crf=${resolveQualityWfRecorder(quality)}`);
    if (isWebm) args.push('-c', 'libvpx');

    return {args, backendName: 'wf-recorder'};
}

export function buildRecordingArgs(
    backend: RecorderBackend,
    filename: string,
    geometry: string | undefined,
    output: string | undefined,
    audio: boolean,
    format: RecordingFormat = RecordingFormat.MP4,
    audioInputId: number = -1,
    quality: number = 1
): RecordingArgs {
    const isWebm = format === RecordingFormat.WEBM;
    if (backend === RecorderBackend.WL_SCREENREC) {
        return buildWlScreenrecArgs(
            filename,
            geometry,
            output,
            audio,
            isWebm,
            audioInputId,
            quality
        );
    }
    return buildWfRecorderArgs(filename, geometry, output, audio, isWebm, audioInputId, quality);
}

// ── Backend resolution ───────────────────────────────────────────

export function resolveBackend(pref: RecorderBackend): RecorderBackend {
    if (pref === RecorderBackend.AUTO) {
        // Prefer wl-screenrec (GPU/vaapi) when installed; otherwise fall
        // back to wf-recorder. wl-screenrec also gets a runtime fallback
        // in the exit handler if it dies fast (e.g. no vaapi on NVIDIA).
        return Process.findBinary(WL_SCREENREC) !== WL_SCREENREC
            ? RecorderBackend.WL_SCREENREC
            : RecorderBackend.WF_RECORDER;
    }
    return pref;
}

// ─── Duration formatting ─────────────────────────────────────────

export function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

// ── Notify helper ────────────────────────────────────────────────

export function notify(title: string, body: string, icon: string = 'dialog-information-symbolic') {
    // Use execAsyncv to avoid GLib.shell_parse_argv quoting issues
    // when title or body contain special characters.
    Process.execAsyncv(['notify-send', '-a', 'shade-shell', '-i', icon, title, body]).catch((e) =>
        logger.warn('screenshot', 'notify-send failed:', e)
    );
}

// ── Post-capture pipeline ──────────────────────────────────────

/** A fresh timestamped filename inside the screenshot directory. */
export function freshScreenshotFilename(ext = 'png'): string {
    const dir = ensureScreenshotDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${dir}/${timestamp}.${ext}`;
}

/**
 * The single post-capture pipeline every screenshot path funnels through:
 * clipboard copy, notification, and the sound-alert bus event.
 */
export function finalizeImage(filename: string, area: boolean): void {
    copyImageToClipboard(filename);
    notify('Screenshot saved', filename, 'camera-photo-symbolic');
    if (area) {
        bus.emit('capture:screenshot:area');
    } else {
        bus.emit('capture:screenshot', true);
    }
}

/** Shared failure notification for capture paths. */
export function notifyCaptureFailed(detail: string): void {
    notify('Screenshot failed', detail, 'dialog-error-symbolic');
}

// ── Image clipboard copy ─────────────────────────────────────────

/**
 * Copy an image file to the system clipboard using wl-copy (Wayland).
 * Falls back to a Gdk-based approach if wl-copy is unavailable.
 *
 * Uses Gio.Subprocess with stdin pipe instead of shell redirect
 * because GLib.shell_parse_argv does not handle shell operators like <.
 */
export function copyImageToClipboard(filename: string): void {
    try {
        const wlCopy = Process.findBinary('wl-copy');
        if (wlCopy !== 'wl-copy') {
            const file = Gio.File.new_for_path(filename);
            const [ok, contents] = file.load_contents(null);
            if (ok && contents) {
                const proc = Gio.Subprocess.new(
                    [wlCopy, '--type', 'image/png'],
                    Gio.SubprocessFlags.STDIN_PIPE
                );
                const stdin = proc.get_stdin_pipe();
                if (stdin) {
                    stdin.write_all(contents, null);
                    stdin.close(null);
                }
                proc.wait(null);
            }
            logger.debug('screenshot', `copied to clipboard via wl-copy: ${filename}`);
            return;
        }
    } catch (e) {
        logger.warn(
            'screenshot',
            `wl-copy clipboard failed: ${e instanceof Error ? e.message : String(e)}`
        );
    }

    try {
        // Fallback: use Gdk clipboard
        const display = Gdk.Display.get_default();
        if (!display) {
            logger.warn('screenshot', 'no display for clipboard copy');
            return;
        }
        const texture = Gdk.Texture.new_from_filename(filename);
        const clipboard = display.get_clipboard();
        const bytes = texture.save_to_png_bytes();
        const provider = Gdk.ContentProvider.new_for_bytes('image/png', bytes);
        clipboard.set_content(provider);
        logger.debug('screenshot', `copied to clipboard via Gdk: ${filename}`);
    } catch (e) {
        logger.warn(
            'screenshot',
            `clipboard copy failed: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}
