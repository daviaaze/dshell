/**
 * Tests for capture arg building (capture/utils.ts).
 *
 * buildRecordingArgs/formatDuration are pure; resolveBackend is tested only
 * for non-AUTO passthrough (AUTO depends on which binaries are installed).
 */

import {RecorderBackend, RecordingFormat} from '../capture/types';
import {buildRecordingArgs, formatDuration, resolveBackend} from '../capture/utils';
import {describe, expect, it, run} from './test-runner';

describe('buildRecordingArgs', () => {
    it('wl-screenrec: always includes filename and bitrate', () => {
        const {args, backendName} = buildRecordingArgs(
            RecorderBackend.WL_SCREENREC,
            'out.mp4',
            undefined,
            undefined,
            false
        );
        expect(backendName).toBe('wl-screenrec');
        expect(args[0]).toBe('wl-screenrec');
        expect(args.join(' ').includes('-f out.mp4')).toBe(true);
        expect(args.join(' ').includes('--bitrate 5 MB')).toBe(true);
    });

    it('wl-screenrec: maps quality 0/1/2 to bitrate 2/5/10 MB', () => {
        const q = (quality: number) =>
            buildRecordingArgs(
                RecorderBackend.WL_SCREENREC,
                'o.mp4',
                undefined,
                undefined,
                false,
                RecordingFormat.MP4,
                -1,
                quality
            ).args.join(' ');
        expect(q(0).includes('--bitrate 2 MB')).toBe(true);
        expect(q(1).includes('--bitrate 5 MB')).toBe(true);
        expect(q(2).includes('--bitrate 10 MB')).toBe(true);
        // wl-screenrec has no --quality flag; must not be emitted
        expect(q(0).includes('--quality')).toBe(false);
    });

    it('wl-screenrec: adds geometry, output, audio and webm codec', () => {
        const {args} = buildRecordingArgs(
            RecorderBackend.WL_SCREENREC,
            'o.webm',
            '0,0 100x100',
            'DP-1',
            true,
            RecordingFormat.WEBM
        );
        const s = args.join(' ');
        expect(s.includes('-g 0,0 100x100')).toBe(true);
        expect(s.includes('-o DP-1')).toBe(true);
        expect(s.includes('--audio')).toBe(true);
        expect(s.includes('--codec vp9')).toBe(true);
        // no mic id → no --audio-device
        expect(s.includes('--audio-device')).toBe(false);
    });

    it('wf-recorder: always includes -y and crf', () => {
        const {args, backendName} = buildRecordingArgs(
            RecorderBackend.WF_RECORDER,
            'out.mp4',
            undefined,
            undefined,
            false
        );
        expect(backendName).toBe('wf-recorder');
        expect(args.join(' ').includes('-f out.mp4 -y')).toBe(true);
        expect(args.join(' ').includes('crf=28')).toBe(true);
    });

    it('wf-recorder: maps quality 0/1/2 to crf 33/28/23', () => {
        const q = (quality: number) =>
            buildRecordingArgs(
                RecorderBackend.WF_RECORDER,
                'o.mp4',
                undefined,
                undefined,
                false,
                RecordingFormat.MP4,
                -1,
                quality
            ).args.join(' ');
        expect(q(0).includes('crf=33')).toBe(true);
        expect(q(1).includes('crf=28')).toBe(true);
        expect(q(2).includes('crf=23')).toBe(true);
    });

    it('wf-recorder: audio+webm adds libopus, no-audio webm adds libvpx', () => {
        const withAudio = buildRecordingArgs(
            RecorderBackend.WF_RECORDER,
            'o.webm',
            undefined,
            undefined,
            true,
            RecordingFormat.WEBM
        ).args.join(' ');
        expect(withAudio.includes('-a')).toBe(true);
        expect(withAudio.includes('-C libopus')).toBe(true);
        expect(withAudio.includes('-c libvpx')).toBe(true);

        const noAudio = buildRecordingArgs(
            RecorderBackend.WF_RECORDER,
            'o.webm',
            undefined,
            undefined,
            false,
            RecordingFormat.WEBM
        ).args.join(' ');
        expect(noAudio.includes('-a ')).toBe(false);
        expect(noAudio.includes('-C libopus')).toBe(false);
    });

    it('wf-recorder: pipewire node id only when provided', () => {
        const withMic = buildRecordingArgs(
            RecorderBackend.WF_RECORDER,
            'o.mp4',
            undefined,
            undefined,
            true,
            RecordingFormat.MP4,
            42
        ).args.join(' ');
        expect(withMic.includes('pipewire_node.restore.id=42')).toBe(true);

        const noMic = buildRecordingArgs(
            RecorderBackend.WF_RECORDER,
            'o.mp4',
            undefined,
            undefined,
            true
        ).args.join(' ');
        expect(noMic.includes('pipewire_node.restore.id')).toBe(false);
    });
});

describe('formatDuration', () => {
    it('formats sub-minute durations as seconds', () => {
        expect(formatDuration(0)).toBe('0s');
        expect(formatDuration(999)).toBe('1s');
        expect(formatDuration(59_000)).toBe('59s');
    });

    it('formats minute-plus durations as Xm Ys', () => {
        expect(formatDuration(60_000)).toBe('1m 0s');
        expect(formatDuration(95_000)).toBe('1m 35s');
        expect(formatDuration(3_660_000)).toBe('61m 0s');
    });
});

describe('resolveBackend', () => {
    it('passes through explicit backends unchanged', () => {
        expect(resolveBackend(RecorderBackend.WL_SCREENREC)).toBe(RecorderBackend.WL_SCREENREC);
        expect(resolveBackend(RecorderBackend.WF_RECORDER)).toBe(RecorderBackend.WF_RECORDER);
    });

    it('AUTO resolves to a concrete backend', () => {
        const resolved = resolveBackend(RecorderBackend.AUTO);
        expect(
            resolved === RecorderBackend.WL_SCREENREC || resolved === RecorderBackend.WF_RECORDER
        ).toBe(true);
    });
});

await run(import.meta.url);
