import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {
    parseSelection,
    REUSE_WINDOW_MS,
    type RememberedSelection,
    selectionLine,
    selectionToReplay,
} from '../reuse';

const NOW = 1_000_000;
const remembered: RememberedSelection = {
    requester: ':1.360',
    kind: 'window',
    id: '619159856',
    allowToken: false,
    at: NOW - 600,
};
const everythingExists = () => true;

describe('selectionToReplay', () => {
    it('replays the selection the same requester made moments ago', () => {
        expect(selectionToReplay(remembered, ':1.360', NOW, everythingExists)).toEqual(remembered);
    });

    it('asks again for a different requester', () => {
        expect(selectionToReplay(remembered, ':1.361', NOW, everythingExists)).toBe(null);
        expect(selectionToReplay(remembered, null, NOW, everythingExists)).toBe(null);
    });

    it('asks again once the window has passed, so a deliberate new share is not hijacked', () => {
        const stale = {...remembered, at: NOW - REUSE_WINDOW_MS - 1};
        expect(selectionToReplay(stale, ':1.360', NOW, everythingExists)).toBe(null);
    });

    it('asks again when the remembered time is in the future', () => {
        const future = {...remembered, at: NOW + 1000};
        expect(selectionToReplay(future, ':1.360', NOW, everythingExists)).toBe(null);
    });

    it('asks again when the window or output no longer exists', () => {
        expect(selectionToReplay(remembered, ':1.360', NOW, () => false)).toBe(null);
    });

    it('checks existence of the remembered kind and id, not just any source', () => {
        const asked: string[] = [];
        selectionToReplay(remembered, ':1.360', NOW, (kind, id) => {
            asked.push(`${kind}:${id}`);
            return true;
        });
        expect(asked).toEqual(['window:619159856']);
    });

    it('has nothing to replay without a remembered selection', () => {
        expect(selectionToReplay(null, ':1.360', NOW, everythingExists)).toBe(null);
    });
});

describe('parseSelection', () => {
    it('reads back what the picker stored', () => {
        expect(parseSelection(JSON.stringify(remembered))).toEqual(remembered);
    });

    it('rejects missing, malformed or wrongly typed input', () => {
        expect(parseSelection(null)).toBe(null);
        expect(parseSelection('not json')).toBe(null);
        expect(
            parseSelection('{"requester":":1.1","kind":"tab","id":"1","allowToken":false,"at":1}')
        ).toBe(null);
        expect(
            parseSelection('{"requester":":1.1","kind":"screen","id":"","allowToken":false,"at":1}')
        ).toBe(null);
        expect(
            parseSelection('{"requester":":1.1","kind":"screen","id":"a","allowToken":"no","at":1}')
        ).toBe(null);
    });
});

describe('selectionLine', () => {
    it('writes the line XDPH parses, with the token flag only when allowed', () => {
        expect(selectionLine('window', '42', false)).toBe('[SELECTION]/window:42');
        expect(selectionLine('screen', 'eDP-1', true)).toBe('[SELECTION]r/screen:eDP-1');
    });
});

run();
