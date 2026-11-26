import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import PowerProfiles from '@shade/services/power/powerProfiles';
import {createState, effect, onCleanup} from 'gnim';

const PROFILE_LABELS: Record<string, string> = {
    'power-saver': 'Economia de energia',
    performance: 'Desempenho',
};

export default () => {
    const [visible, setVisible] = createState(false);
    const [iconName, setIconName] = createState('');
    const [tooltip, setTooltip] = createState('');
    const pp = PowerProfiles.get_default();

    effect(() => {
        const _hn = {};
        const update = () => {
            const p = pp.activeProfile;
            setVisible(p !== 'balanced');
            setIconName(pp.iconName);
            setTooltip(PROFILE_LABELS[p] ?? p);
        };
        connectFor(_hn, pp, 'notify::activeProfile', update);
        update();
        onCleanup(() => cleanupNode(_hn));
    });

    return <Gtk.Image visible={visible} iconName={iconName} tooltipText={tooltip} pixelSize={18} />;
};
