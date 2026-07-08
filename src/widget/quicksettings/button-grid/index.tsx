import Gtk from 'gi://Gtk?version=4.0';
import Powerprofiles from './powerprofiles';
import Conservation from './conservation';

import ColorScheme from './colorScheme';
import Bluetooth from './bluetooth';
import Caffeinated from './caffeinated';
import {QuickTimerButton} from '../timer/QuickTimerButton';
import Network from '#/widget/quicksettings/network';
import Screenshot from './screenshot';
import NightLight from './nightLight';
import NightLightLib from '#/lib/nightLight';
import Touchpad from './touchpad';
import TouchpadLib from '#/lib/touchpad';

export const ButtonGrid = ({cols = 2}: {cols?: number}) => {
    const nightLight = NightLightLib.get_default();
    const items = [
        <Powerprofiles />,
        <Conservation />,
        <ColorScheme />,
        <Bluetooth />,
        <Network />,
        <Screenshot />,
        <Caffeinated />,
        <QuickTimerButton />,
        nightLight.available ? <NightLight /> : null,
        TouchpadLib.get_default().available ? <Touchpad /> : null,
    ];

    const visibleItems = items.filter(Boolean);

    return (
        <Gtk.Grid
            rowSpacing={4}
            columnSpacing={4}
            columnHomogeneous
            hexpand
            $={self =>
                visibleItems.forEach((item, index) =>
                    self.attach(
                        item as Gtk.Widget,
                        index % cols,
                        Math.floor(index / cols),
                        1,
                        1
                    )
                )
            }
        ></Gtk.Grid>
    );
};
