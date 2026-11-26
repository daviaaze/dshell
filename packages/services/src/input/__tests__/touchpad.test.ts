import {Process} from '@shade/core/process';
import {bus} from '../../bus';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import Touchpad from '../touchpad';

class Grabber {
    callbacks: ((process: Process, code: number, signaled: boolean) => void)[] = [];
    killed = false;
    connect(_name: string, callback: (process: Process, code: number, signaled: boolean) => void) {
        this.callbacks.push(callback);
        return this.callbacks.length;
    }
    exit() {
        for (const callback of this.callbacks) callback(this as unknown as Process, 1, false);
    }
    kill() {
        this.killed = true;
        this.exit();
    }
}

describe('Touchpad grabber lifecycle', () => {
    it('restores enabled state when the grabber exits and removes command subscriptions on dispose', () => {
        const originalExec = Process.exec;
        const originalSpawn = Process.subprocessv;
        const grabbers: Grabber[] = [];
        Process.exec = (command) => {
            if (command.startsWith('test -f')) throw new Error('no EC device');
            return 'N: Name="Touchpad"\nH: Handlers=mouse0 event7';
        };
        Process.subprocessv = (argv) => {
            expect(argv[0]).toBe('python3');
            expect(argv[3]).toBe('/dev/input/event7');
            const process = new Grabber();
            grabbers.push(process);
            return process as unknown as Process;
        };
        const touchpad = new Touchpad();
        try {
            touchpad.init();
            touchpad.enabled = false;
            expect(touchpad.enabled).toBe(false);
            grabbers[0].exit();
            expect(touchpad.enabled).toBe(true);
            touchpad.enabled = false;
            expect(grabbers.length).toBe(2);
            touchpad.dispose();
            expect(grabbers[1].killed).toBe(true);
            bus.emit('input:touchpad:toggle');
            expect(grabbers.length).toBe(2);
            touchpad.init();
            expect(touchpad.available).toBe(true);
        } finally {
            touchpad.dispose();
            Process.exec = originalExec;
            Process.subprocessv = originalSpawn;
        }
    });
});

await run(import.meta.url);
