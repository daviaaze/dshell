import type Gio from 'gi://Gio?version=2.0';
import {
    buildDefaultAppFamilyModel,
    registeredMimeFamilyTypes,
    setDefaultAppForTypes,
    type DefaultAppTypeState,
} from '../desktop/defaultApps';
import {describe, expect, it, run} from './test-runner';

interface TestApp extends Gio.AppInfo {
    id: string;
    displayName: string;
}

function app(id: string, displayName = id): TestApp {
    return {
        id,
        displayName,
        equal(other: Gio.AppInfo) {
            return (other as TestApp).id === id;
        },
    } as unknown as TestApp;
}

function typeState(
    contentType: string,
    mimeType: string,
    candidates: Gio.AppInfo[] = [],
    current: Gio.AppInfo | null = null,
    readError: string | null = null
): DefaultAppTypeState {
    return {contentType, mimeType, candidates, current, readError};
}

describe('registeredMimeFamilyTypes', () => {
    it('keeps sorted, distinct concrete MIME types from only the exact family', () => {
        const mimeByContentType: Record<string, string | null> = {
            'audio/ogg': 'audio/ogg',
            'audio/mpeg': 'audio/mpeg',
            'video/mp4': 'video/mp4',
            'application/x-wildcard': 'audio/*',
            'application/x-malformed': 'audio/not a mime',
            'audiox/example': 'audiox/example',
            'application/x-null': null,
            'audio/*': 'audio/ogg',
            'not a valid content type': 'audio/ogg',
        };
        const types = registeredMimeFamilyTypes(
            'audio',
            [
                'audio/ogg',
                'audio/mpeg',
                'audio/ogg',
                'video/mp4',
                'application/x-wildcard',
                'application/x-malformed',
                'audiox/example',
                'application/x-null',
                'audio/*',
                'not a valid content type',
            ],
            (contentType) => mimeByContentType[contentType] ?? null
        );

        expect(types.map((type) => type.contentType)).toEqual(['audio/mpeg', 'audio/ogg']);
        expect(types.map((type) => type.mimeType)).toEqual(['audio/mpeg', 'audio/ogg']);
        expect(() =>
            registeredMimeFamilyTypes('audio', ['application/x-throws'], () => {
                throw new Error('lookup failed');
            })
        ).toThrow();
    });

    it('accepts case-insensitive family names and concrete vendor tokens', () => {
        const types = registeredMimeFamilyTypes(
            'image',
            ['image/vnd.example+raw'],
            () => 'Image/vnd.example+raw'
        );
        expect(types.length).toBe(1);
        expect(types[0]?.mimeType).toBe('Image/vnd.example+raw');
    });
});


describe('buildDefaultAppFamilyModel', () => {
    it('distinguishes empty, none, uniform and mixed family defaults', () => {
        const current = app('player');
        const equivalent = app('player', 'Different display name');
        expect(buildDefaultAppFamilyModel([]).defaults.kind).toBe('none');
        expect(
            buildDefaultAppFamilyModel([
                typeState('audio/a', 'audio/a'),
                typeState('audio/b', 'audio/b'),
            ]).defaults.kind
        ).toBe('none');
        expect(
            buildDefaultAppFamilyModel([
                typeState('audio/a', 'audio/a', [], current),
                typeState('audio/b', 'audio/b', [], equivalent),
            ]).defaults.kind
        ).toBe('uniform');
        expect(
            buildDefaultAppFamilyModel([
                typeState('audio/a', 'audio/a', [], current),
                typeState('audio/b', 'audio/b'),
            ]).defaults.kind
        ).toBe('mixed');
    });

    it('unions apps by AppInfo equality and keeps current-only and same-name apps', () => {
        const candidate = app('candidate', 'Same label');
        const equalCandidate = app('candidate', 'Alternate label');
        const currentOnly = app('current-only', 'Existing app');
        const sameNameDifferentApp = app('different', 'Same label');
        const model = buildDefaultAppFamilyModel([
            typeState('audio/a', 'audio/a', [candidate], currentOnly),
            typeState('audio/b', 'audio/b', [equalCandidate, sameNameDifferentApp], sameNameDifferentApp),
        ]);

        expect(model.choices.length).toBe(3);
        const candidateChoice = model.choices.find((choice) => (choice.app as TestApp).id === 'candidate');
        const currentChoice = model.choices.find((choice) => (choice.app as TestApp).id === 'current-only');
        const distinctSameNameChoice = model.choices.find((choice) => (choice.app as TestApp).id === 'different');
        expect(candidateChoice?.supportedContentTypes).toEqual(['audio/a', 'audio/b']);
        expect(currentChoice?.supportedContentTypes).toEqual(['audio/a']);
        expect(distinctSameNameChoice?.supportedContentTypes).toEqual(['audio/b']);
        expect(model.defaults.kind).toBe('mixed');
    });

    it('marks the whole family unread and excludes errored formats from every choice', () => {
        const shared = app('shared');
        const model = buildDefaultAppFamilyModel([
            typeState('audio/readable', 'audio/ogg', [shared], null),
            typeState('audio/unknown', 'audio/wav', [shared], app('unknown-current'), 'permission denied'),
        ]);

        expect(model.defaults.kind).toBe('unread');
        expect(model.readErrorCount).toBe(1);
        expect(model.choices.length).toBe(1);
        expect(model.choices[0]?.supportedContentTypes).toEqual(['audio/readable']);
    });

    it('counts readable types without candidates or a current app as unsupported', () => {
        const model = buildDefaultAppFamilyModel([
            typeState('audio/unsupported', 'audio/example'),
            typeState('audio/supported', 'audio/ogg', [app('player')]),
        ]);

        expect(model.unsupportedTypeCount).toBe(1);
        expect(model.choices[0]?.supportedContentTypes).toEqual(['audio/supported']);
    });
});

