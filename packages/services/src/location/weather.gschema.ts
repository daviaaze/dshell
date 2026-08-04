import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Weather location settings — owned by the Weather service.
 *
 * Colocated with the service that consumes it (packages/services/src/location/weather.ts).
 */
export const weatherSettings = defineSettings('weather', (s) =>
    s
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
);

export default defineSchemaList([getRegisteredSchema('weather')]);
