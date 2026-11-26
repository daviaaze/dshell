import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Weather location settings — owned by the Weather service.
 *
 * Colocated with the service that consumes it (packages/services/src/location/weather.ts).
 */
export const weatherSettings = defineSettings('weather', (s) =>
    s
        // 0.0 / 0.0 means "no location set yet"; the Weather service treats it as unset.
        .key('latitude', 'd', {
            default: 0.0,
        })
        .key('longitude', 'd', {
            default: 0.0,
        })
        .key('auto-location', 'b', {
            default: false,
            summary: 'Automatically detect location for weather',
        })
        .key('ip-location-fallback', 'b', {
            default: false,
            summary: 'Use an IP-based lookup when GeoClue cannot locate the device',
            description:
                'When enabled and automatic location is on, a failed GeoClue lookup falls ' +
                'back to ipapi.co, which receives your public IP address. Disabled by default.',
        })
);

export default defineSchemaList([getRegisteredSchema('weather')]);
