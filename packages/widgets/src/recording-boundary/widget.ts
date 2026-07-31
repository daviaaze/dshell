import {defineWidget} from '@shade/core/define';
import recordingBoundary from './index';

export default defineWidget({
    name: 'recording-boundary',
    mount: recordingBoundary,
});
