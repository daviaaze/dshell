import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Timer / pomodoro settings — owned by the TimerService.
 *
 * Colocated with the service that consumes it (packages/services/src/time/timerService.ts).
 */
export const timerSettings = defineSettings('timer', (s) =>
    s
        .key('pomodoro-work-duration', 'i', {
            default: 25,
            summary: 'Pomodoro work duration in minutes',
        })
        .key('pomodoro-break-duration', 'i', {
            default: 5,
            summary: 'Pomodoro short break duration in minutes',
        })
        .key('pomodoro-long-break-duration', 'i', {
            default: 15,
            summary: 'Pomodoro long break duration in minutes',
        })
        .key('pomodoro-sessions-before-long-break', 'i', {
            default: 4,
            summary: 'Number of work sessions before a long break',
        })
        .key('countdown-presets', 'ai', {
            default: [1, 5, 10, 15, 30, 60],
            summary: 'Countdown preset durations in minutes',
        })
        .key('timer-alert-sound', 's', {
            default: 'complete',
            summary: 'Sound name for timer alerts (freedesktop sound theme)',
        })
);

export default defineSchemaList([getRegisteredSchema('timer')]);
