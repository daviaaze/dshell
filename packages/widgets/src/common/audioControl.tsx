import Wireplumber from 'gi://AstalWp';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind, createState, For, With} from 'gnim';
import {Slider} from './slider';
import {getVolumeIcon} from '@shade/services/audio/icons';
import {bus} from '@shade/services/bus';
import AppMixer from '../quicksettings/appMixer';

export {getVolumeIcon};

interface AudioControlProps {
    defaultDevice: Accessor<Wireplumber.Endpoint | null>;
    devices: Accessor<Wireplumber.Endpoint[]>;
    visible?: Accessor<boolean> | boolean;
    mutedIcon: string;
    showAppMixer?: boolean;
}

export const AudioEndpointControl = ({
    defaultDevice,
    devices,
    visible,
    mutedIcon,
    showAppMixer,
}: AudioControlProps) => {
    const [revealed, setRevealed] = createState(false);
    const [tab, setTab] = createState<'devices' | 'apps'>('devices');
    const radioGroup = new Gtk.CheckButton();

    const DeviceWidget = ({device}: {device: Wireplumber.Endpoint}) => (
        <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                <Gtk.CheckButton
                    group={radioGroup}
                    active={bind(device, 'is-default')}
                    onNotifyActive={({active}) => {
                        if (active) device.isDefault = true;
                    }}
                />
                <Gtk.Label
                    label={device.description ?? undefined}
                    maxWidthChars={30}
                    ellipsize={3}
                    hexpand
                    halign={Gtk.Align.START}
                    cssClasses={['body']}
                />
            </Gtk.Box>
            <Slider
                min={0}
                max={100}
                onIconClick={() => device.set_mute(!device.get_mute())}
                icon={getVolumeIcon(device, mutedIcon)}
                value={bind(device, 'volume').as(v => v * 100)}
                setValue={value => device.set_volume(value / 100)}
            />
        </Gtk.Box>
    );

    const DevicesList = () => (
        <Gtk.Box
            cssClasses={['p-12']}
            spacing={12}
            orientation={Gtk.Orientation.VERTICAL}
        >
            <For each={devices}>{d => <DeviceWidget device={d} />}</For>
        </Gtk.Box>
    );

    const TabbedContent = () => (
        <Gtk.Box spacing={0} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box
                spacing={0}
                halign={Gtk.Align.CENTER}
                cssClasses={['linked']}
            >
                <Gtk.ToggleButton
                    active={tab.as(t => t === 'devices')}
                    onClicked={() => setTab('devices')}
                    label="Devices"
                />
                <Gtk.ToggleButton
                    active={tab.as(t => t === 'apps')}
                    onClicked={() => setTab('apps')}
                    label="Applications"
                />
            </Gtk.Box>
            <Gtk.Box
                visible={tab.as(t => t === 'devices')}
                cssClasses={['popover-padded']}
                spacing={12}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <For each={devices}>{d => <DeviceWidget device={d} />}</For>
            </Gtk.Box>
            <Gtk.Box
                visible={tab.as(t => t === 'apps')}
                cssClasses={['popover-padded', 'p-12']}
                spacing={12}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <AppMixer />
            </Gtk.Box>
        </Gtk.Box>
    );

    return (
        <Gtk.Box
            visible={visible}
            spacing={4}
            cssClasses={revealed.as(r =>
                r ? ['card', 'audio-config'] : ['audio-config']
            )}
            orientation={Gtk.Orientation.VERTICAL}
        >
            <Gtk.Box spacing={4}>
                <With value={defaultDevice}>
                    {device =>
                        device ? (
                            <Slider
                                icon={getVolumeIcon(device, mutedIcon)}
                                min={0}
                                max={100}
                                value={bind(device, 'volume').as(v => v * 100)}
                                setValue={value =>
                                    bus.emit('audio:set-volume', {
                                        device,
                                        value: value / 100,
                                    })
                                }
                                onIconClick={() =>
                                    bus.emit('audio:toggle-mute', {device})
                                }
                            />
                        ) : null
                    }
                </With>
                <Gtk.Button
                    onClicked={() => setRevealed(!revealed())}
                    iconName={revealed.as(v =>
                        v ? 'go-up-symbolic' : 'go-down-symbolic'
                    )}
                />
            </Gtk.Box>
            <Gtk.Revealer revealChild={revealed}>
                {showAppMixer ? <TabbedContent /> : <DevicesList />}
            </Gtk.Revealer>
        </Gtk.Box>
    );
};
