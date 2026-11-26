import {describe, expect, it, run} from '../../__tests__/test-runner';
import {JsonArrayFramer} from '../screencastGraph';

describe('Bounded PipeWire JSON framing', () => {
    it('rejects an oversized incomplete document and accepts a fresh document afterward', () => {
        const framer = new JsonArrayFramer(64);
        expect(framer.push('[{"value":"')).toEqual([]);
        expect(() => framer.push('x'.repeat(64))).toThrow();
        expect(framer.push('[{"id":1}]')).toEqual([[{id: 1}]]);
    });

    it('enforces the document limit across chunks, including unterminated strings', () => {
        const framer = new JsonArrayFramer(32);
        framer.push('["');
        framer.push('x'.repeat(20));
        expect(() => framer.push('y'.repeat(20))).toThrow();
        expect(framer.push('[]')).toEqual([[]]);
    });

    it('does not count preceding whitespace or adjacent valid documents against one limit', () => {
        const framer = new JsonArrayFramer(16);
        expect(framer.push(`${' '.repeat(100)}[1][2]`)).toEqual([[1], [2]]);
    });
});

await run(import.meta.url);
