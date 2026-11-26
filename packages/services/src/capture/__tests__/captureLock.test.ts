import {Process} from '@shade/core/process';
import ShellState from '../../state/shellState';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {captureGeometryLive, screenshotFullscreen, slurpAreaScreenshot} from '../captureFlow';
import Screenshot from '../screenshot';

const geometry = {x: 0, y: 0, width: 100, height: 100};

describe('Capture lock gate', () => {
    it.async('blocks capture entrypoints while leaving cleanup and unlock available', async () => {
        const originalExec = Process.execAsyncv;
        const originalSpawn = Process.subprocessv;
        const state = ShellState.get_default();
        const wasLocked = state.screenlocked;
        const screenshot = new Screenshot();
        let processes = 0;
        Process.execAsyncv = async () => {
            processes++;
            return '';
        };
        Process.subprocessv = () => {
            processes++;
            throw new Error('unexpected capture process');
        };
        try {
            state.screenlocked = true;
            screenshot.screenshot(true);
            screenshot.screenshot(false);
            screenshot.toggleOverlay();
            screenshot.showOverlay();
            screenshot.confirmArea(geometry);
            screenshot.confirmOverlay('fullscreen', null);
            await screenshot.captureFromStage(geometry);
            screenshot.toggleRecording();
            screenshot.startRecording();
            screenshot.recordArea();
            screenshot.recordOutput('TEST');
            screenshot.recordOutputVisual();
            screenshot.recordWindowVisual();
            screenshot.recordWindowByAddress('0x1');
            screenshot.recordWindow();
            expect(await screenshot.createVirtualMonitor()).toBeNull();
            screenshotFullscreen();
            await slurpAreaScreenshot();
            await captureGeometryLive(geometry);
            expect(processes).toBe(0);
            expect(screenshot.overlayOpen).toBe(false);
            expect(screenshot.recording).toBe(false);
            expect(screenshot.captureBusy).toBe(false);
            screenshot.hideOverlay();
            screenshot.stopRecording();
            await screenshot.removeVirtualMonitors();
            screenshot.clearCaptureFeedback();
            screenshot.dispose();
            state.unlock();
            expect(state.screenlocked).toBe(false);
        } finally {
            screenshot.dispose();
            state.screenlocked = wasLocked;
            Process.execAsyncv = originalExec;
            Process.subprocessv = originalSpawn;
        }
    });

    it.async('checks the lock again after asynchronous area selection', async () => {
        const original = Process.execAsyncv;
        const state = ShellState.get_default();
        const wasLocked = state.screenlocked;
        const selection = Promise.withResolvers<string>();
        let calls = 0;
        Process.execAsyncv = () => {
            calls++;
            return selection.promise;
        };
        try {
            state.screenlocked = false;
            const capture = slurpAreaScreenshot();
            state.screenlocked = true;
            selection.resolve('0,0 100x100');
            await capture;
            expect(calls).toBe(1);
        } finally {
            selection.resolve('');
            state.screenlocked = wasLocked;
            Process.execAsyncv = original;
        }
    });
});

await run(import.meta.url);
