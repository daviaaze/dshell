import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Monitor + layout settings (display domain).
 *
 * Owned by LayoutService, edited from the Displays settings page.
 */
export const monitorsSettings = defineSettings('monitors', (s) =>
    s.key('auto-apply', 'b', {
        default: true,
        summary:
            'Automatically apply the best matching saved layout when monitors are connected or disconnected',
    })
);

export default defineSchemaList([getRegisteredSchema('monitors')]);