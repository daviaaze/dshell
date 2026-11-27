/**
 * Finding the .desktop file of an app started with `nix run` (or `nix shell`).
 *
 * Such apps are not in the profile, so their desktop entry is not under any
 * XDG data dir and AstalApps cannot see it. It does exist in the app's own
 * store path (`<store path>/share/applications/*.desktop`), and the running
 * process leaves enough traces to find that path: its executable, its command
 * line and, for wrapped GTK/Qt apps, the `XDG_DATA_DIRS` the wrapper set.
 *
 * This module is the pure part (no GLib/Gio): it picks store roots and chooses
 * the matching desktop entry. Reading `/proc` and the files lives in `apps.ts`.
 */

const STORE_ROOT = /^\/nix\/store\/[0-9a-z]{32}-[^/]+/;

/** A desktop file found under a store path, reduced to what matching needs. */
export interface DesktopCandidate {
    /** Absolute path of the .desktop file. */
    path: string;
    /** File name without `.desktop`. */
    id: string;
    /** `StartupWMClass`, or an empty string. */
    wmClass: string;
    /** First word of `Exec`, or an empty string. */
    executable: string;
    /** `NoDisplay` or `Hidden`. */
    hidden: boolean;
}

/** `/nix/store/<hash>-name` for any path inside the store, otherwise null. */
export function storeRoot(path: string): string | null {
    return STORE_ROOT.exec(path)?.[0] ?? null;
}

/**
 * Basename without the decorations Nix wrappers add: `.firefox-wrapped` and
 * `firefox-wrapped` both become `firefox`.
 */
export function normalizeExecutable(nameOrPath: string): string {
    const base = nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1).trim();
    return base.replace(/^\./, '').replace(/-wrapped$/, '');
}

/**
 * Store roots that may own the app's desktop file, most specific first and
 * without duplicates: the executable's root, then store paths in the command
 * line (interpreters such as python run `/nix/store/…-app/bin/.app-wrapped`),
 * then store paths in `XDG_DATA_DIRS` (wrapGAppsHook adds the app's own share).
 */
export function candidateRoots(source: {
    exe: string | null;
    cmdline: readonly string[];
    xdgDataDirs: string | null;
}): string[] {
    const roots: string[] = [];
    const add = (path: string | null | undefined) => {
        const root = path ? storeRoot(path) : null;
        if (root && !roots.includes(root)) roots.push(root);
    };
    add(source.exe);
    for (const argument of source.cmdline.slice(0, 8)) add(argument);
    for (const directory of (source.xdgDataDirs ?? '').split(':')) add(directory);
    return roots;
}

/**
 * Choose the desktop entry that belongs to a window.
 *
 * Order: `StartupWMClass` equals the window class, then the desktop id equals
 * the class, then the entry runs the same executable as the process. A lone
 * visible entry in the candidate list is used only when nothing else matches
 * and the list came from a single root, since that is unambiguous.
 */
export function pickDesktopEntry(
    candidates: readonly DesktopCandidate[],
    window: {cls: string; executable: string}
): DesktopCandidate | null {
    const visible = candidates.filter((candidate) => !candidate.hidden);
    const cls = window.cls.toLowerCase();
    const executable = normalizeExecutable(window.executable).toLowerCase();

    if (cls) {
        const byClass = visible.find((candidate) => candidate.wmClass.toLowerCase() === cls);
        if (byClass) return byClass;
        const byId = visible.find((candidate) => candidate.id.toLowerCase() === cls);
        if (byId) return byId;
    }
    if (executable) {
        const byExecutable = visible.find(
            (candidate) =>
                candidate.executable !== '' &&
                normalizeExecutable(candidate.executable).toLowerCase() === executable
        );
        if (byExecutable) return byExecutable;
    }
    const roots = new Set(visible.map((candidate) => storeRoot(candidate.path)));
    return visible.length === 1 && roots.size === 1 ? (visible[0] ?? null) : null;
}
