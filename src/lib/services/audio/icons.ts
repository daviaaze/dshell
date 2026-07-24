import Wireplumber from 'gi://AstalWp';
import {bind, computed} from 'gnim';

export function getVolumeIcon(device: Wireplumber.Endpoint, mutedIcon: string) {
    const volume = bind(device, 'volume');
    const mute = bind(device, 'mute');
    const volumeIcon = bind(device, 'volumeIcon');

    return computed(() =>
        mute() || volume() === 0 ? mutedIcon : volumeIcon()
    );
}
