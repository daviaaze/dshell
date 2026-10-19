import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {
    buildDefaultAppFamilyModel,
    registeredMimeFamilyTypes,
    setDefaultAppForTypes,
    type DefaultAppFamilyModel,
    type DefaultAppTypeState,
    type DefaultAppWriteResult,
    type MimeFamily,
} from '@shade/services/desktop/defaultApps';

type AppCategory =
    | {label: string; family: MimeFamily}
    | {label: string; contentType: string};

const CATEGORIES: AppCategory[] = [
    {label: 'Web Browser', contentType: 'x-scheme-handler/http'},
    {label: 'Email Client', contentType: 'x-scheme-handler/mailto'},
    {label: 'Music Player', family: 'audio'},
    {label: 'Video Player', family: 'video'},
    {label: 'Photo Viewer', family: 'image'},
    {label: 'Text Editor', contentType: 'text/plain'},
    {label: 'File Manager', contentType: 'inode/directory'},
    {label: 'Terminal', contentType: 'x-scheme-handler/terminal'},
];

function appName(app: Gio.AppInfo | null): string {
    return app ? app.get_display_name() || app.get_name() || 'Unknown application' : 'No default app';
}

function readType(contentType: string, mimeType: string): DefaultAppTypeState {
    const errors: string[] = [];
    let candidates: Gio.AppInfo[] = [];
    let current: Gio.AppInfo | null = null;

    try {
        candidates = Gio.AppInfo.get_all_for_type(contentType);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    try {
        current = Gio.AppInfo.get_default_for_type(contentType, false);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }

    return {
        contentType,
        mimeType,
        candidates,
        current,
        readError: errors.length > 0 ? errors.join('; ') : null,
    };
}

interface CategorySnapshot {
    model: DefaultAppFamilyModel;
    discoveryError: string | null;
}

function loadCategory(category: AppCategory): CategorySnapshot {
    if ('family' in category) {
        try {
            const registeredTypes = registeredMimeFamilyTypes(
                category.family,
                Gio.content_types_get_registered(),
                (contentType) => Gio.content_type_get_mime_type(contentType)
            );
            return {
                model: buildDefaultAppFamilyModel(
                    registeredTypes.map((type) => readType(type.contentType, type.mimeType))
                ),
                discoveryError: null,
            };
        } catch (error) {
            return {
                model: buildDefaultAppFamilyModel([]),
                discoveryError: error instanceof Error ? error.message : String(error),
            };
        }
    }

    return {
        model: buildDefaultAppFamilyModel([readType(category.contentType, category.contentType)]),
        discoveryError: null,
    };
}

function categoryDetailLines(
    snapshot: CategorySnapshot,
    lastWrite: DefaultAppWriteResult | null
): string[] {
    const lines: string[] = [];
    if (snapshot.discoveryError) {
        lines.push(`Could not enumerate registered formats: ${snapshot.discoveryError}`);
    }
    for (const type of snapshot.model.types) {
        if (type.readError) lines.push(`${type.mimeType}: ${type.readError}`);
    }
    if (lastWrite) {
        for (const result of lastWrite.results) {
            const type = snapshot.model.types.find((entry) => entry.contentType === result.contentType);
            const mimeType = type?.mimeType ?? result.contentType;
            lines.push(
                result.error === null
                    ? `${mimeType}: saved as ${appName(result.actual)}`
                    : `${mimeType}: ${result.error} Actual: ${appName(result.actual)}.`
            );
        }
    }
    for (const type of snapshot.model.types) {
        if (type.readError === null && type.candidates.length === 0 && type.current === null) {
            lines.push(`${type.mimeType}: no compatible app; unchanged.`);
        }
    }
    return lines;
}

function renderCategoryDetails(
    detailBox: Gtk.Box,
    details: Adw.ExpanderRow,
    lines: readonly string[]
): void {
    let child = detailBox.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        detailBox.remove(child);
        child = next;
    }

    for (const line of lines) {
        detailBox.append(
            new Gtk.Label({
                label: line,
                xalign: 0,
                wrap: true,
                cssClasses: ['caption'],
                marginStart: 12,
                marginEnd: 12,
            })
        );
    }
    details.visible = lines.length > 0;
}

function canChangeAnySupportedType(model: DefaultAppFamilyModel): boolean {
    return model.choices.some((choice) =>
        choice.supportedContentTypes.some((contentType) => {
            const type = model.types.find((entry) => entry.contentType === contentType);
            return (
                type !== undefined &&
                type.readError === null &&
                (type.current === null || !type.current.equal(choice.app))
            );
        })
    );
}

