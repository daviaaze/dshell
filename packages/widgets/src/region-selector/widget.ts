import {defineWidget} from '@shade/core/define';
import regionSelector from './index';

export default defineWidget({
    name: 'region-selector',
    mount: regionSelector,
});
