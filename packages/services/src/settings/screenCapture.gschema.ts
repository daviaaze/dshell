import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Screen capture / recording settings (shell-domain).
 *
 * Consumed by the capture services (recorder, screenshot) and the capture UI.
 */
export const screenCaptureSettings = defineSettings('screen-capture', s => s
    .key('recorder-backend', 'i', {
        default: 2,
        summary:
            'Recording backend (0 = wl-screenrec, 1 = wf-recorder, 2 = auto)',
    })
    .key('recording-format', 'i', {
        default: 0,
        summary: 'Recording container format (0 = mp4, 1 = webm)',
    })
    .key('screenshot-format', 'i', {
        default: 0,
        summary: 'Screenshot image format (0 = png, 1 = jpg)',
    })
    .key('record-audio', 'b', {
        default: true,
        summary: 'Enable audio recording by default',
    })
    .key('show-recording-boundary', 'b', {
        default: true,
        summary: 'Show red border around recorded/shared area',
    })
    .key('recording-boundary-color', 's', {
        default: '#FF0000',
        summary: 'Color of the recording boundary border',
    })
    .key('virtual-monitor-resolution', 's', {
        default: '1920x1080',
        summary: 'Default resolution for virtual monitors',
    })
    .key('virtual-monitor-fps', 'i', {
        default: 60,
        summary: 'Default refresh rate for virtual monitors',
    })
    .key('overlay-freeze-enabled', 'b', {
        default: true,
        summary: 'Freeze screen when opening the capture overlay',
    })
    .key('audio-input-id', 'i', {
        default: -1,
        summary:
            'PipeWire node ID for recording audio input (-1 = system default)',
    })
    .key('recording-quality', 'i', {
        default: 1,
        summary: 'Recording quality preset (0=Low, 1=Medium, 2=High)',
        range: {min: 0, max: 2},
    })
    .key('preview-thumbnails-enabled', 'b', {
        default: true,
        summary: 'Show live preview thumbnails in capture overlay',
    }));

export default defineSchemaList([getRegisteredSchema('screen-capture')]);
