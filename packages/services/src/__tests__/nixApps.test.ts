import {
    candidateRoots,
    type DesktopCandidate,
    normalizeExecutable,
    pickDesktopEntry,
    storeRoot,
} from '../state/nixApps';
import {describe, expect, it, run} from './test-runner';

const HASH = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

const entry = (over: Partial<DesktopCandidate> & {id: string}): DesktopCandidate => ({
    path: `/nix/store/${HASH}-app-1.0/share/applications/${over.id}.desktop`,
    wmClass: '',
    executable: '',
    hidden: false,
    ...over,
});

describe('storeRoot', () => {
    it('returns the store path of any file inside it', () => {
        expect(storeRoot(`/nix/store/${HASH}-app-1.0/bin/app`)).toBe(`/nix/store/${HASH}-app-1.0`);
    });

    it('rejects paths outside the store or with a malformed hash', () => {
        expect(storeRoot('/usr/bin/app')).toBeNull();
        expect(storeRoot('/nix/store/short-app/bin/app')).toBeNull();
    });
});

describe('normalizeExecutable', () => {
    it('drops the directory and nix wrapper decorations', () => {
        expect(normalizeExecutable('/nix/store/x/bin/.firefox-wrapped')).toBe('firefox');
        expect(normalizeExecutable('firefox-wrapped')).toBe('firefox');
        expect(normalizeExecutable('/bin/kitty')).toBe('kitty');
    });
});

describe('candidateRoots', () => {
    it('orders executable, command line, then XDG_DATA_DIRS without duplicates', () => {
        const roots = candidateRoots({
            exe: `/nix/store/${OTHER}-python3-3.12/bin/python3.12`,
            cmdline: [
                'python3',
                `/nix/store/${HASH}-app-1.0/bin/.app-wrapped`,
                `/nix/store/${OTHER}-python3-3.12/lib/x.py`,
            ],
            xdgDataDirs: `/usr/share:/nix/store/${HASH}-app-1.0/share:/run/current-system/sw/share`,
        });
        expect(roots).toEqual([`/nix/store/${OTHER}-python3-3.12`, `/nix/store/${HASH}-app-1.0`]);
    });

    it('returns nothing for a process outside the store', () => {
        expect(candidateRoots({exe: '/usr/bin/app', cmdline: ['app'], xdgDataDirs: null})).toEqual(
            []
        );
    });
});

describe('pickDesktopEntry', () => {
    it('prefers StartupWMClass over every other signal', () => {
        const wanted = entry({id: 'org.example.App', wmClass: 'ExampleApp'});
        const decoy = entry({id: 'exampleapp'});
        const picked = pickDesktopEntry([decoy, wanted], {cls: 'exampleapp', executable: ''});
        expect(picked?.id).toBe('org.example.App');
    });

    it('falls back to the desktop id, then to the executable', () => {
        const byId = entry({id: 'kitty'});
        expect(pickDesktopEntry([byId], {cls: 'kitty', executable: ''})?.id).toBe('kitty');

        const byExec = entry({id: 'org.example.Edit', executable: '/nix/store/x/bin/edit'});
        const other = entry({id: 'org.example.Other', executable: 'other'});
        expect(
            pickDesktopEntry([other, byExec], {cls: 'unknown', executable: '/n/bin/.edit-wrapped'})
                ?.id
        ).toBe('org.example.Edit');
    });

    it('ignores hidden entries', () => {
        const hidden = entry({id: 'kitty', hidden: true});
        expect(pickDesktopEntry([hidden], {cls: 'kitty', executable: 'kitty'})).toBeNull();
    });

    it('uses a lone visible entry only when it is unambiguous', () => {
        const only = entry({id: 'whatever'});
        expect(pickDesktopEntry([only], {cls: 'zzz', executable: 'zzz'})?.id).toBe('whatever');

        const second = entry({id: 'second'});
        expect(pickDesktopEntry([only, second], {cls: 'zzz', executable: 'zzz'})).toBeNull();

        const elsewhere = entry({
            id: 'third',
            path: `/nix/store/${OTHER}-lib-1/share/applications/third.desktop`,
        });
        expect(pickDesktopEntry([only, elsewhere], {cls: 'zzz', executable: 'zzz'})).toBeNull();
    });
});

await run(import.meta.url);
