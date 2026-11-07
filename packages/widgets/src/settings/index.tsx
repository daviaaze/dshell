import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import {newObject, onCleanup, type GnimNode} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '@shade/services/state/windowManager';
import About from './about';
import Appearance from './appearance';
import Bar from './bar';
import Bluetooth from './bluetooth';
import Clock from './clock';
import Debug from './debug';
import DefaultApps from './defaultApps';
import Displays from './displays';
import Idle from './idle';
import Mouse from './mouse';
import Network from './network';
import Notifications from './notifications';
import Power from './power';
import ScheduledDND from './scheduledDND';
import ScreenCapture from './screenCapture';
import ScreenShare from './screenShare';
import Shortcuts from './shortcuts';
import Sound from './sound';
import StartupApps from './startupApps';
import Timer from './timer';
import Weather from './weather';

export const settingsDestinationMeta = {
    appearance: {title: 'Aparência', icon: 'applications-graphics-symbolic', summary: 'Tema, papéis de cor, wallpaper e luz noturna', group: 'Aparência'},
    bar: {title: 'Barra e dock', icon: 'view-sidebar-symbolic', summary: 'Posição, itens, aplicativos fixados e recursos', group: 'Barra e dock'},
    displays: {title: 'Telas', icon: 'video-display-symbolic', summary: 'Arranjo, modos, escala e layouts recuperáveis', group: 'Telas'},
    sound: {title: 'Som', icon: 'audio-volume-high-symbolic', summary: 'Saída, microfone e alertas', group: 'Som'},
    mouse: {title: 'Mouse e touchpad', icon: 'input-mouse-symbolic', summary: 'Ponteiro, clique e rolagem', group: 'Mouse e touchpad'},
    network: {title: 'Conexões', icon: 'network-wireless-symbolic', summary: 'Wi-Fi, cabo, hotspot e Bluetooth', group: 'Conexões'},
    bluetooth: {title: 'Bluetooth', icon: 'bluetooth-symbolic', summary: 'Dispositivos e conexões Bluetooth', group: 'Conexões'},
    idle: {title: 'Bloqueio e energia', icon: 'system-lock-screen-symbolic', summary: 'Inatividade, botão de energia e tampa', group: 'Bloqueio e energia'},
    power: {title: 'Energia', icon: 'battery-symbolic', summary: 'Política de energia', group: 'Bloqueio e energia'},
    notifications: {title: 'Notificações', icon: 'preferences-system-notifications-symbolic', summary: 'Exibição, privacidade e histórico', group: 'Notificações'},
    'scheduled-dnd': {title: 'Não perturbe', icon: 'notifications-disabled-symbolic', summary: 'Agendamento e estado de não perturbe', group: 'Notificações'},
    'screen-capture': {title: 'Captura de tela', icon: 'camera-photo-symbolic', summary: 'Imagem, gravação e opções de captura', group: 'Captura e compartilhamento'},
    'screen-share': {title: 'Compartilhamento de tela', icon: 'screen-shared-symbolic', summary: 'Fontes e opções de compartilhamento', group: 'Captura e compartilhamento'},
    'default-apps': {title: 'Aplicativos padrão', icon: 'application-x-executable-symbolic', summary: 'Padrões de abertura', group: 'Aplicativos'},
    'startup-apps': {title: 'Aplicativos ao entrar', icon: 'system-run-symbolic', summary: 'Aplicativos iniciados com a sessão', group: 'Aplicativos'},
    clock: {title: 'Relógio', icon: 'preferences-system-time-symbolic', summary: 'Relógios e fusos horários', group: 'Tempo e concentração'},
    weather: {title: 'Clima', icon: 'weather-clear-symbolic', summary: 'Localização e previsão do tempo', group: 'Tempo e concentração'},
    timer: {title: 'Temporizador', icon: 'alarm-symbolic', summary: 'Pomodoro e contagem regressiva', group: 'Tempo e concentração'},
    shortcuts: {title: 'Atalhos', icon: 'input-keyboard-symbolic', summary: 'Localizar ações e consultar comandos ativos', group: 'Atalhos'},
    about: {title: 'Sobre o sistema', icon: 'help-about-symbolic', summary: 'Informações do sistema', group: 'Sistema e diagnóstico'},
    debug: {title: 'Diagnóstico', icon: 'utilities-system-monitor-symbolic', summary: 'Categorias de log', group: 'Sistema e diagnóstico'},
} as const;

