import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createState} from 'gnim';
import {WeatherIcon} from '../../common/weatherWidget';
import {Battery, BatteryIcon} from './battery';
import {Calendar, CalendarIcon} from './calendar';
import {Media, MediaIcon} from './media';
import {Weather} from './weather';
import {WorldClock} from './worldClock';

export const Expander = () => {
    const [visible, setVisible] = createState(false);

    const Heading = () => (
        <Gtk.ToggleButton
            onClicked={() => setVisible(!visible())}
            active={visible}
            cssClasses={['flat']}
        >
            <Gtk.Box spacing={8} marginTop={8} marginBottom={8} marginStart={8} marginEnd={8}>
                <Adw.WrapBox halign={Gtk.Align.CENTER} hexpand>
                    <MediaIcon />
                    <CalendarIcon />
                    <BatteryIcon />
                    <WeatherIcon />
                </Adw.WrapBox>
                <Gtk.Image
                    halign={Gtk.Align.END}
                    iconName={visible.as((v) => (v ? 'go-up-symbolic' : 'go-down-symbolic'))}
                />
            </Gtk.Box>
        </Gtk.ToggleButton>
    );

    return (
        <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
            <Heading />
            <Gtk.Revealer revealChild={visible}>
                <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                    <Media />
                    <Gtk.Box spacing={4} orientation={Gtk.Orientation.HORIZONTAL} homogeneous>
                        <Battery />
                        <Calendar />
                    </Gtk.Box>
                    <Gtk.Box halign={Gtk.Align.CENTER} hexpand>
                        <Weather />
                    </Gtk.Box>
                    <WorldClock />
                </Gtk.Box>
            </Gtk.Revealer>
        </Gtk.Box>
    );
};
