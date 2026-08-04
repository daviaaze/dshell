import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * App launcher frecency settings (shell-domain).
 *
 * The frecency data is managed by FrecencyManager's own storage; this schema
 * declares the key so it is compiled into the app's gschema. No service reads
 * it via Gio.Settings directly.
 */
export const launcherSettings = defineSettings('launcher', (s) =>
    s.key('frecency', 's', {
        default: '{}',
        summary: 'Frecency data for app launcher (JSON)',
    })
);

export default defineSchemaList([getRegisteredSchema('launcher')]);
