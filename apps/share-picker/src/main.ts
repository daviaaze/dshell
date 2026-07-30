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

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {programArgs} from 'system';
import './picker.css'; // auto-loaded as CssProvider by gnim dev/bundle
import logger from '../../lib/core/logger';
import printOut from '../../lib/core/stdout';
import type {SelectFn} from './types';
import {HYPRCTL_BIN, parseWindowList} from './protocol';
import {buildSources} from './sources';
import {
    GRIM_BIN,
    ensureTempDir,
    cleanTempDir,
    monPath,
    winPath,
    windowAddr,
    runCapture,
    loadTexture,
    captureMonitorSync,
    captureWindow,
} from './capture';
import {MonitorPoller} from './poller';
import {buildScreensTab, buildWindowsTab, buildCombinedTab} from './ui';

const CAT = 'share-picker';
const APP_ID = 'com.caioasmuniz.shade_shell.share_picker';

function main() {
    const allowTokenDefault = programArgs.includes('--allow-token');
    const xdphWindows = parseWindowList(
        GLib.getenv('XDPH_WINDOW_SHARING_LIST')
    );

    const app = new Gtk.Application({applicationId: APP_ID, flags: 0});

    let tokenRestore = allowTokenDefault;

    /** Print selection and quit — XDPH reads stdout */
    const select: SelectFn = (kind, id) => {
        try {
            printOut(`[SELECTION]${tokenRestore ? 'r' : ''}/${kind}:${id}`);
        } catch (e) {
            logger.error(CAT, `select: print failed for ${kind}:${id}`, e);
        }
        try {
            app.quit();
        } catch (e) {
            logger.error(CAT, 'select: app.quit failed', e);
        }
    };

    app.connect('activate', () => {
        ensureTempDir();

        logger.debug(
            CAT,
            'XDPH_WINDOW_SHARING_LIST=' +
                (GLib.getenv('XDPH_WINDOW_SHARING_LIST') || '(null)')
        );
        logger.debug(CAT, `GRIM_BIN=${GRIM_BIN}, HYPRCTL_BIN=${HYPRCTL_BIN}`);
        if (!GRIM_BIN.includes('/'))
            logger.warn(CAT, 'grim not found in PATH, previews will be blank');
        if (!HYPRCTL_BIN.includes('/'))
            logger.warn(
                CAT,
                'hyprctl not found in PATH, monitors/windows will be empty'
            );

        const {monitors, windows} = buildSources(xdphWindows);

        logger.info(
            CAT,
            `${monitors.length} monitors loaded, ${windows.length} windows loaded`
        );
        for (const m of monitors) {
            logger.info(
                CAT,
                `  monitor: ${m.info.name} ${m.info.width}x${m.info.height} @ (${m.info.x},${m.info.y})`
            );
        }
        for (const w of windows) {
            const geo = w.geometry
                ? `${w.geometry.width}x${w.geometry.height}`
                : 'none';
            logger.info(CAT, `  window: ${w.info.clazz} geo=${geo}`);
        }

        
        // ── Window ──────────────────────────────────────────
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

        // ── Tabs ────────────────────────────────────────────
        const notebook = new Gtk.Notebook();
        notebook.set_scrollable(true);

        const screensTab = buildScreensTab(monitors, select);
        notebook.append_page(
            screensTab.page,
            new Gtk.Label({label: 'Screens'})
        );

        const windowsTab = buildWindowsTab(windows, select);
        notebook.append_page(
            windowsTab.page,
            new Gtk.Label({label: 'Windows'})
        );

        const combinedTab = buildCombinedTab(monitors, windows, select);
        notebook.append_page(combinedTab.page, new Gtk.Label({label: 'All'}));

        mainBox.append(notebook);

        // ── Token restore checkbox ──────────────────────────
        const tokenBox = new Gtk.CheckButton({
            label: 'Allow restore token',
            active: tokenRestore,
        });
        tokenBox.connect('toggled', () => {
            tokenRestore = tokenBox.active;
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
        win.present();

        // ── Capture orchestration ────────────────────────────

        // Live polling on the Screens tab; each tick also refreshes the
        // combined-tab picture from the *previous* capture file.
        const poller = new MonitorPoller(
            monitors,
            screensTab.pics,
            (state, i) => {
                const pic = combinedTab.monitorPics[i];
                if (pic) loadTexture(monPath(state.info.name), pic);
            }
        );

        const captureAllWindows = (): void => {
            windows.forEach((state, i) => {
                if (!state.geometry) return;
                const pic = windowsTab.pics[i];
                if (pic) captureWindow(state, [pic]);
                // Also fill combined tab from the previous capture file
                const combinedPic = combinedTab.windowPics[i];
                if (combinedPic)
                    loadTexture(winPath(windowAddr(state)), combinedPic);
            });
        };

        const captureCombinedOnce = (): void => {
            monitors.forEach((state, i) => {
                const pic = combinedTab.monitorPics[i];
                if (!pic) return;
                const path = monPath(state.info.name);
                runCapture(
                    [GRIM_BIN, '-s', '0.25', '-o', state.info.name, path],
                    ok => {
                        if (ok) loadTexture(path, pic);
                    }
                );
            });
            windows.forEach((state, i) => {
                const pic = combinedTab.windowPics[i];
                const g = state.geometry;
                if (!pic || !g) return;
                const path = winPath(windowAddr(state));
                runCapture(
                    [
                        GRIM_BIN,
                        '-s',
                        '0.25',
                        '-g',
                        `${g.x},${g.y} ${g.width}x${g.height}`,
                        path,
                    ],
                    ok => {
                        if (ok) loadTexture(path, pic);
                    }
                );
            });
        };

        notebook.connect('switch-page', (_nb, _page, pageNum: number) => {
            poller.stop();
            if (pageNum === 0) {
                poller.start();
            } else if (pageNum === 1) {
                captureAllWindows();
            } else if (pageNum === 2) {
                captureCombinedOnce();
            }
        });

        // ── Initial capture — synchronous so previews render immediately ─
        for (const state of monitors) {
            captureMonitorSync(state, screensTab.pics);
        }
        poller.start();
    });

    app.connect('shutdown', () => {
        cleanTempDir();
    });

    app.run([]);
}

main();
