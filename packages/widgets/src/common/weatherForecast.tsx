import Gtk from 'gi://Gtk?version=4.0';
import {formatTemp, formatTime} from '@shade/services/location/weatherUtils';
import {useStyle} from '@shade/style/useStyle';
import {type Accessor, For} from 'gnim';

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

const CAPTION_HEADING = 'caption-heading';

export const HourlyForecastSection = ({
    hourlyForecast,
}: {
    hourlyForecast: Accessor<HourlyItem[]>;
}) => {
    const styles = useStyle({padding: '8px'});

    return (
        <Gtk.Box
            ref={styles.$}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={[styles.class]}
            marginTop={8}
            marginBottom={8}
            marginStart={8}
            marginEnd={8}
        >
            <Gtk.Label
                cssClasses={[CAPTION_HEADING, 'dimmed']}
                label="Hourly"
                halign={Gtk.Align.START}
            />
            <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER}>
                <Gtk.Box spacing={4} css={'justify-content: space-between;'}>
                    <For each={hourlyForecast}>
                        {(f) => (
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
                                <Gtk.Label
                                    cssClasses={['caption', 'dimmed']}
                                    label={formatTime(f.time)}
                                />
                                <Gtk.Image iconName={f.iconName} pixelSize={16} />
                                <Gtk.Label cssClasses={['heading']} label={formatTemp(f.temp)} />
                            </Gtk.Box>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.ScrolledWindow>
        </Gtk.Box>
    );
};

export const DailyForecastSection = ({dailyForecast}: {dailyForecast: Accessor<DailyItem[]>}) => {
    const styles = useStyle({padding: '8px'});

    return (
        <Gtk.Box
            ref={styles.$}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={[styles.class]}
            marginTop={8}
            marginBottom={8}
            marginStart={8}
            marginEnd={8}
        >
            <Gtk.Label
                cssClasses={[CAPTION_HEADING, 'dimmed']}
                label="5-Day Forecast"
                halign={Gtk.Align.START}
            />
            <Gtk.Box spacing={8} hexpand homogeneous>
                <For each={dailyForecast}>
                    {(d) => (
                        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                            <Gtk.Label cssClasses={['caption']} label={d.dayName} />
                            <Gtk.Image iconName={d.iconName} pixelSize={18} />
                            <Gtk.Label
                                label={`${formatTemp(d.tempMax)} / ${formatTemp(d.tempMin)}`}
                                cssClasses={[CAPTION_HEADING]}
                            />
                        </Gtk.Box>
                    )}
                </For>
            </Gtk.Box>
        </Gtk.Box>
    );
};
