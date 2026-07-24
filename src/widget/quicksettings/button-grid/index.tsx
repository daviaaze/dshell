import {createMemo} from 'gnim';
import Powerprofiles from './powerprofiles';
import Conservation from './conservation';
import ColorScheme from './colorScheme';
import Bluetooth from './bluetooth';
import Caffeinated from './caffeinated';
import {QuickTimerButton} from '../timer/QuickTimerButton';
import Network from '#/widget/quicksettings/network';
import Screenshot from './screenshot';
import NightLight from './nightLight';
import Touchpad from './touchpad';
import {ReactiveGrid} from './reactiveGrid';

export const ButtonGrid = ({cols = 2}: {cols?: number}) => {
    const items = createMemo(() => [
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
