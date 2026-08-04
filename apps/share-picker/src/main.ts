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

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {programArgs} from 'system';
import './picker.css'; // auto-loaded as CssProvider by gnim dev/bundle
import logger from '@shade/core/logger';
import printOut from '@shade/core/stdout';
import {
    captureMonitorSync,
    captureWindow,
    cleanTempDir,
    ensureTempDir,
    GRIM_BIN,
    loadTexture,
    monPath,
    runCapture,
    windowAddr,
    winPath,
} from './capture';
import {MonitorPoller} from './poller';
import {HYPRCTL_BIN, parseWindowList} from './protocol';
import {buildSources} from './sources';
import type {MonitorState, SelectFn, WindowState, XDPHWindow} from './types';
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
    windows: WindowState[]
): PickerUi {
    const win = new Gtk.Window({
        application: app,
        title: 'Share Screen / Window',
        defaultWidth: 720,
        defaultHeight: 520,
        resizable: true,
        decorated: false,
        hideOnClose: false,
        cssClasses: ['picker-popup'],
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

    const windowsTab = buildWindowsTab(windows, select);
    notebook.append_page(windowsTab.page, new Gtk.Label({label: 'Windows'}));

    const combinedTab = buildCombinedTab(monitors, windows, select);
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

function captureAllWindows(windows: WindowState[], screens: Tab, combined: CombinedTab): void {
    windows.forEach((state, i) => {
        if (!state.geometry) return;
        const pic = screens.pics[i];
        if (pic) captureWindow(state, [pic]);
        // Also fill combined tab from the previous capture file
        const combinedPic = combined.windowPics[i];
        if (combinedPic) loadTexture(winPath(windowAddr(state)), combinedPic);
    });
}

function captureCombinedOnce(
    monitors: MonitorState[],
    windows: WindowState[],
    combined: CombinedTab
): void {
    monitors.forEach((state, i) => {
        const pic = combined.monitorPics[i];
        if (!pic) return;
        const path = monPath(state.info.name);
        runCapture([GRIM_BIN, '-s', '0.25', '-o', state.info.name, path], (ok) => {
            if (ok) loadTexture(path, pic);
        });
    });
    windows.forEach((state, i) => {
        const pic = combined.windowPics[i];
        const g = state.geometry;
        if (!pic || !g) return;
        const path = winPath(windowAddr(state));
        runCapture(
            [GRIM_BIN, '-s', '0.25', '-g', `${g.x},${g.y} ${g.width}x${g.height}`, path],
            (ok) => {
                if (ok) loadTexture(path, pic);
            }
        );
    });
}

function setupCapture(ui: PickerUi, monitors: MonitorState[], windows: WindowState[]) {
    const {screensTab, windowsTab, combinedTab, notebook} = ui;

    // Live polling on the Screens tab; each tick also refreshes the
    // combined-tab picture from the *previous* capture file.
    const poller = new MonitorPoller(monitors, screensTab.pics, (state, i) => {
        const pic = combinedTab.monitorPics[i];
        if (pic) loadTexture(monPath(state.info.name), pic);
    });

    notebook.connect('switch-page', (_nb, _page, pageNum: number) => {
        poller.stop();
        if (pageNum === 0) {
            poller.start();
        } else if (pageNum === 1) {
            captureAllWindows(windows, windowsTab, combinedTab);
        } else if (pageNum === 2) {
            captureCombinedOnce(monitors, windows, combinedTab);
        }
    });

    // ── Initial capture — synchronous so previews render immediately ─
    for (const state of monitors) {
        captureMonitorSync(state, screensTab.pics);
    }
    poller.start();
}

function onActivate(
    app: Gtk.Application,
    token: TokenState,
    select: SelectFn,
    xdphWindows: XDPHWindow[]
): void {
    ensureTempDir();

    logger.debug(
        CAT,
        'XDPH_WINDOW_SHARING_LIST=' + (GLib.getenv('XDPH_WINDOW_SHARING_LIST') || '(null)')
    );
    logger.debug(CAT, `GRIM_BIN=${GRIM_BIN}, HYPRCTL_BIN=${HYPRCTL_BIN}`);
    if (!GRIM_BIN.includes('/')) logger.warn(CAT, 'grim not found in PATH, previews will be blank');
    if (!HYPRCTL_BIN.includes('/'))
        logger.warn(CAT, 'hyprctl not found in PATH, monitors/windows will be empty');

    const {monitors, windows} = buildSources(xdphWindows);
    logSources(monitors, windows);

    const ui = buildPicker(app, token, select, monitors, windows);
    ui.win.present();
    setupCapture(ui, monitors, windows);
}

function main() {
    const allowTokenDefault = programArgs.includes('--allow-token');
    const xdphWindows = parseWindowList(GLib.getenv('XDPH_WINDOW_SHARING_LIST'));

    const app = new Gtk.Application({applicationId: APP_ID, flags: 0});
    const token: TokenState = {value: allowTokenDefault};
    const select = makeSelectFn(app, token);

    app.connect('activate', () => onActivate(app, token, select, xdphWindows));
    app.connect('shutdown', () => cleanTempDir());

    app.run([]);
}

main();
