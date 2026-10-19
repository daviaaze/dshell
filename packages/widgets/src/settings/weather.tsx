import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import Weather from '@shade/services/location/weather';
import {weatherSettings} from '@shade/services/location/weather.gschema';
import {bind, computed} from 'gnim';

export default () => {
    const settings = weatherSettings();
    const weather = Weather.get_default();
    const locationBusy = bind(weather, 'locationBusy');
    const locationError = bind(weather, 'locationError');
    const updateBusy = bind(weather, 'updateBusy');
    const updateError = bind(weather, 'updateError');
    const locationStatus = computed(() => (locationBusy() ? 'Detecting location…' : ''));
    const updateStatus = computed(() => (updateBusy() ? 'Updating weather…' : ''));

    return (
        <Adw.PreferencesGroup title={'Weather'} description={'Weather options'}>
            <Adw.SwitchRow
                title={'Auto Location'}
                subtitle={'Automatically detect your location'}
                active={settings.autoLocation}
                onNotifyActive={(self) => settings.setAutoLocation(self.active)}
            />
            <Adw.SpinRow
                title={'Latitude'}
                value={settings.latitude}
                adjustment={Gtk.Adjustment.new(settings.latitude(), -90.0, 90.0, 1.0, 0, 0)}
                onNotifyValue={(self) => settings.setLatitude(self.value)}
            />
            <Adw.SpinRow
                title={'Longitude'}
                value={settings.longitude}
                adjustment={Gtk.Adjustment.new(settings.longitude(), -180.0, 180.0, 1.0, 0, 0)}
                onNotifyValue={(self) => settings.setLongitude(self.value)}
            />
            <Adw.ActionRow
                title={'Detect Location Now'}
                subtitle={locationStatus}
                activatable
                sensitive={computed(() => !locationBusy())}
                onActivated={async () => {
                    logger.info('weather', 'manual location detection triggered');
                    try {
                        const coordinates = await weather.detectLocation();
                        if (!settings.autoLocation()) {
                            settings.setLatitude(coordinates.latitude);
                            settings.setLongitude(coordinates.longitude);
                        }
                    } catch (error) {
                        logger.error('weather', 'manual location detection failed:', error);
                    }
                }}
            >
                <Gtk.Image iconName="find-location-symbolic" pixelSize={16} />
            </Adw.ActionRow>
            <Gtk.Label
                label={locationError.as((error) => error ?? '')}
                cssClasses={['error', 'caption']}
                visible={locationError.as((error) => error !== null)}
                xalign={0}
                wrap
                marginStart={12}
                marginEnd={12}
                marginBottom={12}
            />
            <Adw.ActionRow
                title={'Update Weather'}
                subtitle={updateStatus}
                activatable
                sensitive={computed(() => !updateBusy())}
                onActivated={async () => {
                    logger.info('weather', 'manual weather update triggered');
                    try {
                        await weather.updateFromCoords(settings.latitude(), settings.longitude());
                    } catch (error) {
                        logger.error('weather', 'manual weather update failed:', error);
                    }
                }}
            >
                <Gtk.Image iconName="view-refresh-symbolic" pixelSize={16} />
            </Adw.ActionRow>
            <Gtk.Label
                label={updateError.as((error) => error ?? '')}
                cssClasses={['error', 'caption']}
                visible={updateError.as((error) => error !== null)}
                xalign={0}
                wrap
                marginStart={12}
                marginEnd={12}
                marginBottom={12}
            />
        </Adw.PreferencesGroup>
    );
};
