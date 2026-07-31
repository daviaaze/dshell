import {defineWidget} from '@shade/core/define';
import windowswitcher, {toggleWindowSwitcher} from './index';

export default defineWidget({
    name: 'windowswitcher',
    mount: windowswitcher,
    actions: {onToggleWindowSwitcher: () => toggleWindowSwitcher()},
});
