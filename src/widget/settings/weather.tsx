import {useSettings} from '#/lib/settings';
import Weather from '#/lib/services/location/weather';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '#/lib/core/logger';

export default () => {
    const settings = useSettings().weather;
    const weather = Weather.get_default();

    return (
        <Adw.PreferencesGroup title={'Weather'} description={'Weather options'}>
            <Adw.SwitchRow
                title={'Auto Location'}
                subtitle={'Automatically detect your location'}
                active={settings.autoLocation}
                onNotifyActive={self => settings.setAutoLocation(self.active)}
            />
            <Adw.SpinRow
                title={'Latitude'}
                value={settings.latitude}
                adjustment={Gtk.Adjustment.new(
                    settings.latitude(),
                    -90.0,
                    90.0,
                    1.0,
                    0,
                    0
                )}
                onNotifyValue={self => settings.setLatitude(self.value)}
            />
            <Adw.SpinRow
                title={'Longitude'}
                value={settings.longitude}
                adjustment={Gtk.Adjustment.new(
                    settings.longitude(),
                    -180.0,
                    180.0,
                    1.0,
                    0,
                    0
                )}
                onNotifyValue={self => settings.setLongitude(self.value)}
            />
            <Adw.ActionRow
                title={'Detect Location Now'}
                activatable
                onActivated={() => {
                    logger.info(
                        'weather',
                        'manual location detection triggered'
                    );
                    weather.detectLocation();
                }}
            >
                <Gtk.Image
                    iconName="find-location-symbolic"
                    pixelSize={16}
                />
            </Adw.ActionRow>
            <Adw.ActionRow
                title={'Update Weather'}
                activatable
                onActivated={() => {
                    logger.info('weather', 'manual weather update triggered');
                    weather.updateFromCoords(
                        settings.latitude(),
                        settings.longitude()
                    );
                }}
            >
                <Gtk.Image
                    iconName="view-refresh-symbolic"
                    pixelSize={16}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
};
