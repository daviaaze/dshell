import Adw from 'gi://Adw?version=1';
import type Wireplumber from 'gi://AstalWp';
import Gtk from 'gi://Gtk?version=4.0';
import {getVolumeIcon} from '@shade/services/audio/icons';
import {bus} from '@shade/services/bus';
import {type Accessor, bind, For, With} from 'gnim';
import {Slider} from './slider';

export {getVolumeIcon};

interface AudioControlProps {
    defaultDevice: Accessor<Wireplumber.Endpoint | null>;
    devices: Accessor<Wireplumber.Endpoint[]>;
    deviceTitle: string;
    volumeTitle: string;
    muteTitle: string;
    mutedIcon: string;
}

export const AudioEndpointControl = ({
    defaultDevice, devices, deviceTitle, volumeTitle, muteTitle, mutedIcon,
}: AudioControlProps) => {
    const radioGroup = new Gtk.CheckButton();
    return (
        <Gtk.Box spacing={16} orientation={Gtk.Orientation.VERTICAL}>
            <Adw.PreferencesGroup title={deviceTitle} visible={devices.as(items => items.length > 0)}>
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['card', 'vertical']}>
                    <For each={devices}>{device => (
                        <Gtk.CheckButton group={radioGroup}
                            label={bind(device, 'description').as(description => description || device.name || 'Dispositivo de áudio')}
                            active={bind(device, 'is-default')}
                            marginTop={12} marginBottom={12} marginStart={12} marginEnd={12}
                            onNotifyActive={self => {
                                if (self.active && !device.isDefault) device.isDefault = true;
                            }} />
                    )}</For>
                </Gtk.Box>
            </Adw.PreferencesGroup>
            <With value={defaultDevice}>{device => device ? (
                <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <Gtk.Label label={volumeTitle} xalign={0} cssClasses={['heading']} />
                        <Slider min={0} max={100} label={volumeTitle} showIcon={false}
                            icon={getVolumeIcon(device, mutedIcon)}
                            value={bind(device, 'volume').as(value => value * 100)}
                            setValue={value => bus.emit('audio:set-volume', {device, value: value / 100})} />
                    </Gtk.Box>
                    <Adw.PreferencesGroup>
                        <Adw.SwitchRow title={muteTitle} active={bind(device, 'mute')}
                            onNotifyActive={self => {
                                if (self.active !== device.mute) bus.emit('audio:toggle-mute', {device});
                            }} />
                    </Adw.PreferencesGroup>
                </Gtk.Box>
            ) : (
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                    <Gtk.Label label={volumeTitle} xalign={0} cssClasses={['heading']} />
                    <Gtk.Label label="Indisponível" wrap xalign={0} cssClasses={['dimmed']} />
                </Gtk.Box>
            )}</With>
        </Gtk.Box>
    );
};
