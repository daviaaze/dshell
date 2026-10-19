import type Gio from 'gi://Gio?version=2.0';

export type MimeFamily = 'audio' | 'video' | 'image';

export interface RegisteredMimeType {
    contentType: string;
    mimeType: string;
}

export interface DefaultAppTypeState {
    contentType: string;
    mimeType: string;
    candidates: readonly Gio.AppInfo[];
    current: Gio.AppInfo | null;
    readError: string | null;
}

export interface DefaultAppChoice {
    app: Gio.AppInfo;
    supportedContentTypes: readonly string[];
}

export type DefaultAppFamilyDefaults =
    | {kind: 'none' | 'mixed' | 'unread'; app: null}
    | {kind: 'uniform'; app: Gio.AppInfo};

export interface DefaultAppFamilyModel {
    types: readonly DefaultAppTypeState[];
    choices: readonly DefaultAppChoice[];
    defaults: DefaultAppFamilyDefaults;
    readErrorCount: number;
    unsupportedTypeCount: number;
}

export interface DefaultAppTypeWriteResult {
    contentType: string;
    requested: Gio.AppInfo;
    actual: Gio.AppInfo | null;
    error: string | null;
}

export interface DefaultAppWriteResult {
    status: 'saved' | 'partial' | 'failed';
    results: readonly DefaultAppTypeWriteResult[];
}

const MIME_TYPE_PATTERN = /^[a-z0-9!#$&'+.^_`|~%-]+\/[a-z0-9!#$&'+.^_`|~%-]+$/i;

function isConcreteMimeType(mimeType: string): boolean {
    return MIME_TYPE_PATTERN.test(mimeType);
}

function sameApp(left: Gio.AppInfo, right: Gio.AppInfo): boolean {
    return left === right || left.equal(right);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function familyDefaults(
    types: readonly DefaultAppTypeState[],
    readErrorCount: number
): DefaultAppFamilyDefaults {
    if (readErrorCount > 0) return {kind: 'unread', app: null};
    if (types.every((type) => type.current === null)) return {kind: 'none', app: null};

    const first = types[0]?.current;
    if (
        first &&
        types.every((type) => type.current !== null && sameApp(first, type.current))
    ) {
        return {kind: 'uniform', app: first};
    }

    return {kind: 'mixed', app: null};
}

function writeDefaultForType(
    app: Gio.AppInfo,
    contentType: string,
    writer: {
        setDefault(app: Gio.AppInfo, type: string): boolean;
        getDefault(type: string): Gio.AppInfo | null;
    }
): DefaultAppTypeWriteResult {
    let accepted: boolean | null = null;
    let writeError: string | null = null;
    try {
        accepted = writer.setDefault(app, contentType);
    } catch (error) {
        writeError = errorMessage(error);
    }

    let actual: Gio.AppInfo | null = null;
    let readError: string | null = null;
    try {
        actual = writer.getDefault(contentType);
    } catch (error) {
        readError = errorMessage(error);
    }

    let error: string | null = null;
    if (actual === null || !sameApp(actual, app)) {
        if (readError !== null) {
            error = `Could not read back the actual default: ${readError}`;
        } else if (writeError !== null) {
            error = `Could not set the default app: ${writeError}`;
        } else if (accepted === false) {
            error = 'The system did not accept the default-app change.';
        } else {
            error = 'The requested app is not the active default.';
        }
    }

    return {contentType, requested: app, actual, error};
}

function addSupportedApp(
    choices: Array<{app: Gio.AppInfo; supportedContentTypes: string[]}>,
    app: Gio.AppInfo,
    contentType: string
): void {
    const choice = choices.find((candidate) => sameApp(candidate.app, app));
    if (choice) {
        if (!choice.supportedContentTypes.includes(contentType)) {
            choice.supportedContentTypes.push(contentType);
        }
        return;
    }

    choices.push({app, supportedContentTypes: [contentType]});
}

/** Return concrete, deduplicated registered types in one exact media family. */
export function registeredMimeFamilyTypes(
    family: MimeFamily,
    registeredTypes: readonly string[],
    getMimeType: (type: string) => string | null
): RegisteredMimeType[] {
    const byContentType = new Map<string, RegisteredMimeType>();

    for (const contentType of registeredTypes) {
        if (!isConcreteMimeType(contentType)) continue;
        const mimeType = getMimeType(contentType);
        if (
            mimeType === null ||
            !isConcreteMimeType(mimeType) ||
            mimeType.slice(0, mimeType.indexOf('/')).toLowerCase() !== family
        ) {
            continue;
        }

        if (!byContentType.has(contentType)) {
            byContentType.set(contentType, {contentType, mimeType});
        }
    }

    return [...byContentType.values()].sort(
        (left, right) =>
            left.mimeType.localeCompare(right.mimeType) ||
            left.contentType.localeCompare(right.contentType)
    );
}

/**
 * Build a family-wide current state and a union of candidate/current applications.
 * A read-error type is not treated as writable because its current association is unknown.
 */
export function buildDefaultAppFamilyModel(
    types: readonly DefaultAppTypeState[]
): DefaultAppFamilyModel {
    const choices: Array<{app: Gio.AppInfo; supportedContentTypes: string[]}> = [];
    let unsupportedTypeCount = 0;
    const readErrorCount = types.reduce((count, type) => count + (type.readError === null ? 0 : 1), 0);

    for (const type of types) {
        if (type.readError !== null) continue;
        if (type.candidates.length === 0 && type.current === null) {
            unsupportedTypeCount++;
            continue;
        }

        for (const candidate of type.candidates) {
            addSupportedApp(choices, candidate, type.contentType);
        }
        if (type.current) addSupportedApp(choices, type.current, type.contentType);
    }

    const defaults = familyDefaults(types, readErrorCount);

    return {
        types,
        choices,
        defaults,
        readErrorCount,
        unsupportedTypeCount,
    };
}

/**
 * Independently apply the selected app to its supported concrete types, then
 * trust readback rather than the setter's return value for each outcome.
 */
export function setDefaultAppForTypes(
    app: Gio.AppInfo,
    supportedContentTypes: readonly string[],
    writer: {
        setDefault(app: Gio.AppInfo, type: string): boolean;
        getDefault(type: string): Gio.AppInfo | null;
    }
): DefaultAppWriteResult {
    const contentTypes = [...new Set(supportedContentTypes)].filter(isConcreteMimeType);
    const results: DefaultAppTypeWriteResult[] = [];

    for (const contentType of contentTypes) {
        results.push(writeDefaultForType(app, contentType, writer));
    }

    const savedCount = results.reduce((count, result) => count + (result.error === null ? 1 : 0), 0);
    let status: DefaultAppWriteResult['status'];
    if (results.length === 0 || savedCount === 0) {
        status = 'failed';
    } else if (savedCount === results.length) {
        status = 'saved';
    } else {
        status = 'partial';
    }

    return {status, results};
}
