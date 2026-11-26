/**
 * GTK widget builders for the picker UI.
 */
import type Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {monitorResolution} from './monitorGeometry';
import type {MonitorState, PreviewHandle, PreviewState, SelectFn, WindowState} from './types';

const PICTURE_W = 240;
const PICTURE_H = 135;

function makePreview(initialState: PreviewState): PreviewHandle {
    const picture = new Gtk.Picture({contentFit: Gtk.ContentFit.SCALE_DOWN, canShrink: true});
    picture.set_size_request(PICTURE_W, PICTURE_H);
    const stack = new Gtk.Stack({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
    stack.set_size_request(PICTURE_W, PICTURE_H);
    const status = new Gtk.Label({
        label: 'A prévia pode estar desatualizada',
        halign: Gtk.Align.END,
        valign: Gtk.Align.END,
        visible: false,
        cssClasses: ['picker-preview-status'],
    });
    stack.add_css_class('picker-preview');
    for (const [name, text] of [
        ['idle', 'Prévia não carregada'],
        ['loading', 'Carregando prévia'],
        ['unavailable', 'Prévia indisponível'],
    ]) {
        stack.add_named(
            new Gtk.Label({label: text, wrap: true, justify: Gtk.Justification.CENTER}),
            name
        );
    }
    const image = new Gtk.Overlay({child: picture});
    image.add_overlay(status);
    stack.add_named(image, 'available');
    stack.set_visible_child_name(initialState);

    let disposed = false;
    stack.connect('destroy', () => {
        disposed = true;
    });
    return {
        widget: stack,
        setState(state) {
            if (disposed) return;
            if (state === 'unavailable' && picture.paintable) {
                status.visible = true;
                stack.set_visible_child_name('available');
                return;
            }
            status.visible = false;
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
    box.append(new Gtk.Image({iconName, pixelSize: 48, cssClasses: ['dimmed']}));
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
            cssClasses: ['dimmed'],
        })
    );
    return box;
}

function noScreens(): Gtk.Widget {
    return emptyState(
        'video-display-symbolic',
        'Nenhuma tela disponível',
        'Nenhum monitor conectado está disponível para compartilhamento.'
    );
}

function noWindows(provided: boolean): Gtk.Widget {
    return emptyState(
        'focus-windows-symbolic',
        provided ? 'No windows available' : 'Lista de janelas indisponível',
        provided
            ? 'Nenhuma janela foi informada para este pedido.'
            : 'O portal não informou a lista de janelas para este pedido.'
    );
}

function buildFlowBox(): Gtk.FlowBox {
    return new Gtk.FlowBox({
        minChildrenPerLine: 1,
        maxChildrenPerLine: 4,
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 8,
        rowSpacing: 8,
        homogeneous: true,
        hexpand: true,
        valign: Gtk.Align.START,
    });
}

/** Source key → every card (one per tab) showing it, for the selected state. */
const cards = new Map<string, Gtk.Button[]>();

/** Mark the card(s) of the chosen source; null clears the selection. */
export function markSelected(kind: 'screen' | 'window', id: string | null): void {
    const selected = id === null ? null : `${kind}:${id}`;
    for (const [key, widgets] of cards) {
        for (const widget of widgets) {
            widget.update_property(
                [Gtk.AccessibleProperty.DESCRIPTION],
                [
                    new GObject.Value(
                        GObject.TYPE_STRING,
                        key === selected ? 'Fonte selecionada' : ''
                    ),
                ]
            );
            if (key === selected) widget.add_css_class('selected');
            else widget.remove_css_class('selected');
        }
    }
}

/** Build one selectable source card and add it to `flow`. */
function buildCard(
    flow: Gtk.FlowBox,
    key: string,
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

    const button = new Gtk.Button({
        child: inner,
        cssClasses: ['flat', 'picker-source'],
        tooltipText: [labelText, subText].filter(Boolean).join(' — '),
    });
    // Preview loading must not change the identity of the selectable source.
    button.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, [labelText, subText].filter(Boolean).join(' — '))]
    );
    button.connect('clicked', onClick);
    cards.set(key, [...(cards.get(key) ?? []), button]);

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

function monitorCard(flow: Gtk.FlowBox, state: MonitorState, select: SelectFn): PreviewHandle {
    const preview = makePreview(
        state.info.width > 0 && state.info.height > 0 ? 'idle' : 'unavailable'
    );
    const {width, height} = monitorResolution(state.info);
    const res = `${width}×${height}`;
    const description =
        state.info.description && state.info.description !== state.info.name
            ? state.info.description
            : '';
    buildCard(
        flow,
        `screen:${state.info.name}`,
        state.info.name,
        [description, res].filter(Boolean).join(' — '),
        preview,
        () => select('screen', state.info.name)
    );
    return preview;
}

function windowCard(flow: Gtk.FlowBox, state: WindowState, select: SelectFn): PreviewHandle {
    const preview = makePreview(state.geometry ? 'idle' : 'unavailable');
    const {clazz, title} = state.info;
    // The title is what people recognise ("Backspace", a document name); the
    // class alone cannot tell apart several windows of one app.
    const subText = [
        title ? clazz : '',
        state.geometry ? `${state.geometry.width}×${state.geometry.height}` : '',
    ]
        .filter(Boolean)
        .join(' — ');
    buildCard(flow, `window:${state.info.id}`, title || clazz, subText, preview, () =>
        select('window', state.info.id)
    );
    return preview;
}

/** Preview kept in the selection summary; capture setters update it in place. */
export function makeSelectedPreview(texture: Gdk.Texture | null): PreviewHandle {
    const preview = makePreview(texture ? 'available' : 'unavailable');
    preview.setTexture(texture);
    return preview;
}

function scrolled(child: Gtk.Widget): Gtk.ScrolledWindow {
    return new Gtk.ScrolledWindow({
        child,
        hexpand: true,
        vexpand: true,
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
    });
}

export interface Tab {
    page: Gtk.Widget;
    previews: PreviewHandle[];
}

/** Screens tab — one card per monitor */
export function buildScreensTab(states: MonitorState[], select: SelectFn): Tab {
    const flow = buildFlowBox();
    const previews = states.map((state) => monitorCard(flow, state, select));
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

    box.append(buildSectionLabel('Telas'));
    const monFlow = buildFlowBox();
    const monitorPreviews = monitors.map((state) => monitorCard(monFlow, state, select));
    box.append(monitors.length === 0 ? noScreens() : monFlow);

    box.append(buildSectionLabel('Janelas'));
    const winFlow = buildFlowBox();
    const windowPreviews = windows.map((state) => windowCard(winFlow, state, select));
    box.append(windows.length === 0 ? noWindows(windowListProvided) : winFlow);

    return {page: scrolled(box), monitorPreviews, windowPreviews};
}
