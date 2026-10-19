/**
 * GTK widget builders for the picker UI.
 */
import Gtk from 'gi://Gtk?version=4.0';
import type {MonitorState, PreviewHandle, PreviewState, SelectFn, WindowState} from './types';

const PICTURE_W = 240;
const PICTURE_H = 135;
const MAX_DESC_LEN = 60;

function truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.substring(0, max - 1)}…`;
}

function makePreview(initialState: PreviewState): PreviewHandle {
    const picture = new Gtk.Picture({contentFit: Gtk.ContentFit.SCALE_DOWN, canShrink: true});
    picture.set_size_request(PICTURE_W, PICTURE_H);
    const stack = new Gtk.Stack({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
    stack.set_size_request(PICTURE_W, PICTURE_H);
    stack.add_css_class('picker-preview');
    for (const [name, text] of [
        ['idle', 'Preview not loaded'],
        ['loading', 'Loading preview'],
        ['unavailable', 'Preview unavailable'],
    ]) {
        stack.add_named(
            new Gtk.Label({label: text, wrap: true, justify: Gtk.Justification.CENTER}),
            name
        );
    }
    stack.add_named(picture, 'available');
    stack.set_visible_child_name(initialState);

    let disposed = false;
    stack.connect('destroy', () => {
        disposed = true;
    });
    return {
        widget: stack,
        setState(state) {
            if (disposed) return;
            if (state === 'unavailable') picture.set_paintable(null);
            stack.set_visible_child_name(state);
        },
        setTexture(texture) {
            if (disposed) return;
            picture.set_paintable(texture);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            picture.set_paintable(null);
        },
    };
}

function emptyState(iconName: string, heading: string, description: string): Gtk.Widget {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        vexpand: true,
        marginTop: 24,
        marginBottom: 24,
        marginStart: 24,
        marginEnd: 24,
    });
    box.append(new Gtk.Image({iconName, pixelSize: 48, cssClasses: ['dim-label']}));
    box.append(
        new Gtk.Label({
            label: heading,
            wrap: true,
            justify: Gtk.Justification.CENTER,
            cssClasses: ['title-2'],
        })
    );
    box.append(
        new Gtk.Label({
            label: description,
            wrap: true,
            maxWidthChars: 48,
            justify: Gtk.Justification.CENTER,
            cssClasses: ['dim-label'],
        })
    );
    return box;
}

function noScreens(): Gtk.Widget {
    return emptyState(
        'video-display-symbolic',
        'No screens available',
        'No connected monitors are available for sharing.'
    );
}

function noWindows(provided: boolean): Gtk.Widget {
    return emptyState(
        'focus-windows-symbolic',
        provided ? 'No windows available' : 'Window list unavailable',
        provided
            ? 'No windows were provided for this request.'
            : 'The portal did not provide a list of windows for this request.'
    );
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

/** Build one selectable source card and add it to `flow`. */
function buildCard(
    flow: Gtk.FlowBox,
    labelText: string,
    subText: string,
    preview: PreviewHandle,
    onClick: () => void
): void {
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
    inner.append(preview.widget);
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
): PreviewHandle {
    const preview = makePreview(
        state.info.width > 0 && state.info.height > 0 ? 'idle' : 'unavailable'
    );
    const res = `${state.info.width}×${state.info.height}`;
    buildCard(
        flow,
        truncate(state.info.description || state.info.name, MAX_DESC_LEN),
        subRes ? `${res} — ${state.info.name}` : res,
        preview,
        () => select('screen', state.info.name)
    );
    return preview;
}

function windowCard(
    flow: Gtk.FlowBox,
    state: WindowState,
    select: SelectFn
): PreviewHandle {
    const preview = makePreview(state.geometry ? 'idle' : 'unavailable');
    buildCard(
        flow,
        state.info.clazz || state.info.title,
        state.geometry
            ? `${state.geometry.width}×${state.geometry.height}`
            : '',
        preview,
        () => select('window', state.info.id)
    );
    return preview;
}

function scrolled(child: Gtk.Widget): Gtk.ScrolledWindow {
    return new Gtk.ScrolledWindow({child, hexpand: true, vexpand: true});
}

export interface Tab {
    page: Gtk.Widget;
    previews: PreviewHandle[];
}

/** Screens tab — one card per monitor */
export function buildScreensTab(states: MonitorState[], select: SelectFn): Tab {
    const flow = buildFlowBox();
    const previews = states.map((state) => monitorCard(flow, state, select, true));
    return {page: scrolled(states.length === 0 ? noScreens() : flow), previews};
}

/** Windows tab — one card per XDPH window */
export function buildWindowsTab(
    states: WindowState[],
    select: SelectFn,
    windowListProvided: boolean
): Tab {
    const flow = buildFlowBox();
    const previews = states.map((state) => windowCard(flow, state, select));
    return {page: scrolled(states.length === 0 ? noWindows(windowListProvided) : flow), previews};
}

export interface CombinedTab {
    page: Gtk.Widget;
    monitorPreviews: PreviewHandle[];
    windowPreviews: PreviewHandle[];
}

/** Combined tab — screens section followed by windows section */
export function buildCombinedTab(
    monitors: MonitorState[],
    windows: WindowState[],
    select: SelectFn,
    windowListProvided: boolean
): CombinedTab {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        hexpand: true,
    });

    box.append(buildSectionLabel('Screens'));
    const monFlow = buildFlowBox();
    const monitorPreviews = monitors.map((state) => monitorCard(monFlow, state, select, false));
    box.append(monitors.length === 0 ? noScreens() : monFlow);

    box.append(buildSectionLabel('Windows'));
    const winFlow = buildFlowBox();
    const windowPreviews = windows.map((state) => windowCard(winFlow, state, select));
    box.append(windows.length === 0 ? noWindows(windowListProvided) : winFlow);

    return {page: scrolled(box), monitorPreviews, windowPreviews};
}
