import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, For} from 'gnim';
import {formatTemp} from '@shade/services/location/weatherUtils';

interface HourlyItem {
    time: number;
    temp: number;
    iconName: string;
}

interface DailyItem {
    dayName: string;
    tempMax: number;
    tempMin: number;
    iconName: string;
}

function formatTime(unixTs: number): string {
    const dt = new Date(unixTs * 1000);
    return dt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

export const HourlyForecastSection = ({
    hourlyForecast,
}: {
    hourlyForecast: Accessor<HourlyItem[]>;
}) => {
    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['p-8', 'weather-section']}
        >
            <Gtk.Label
                cssClasses={['caption-heading', 'dimmed']}
                label="Hourly"
                halign={Gtk.Align.START}
            />
            <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER}>
                <Gtk.Box spacing={4}>
                    <For each={hourlyForecast}>
                        {f => (
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                cssClasses={['weather-hourly-item']}
                                spacing={0}
                            >
                                <Gtk.Label
                                    cssClasses={['caption', 'dimmed']}
                                    label={formatTime(f.time)}
                                />
                                <Gtk.Image
                                    iconName={f.iconName}
                                    pixelSize={16}
                                />
                                <Gtk.Label
                                    cssClasses={['heading']}
                                    label={formatTemp(f.temp)}
                                />
                            </Gtk.Box>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.ScrolledWindow>
        </Gtk.Box>
    );
};

export const DailyForecastSection = ({
    dailyForecast,
}: {
    dailyForecast: Accessor<DailyItem[]>;
}) => {
    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['p-8', 'weather-section']}
        >
            <Gtk.Label
                cssClasses={['caption-heading', 'dimmed']}
                label="5-Day Forecast"
                halign={Gtk.Align.START}
            />
            <Gtk.Box spacing={8} hexpand homogeneous>
                <For each={dailyForecast}>
                    {d => (
                        <Gtk.Box
                            orientation={Gtk.Orientation.VERTICAL}
                            cssClasses={['weather-daily-item']}
                            spacing={2}
                        >
                            <Gtk.Label
                                cssClasses={['caption']}
                                label={d.dayName}
                            />
                            <Gtk.Image iconName={d.iconName} pixelSize={18} />
                            <Gtk.Label
                                label={`${formatTemp(d.tempMax)} / ${formatTemp(d.tempMin)}`}
                                cssClasses={['caption-heading']}
                            />
                        </Gtk.Box>
                    )}
                </For>
            </Gtk.Box>
        </Gtk.Box>
    );
};
