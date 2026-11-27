import Apps from 'gi://AstalApps';
import type Hyprland from 'gi://AstalHyprland';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import {toArray} from '@shade/core/gjsUtils';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GioUnix from 'gi://GioUnix?version=2.0';
import logger from '@shade/core/logger';
import {candidateRoots, type DesktopCandidate, pickDesktopEntry, storeRoot} from './nixApps';

const apps = new Apps.Apps({
    nameMultiplier: 4,
    entryMultiplier: 2,
    executableMultiplier: 2,
    descriptionMultiplier: 1,
});

const CLASS_OVERRIDES: Record<string, string> = {
    'code-url-handler': 'code',
};

export function getAppList(): Apps.Application[] {
    return toArray<Apps.Application>(apps.get_list());
}

export function fuzzyQuery(query: string): Apps.Application[] {
    return toArray<Apps.Application>(apps.fuzzy_query(query));
}

export function exactQuery(query: string): Apps.Application[] {
    return toArray<Apps.Application>(apps.exact_query(query));
}

function getExecutableName(exec: string): string {
    if (!exec) return '';
    const base = exec.split('/').pop() || exec;
    return base.split(' ')[0]!.toLowerCase();
}

// ── Helpers for getAppForClient ──

type ClientTerms = {
    cls: string | undefined;
    title: string | undefined;
    initialTitle: string | undefined;
};

/** Match a client property against a getter on each app in the list. */
function matchByGetter(
    allApps: Apps.Application[],
    terms: ClientTerms,
    getValue: (app: Apps.Application) => string
): Apps.Application | null {
    for (const app of allApps) {
        const value = getValue(app);
        if (!value) continue;
        if (value === terms.cls || value === terms.title || value === terms.initialTitle) {
            return app;
        }
    }
    return null;
}

/** Try AstalApps query on a client term, returning first result. */
function queryTerm(
    term: string | undefined,
    queryFn: (q: string) => Apps.Application[]
): Apps.Application | null {
    if (!term) return null;
    const results = queryFn(term);
    return results.length > 0 ? results[0]! : null;
}

export function getAppForClient(client: Hyprland.Client): Apps.Application | null {
    const terms: ClientTerms = {
        cls: client.class?.toLowerCase(),
        title: client.title?.toLowerCase(),
        initialTitle: client.initialTitle?.toLowerCase(),
    };

    if (!terms.cls && !terms.title) return null;

    const allApps = getAppList();

    // 1. Exact desktop entry match
    const entryMatch = matchByGetter(
        allApps,
        terms,
        (a) => a.entry?.toLowerCase().replace('.desktop', '') ?? ''
    );
    if (entryMatch) return entryMatch;

    // 2. Exact AstalApps query
    const exactFromCls = queryTerm(terms.cls, exactQuery);
    if (exactFromCls) return exactFromCls;
    const exactFromTitle = queryTerm(terms.title, exactQuery);
    if (exactFromTitle) return exactFromTitle;

    // 3. Executable name match
    const execMatch = matchByGetter(allApps, terms, (a) => getExecutableName(a.executable));
    if (execMatch) return execMatch;

    // 4. App name match
    const nameMatch = matchByGetter(allApps, terms, (a) => a.name?.toLowerCase() ?? '');
    if (nameMatch) return nameMatch;

    // 5. Fuzzy query fallback
    const fuzzyFromCls = queryTerm(terms.cls, fuzzyQuery);
    if (fuzzyFromCls) return fuzzyFromCls;
    const fuzzyFromTitle = queryTerm(terms.title, fuzzyQuery);
    if (fuzzyFromTitle) return fuzzyFromTitle;

    return null;
}

// ── Apps started with `nix run` ──

const NIX_ENTRY_CACHE_LIMIT = 128;
/** pid + class → desktop file path in the store, or null when none was found. */
const nixEntryCache = new Map<string, string | null>();

