import Gtk from 'gi://Gtk?version=4.0';
import {createState, onMount, onCleanup} from 'gnim';
import PowerProfiles from '#/lib/powerProfiles';
import {connectFor, cleanupNode} from '#/lib/connectFor';

export default () => {
    const [visible, setVisible] = createState(false);
    const [iconName, setIconName] = createState('');
    const [tooltip, setTooltip] = createState('');
    const pp = PowerProfiles.get_default();

    onMount(() => {
        const _hn = {};
        const update = () => {
            const p = pp.activeProfile;
            setVisible(p !== 'balanced');
            setIconName(pp.iconName);
            setTooltip(p);
        };
        connectFor(_hn, pp, 'notify::activeProfile', update);
        update();
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Image
            visible={visible}
            iconName={iconName}
            tooltipMarkup={tooltip}
            pixelSize={18}
        />
    );
};
