import Weather from '#/lib/services/location/weather';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind} from 'gnim';
import {usePopoverCleanup} from '#/widget/common/popoverCleanup';
import {WeatherWidget} from '#/widget/common/weatherWidget';

export const WeatherButton = ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const svc = Weather.get_default();
    const iconName = bind(svc, 'weatherIcon');
    const tempLabel = bind(svc, 'tempSummary');

    return (
        <Gtk.MenuButton
            direction={vertical.as(v =>
                v ? Gtk.ArrowType.RIGHT : Gtk.ArrowType.UP
            )}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            visible={visible}
            ref={usePopoverCleanup}
            popover={
                (
                    <Gtk.Popover
                        valign={Gtk.Align.CENTER}
                        halign={Gtk.Align.CENTER}
                        cssClasses={[]}
                        hasArrow={false}
                        widthRequest={320}
                    >
                        <Gtk.Box cssClasses={[]}>
                            <WeatherWidget />
                        </Gtk.Box>
                    </Gtk.Popover>
                ) as any
            }
        >
            <Gtk.Box
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={4}
            >
                <Gtk.Image pixelSize={22} iconName={iconName} />
                <Gtk.Label cssClasses={['heading']} label={tempLabel} />
            </Gtk.Box>
        </Gtk.MenuButton>
    );
};
