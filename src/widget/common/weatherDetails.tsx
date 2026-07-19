import Gtk from 'gi://Gtk?version=4.0';
import {Accessor} from 'gnim';
import {useStyle} from '#/style/useStyle';
import {windDirectionLabel} from '#/lib/services/location/weatherUtils';

interface WeatherDetailsProps {
    windSpeed: Accessor<number>;
    windDirection: Accessor<number>;
    humidity: Accessor<number>;
    pressure: Accessor<number>;
}

export const WeatherDetails = ({
    windSpeed,
    windDirection,
    humidity,
    pressure,
}: WeatherDetailsProps) => {
    const detailCardStyle = useStyle({
        padding: '8px',
        'border-radius': '8px',
        background: 'var(--shade-surface-dim)',
    });
    const detailValueStyle = useStyle({
        'font-size': '18px',
        'font-weight': 'bold',
    });

    return (
        <Gtk.Box spacing={6} hexpand>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['weather-detail-card', detailCardStyle.class]}
                hexpand
            >
                <Gtk.Label
                    label={windSpeed.as(s => `${s.toFixed(0)} km/h`)}
                    cssClasses={[
                        'weather-detail-value',
                        detailValueStyle.class,
                    ]}
                />
                <Gtk.Label
                    label={windDirection.as(d => windDirectionLabel(d))}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['weather-detail-card', detailCardStyle.class]}
                hexpand
            >
                <Gtk.Label
                    label={humidity.as(h => `${h.toFixed(0)}%`)}
                    cssClasses={[
                        'weather-detail-value',
                        detailValueStyle.class,
                    ]}
                />
                <Gtk.Label label="Humidity" cssClasses={['caption']} />
            </Gtk.Box>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['weather-detail-card', detailCardStyle.class]}
                hexpand
            >
                <Gtk.Label
                    label={pressure.as(p => `${p.toFixed(0)} hPa`)}
                    cssClasses={[
                        'weather-detail-value',
                        detailValueStyle.class,
                    ]}
                />
                <Gtk.Label label="Pressure" cssClasses={['caption']} />
            </Gtk.Box>
        </Gtk.Box>
    );
};
