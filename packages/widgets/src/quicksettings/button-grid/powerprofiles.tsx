import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import {bus} from '@shade/services/bus';
import PowerProfiles, {nextProfile, profileLabel} from '@shade/services/power/powerProfiles';
import {createState, effect, onCleanup} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

export default (): QuickButton => {
    const [iconName, setIconName] = createState('power-profile-balanced-symbolic');
    const [label, setLabel] = createState('');
    const [activeProfile, setActiveProfile] = createState<
        'power-saver' | 'balanced' | 'performance'
    >('balanced');
    const pp = PowerProfiles.get_default();
    const group = new Gtk.CheckButton();
    const choices = [
        {profile: 'power-saver' as const, label: 'Power Saver'},
        {profile: 'balanced' as const, label: 'Balanced'},
        {profile: 'performance' as const, label: 'Performance'},
    ].map(({profile, label}) => ({
        profile,
        button: new Gtk.CheckButton({group, label}),
    }));
    let syncing = false;
    const syncChoices = () => {
        syncing = true;
        try {
            for (const {profile, button} of choices) {
                button.active = activeProfile() === profile;
            }
        } finally {
            syncing = false;
        }
    };
    for (const {profile, button} of choices) {
        button.connect('toggled', () => {
            if (syncing || !button.active || activeProfile() === profile) return;
            try {
                setProfile(profile);
            } finally {
                syncChoices();
            }
        });
    }

    effect(() => {
        const _hn = {};
        const update = () => {
            const p = pp.activeProfile;
            setActiveProfile(p);
            setIconName(pp.iconName);
            setLabel(profileLabel(p));
        };
        connectFor(_hn, pp, 'notify::activeProfile', update);
        update();
        onCleanup(() => cleanupNode(_hn));
    });
    effect(() => {
        activeProfile();
        syncChoices();
    });

    const setProfile = (p: 'power-saver' | 'balanced' | 'performance') => {
        bus.emit('power:profile:set', p);
    };

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                {choices.map(({button}) => button)}
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickControlButton
                intent="action"
                domain="Power profile"
                icon={iconName}
                value={label}
                actionLabel="Cycle power profile"
                onClick={() => setProfile(nextProfile(activeProfile()))}
                menu={{label: 'Power profile options', popover}}
            />
        ),
    };
};
