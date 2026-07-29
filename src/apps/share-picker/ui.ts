/**
 * GTK widget builders for the picker UI.
 */
import Gtk from 'gi://Gtk?version=4.0';
import logger from '../../lib/core/logger';
import type {MonitorState, SelectFn, WindowState} from './types';

const CAT = 'share-picker';

const PICTURE_W = 240;
const PICTURE_H = 135;
const MAX_DESC_LEN = 60;

function truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.substring(0, max - 1)}…`;
}

/** Popup window rounding — non-fatal if the display isn't ready */
export function applyPopupCss(): void {
    // CSS is now auto-loaded by gnim dev/bundle via picker.css import
}

function makePicture(): Gtk.Picture {
    const pic = new Gtk.Picture();
    pic.set_size_request(PICTURE_W, PICTURE_H);
    pic.contentFit = Gtk.ContentFit.SCALE_DOWN;
    pic.add_css_class('picker-preview');
    return pic;
}

function buildFlowBox(): Gtk.FlowBox {
    return new Gtk.FlowBox({
        minChildrenPerLine: 2,
        maxChildrenPerLine: 4,
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 8,
        rowSpacing: 8,
        homogeneous: true,
        hexpand: true,
    });
}

/**
 * Build one thumbnail card and add it to `flow`.
 * Returns the button for later updates.
 */
function buildCard(
    flow: Gtk.FlowBox,
    labelText: string,
    subText: string,
    pic: Gtk.Picture,
    onClick: () => void
): Gtk.Button {
    const label = new Gtk.Label({
        label: labelText,
        xalign: 0.5,
        cssClasses: ['picker-label'],
        ellipsize: 3, // Pango.EllipsizeMode.END
    });

    const inner = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        cssClasses: ['picker-card'],
    });
    inner.append(pic);
    inner.append(label);

    if (subText) {
        const sub = new Gtk.Label({
            label: subText,
            xalign: 0.5,
            cssClasses: ['picker-sublabel'],
            ellipsize: 3,
        });
        inner.append(sub);
    }

    const button = new Gtk.Button({child: inner, cssClasses: ['flat']});
    button.connect('clicked', onClick);

    flow.append(new Gtk.FlowBoxChild({child: button}));
    return button;
}

/** Build a label header for sections within a flow box */
function buildSectionLabel(text: string): Gtk.Label {
    const l = new Gtk.Label({
        label: text,
        cssClasses: ['picker-section'],
        halign: Gtk.Align.START,
    });
    l.set_margin_top(8);
    return l;
}

function monitorCard(
    flow: Gtk.FlowBox,
    state: MonitorState,
    select: SelectFn,
    subRes: boolean
): Gtk.Picture {
    const pic = makePicture();
    const res = `${state.info.width}×${state.info.height}`;
    buildCard(
        flow,
        truncate(state.info.description || state.info.name, MAX_DESC_LEN),
        subRes ? `${res} — ${state.info.name}` : res,
        pic,
        () => select('screen', state.info.name)
    );
    return pic;
}

function windowCard(
    flow: Gtk.FlowBox,
    state: WindowState,
    select: SelectFn,
    longSub: boolean
): Gtk.Picture {
    const pic = makePicture();
    buildCard(
        flow,
        state.info.clazz || state.info.title,
        state.geometry
            ? `${state.geometry.width}×${state.geometry.height}`
            : longSub
              ? 'No preview (hidden or off-screen)'
              : 'No preview',
        pic,
        () => select('window', state.info.id)
    );
    return pic;
}

function scrolled(child: Gtk.Widget): Gtk.ScrolledWindow {
    return new Gtk.ScrolledWindow({child, hexpand: true, vexpand: true});
}

export interface Tab {
    page: Gtk.Widget;
    pics: Gtk.Picture[];
}

/** Screens tab — one card per monitor */
export function buildScreensTab(states: MonitorState[], select: SelectFn): Tab {
    const flow = buildFlowBox();
    const pics: Gtk.Picture[] = [];
    if (states.length === 0) {
        flow.append(
            new Gtk.FlowBoxChild({
                child: new Gtk.Label({label: 'No monitors found'}),
            })
        );
    } else {
        for (const state of states) {
            pics.push(monitorCard(flow, state, select, true));
        }
    }
    return {page: scrolled(flow), pics};
}

/** Windows tab — one card per XDPH window */
export function buildWindowsTab(states: WindowState[], select: SelectFn): Tab {
    const flow = buildFlowBox();
    const pics: Gtk.Picture[] = [];
    if (states.length === 0) {
        flow.append(
            new Gtk.FlowBoxChild({
                child: new Gtk.Label({label: 'No windows available'}),
            })
        );
    } else {
        for (const state of states) {
            pics.push(windowCard(flow, state, select, true));
        }
    }
    return {page: scrolled(flow), pics};
}

export interface CombinedTab {
    page: Gtk.Widget;
    monitorPics: Gtk.Picture[];
    windowPics: Gtk.Picture[];
}

/** Combined tab — screens section followed by windows section */
export function buildCombinedTab(
    monitors: MonitorState[],
    windows: WindowState[],
    select: SelectFn
): CombinedTab {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        hexpand: true,
    });

    box.append(buildSectionLabel('Screens'));
    const monFlow = buildFlowBox();
    const monitorPics = monitors.map(state =>
        monitorCard(monFlow, state, select, false)
    );
    box.append(monFlow);

    box.append(buildSectionLabel('Windows'));
    const winFlow = buildFlowBox();
    const windowPics = windows.map(state =>
        windowCard(winFlow, state, select, false)
    );
    box.append(winFlow);

    return {page: scrolled(box), monitorPics, windowPics};
}
