import Wireplumber from 'gi://AstalWp';
import {createBinding, createComputed} from 'gnim';

export function getVolumeIcon(device: Wireplumber.Endpoint, mutedIcon: string) {
    const volume = createBinding(device, 'volume');
    const mute = createBinding(device, 'mute');
    const volumeIcon = createBinding(device, 'volumeIcon');

    return createComputed(() =>
        mute() || volume() === 0 ? mutedIcon : volumeIcon()
    );
}
