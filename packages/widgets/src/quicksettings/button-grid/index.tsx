import Gtk from 'gi://Gtk?version=4.0';
import type {GnimNode} from 'gnim';
import QuickTimerButton from '../timer/QuickTimerButton';
import Caffeinated from './caffeinated';
import ColorScheme from './colorScheme';
import Conservation from './conservation';
import NightLight from './nightLight';
import Powerprofiles from './powerprofiles';
import Screenshot from './screenshot';
import Touchpad from './touchpad';
import type {QuickButton, QuickDetailButton} from './quickButton';

export type OtherRoute = 'profile' | 'appearance' | 'capture' | 'inhibit' | 'timer' | 'nightlight';

export const createOtherControls = (
    navigate: (route: OtherRoute, origin: Gtk.Button) => void
): {buttons: QuickButton[]; pages: {id: OtherRoute; title: string; body: GnimNode}[]} => {
    const pageControl = (
        create: (onOpen: (self: Gtk.Button) => void) => QuickDetailButton,
        route: OtherRoute,
        title: string
    ) => {
        const control = create((origin) => navigate(route, origin));
        return {
            button: control,
            page: {id: route, title, body: control.detail},
        };
    };
    const profile = pageControl(Powerprofiles, 'profile', 'Power profile');
    const appearance = pageControl(ColorScheme, 'appearance', 'Appearance');
    const capture = pageControl(Screenshot, 'capture', 'Screen capture');
    const inhibit = pageControl(Caffeinated, 'inhibit', 'Keep awake');
    const timer = pageControl(QuickTimerButton, 'timer', 'Timer');
    const nightlight = pageControl(NightLight, 'nightlight', 'Night Light');

    return {
        buttons: [
            profile.button,
            Conservation(),
            appearance.button,
            capture.button,
            inhibit.button,
            timer.button,
            nightlight.button,
            Touchpad(),
        ],
        pages: [
            profile.page,
            appearance.page,
            capture.page,
            inhibit.page,
            timer.page,
            nightlight.page,
        ],
    };
};

