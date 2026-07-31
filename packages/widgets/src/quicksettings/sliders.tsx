import {bind, createState} from 'gnim';
import Brightness from '@shade/services/display/brightness';
import {bus} from '@shade/services/bus';
import AudioController from '@shade/services/audio/audioController';
import {AudioEndpointControl} from '../common/audioControl';
import {Slider} from '../common/slider';
import logger from '@shade/core/logger';

const BRIGHTNESS_PRESETS = [0.25, 0.5, 0.75, 1.0];
const BRIGHTNESS_PCT_MAX = 100;
const BRIGHTNESS_PCT_MIN = 1;

// ── Shared endpoint config factory (AudioConfig / MicConfig) ──

interface EndpointConfig {
    devicesProp: 'speakers' | 'microphones';
    defaultProp: 'defaultSpeaker' | 'defaultMicrophone';
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
                visible={bind(audioCtrl, cfg.devicesProp).as(s => s.length > 0)}
                defaultDevice={bind(audioCtrl, cfg.defaultProp)}
                devices={bind(audioCtrl, cfg.devicesProp)}
                mutedIcon={cfg.mutedIcon}
                showAppMixer={cfg.showAppMixer}
            />
        );
    };
}

export const AudioConfig = createEndpointConfig({
    devicesProp: 'speakers',
    defaultProp: 'defaultSpeaker',
    mutedIcon: 'audio-volume-muted-symbolic',
    label: 'AudioConfig',
    showAppMixer: true,
});

export const MicConfig = createEndpointConfig({
    devicesProp: 'microphones',
    defaultProp: 'defaultMicrophone',
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
        bus.emit('display:brightness:set', {screen: value});
    };

    logger.debug('brightness', 'BrightnessSlider: done');
    return (
        <Slider
            visible={bind(brightness, 'screen').as(v => v > 0)}
            icon={'display-brightness-symbolic'}
            min={BRIGHTNESS_PCT_MIN}
            max={BRIGHTNESS_PCT_MAX}
            value={bind(brightness, 'screen').as(v => v * BRIGHTNESS_PCT_MAX)}
            setValue={value =>
                bus.emit('display:brightness:set', {screen: value / BRIGHTNESS_PCT_MAX})
            }
            onIconClick={cycleBrightness}
        />
    );
};
