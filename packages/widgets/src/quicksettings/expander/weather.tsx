import Gtk from 'gi://Gtk?version=4.0';
import {WeatherWidget} from '../../common/weatherWidget';

export const Weather = () => {
    return (
        <Gtk.Box
            cssClasses={['card', 'p-12']}
            orientation={Gtk.Orientation.VERTICAL}
        >
            <Gtk.Label
                cssClasses={['title-3']}
                label={'Weather'}
                halign={Gtk.Align.CENTER}
            />
            <WeatherWidget />
        </Gtk.Box>
    );
};