function stateDescription(category: AppCategory, model: DefaultAppFamilyModel): string {
    let description: string;
    if (model.defaults.kind === 'unread') {
        description = `Could not read one or more ${model.readErrorCount} format defaults; unread formats will not be changed.`;
    } else if (model.types.length === 0) {
        description = 'No registered concrete media types are available for this category.';
    } else if (model.choices.length === 0) {
        description = 'No compatible applications are available for the registered formats.';
    } else if (model.defaults.kind === 'uniform') {
        description = `${appName(model.defaults.app)} is the default for all ${model.types.length} registered format${model.types.length === 1 ? '' : 's'}.`;
    } else if (model.defaults.kind === 'none') {
        description = `No app is currently the default for any of these ${model.types.length} registered format${model.types.length === 1 ? '' : 's'}.`;
    } else if (model.defaults.kind === 'mixed') {
        description = 'Defaults differ across the registered formats; choosing an app changes only formats it supports.';
    } else {
        description = `Choose a default for ${category.label}.`;
    }

    if (model.unsupportedTypeCount > 0 && model.choices.length > 0) {
        description += ` ${model.unsupportedTypeCount} format${model.unsupportedTypeCount === 1 ? ' has' : 's have'} no compatible app and will be unchanged.`;
    }
    return description;
}

function resultDescription(result: DefaultAppWriteResult): string {
    const saved = result.results.filter((entry) => entry.error === null).length;
    const failed = result.results.length - saved;
    if (result.status === 'saved') {
        return `Saved for all ${saved} supported format${saved === 1 ? '' : 's'}.`;
    }
    if (result.status === 'partial') {
        return `Saved for ${saved} of ${result.results.length} supported formats; ${failed} did not change.`;
    }
    return `Could not apply the selected app to any of its ${failed} supported format${failed === 1 ? '' : 's'}.`;
}

function selectableAppLabel(app: Gio.AppInfo): string {
    const name = appName(app);
    const executable = app.get_executable();
    return executable ? `${name} (${executable})` : name;
}

function categoryRow(group: Adw.PreferencesGroup, category: AppCategory) {
    const row = new Adw.ComboRow({title: category.label});
    const details = new Adw.ExpanderRow({
        title: `${category.label} format details`,
        subtitle: 'Read and write results by format',
    });
    const detailBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
    details.add_row(detailBox as unknown as Gtk.Widget);
    group.add(row as unknown as Gtk.Widget);
    group.add(details as unknown as Gtk.Widget);

    let snapshot = loadCategory(category);
    let lastWrite: DefaultAppWriteResult | null = null;
    let reconciling = true;
    let selectionOffset = 0;
    let pendingWrite = 0;
    row.connect('destroy', () => {
        if (pendingWrite) GLib.Source.remove(pendingWrite);
        pendingWrite = 0;
    });

    const refreshDetailRows = () =>
        renderCategoryDetails(detailBox, details, categoryDetailLines(snapshot, lastWrite));

    const describe = () => {
        const description = snapshot.discoveryError
            ? `Could not read registered formats: ${snapshot.discoveryError}`
            : stateDescription(category, snapshot.model);
        row.subtitle = lastWrite ? `${resultDescription(lastWrite)} ${description}` : description;
    };

    const reconcileSelection = () => {
        reconciling = true;
        const uniformApp =
            snapshot.model.defaults.kind === 'uniform' ? snapshot.model.defaults.app : null;
        const selectedIndex = uniformApp
            ? snapshot.model.choices.findIndex((choice) => choice.app.equal(uniformApp))
            : -1;
        const model = new Gtk.StringList();
        selectionOffset = selectedIndex < 0 ? 1 : 0;
        if (selectionOffset) {
            // Native ComboRow auto-selects index zero and rejects an invalid
            // selection on a populated model. This row never represents an app.
            model.append(snapshot.model.defaults.kind === 'mixed' ? 'Mixed defaults'
                : snapshot.model.defaults.kind === 'unread' ? 'Defaults unavailable'
                : 'No default application');
        }
        snapshot.model.choices.forEach((choice) => model.append(selectableAppLabel(choice.app)));
        row.model = model;
        row.selected = selectedIndex < 0 ? 0 : selectedIndex;
        row.sensitive = canChangeAnySupportedType(snapshot.model);
        reconciling = false;
        describe();
        refreshDetailRows();
    };

    row.connect('notify::selected', () => {
        if (reconciling || pendingWrite) return;
        const choice = snapshot.model.choices[row.selected - selectionOffset];
        if (!choice || choice.supportedContentTypes.every((contentType) => {
            const current = snapshot.model.types.find((type) => type.contentType === contentType)?.current;
            return current !== null && current !== undefined && current.equal(choice.app);
        })) return;

        row.sensitive = false;
        // Replacing a native selection model during its notify signal can
        // re-enter GTK selection dispatch. Apply and reconcile after it unwinds.
        pendingWrite = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingWrite = 0;
            lastWrite = setDefaultAppForTypes(choice.app, choice.supportedContentTypes, {
                setDefault: (app, type) => app.set_as_default_for_type(type),
                getDefault: (type) => Gio.AppInfo.get_default_for_type(type, false),
            });
            snapshot = loadCategory(category);
            reconcileSelection();
            return GLib.SOURCE_REMOVE;
        });
    });

    // Install the model before its confirmed app index or explicit non-app status.
    reconcileSelection();
}

export default () => {
    const group = new Adw.PreferencesGroup({
        title: 'Default Applications',
        description: 'Choose defaults for registered media formats and common actions',
    });

    CATEGORIES.forEach((category) => categoryRow(group, category));

    return group;
};
