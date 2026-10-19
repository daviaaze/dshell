/**
 * shade-shell — Share Picker for XDPH
 *
 * Live-ish screen preview picker for xdg-desktop-portal-hyprland.
 * Polls grim every ~200ms per monitor for live thumbnails.
 * Captures window snapshots via grim -g on tab switch.
 *
 * Protocol:
 *   Env: XDPH_WINDOW_SHARING_LIST = "ID[HC>]CLASS[HT>]TITLE[HE>]..."
 *   Args: --allow-token
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {programArgs} from 'system';
import './picker.css'; // auto-loaded as CssProvider by gnim dev/bundle
import logger from '@shade/core/logger';
import printOut from '@shade/core/stdout';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {initSettingsRoot} from '@shade/core/settingsRegistry';
import {ColorScheme} from '@shade/services/display/colorScheme';
import {Theme} from '@shade/style/theme';
import {captureMonitor, captureWindow, cleanTempDir, ensureTempDir, GRIM_BIN} from './capture';
import {MonitorPoller} from './poller';
import {HYPRCTL_BIN, parseWindowList} from './protocol';
import {buildSources} from './sources';
import type {MonitorState, ParsedWindowList, PreviewHandle, SelectFn, WindowState} from './types';
import {buildCombinedTab, buildScreensTab, buildWindowsTab, type CombinedTab, type Tab} from './ui';

const CAT = 'share-picker';
const APP_ID = 'com.caioasmuniz.shade_shell.share_picker';

/** Mutable holder so the token checkbox and the select fn share state. */
interface TokenState {
    value: boolean;
}

interface PickerUi {
    win: Gtk.Window;
    notebook: Gtk.Notebook;
    screensTab: Tab;
    windowsTab: Tab;
    combinedTab: CombinedTab;
}

function makeSelectFn(app: Gtk.Application, token: TokenState): SelectFn {
    return (kind, id) => {
        try {
            printOut(`[SELECTION]${token.value ? 'r' : ''}/${kind}:${id}`);
        } catch (e) {
            logger.error(CAT, `select: print failed for ${kind}:${id}`, e);
        }
        try {
            app.quit();
        } catch (e) {
            logger.error(CAT, 'select: app.quit failed', e);
        }
    };
}

function logSources(monitors: MonitorState[], windows: WindowState[]): void {
    logger.info(CAT, `${monitors.length} monitors loaded, ${windows.length} windows loaded`);
    for (const m of monitors) {
        logger.info(
            CAT,
            `  monitor: ${m.info.name} ${m.info.width}x${m.info.height} @ (${m.info.x},${m.info.y})`
        );
    }
    for (const w of windows) {
        const geo = w.geometry ? `${w.geometry.width}x${w.geometry.height}` : 'none';
        logger.info(CAT, `  window: ${w.info.clazz} geo=${geo}`);
    }
}

function buildPicker(
    app: Gtk.Application,
    token: TokenState,
    select: SelectFn,
    monitors: MonitorState[],
    windows: WindowState[],
    windowListProvided: boolean
): PickerUi {
    const win = new Gtk.Window({
        application: app,
        title: 'Share Screen / Window',
        defaultWidth: 720,
        defaultHeight: 520,
        resizable: true,
        decorated: false,
        hideOnClose: false,
        cssClasses: ['picker-popup', 'background'],
    });

    const mainBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        marginTop: 12,
        marginBottom: 12,
        marginStart: 12,
        marginEnd: 12,
    });

    mainBox.append(
        new Gtk.Label({
            label: 'Select what to share',
            cssClasses: ['title-2'],
            halign: Gtk.Align.START,
        })
    );

    const notebook = new Gtk.Notebook();
    notebook.set_scrollable(true);

    const screensTab = buildScreensTab(monitors, select);
    notebook.append_page(screensTab.page, new Gtk.Label({label: 'Screens'}));

    const windowsTab = buildWindowsTab(windows, select, windowListProvided);
    notebook.append_page(windowsTab.page, new Gtk.Label({label: 'Windows'}));

    const combinedTab = buildCombinedTab(monitors, windows, select, windowListProvided);
    notebook.append_page(combinedTab.page, new Gtk.Label({label: 'All'}));

    mainBox.append(notebook);

    // ── Token restore checkbox ──────────────────────────
    const tokenBox = new Gtk.CheckButton({
        label: 'Allow restore token',
        active: token.value,
    });
    tokenBox.connect('toggled', () => {
        token.value = tokenBox.active;
    });
    mainBox.append(tokenBox);

    // ── Cancel ──────────────────────────────────────────
    const cancelBtn = new Gtk.Button({
        label: 'Cancel',
        halign: Gtk.Align.CENTER,
    });
    cancelBtn.connect('clicked', () => app.quit());
    mainBox.append(cancelBtn);

    GObject.signal_connect(win, 'close-request', () => app.quit());
    win.set_child(mainBox);

    return {win, notebook, screensTab, windowsTab, combinedTab};
}

