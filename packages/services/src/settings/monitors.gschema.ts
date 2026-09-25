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
            'Automatically apply a saved layout when its attached-output set matches the connected monitor topology',
    })
);

export default defineSchemaList([getRegisteredSchema('monitors')]);
