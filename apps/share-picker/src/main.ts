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
import {HYPRCTL_BIN, getHyprClients, getHyprMonitors, parseWindowList} from './protocol';
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
            throw e;
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
        title: 'Escolha o que compartilhar',
        defaultWidth: 760,
        defaultHeight: 600,
        resizable: true,
        decorated: true,
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

    const heading = new Gtk.Label({
        label: 'Escolha o que compartilhar',
        cssClasses: ['title-2'],
        halign: Gtk.Align.START,
    });
    mainBox.append(heading);
    const explanation = new Gtk.Label({
        label: 'Inspecionar a prévia não autoriza compartilhamento.',
        wrap: true,
        xalign: 0,
        cssClasses: ['dim-label'],
    });
    mainBox.append(explanation);
    const notebook = new Gtk.Notebook({vexpand: true});
    notebook.set_scrollable(true);
    let pending: {kind: 'screen' | 'window'; id: string} | null = null;
    const review = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, visible: false});
    const picture = new Gtk.Picture({heightRequest: 180, canShrink: true});
    const summary = new Gtk.Label({wrap: true, xalign: 0, selectable: true});
    const confirm = new Gtk.Button({label: 'Compartilhar', sensitive: false, cssClasses: ['suggested-action']});
    let submitted = false;
    const reset = () => {
        pending = null;
        picture.paintable = null;
        review.visible = false;
        notebook.visible = true;
        confirm.sensitive = false;
        heading.label = 'Escolha o que compartilhar';
        explanation.label = 'Inspecionar a prévia não autoriza compartilhamento.';
    };
    const choose: SelectFn = (kind, id) => {
        const monitor = monitors.find((source) => source.info.name === id);
        const window = windows.find((source) => source.info.id === id);
        if (kind === 'screen' ? !monitor : !window) return;
        pending = {kind, id};
        picture.paintable = kind === 'screen' ? monitor?.texture ?? null : window?.texture ?? null;
        summary.label = kind === 'screen'
            ? `${monitor?.info.description || id}\nTela inteira; outras janelas visíveis também podem ser expostas.`
            : `${window?.info.title || id}\n${window?.info.clazz || ''}`;
        heading.label = kind === 'screen' ? 'Revise a tela escolhida' : 'Revise a janela escolhida';
        explanation.label = 'A prévia pode estar indisponível; a fonte só será enviada após Compartilhar. O aplicativo solicitante controla o início da transmissão.';
        confirm.sensitive = true;
        notebook.visible = false;
        review.visible = true;
    };
    review.append(picture);
    review.append(summary);
    const change = new Gtk.Button({label: 'Escolher outra fonte', halign: Gtk.Align.START});
    change.connect('clicked', reset);
    review.append(change);
    const screensTab = buildScreensTab(monitors, choose);
    notebook.append_page(screensTab.page, new Gtk.Label({label: 'Telas'}));
    const windowsTab = buildWindowsTab(windows, choose, windowListProvided);
    notebook.append_page(windowsTab.page, new Gtk.Label({label: 'Janelas'}));
    const combinedTab = buildCombinedTab(monitors, windows, choose, windowListProvided);
    notebook.append_page(combinedTab.page, new Gtk.Label({label: 'Todas as fontes'}));

    mainBox.append(notebook);
    mainBox.append(review);

    // ── Token restore checkbox ──────────────────────────
    const tokenBox = new Gtk.CheckButton({
        label: 'Permitir token de restauração',
        active: token.value,
        visible: token.value || programArgs.includes('--allow-token'),
    });
    tokenBox.connect('toggled', () => {
        token.value = tokenBox.active;
    });
    mainBox.append(tokenBox);

    mainBox.append(new Gtk.Label({
        label: 'O token pertence a este pedido; não salva uma preferência do shell.',
        wrap: true, xalign: 0, cssClasses: ['caption', 'dim-label'],
    }));
    const actions = new Gtk.Box({spacing: 12, halign: Gtk.Align.END});
    const back = new Gtk.Button({label: 'Voltar'});
    back.connect('clicked', reset);
    actions.append(back);
    const cancelBtn = new Gtk.Button({label: 'Cancelar'});
    cancelBtn.connect('clicked', () => app.quit());
    actions.append(cancelBtn);
    confirm.connect('clicked', () => {
        if (!pending || submitted) return;
        const {kind, id} = pending;
        const source = windows.find((item) => item.info.id === id);
        const exists = kind === 'screen'
            ? getHyprMonitors().some((item) => item.name === id)
            : getHyprClients().some((item) => item.mapped && !item.hidden &&
                (source?.hyprAddress ? item.address === source.hyprAddress :
                    source ? item.class === source.info.clazz && item.title === source.info.title : false));
        if (!exists) {
            reset();
            explanation.label = 'A fonte não está mais disponível. Escolha outra fonte ou cancele.';
            return;
        }
        submitted = true;
        confirm.sensitive = false;
        try {
            select(kind, id);
        } catch {
            submitted = false;
            confirm.sensitive = true;
            explanation.label = 'Não foi possível enviar a escolha ao portal. Tente novamente ou cancele.';
        }
    });
    actions.append(confirm);
    mainBox.append(actions);

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
