/**
 * Settings barrel — re-exports the per-domain settings accessors.
 *
 * Each service/widget imports its own slice directly (e.g. barSettings(),
 * generalSettings()) instead of reaching through a god-object. The old
 * createAppSettings()/useSettings()/SettingsContext machinery is gone —
 * accessors work globally once initSettingsRoot() runs at boot.
 */

export {generalSettings} from '@shade/core/settings/general.gschema';
export {weatherSettings} from '../location/weather.gschema';
export {timerSettings} from '../time/timer.gschema';
export {barSettings} from './bar.gschema';
export {screenCaptureSettings} from './screenCapture.gschema';
