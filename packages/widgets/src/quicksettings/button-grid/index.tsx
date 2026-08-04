import {computed} from 'gnim';
import Network from '../network/index';
import QuickTimerButton from '../timer/QuickTimerButton';
import Bluetooth from './bluetooth';
import Caffeinated from './caffeinated';
import ColorScheme from './colorScheme';
import Conservation from './conservation';
import NightLight from './nightLight';
import Powerprofiles from './powerprofiles';
import {ReactiveGrid} from './reactiveGrid';
import Screenshot from './screenshot';
import Touchpad from './touchpad';

export const ButtonGrid = ({cols = 2}: {cols?: number}) => {
    const items = computed(() => [
        Powerprofiles(),
        Conservation(),
        ColorScheme(),
        Bluetooth(),
        Network(),
        Screenshot(),
        Caffeinated(),
        QuickTimerButton(),
        NightLight(),
        Touchpad(),
    ]);

    return <ReactiveGrid cols={cols} items={items()} />;
};
