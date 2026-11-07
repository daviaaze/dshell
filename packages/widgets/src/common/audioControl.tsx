import GObject from 'gi://GObject?version=2.0';
import type Wireplumber from 'gi://AstalWp';
import Gtk from 'gi://Gtk?version=4.0';
import {getVolumeIcon} from '@shade/services/audio/icons';
import {bus} from '@shade/services/bus';
import {type Accessor, bind, createState, For, With} from 'gnim';
import AppMixer from '../quicksettings/appMixer';
import {Slider} from './slider';

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
    const [tab, setTab] = createState<'devices' | 'apps'>('devices');
    const radioGroup = new Gtk.CheckButton();

    const DeviceWidget = ({device}: {device: Wireplumber.Endpoint}) => (
        <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={8} orientation={Gtk.Orientation.HORIZONTAL} valign={Gtk.Align.CENTER}>
                <Gtk.CheckButton
                    group={radioGroup}
                    active={bind(device, 'is-default')}
                    onNotifyActive={({active}) => {
                        if (active) device.isDefault = true;
                    }}
                    ref={(self) =>
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [
                                new GObject.Value(
                                    GObject.TYPE_STRING,
                                    device.description ?? 'Select audio device'
                                ),
                            ]
                        )
                    }
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
                onIconClick={() => bus.emit('audio:toggle-mute', {device})}
                icon={getVolumeIcon(device, mutedIcon)}
                value={bind(device, 'volume').as((v) => v * 100)}
                setValue={(value) => bus.emit('audio:set-volume', {device, value: value / 100})}
            />
        </Gtk.Box>
    );

    const DevicesList = () => (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
            <For each={devices}>{(d) => <DeviceWidget device={d} />}</For>
        </Gtk.Box>
    );

    const TabbedContent = () => (
        <Gtk.Box spacing={0} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={0} orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.CENTER} cssClasses={['linked']}>
                <Gtk.ToggleButton
                    active={tab.as((t) => t === 'devices')}
                    onClicked={() => setTab('devices')}
                    label="Devices"
                />
                <Gtk.ToggleButton
                    active={tab.as((t) => t === 'apps')}
                    onClicked={() => setTab('apps')}
                    label="Applications"
                />
            </Gtk.Box>
            <Gtk.Box
                visible={tab.as((t) => t === 'devices')}
                spacing={12}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <For each={devices}>{(d) => <DeviceWidget device={d} />}</For>
            </Gtk.Box>
            <Gtk.Box
                visible={tab.as((t) => t === 'apps')}
                spacing={12}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <AppMixer />
            </Gtk.Box>
        </Gtk.Box>
    );

    return (
        <Gtk.Box visible={visible} spacing={12} orientation={Gtk.Orientation.VERTICAL}>
            <With value={defaultDevice}>
                {device => device ? (
                    <Slider icon={getVolumeIcon(device, mutedIcon)} min={0} max={100}
                        value={bind(device, 'volume').as(value => value * 100)}
                        setValue={value => bus.emit('audio:set-volume', {device, value: value / 100})}
                        onIconClick={() => bus.emit('audio:toggle-mute', {device})} />
                ) : <Gtk.Label label="Selecione um dispositivo para usar como padrão." wrap xalign={0} />}
            </With>
            {showAppMixer ? <TabbedContent /> : <DevicesList />}
        </Gtk.Box>
    );
};
