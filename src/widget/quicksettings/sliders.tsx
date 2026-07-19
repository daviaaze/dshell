import {createBinding, createState} from 'gnim';
import Brightness from '#/lib/services/display/brightness';
import AudioController from '#/lib/services/audio/audioController';
import {AudioEndpointControl} from '#/widget/common/audioControl';
import {Slider} from '#/widget/common/slider';
import logger from '#/lib/core/logger';

const BRIGHTNESS_PRESETS = [0.25, 0.5, 0.75, 1.0];
const BRIGHTNESS_PCT_MAX = 100;
const BRIGHTNESS_PCT_MIN = 1;

// ── Shared endpoint config factory (AudioConfig / MicConfig) ──

interface EndpointConfig {
    devicesProp: 'speakers' | 'microphones';
    defaultProp: 'default-speaker' | 'default-microphone';
    mutedIcon: string;
    label: string;
    showAppMixer?: boolean;
}

function createEndpointConfig(cfg: EndpointConfig) {
    const audioCtrl = AudioController.get_default();
    return () => {
        logger.log('audio', `${cfg.label}:`);

        return (
            <AudioEndpointControl
                visible={createBinding(audioCtrl, cfg.devicesProp).as(
                    s => s.length > 0
                )}
                defaultDevice={createBinding(audioCtrl, cfg.defaultProp)}
                devices={createBinding(audioCtrl, cfg.devicesProp)}
                mutedIcon={cfg.mutedIcon}
                showAppMixer={cfg.showAppMixer}
            />
        );
    };
}

export const AudioConfig = createEndpointConfig({
    devicesProp: 'speakers',
    defaultProp: 'default-speaker',
    mutedIcon: 'audio-volume-muted-symbolic',
    label: 'AudioConfig',
    showAppMixer: true,
});

export const MicConfig = createEndpointConfig({
    devicesProp: 'microphones',
    defaultProp: 'default-microphone',
    mutedIcon: 'microphone-sensitivity-muted-symbolic',
    label: 'MicConfig',
});

export const BrightnessSlider = () => {
    logger.debug('brightness', 'BrightnessSlider: get_default()');
    const brightness = Brightness.get_default();
    const [presetIndex, setPresetIndex] = createState(0);

    const cycleBrightness = () => {
        const next = (presetIndex() + 1) % BRIGHTNESS_PRESETS.length;
        setPresetIndex(next);
        const value = BRIGHTNESS_PRESETS[next];
        brightness.set({screen: value});
    };

    logger.debug('brightness', 'BrightnessSlider: done');
    return (
        <Slider
            visible={createBinding(brightness, 'screen').as(v => v > 0)}
            icon={'display-brightness-symbolic'}
            min={BRIGHTNESS_PCT_MIN}
            max={BRIGHTNESS_PCT_MAX}
            value={createBinding(brightness, 'screen').as(
                v => v * BRIGHTNESS_PCT_MAX
            )}
            setValue={value =>
                brightness.set({screen: value / BRIGHTNESS_PCT_MAX})
            }
            onIconClick={cycleBrightness}
        />
    );
};