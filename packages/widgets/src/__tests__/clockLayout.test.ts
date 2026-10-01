import Gtk from 'gi://Gtk?version=4.0';
import {clockLayoutOrientation} from '../bar/clock';
import {describe, expect, it, run} from './test-runner';

describe('bar clock orientation', () => {
    it('uses vertical orientation for vertical bars and horizontal for horizontal bars', () => {
        expect(clockLayoutOrientation(true)).toBe(Gtk.Orientation.VERTICAL);
        expect(clockLayoutOrientation(false)).toBe(Gtk.Orientation.HORIZONTAL);
    });
});

await run();