export type SettingsDestination = keyof typeof settingsDestinationMeta;
type Task = {id: SettingsDestination; content: () => GnimNode};

const tasks: Task[] = [
    {id: 'appearance', content: Appearance}, {id: 'bar', content: Bar},
    {id: 'displays', content: Displays}, {id: 'sound', content: Sound},
    {id: 'mouse', content: Mouse}, {id: 'network', content: Network},
    {id: 'bluetooth', content: Bluetooth}, {id: 'idle', content: Idle},
    {id: 'power', content: Power}, {id: 'notifications', content: Notifications},
    {id: 'scheduled-dnd', content: ScheduledDND},
    {id: 'screen-capture', content: ScreenCapture}, {id: 'screen-share', content: ScreenShare},
    {id: 'default-apps', content: DefaultApps}, {id: 'startup-apps', content: StartupApps},
    {id: 'clock', content: Clock}, {id: 'weather', content: Weather},
    {id: 'timer', content: Timer}, {id: 'shortcuts', content: Shortcuts},
    {id: 'about', content: About}, {id: 'debug', content: Debug},
];

export type SettingsNavigator = {
    navigate: (destination: SettingsDestination) => void;
    search: (query?: string) => void;
};

const navigators = new WeakMap<Gtk.Window, SettingsNavigator>();

export function navigateSettings(window: Gtk.Window, destination: SettingsDestination) {
    navigators.get(window)?.navigate(destination);
}

