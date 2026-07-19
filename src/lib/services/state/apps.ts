import Apps from 'gi://AstalApps';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Hyprland from 'gi://AstalHyprland';
import {toArray} from '#/lib/core/gjsUtils';
import logger from '#/lib/core/logger';

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
        if (
            value === terms.cls ||
            value === terms.title ||
            value === terms.initialTitle
        ) {
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

export function getAppForClient(
    client: Hyprland.Client
): Apps.Application | null {
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
        a => a.entry?.toLowerCase().replace('.desktop', '') ?? ''
    );
    if (entryMatch) return entryMatch;

    // 2. Exact AstalApps query
    const exactFromCls = queryTerm(terms.cls, exactQuery);
    if (exactFromCls) return exactFromCls;
    const exactFromTitle = queryTerm(terms.title, exactQuery);
    if (exactFromTitle) return exactFromTitle;

    // 3. Executable name match
    const execMatch = matchByGetter(allApps, terms, a =>
        getExecutableName(a.executable)
    );
    if (execMatch) return execMatch;

    // 4. App name match
    const nameMatch = matchByGetter(
        allApps,
        terms,
        a => a.name?.toLowerCase() ?? ''
    );
    if (nameMatch) return nameMatch;

    // 5. Fuzzy query fallback
    const fuzzyFromCls = queryTerm(terms.cls, fuzzyQuery);
    if (fuzzyFromCls) return fuzzyFromCls;
    const fuzzyFromTitle = queryTerm(terms.title, fuzzyQuery);
    if (fuzzyFromTitle) return fuzzyFromTitle;

    return null;
}

export function getAppIcon(client: Hyprland.Client): string {
    const cls = client.class;
    if (!cls) return 'image-missing-symbolic';

    // Check hardcoded overrides first
    if (CLASS_OVERRIDES[cls]) return CLASS_OVERRIDES[cls];

    // Try AstalApps database lookup
    const app = getAppForClient(client);
    if (app?.iconName) return app.iconName;

    // Fallback: use the client class as an icon name directly.
    // Most apps set their wm_class to match their icon name (e.g.
    // class "firefox" → icon "firefox", class "Code" → icon "code").
    return cls.toLowerCase();
}

export function getDesktopFileForClient(
    client: Hyprland.Client
): string | null {
    const app = getAppForClient(client);
    return app?.entry || null;
}

// ── App database auto-refresh ──
// AstalApps loads desktop files once at construction. Newly installed apps
// won't appear until the database is reloaded. We watch the standard desktop
// file directories and call reload() on changes.

const DESKTOP_DIRS = [
    `${GLib.get_home_dir()}/.local/share/applications`,
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
        GLib.spawn_command_line_async(
            `uwsm-app -t service -- ${application.entry}`
        );
    } catch (e) {
        logger.error('apps', `Failed to launch ${application.entry}:`, e);
    }
}

/**
 * Start watching desktop file directories for changes and auto-reload.
 * Call once during app initialization.
 */
export function initAppWatcher() {
    for (const dir of DESKTOP_DIRS) {
        const file = Gio.File.new_for_path(dir);
        if (!file.query_exists(null)) continue;

        const monitor = file.monitor(
            Gio.FileMonitorFlags.WATCH_HARD_LINKS |
                Gio.FileMonitorFlags.WATCH_MOVES,
            null
        );

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
                reloadDebounceId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    2000,
                    () => {
                        reloadDebounceId = null;
                        reloadApps();
                        return GLib.SOURCE_REMOVE;
                    }
                );
            }
        });

        logger.info('apps', `Watching ${dir} for new desktop files`);
    }
}