function readProc(pid: number, file: string): string | null {
    try {
        const [ok, bytes] = Gio.File.new_for_path(`/proc/${pid}/${file}`).load_contents(null);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

function readExe(pid: number): string | null {
    try {
        return GLib.file_read_link(`/proc/${pid}/exe`);
    } catch {
        return null;
    }
}

function desktopCandidates(root: string): DesktopCandidate[] {
    const found: DesktopCandidate[] = [];
    try {
        const directory = Gio.File.new_for_path(`${root}/share/applications`);
        const children = directory.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        for (let info = children.next_file(null); info; info = children.next_file(null)) {
            const name = info.get_name();
            if (!name.endsWith('.desktop')) continue;
            const path = `${directory.get_path()}/${name}`;
            const app = GioUnix.DesktopAppInfo.new_from_filename(path);
            if (!app) continue;
            found.push({
                path,
                id: name.slice(0, -'.desktop'.length),
                wmClass: app.get_startup_wm_class() ?? '',
                executable: app.get_executable() ?? '',
                hidden: app.get_nodisplay() || app.get_is_hidden(),
            });
        }
        children.close(null);
    } catch {
        // No share/applications in this store path.
    }
    return found;
}

/** Make the icons shipped in a store path visible to the icon theme. */
function addStoreIcons(entry: string) {
    const root = storeRoot(entry);
    const display = Gdk.Display.get_default();
    if (!root || !display) return;
    Gtk.IconTheme.get_for_display(display).add_search_path(`${root}/share/icons`);
}

/**
 * Desktop file (absolute path in the store) of a window whose app was started
 * with `nix run` or `nix shell`, or null when it is not a store app.
 */
export function getNixRunEntry(client: Hyprland.Client): string | null {
    const pid = client.pid;
    if (!pid || pid <= 0) return null;
    const key = `${pid}:${client.class ?? ''}`;
    const cached = nixEntryCache.get(key);
    if (cached !== undefined) return cached;

    const exe = readExe(pid);
    const cmdline = (readProc(pid, 'cmdline') ?? '').split('\0').filter(Boolean);
    const environment = (readProc(pid, 'environ') ?? '').split('\0');
    const xdgDataDirs =
        environment
            .find((line) => line.startsWith('XDG_DATA_DIRS='))
            ?.slice('XDG_DATA_DIRS='.length) ?? null;

    let result: string | null = null;
    for (const root of candidateRoots({exe, cmdline, xdgDataDirs})) {
        const picked = pickDesktopEntry(desktopCandidates(root), {
            cls: client.class ?? '',
            executable: exe ?? '',
        });
        if (picked) {
            result = picked.path;
            addStoreIcons(picked.path);
            break;
        }
    }
    if (nixEntryCache.size >= NIX_ENTRY_CACHE_LIMIT) nixEntryCache.clear();
    nixEntryCache.set(key, result);
    return result;
}

export interface EntryInfo {
    name: string;
    iconName: string;
}

/** Name and icon of a desktop file given by absolute path (store apps), else null. */
export function getEntryInfo(entry: string): EntryInfo | null {
    if (!entry.startsWith('/')) return null;
    const app = GioUnix.DesktopAppInfo.new_from_filename(entry);
    if (!app) return null;
    addStoreIcons(entry);
    return {name: app.get_name(), iconName: app.get_string('Icon') ?? ''};
}

export function getAppIcon(client: Hyprland.Client): string {
    const cls = client.class;
    if (!cls) return 'image-missing-symbolic';

    // Check hardcoded overrides first
    const override = Object.hasOwn(CLASS_OVERRIDES, cls) ? CLASS_OVERRIDES[cls] : undefined;
    if (override) return override;

    // Try AstalApps database lookup
    const app = getAppForClient(client);
    if (app?.iconName) return app.iconName;

    // Apps started with `nix run` have no entry in the database; read it from the store.
    const nixEntry = getEntryInfo(getNixRunEntry(client) ?? '');
    if (nixEntry?.iconName) return nixEntry.iconName;

    // Fallback: use the client class as an icon name directly.
    // Most apps set their wm_class to match their icon name (e.g.
    // class "firefox" → icon "firefox", class "Code" → icon "code").
    return cls.toLowerCase();
}

export function getDesktopFileForClient(client: Hyprland.Client): string | null {
    const app = getAppForClient(client);
    return app?.entry || getNixRunEntry(client);
}

// ── App database auto-refresh ──
// AstalApps loads desktop files once at construction. Newly installed apps
// won't appear until the database is reloaded. We watch the standard desktop
// file directories and call reload() on changes.

const DESKTOP_DIRS = [
    `${GLib.get_home_dir()}/.local/share/applications`,
    '/usr/share/applications',
    '/run/current-system/sw/share/applications',
    `${GLib.get_home_dir()}/.nix-profile/share/applications`,
];

let reloadDebounceId: number | null = null;

/**
 * Reload the AstalApps database so newly installed apps appear in search
 * results and the app launcher without needing to restart the shell.
 */
export function reloadApps() {
    apps.reload();
    logger.info('apps', 'AstalApps database reloaded');
}

/**
 * Launch an application via uwsm-app.
 * Encapsulates the shell command so widgets don't import GLib.spawn.
 */
export function launchApp(application: Apps.Application) {
    try {
        GLib.spawn_command_line_async(`uwsm-app -t service -- ${application.entry}`);
    } catch (e) {
        logger.error('apps', `Failed to launch ${application.entry}:`, e);
    }
}

/**
 * Launch a desktop file by entry name, regardless of whether it's in
 * the AstalApps database. Prefers uwsm-app but falls back to gtk-launch
 * for entries not found in the scanned desktop file index.
 * Encapsulates all shell commands so widgets stay clean.
 */
export function launchDesktopFile(entry: string) {
    // Desktop files of apps run with `nix run` live in the store, not in the database.
    if (entry.startsWith('/')) {
        try {
            GLib.spawn_async(
                null,
                ['gio', 'launch', entry],
                null,
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL,
                null
            );
        } catch (e) {
            logger.error('apps', `Failed to launch ${entry}:`, e);
        }
        return;
    }
    // Try AstalApps lookup first
    const app = exactQuery(entry.replace('.desktop', ''))?.[0];
    if (app) {
        launchApp(app);
        return;
    }
    // Fallback for entries not in the scanned database
    try {
        GLib.spawn_command_line_async(`gtk-launch ${entry}`);
    } catch (e) {
        logger.error('apps', `Failed to launch ${entry}:`, e);
    }
}

/**
 * Start watching desktop file directories for changes and auto-reload.
 * Call once during app initialization.
 */
// Keep monitors rooted to prevent GJS from GC'ing them.
const appMonitors = new Set<Gio.FileMonitor>();

export function initAppWatcher() {
    for (const dir of DESKTOP_DIRS) {
        const file = Gio.File.new_for_path(dir);
        if (!file.query_exists(null)) continue;

        const monitor = file.monitor(
            Gio.FileMonitorFlags.WATCH_HARD_LINKS | Gio.FileMonitorFlags.WATCH_MOVES,
            null
        );
        appMonitors.add(monitor);
        monitor.connect('notify::cancelled', () => appMonitors.delete(monitor));

        monitor.connect('changed', (_mon, _file, _other, event) => {
            // Only reload on file creation/deletion, not on attribute changes
            if (
                event === Gio.FileMonitorEvent.CREATED ||
                event === Gio.FileMonitorEvent.DELETED ||
                event === Gio.FileMonitorEvent.MOVED_IN ||
                event === Gio.FileMonitorEvent.MOVED_OUT
            ) {
                // Debounce: multiple file changes happen in quick succession
                // (e.g. nixos-rebuild creating many .desktop files)
                if (reloadDebounceId !== null) {
                    GLib.source_remove(reloadDebounceId);
                }
                reloadDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    reloadDebounceId = null;
                    reloadApps();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        logger.info('apps', `Watching ${dir} for new desktop files`);
    }
}

defineService({name: 'AppWatcher', service: {init: () => initAppWatcher()}});
