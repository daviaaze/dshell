import {defineWidget} from '@shade/core/define';
import windowswitcher, {hideWindowSwitcher, toggleWindowSwitcher} from './index';

export default defineWidget({
    name: 'windowswitcher',
    mount: windowswitcher,
    actions: {
        onToggleWindowSwitcher: () => toggleWindowSwitcher(),
        onHideWindowSwitcher: () => hideWindowSwitcher(),
    },
});