describe('setDefaultAppForTypes', () => {
    it('trusts matching readback even when the writer returns false', () => {
        const selected = app('selected');
        const events: string[] = [];
        const result = setDefaultAppForTypes(selected, ['audio/ogg'], {
            setDefault: (_app, type) => {
                events.push(`set:${type}`);
                return false;
            },
            getDefault: (type) => {
                events.push(`read:${type}`);
                return app('selected');
            },
        });

        expect(events).toEqual(['set:audio/ogg', 'read:audio/ogg']);
        expect(result.status).toBe('saved');
        expect(result.results[0]?.error).toBeNull();
    });

    it('attempts each supported type independently and reports only confirmed writes', () => {
        const selected = app('selected');
        const previous = app('previous');
        const actualByType: Record<string, Gio.AppInfo | null> = {
            'audio/success': previous,
            'audio/failure': previous,
        };
        const events: string[] = [];
        const result = setDefaultAppForTypes(selected, ['audio/success', 'audio/failure'], {
            setDefault: (_app, type) => {
                events.push(`set:${type}`);
                if (type === 'audio/success') {
                    actualByType[type] = app('selected');
                    return true;
                }
                return false;
            },
            getDefault: (type) => {
                events.push(`read:${type}`);
                return actualByType[type] ?? null;
            },
        });

        expect(events).toEqual([
            'set:audio/success',
            'read:audio/success',
            'set:audio/failure',
            'read:audio/failure',
        ]);
        expect(result.status).toBe('partial');
        expect(result.results.length).toBe(2);
        expect(result.results[0]?.error).toBeNull();
        expect(result.results[1]?.actual).toBe(previous);
        expect(result.results[1]?.error).toBe('The system did not accept the default-app change.');
    });

    it('reports failed when every supported type remains on its prior default', () => {
        const selected = app('selected');
        const previous = app('previous');
        let writes = 0;
        const result = setDefaultAppForTypes(selected, ['image/png', 'image/jpeg'], {
            setDefault: () => {
                writes++;
                return true;
            },
            getDefault: () => previous,
        });

        expect(writes).toBe(2);
        expect(result.status).toBe('failed');
        expect(result.results.length).toBe(2);
        expect(result.results[0]?.actual).toBe(previous);
        expect(result.results[0]?.error).toBe('The requested app is not the active default.');
    });

    it('always reads after a thrown setter and accepts a matching actual default', () => {
        const selected = app('selected');
        const events: string[] = [];
        const result = setDefaultAppForTypes(selected, ['video/mp4'], {
            setDefault: (_app, type) => {
                events.push(`set:${type}`);
                throw new Error('permission warning after commit');
            },
            getDefault: (type) => {
                events.push(`read:${type}`);
                return app('selected');
            },
        });

        expect(events).toEqual(['set:video/mp4', 'read:video/mp4']);
        expect(result.status).toBe('saved');
        expect(result.results[0]?.error).toBeNull();
    });

    it('reports readback exceptions as failures without retrying or rolling back', () => {
        const selected = app('selected');
        let writes = 0;
        let reads = 0;
        const result = setDefaultAppForTypes(selected, ['image/png'], {
            setDefault: () => {
                writes++;
                throw new Error('write denied');
            },
            getDefault: () => {
                reads++;
                throw new Error('read denied');
            },
        });

        expect(writes).toBe(1);
        expect(reads).toBe(1);
        expect(result.status).toBe('failed');
        expect(result.results[0]?.actual).toBeNull();
        expect(result.results[0]?.error).toBe('Could not read back the actual default: read denied');
    });

    it('never forwards wildcard or malformed content-type values to the writer', () => {
        const selected = app('selected');
        let writes = 0;
        let reads = 0;
        const result = setDefaultAppForTypes(selected, ['audio/*', '', 'video/*', 'not-a-type'], {
            setDefault: () => {
                writes++;
                return true;
            },
            getDefault: () => {
                reads++;
                return selected;
            },
        });

        expect(writes).toBe(0);
        expect(reads).toBe(0);
        expect(result.status).toBe('failed');
        expect(result.results.length).toBe(0);
    });
});

await run(import.meta.url);