/** Thirteen task destinations keep all twenty-one modules mounted, including drafts. */
export const createSettingsWindow = (
    initialDestination?: SettingsDestination,
    initialQuery = '',
): Gtk.Window => {
    const meta = (id: SettingsDestination) => settingsDestinationMeta[id];
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const stack = new Gtk.Stack({vexpand: true, hhomogeneous: false, vhomogeneous: false});
    const pages = new Map<SettingsDestination, Gtk.Widget>();
    const sections = new Map<string, SettingsDestination[]>();
    for (const {id, content: Content} of tasks) {
        const page = newObject(Gtk.Box, {
            construct: () => new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL, spacing: 18,
                marginTop: 24, marginBottom: 32, marginStart: 18, marginEnd: 18,
            }),
            children: <Content />,
        });
        pages.set(id, page);
        stack.add_named(new Gtk.ScrolledWindow({
            hscrollbarPolicy: Gtk.PolicyType.NEVER,
            child: new Adw.Clamp({maximumSize: 760, tighteningThreshold: 560, child: page}),
        }), `module:${id}`);
        const section = meta(id).group;
        let members = sections.get(section);
        if (!members) { members = []; sections.set(section, members); }
        members.push(id);
    }
    const sidebar = new Gtk.ListBox({selectionMode: Gtk.SelectionMode.SINGLE, cssClasses: ['navigation-sidebar']});
    const sidebarRows = new Map<string, Gtk.ListBoxRow>();
    const results = new Gtk.ListBox({selectionMode: Gtk.SelectionMode.NONE, cssClasses: ['boxed-list']});
    results.update_property([Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, 'Resultados de busca')]);
    const empty = new Adw.StatusPage({iconName: 'system-search-symbolic'});
    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL, spacing: 18,
        marginTop: 24, marginBottom: 24, marginStart: 18, marginEnd: 18,
    });
    searchBox.append(results);
    searchBox.append(empty);
    const clearSearch = new Gtk.Button({label: 'Limpar busca', halign: Gtk.Align.START});
    searchBox.append(clearSearch);
    stack.add_named(new Gtk.ScrolledWindow({
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        child: new Adw.Clamp({maximumSize: 760, child: searchBox}),
    }), 'search');
    const sidebarBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
    sidebarBox.append(new Gtk.Label({
        label: 'Preferências', xalign: 0, marginTop: 16, marginStart: 16, cssClasses: ['heading'],
    }));
    sidebarBox.append(new Gtk.ScrolledWindow({vexpand: true, hscrollbarPolicy: Gtk.PolicyType.NEVER, child: sidebar}));
    const contentPage = new Adw.NavigationPage({title: 'Configurações', child: stack});
    const split = new Adw.NavigationSplitView({
        sidebar: new Adw.NavigationPage({title: 'Preferências', child: sidebarBox}),
        content: contentPage,
        minSidebarWidth: 220, maxSidebarWidth: 280,
    });
    const title = new Adw.WindowTitle({title: 'Configurações'});
    title.bind_property('title', contentPage, 'title', GObject.BindingFlags.SYNC_CREATE);
    const back = new Gtk.Button({iconName: 'go-previous-symbolic', tooltipText: 'Voltar'});
    const header = new Adw.HeaderBar({titleWidget: title});
    header.pack_start(back);
    const searchEntry = new Gtk.SearchEntry({placeholderText: 'Buscar nas configurações', hexpand: true});
    searchEntry.update_property([Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, 'Buscar nas configurações')]);
    const searchRow = new Gtk.Box({marginTop: 8, marginBottom: 8, marginStart: 12, marginEnd: 12});
    searchRow.append(searchEntry);
    const toolbar = new Adw.ToolbarView({content: split});
    toolbar.add_top_bar(header);
    toolbar.add_top_bar(searchRow);
    const window = new Adw.ApplicationWindow({
        application: getApp(), name: 'settings', title: 'Configurações',
        defaultWidth: 1040, defaultHeight: 760, hideOnClose: false, content: toolbar,
    });
    WindowManager.get_default().setSettings(window);
    const breakpoint = new Adw.Breakpoint({condition: Adw.BreakpointCondition.parse('max-width: 760sp')});
    breakpoint.add_setter(split, 'collapsed', new GObject.Value(GObject.TYPE_BOOLEAN, true));
    window.add_breakpoint(breakpoint);
    type View =
        | {kind: 'module'; id: SettingsDestination; from: 'sidebar' | 'section' | 'search'; origin?: Gtk.Widget}
        | {kind: 'section'; title: string}
        | {kind: 'search'};
    let view: View = {kind: 'module', id: 'appearance', from: 'sidebar'};
    let lastSection: string = meta('appearance').group;
    let updatingSelection = false;
    let focusSource = 0;
    const focus = (widget: Gtk.Widget | undefined) => {
        if (!widget) return;
        if (focusSource) GLib.source_remove(focusSource);
        focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            focusSource = 0;
            if (widget.get_mapped() && !widget.grab_focus()) widget.child_focus(Gtk.DirectionType.TAB_FORWARD);
            return GLib.SOURCE_REMOVE;
        });
    };
    onCleanup(() => { if (focusSource) GLib.source_remove(focusSource); });
    const updateBack = () => {
        if (split.get_collapsed() && !split.get_show_content()) { back.set_visible(false); return; }
        back.set_visible(view.kind === 'search' || split.get_collapsed()
            || (view.kind === 'module' && view.from !== 'sidebar'));
    };
    const selectSection = (section: string) => {
        updatingSelection = true;
        sidebar.select_row(sidebarRows.get(section) ?? null);
        updatingSelection = false;
    };
    const navigate = (id: SettingsDestination, from: 'sidebar' | 'section' | 'search', origin?: Gtk.Widget) => {
        view = {kind: 'module', id, from, origin};
        lastSection = meta(id).group;
        stack.set_visible_child_name(`module:${id}`);
        title.set_title(meta(id).title);
        selectSection(lastSection);
        split.set_show_content(true);
        updateBack();
    };
    const showSection = (section: string) => {
        const members = sections.get(section);
        if (!members) return;
        lastSection = section;
        if (members.length === 1) { navigate(members[0], 'sidebar'); return; }
        view = {kind: 'section', title: section};
        stack.set_visible_child_name(`section:${section}`);
        title.set_title(section);
        selectSection(section);
        split.set_show_content(true);
        updateBack();
    };
    for (const [section, members] of sections) {
        const row = new Adw.ActionRow({title: section, activatable: true, useMarkup: false});
        // Adw's GIR overrides activate(); this is a native Gtk.ListBoxRow boundary.
        const nativeRow = row as unknown as Gtk.ListBoxRow;
        sidebar.append(nativeRow);
        sidebarRows.set(section, nativeRow);
        if (members.length > 1) {
            const list = new Gtk.ListBox({selectionMode: Gtk.SelectionMode.NONE, cssClasses: ['boxed-list']});
            for (const id of members) {
                const item = new Adw.ActionRow({
                    title: meta(id).title, subtitle: meta(id).summary, activatable: true, useMarkup: false,
                });
                item.add_prefix(new Gtk.Image({iconName: meta(id).icon}));
                item.add_suffix(new Gtk.Image({iconName: 'go-next-symbolic'}));
                const nativeItem = item as unknown as Gtk.ListBoxRow;
                item.connect('activated', () => navigate(id, 'section', nativeItem));
                list.append(nativeItem);
            }
            const body = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL, spacing: 18,
                marginTop: 24, marginBottom: 24, marginStart: 18, marginEnd: 18,
            });
            body.append(list);
            stack.add_named(new Gtk.ScrolledWindow({
                hscrollbarPolicy: Gtk.PolicyType.NEVER,
                child: new Adw.Clamp({maximumSize: 760, tighteningThreshold: 560, child: body}),
            }), `section:${section}`);
        }
    }
    const activateSection = (row: Gtk.ListBoxRow | null) => {
        if (updatingSelection || !row) return;
        for (const [section, candidate] of sidebarRows) {
            if (row === candidate) { showSection(section); break; }
        }
    };
    sidebar.connect('row-selected', (_list, row) => activateSection(row));
    sidebar.connect('row-activated', (_list, row) => activateSection(row));
    const showSearch = () => {
        view = {kind: 'search'};
        stack.set_visible_child_name('search');
        title.set_title('Buscar configurações');
        split.set_show_content(true);
        updateBack();
    };
    const goBack = () => {
        const previous = view;
        if (previous.kind === 'module' && previous.from === 'search') {
            showSearch();
            focus(previous.origin);
        } else if (previous.kind === 'module' && previous.from === 'section') {
            showSection(meta(previous.id).group);
            focus(previous.origin);
        } else if (split.get_collapsed()) {
            split.set_show_content(false);
            updateBack();
            focus(sidebarRows.get(lastSection));
        } else if (previous.kind === 'search') {
            showSection(lastSection);
        }
    };
    let appliedQuery: string | null = null;
    // Search native labels at query time, including current hardware rows.
    const updateSearch = (showResults = true) => {
        const query = normalize(searchEntry.get_text().trim());
        appliedQuery = query;
        for (let child = results.get_first_child(); child; child = results.get_first_child()) results.remove(child);
        let count = 0;
        // Only exact module titles jump ahead; incidental matches retain registry order.
        const searchTasks = [...tasks].sort((a, b) =>
            Number(normalize(meta(b.id).title) === query) - Number(normalize(meta(a.id).title) === query));
        if (query) for (const {id} of searchTasks) {
            const found = new Set<string>();
            const add = (label: string, subtitle: string, target?: Gtk.Widget) => {
                if (found.has(label) || !normalize(`${label} ${subtitle} ${id}`).includes(query)) return;
                found.add(label);
                count++;
                const row = new Adw.ActionRow({
                    title: label, subtitle: `${meta(id).title} › ${subtitle}`, activatable: true, useMarkup: false,
                });
                row.add_suffix(new Gtk.Image({iconName: 'go-next-symbolic'}));
                const nativeRow = row as unknown as Gtk.ListBoxRow;
                row.connect('activated', () => {
                    navigate(id, 'search', nativeRow);
                    focus(target);
                });
                results.append(nativeRow);
            };
            add(meta(id).title, meta(id).summary);
            const visit = (widget: Gtk.Widget, group: string) => {
                if (!widget.get_visible()) return;
                if (widget instanceof Adw.PreferencesGroup) group = widget.get_title() || group;
                if (widget instanceof Adw.PreferencesRow) {
                    const label = widget.get_title();
                    const subtitle = widget instanceof Adw.ActionRow ? widget.get_subtitle() : '';
                    if (label) add(label, `${group} / ${subtitle}`, widget);
                } else if (widget instanceof Gtk.Label) add(widget.get_text(), group, widget);
                else if (widget instanceof Gtk.Button) {
                    const label = widget.get_label();
                    if (label) add(label, group, widget);
                }
                const tooltip = widget.get_tooltip_text();
                if (tooltip) add(tooltip, group, widget);
                for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) visit(child, group);
            };
            const page = pages.get(id);
            if (page) visit(page, meta(id).title);
        }
        results.set_visible(count > 0);
        empty.set_visible(count === 0);
        empty.title = query ? 'Nenhuma preferência encontrada' : 'Encontre uma preferência';
        empty.description = query ? 'Tente outro nome ou uma ação semelhante.' : 'Busque pelo nome de uma preferência ou pelo que você quer fazer.';
        clearSearch.set_visible(Boolean(query));
        if (showResults) showSearch();
    };
    searchEntry.connect('search-changed', () => {
        // Enter can render and open a result before GTK's debounce fires.
        // Do not let that late signal recreate rows or replace the destination.
        const query = normalize(searchEntry.get_text().trim());
        if (query === appliedQuery) return;
        if (searchEntry.get_text().trim()) updateSearch();
        else {
            updateSearch(false);
            if (view.kind === 'search') showSection(lastSection);
        }
    });
    searchEntry.connect('activate', () => {
        if (!searchEntry.get_text().trim()) return;
        // SearchEntry debounces search-changed; Enter must use the current query.
        updateSearch();
        const first = results.get_row_at_index(0);
        if (first) first.activate();
    });
    searchEntry.connect('stop-search', () => {
        if (view.kind === 'module' && view.from === 'search') goBack();
        else if (searchEntry.get_text()) searchEntry.set_text('');
        else goBack();
    });
    clearSearch.connect('clicked', () => { searchEntry.set_text(''); showSection(lastSection); });
    back.connect('clicked', goBack);
    split.connect('notify::collapsed', updateBack);
    split.connect('notify::show-content', updateBack);
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, key, _keycode, modifiers) => {
        if (modifiers & Gdk.ModifierType.CONTROL_MASK) {
            if (key === Gdk.KEY_f || key === Gdk.KEY_F) { showSearch(); focus(searchEntry); return true; }
            if (key === Gdk.KEY_w || key === Gdk.KEY_W) { window.close(); return true; }
        }
        if (key === Gdk.KEY_Escape && back.visible) { goBack(); return true; }
        return false;
    });
    window.add_controller(controller);
    navigators.set(window, {
        navigate: id => navigate(id, sections.get(meta(id).group)?.length === 1 ? 'sidebar' : 'section'),
        search: (query = '') => { searchEntry.set_text(query); updateSearch(); focus(searchEntry); },
    });
    if (initialDestination) navigate(initialDestination, sections.get(meta(initialDestination).group)?.length === 1 ? 'sidebar' : 'section');
    else showSection(meta('appearance').group);
    if (initialQuery) { searchEntry.set_text(initialQuery); updateSearch(); }
    else updateSearch(false);
    return window;
};
