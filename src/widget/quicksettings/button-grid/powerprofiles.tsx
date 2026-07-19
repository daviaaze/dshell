import {createState, onMount, onCleanup} from 'gnim';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import PowerProfiles, {profileLabel, nextProfile} from '#/lib/services/power/powerProfiles';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import {LinkedBox} from '#/widget/common/linkedBox';
import {connectFor, cleanupNode} from '#/lib/core/connectFor';

export default () => {
    const [iconName, setIconName] = createState(
        'power-profile-balanced-symbolic'
    );
    const [label, setLabel] = createState('');
    const [activeProfile, setActiveProfile] = createState<
        'power-saver' | 'balanced' | 'performance'
    >('balanced');
    const pp = PowerProfiles.get_default();

    onMount(() => {
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

    const setProfile = (p: 'power-saver' | 'balanced' | 'performance') => {
        pp.set_active_profile(p);
    };

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button onClicked={() => setProfile('power-saver')}>
                    <Adw.ButtonContent
                        iconName="power-profile-power-saver-symbolic"
                        label="Power Saver"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => setProfile('balanced')}>
                    <Adw.ButtonContent
                        iconName="power-profile-balanced-symbolic"
                        label="Balanced"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => setProfile('performance')}>
                    <Adw.ButtonContent
                        iconName="power-profile-performance-symbolic"
                        label="Performance"
                    />
                </Gtk.Button>
            </LinkedBox>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return (
        <QuickToggleButton
            icon={iconName}
            label={label}
            onClick={() => setProfile(nextProfile(activeProfile()))}
            popover={popover}
        />
    );
};
