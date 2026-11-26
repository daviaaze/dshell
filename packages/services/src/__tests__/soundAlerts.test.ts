import GLib from 'gi://GLib?version=2.0';
import {
    NotificationSoundTracker,
    SoundPlayer,
    soundProcessPreload,
    spawnSoundProcess,
    type SoundId,
    type SoundPolicy,
} from '../audio/soundAlerts';
import {describe, expect, it, run} from './test-runner';

function fixture() {
    const policy: SoundPolicy = {
        enabled: true,
        dnd: false,
        notification: true,
        capture: true,
        battery: true,
        system: true,
        power: true,
        bluetooth: true,
        temperature: true,
        volume: false,
    };
    const calls: string[][] = [];
    let now = 0;
    let available = true;
    const player = new SoundPlayer(() => policy, {
        available: () => available,
        now: () => now,
        spawn: (argv) => {
            calls.push(argv);
            return Promise.resolve('');
        },
        failed: () => {},
    });
    return {
        player,
        policy,
        calls,
        setNow: (value: number) => { now = value; },
        setAvailable: (value: boolean) => { available = value; },
    };
}

describe('sound playback gating', () => {
    it('passes only allowlisted event IDs as an argv array', () => {
        const {player, calls} = fixture();
        player.play('power-plug');
        expect(calls).toEqual([['canberra-gtk-play', '--id', 'power-plug']]);
        player.play('power-plug; touch /tmp/unwanted' as SoundId);
        expect(calls.length).toBe(1);
    });

    it('respects the master toggle, DND and unavailable sound player', () => {
        const f = fixture();
        f.policy.enabled = false;
        f.player.play('battery-caution');
        f.policy.enabled = true;
        f.policy.dnd = true;
        f.player.play('power-plug');
        f.policy.dnd = false;
        f.setAvailable(false);
        f.player.play('power-plug');
        expect(f.calls).toEqual([]);
    });

    it('respects every event-family switch', () => {
        const events = {
            notification: 'message-new-instant',
            capture: 'screen-capture',
            battery: 'battery-low',
            system: 'screen-lock',
            power: 'power-plug',
            bluetooth: 'device-added',
            temperature: 'dialog-warning',
        } as const;
        for (const category of Object.keys(events) as (keyof typeof events)[]) {
            const f = fixture();
            f.policy[category] = false;
            f.player.play(events[category]);
            expect(f.calls).toEqual([]);
        }
    });

    it('keeps volume feedback off by default and allows opt-in', () => {
        const f = fixture();
        f.player.play('audio-volume-change');
        expect(f.calls).toEqual([]);
        f.policy.volume = true;
        f.player.play('audio-volume-change');
        expect(f.calls.length).toBe(1);
    });

    it('coalesces device and capture bursts without suppressing later interactions', () => {
        const f = fixture();
        f.player.play('device-added');
        f.setNow(500);
        f.player.play('device-added');
        expect(f.calls.length).toBe(1);
        f.setNow(1000);
        f.player.play('device-added');
        f.player.play('screen-capture');
        f.player.play('screen-capture');
        expect(f.calls.length).toBe(3);
    });

    it('contains synchronous and asynchronous spawn errors', async () => {
        let failures = 0;
        const f = fixture();
        const runtime = {
            available: () => true,
            now: () => 0,
            spawn: (_argv: string[]): Promise<string> => { throw new Error('gone'); },
            failed: () => { failures++; },
        };
        new SoundPlayer(() => f.policy, runtime).play('power-plug');
        runtime.spawn = () => Promise.reject(new Error('missing sound'));
        new SoundPlayer(() => f.policy, runtime).play('power-plug');
        await Promise.resolve();
        expect(failures).toBe(2);
    });
});

describe('notification arrival sounds', () => {
    it('makes same-id updates and explicitly replaced notifications silent', () => {
        const tracker = new NotificationSoundTracker();
        expect(tracker.shouldPlay(1, 'Mail', false, [])).toBe(true);
        expect(tracker.shouldPlay(1, 'Mail', false, [])).toBe(false);
        expect(tracker.shouldPlay(2, 'Mail', true, [])).toBe(false);
        expect(tracker.shouldPlay(2, 'Mail', false, [])).toBe(false);
    });

    it('ignores apps case-insensitively and does not double-play Shade system alerts', () => {
        const tracker = new NotificationSoundTracker();
        expect(tracker.shouldPlay(1, 'CHAT', false, ['chat'])).toBe(false);
        expect(tracker.shouldPlay(2, 'Shade', false, [])).toBe(false);
    });

    it('silences recovered backlog but permits a new notification', () => {
        const tracker = new NotificationSoundTracker();
        tracker.seed([1, 2]);
        expect(tracker.shouldPlay(2, 'Mail', false, [])).toBe(false);
        expect(tracker.shouldPlay(3, 'Mail', false, [])).toBe(true);
        tracker.remove(3);
        expect(tracker.shouldPlay(3, 'Mail', false, [])).toBe(true);
    });
});

describe('GTK3 sound subprocess isolation', () => {
    it('removes only GTK4 layer-shell preloads, including colon/space lists and sonames', () => {
        expect(soundProcessPreload(null)).toBeNull();
        expect(soundProcessPreload('/nix/store/gtk4/lib/libgtk4-layer-shell.so')).toBeNull();
        expect(soundProcessPreload('libgtk4-layer-shell.so.0')).toBeNull();
        expect(soundProcessPreload(
            '/lib/libguard.so:/nix/store/gtk4/lib/libgtk4-layer-shell.so /opt/libcustom.so'
        )).toBe('/lib/libguard.so:/opt/libcustom.so');
        expect(soundProcessPreload('/opt/libgtk4-layer-shell-plugin.so'))
            .toBe('/opt/libgtk4-layer-shell-plugin.so');
    });

    it('sanitizes the actual child without changing the parent preload or other environment', async () => {
        const preload = GLib.getenv('LD_PRELOAD');
        const path = GLib.getenv('PATH');
        const output = await spawnSoundProcess([
            'sh', '-c', 'printf "%s\\n%s" "${LD_PRELOAD-}" "${PATH-}"',
        ]);
        const [childPreload, childPath] = output.split('\n');
        expect(childPreload).toBe(soundProcessPreload(preload) ?? '');
        expect(childPreload.includes('libgtk4-layer-shell.so')).toBe(false);
        expect(childPath).toBe(path);
        expect(GLib.getenv('LD_PRELOAD')).toBe(preload);
        expect(GLib.getenv('PATH')).toBe(path);
    });
});

await run();
