import {defineWidget} from '@shade/core/define';
import {openSettings} from './settingsOpen';

export default defineWidget({
    name: 'settings',
    lazy: true,
    mount: () => {}, // created lazily by openSettings()
    actions: {onToggleSettings: () => openSettings()},
});
