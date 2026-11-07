import {defineWidget} from '@shade/core/define';
import notificationCenter from './index';

export default defineWidget({
    name: 'notification-center',
    mount: notificationCenter,
});
