import {defineWidget} from '@shade/core/define';
import notifications from './index';

export default defineWidget({
    name: 'notifications',
    mount: notifications,
});
