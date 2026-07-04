import Wireplumber from 'gi://AstalWp';
import GLib from 'gi://GLib?version=2.0';
import {createBinding, createState, onMount, onCleanup} from 'gnim';
import Brightness from '#/lib/brightness';
import {AudioEndpointControl} from '#/widget/common/audioControl';
import {Slider} from '#/widget/common/slider';
import logger from '#/lib/logger';
import {connectFor, cleanupNode} from '#/lib/connectFor';

const BRIGHTNESS_PRESETS = [0.25, 0.5, 0.75, 1.0];

// ── Shared endpoint config factory (AudioConfig / MicConfig) ──

interface EndpointConfig {
    /** Property name on audio object (e.g. "speakers", "microphones") */
    devicesProp: 'speakers' | 'microphones';
    /** Signal for device list changes */
    devicesSignal: 'notify::speakers' | 'notify::microphones';
    /** Property name for default device */
    defaultProp: 'default_speaker' | 'default_microphone';
    /** Signal for default device changes */
    defaultSignal: 'notify::default-speaker' | 'notify::default-microphone';
    /** Muted icon name */
    mutedIcon: string;
    /** Label for logging */
    label: string;
    /** Whether to show the app mixer button */
    showAppMixer?: boolean;
}

function createEndpointConfig(cfg: EndpointConfig) {
    return () => {
        logger.log(`${cfg.label}:`);
        const [devices, setDevices] = createState<Wireplumber.Endpoint[]>([]);
        const [defaultDevice, setDefaultDevice] =
            createState<Wireplumber.Endpoint | null>(null);

        onMount(() => {
            const _hn = {};
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                const audio = Wireplumber.get_default()!.audio;
                const update = () => {
                    setDevices([...(audio[cfg.devicesProp] ?? [])]);
                    setDefaultDevice(audio[cfg.defaultProp]);
                };
                update();
                connectFor(_hn, audio, cfg.devicesSignal, update);
                connectFor(_hn, audio, cfg.defaultSignal, update);
                return GLib.SOURCE_REMOVE;
            });
            onCleanup(() => cleanupNode(_hn));
        });

        logger.info(`${cfg.label} done`);
        return (
            <AudioEndpointControl
                visible={devices.as(s => s.length > 0)}
                defaultDevice={defaultDevice}
                devices={devices}
                mutedIcon={cfg.mutedIcon}
                showAppMixer={cfg.showAppMixer}
            />
        );
    };
}

export const AudioConfig = createEndpointConfig({
    devicesProp: 'speakers',
    devicesSignal: 'notify::speakers',
    defaultProp: 'default_speaker',
    defaultSignal: 'notify::default-speaker',
    mutedIcon: 'audio-volume-muted-symbolic',
    label: 'AudioConfig',
    showAppMixer: true,
});

export const MicConfig = createEndpointConfig({
    devicesProp: 'microphones',
    devicesSignal: 'notify::microphones',
    defaultProp: 'default_microphone',
    defaultSignal: 'notify::default-microphone',
    mutedIcon: 'microphone-sensitivity-muted-symbolic',
    label: 'MicConfig',
});

export const BrightnessSlider = () => {
    logger.log('BrightnessSlider: get_default()');
    const brightness = Brightness.get_default();
    const [presetIndex, setPresetIndex] = createState(0);

    const cycleBrightness = () => {
        const next = (presetIndex() + 1) % BRIGHTNESS_PRESETS.length;
        setPresetIndex(next);
        const value = BRIGHTNESS_PRESETS[next];
        brightness.set({screen: value});
    };

    logger.log('BrightnessSlider: done');
    return (
        <Slider
            visible={createBinding(brightness, 'screen').as(v => v > 0)}
            icon={'display-brightness-symbolic'}
            min={1}
            max={100}
            value={createBinding(brightness, 'screen').as(v => v * 100)}
            setValue={value => brightness.set({screen: value / 100})}
            onIconClick={cycleBrightness}
        />
    );
};