function setupCapture(ui: PickerUi, monitors: MonitorState[], windows: WindowState[]): () => void {
    const {screensTab, windowsTab, combinedTab, notebook} = ui;
    const monitorTargets = monitors.map((_, index) =>
        [screensTab.previews[index], combinedTab.monitorPreviews[index]]
            .filter((handle): handle is PreviewHandle => handle !== undefined));
    const windowTargets = windows.map((_, index) =>
        [windowsTab.previews[index], combinedTab.windowPreviews[index]]
            .filter((handle): handle is PreviewHandle => handle !== undefined));
    const poller = new MonitorPoller(monitors, monitorTargets);
    const switched = notebook.connect('switch-page', (_notebook, _page, pageNum: number) => {
        poller.stop();
        if (pageNum === 0) {
            poller.start();
        } else {
            if (pageNum === 2) {
                monitors.forEach((state, index) => captureMonitor(state, monitorTargets[index]));
            }
            windows.forEach((state, index) => captureWindow(state, windowTargets[index]));
        }
    });
    monitors.forEach((state, index) => captureMonitor(state, monitorTargets[index]));
    poller.start();
    return () => {
        poller.stop();
        if (GObject.signal_handler_is_connected(notebook, switched)) notebook.disconnect(switched);
        for (const targets of [...monitorTargets, ...windowTargets]) {
            for (const handle of targets) handle.dispose();
        }
    };
}

function onActivate(
    app: Gtk.Application,
    token: TokenState,
    select: SelectFn,
    windowList: ParsedWindowList
): () => void {
    Adw.init();
    initSettingsRoot();
    ColorScheme.get_default().init(generalSettings());
    Theme.get_default();
    ensureTempDir();

    logger.debug(
        CAT,
        'XDPH_WINDOW_SHARING_LIST=' + (GLib.getenv('XDPH_WINDOW_SHARING_LIST') || '(null)')
    );
    logger.debug(CAT, `GRIM_BIN=${GRIM_BIN}, HYPRCTL_BIN=${HYPRCTL_BIN}`);
    if (!GRIM_BIN.includes('/')) logger.warn(CAT, 'grim not found in PATH, previews unavailable');
    if (!HYPRCTL_BIN.includes('/'))
        logger.warn(CAT, 'hyprctl not found in PATH, monitors/windows will be empty');

    const {monitors, windows} = buildSources(windowList.windows);
    logSources(monitors, windows);

    const ui = buildPicker(app, token, select, monitors, windows, windowList.provided);
    ui.win.present();
    return setupCapture(ui, monitors, windows);
}

function main() {
    const allowTokenDefault = programArgs.includes('--allow-token');
    const xdphWindows = parseWindowList(GLib.getenv('XDPH_WINDOW_SHARING_LIST'));

    const app = new Gtk.Application({applicationId: APP_ID, flags: 0});
    const token: TokenState = {value: allowTokenDefault};
    const select = makeSelectFn(app, token);

    let disposeCapture: (() => void) | null = null;
    app.connect('activate', () => {
        if (disposeCapture) {
            app.get_active_window()?.present();
            return;
        }
        disposeCapture = onActivate(app, token, select, xdphWindows);
    });
    app.connect('shutdown', () => {
        disposeCapture?.();
        disposeCapture = null;
        ColorScheme.get_default().dispose();
        cleanTempDir();
    });

    app.run([]);
}

main();
