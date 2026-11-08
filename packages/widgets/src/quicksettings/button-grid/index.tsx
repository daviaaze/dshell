import type Gtk from 'gi://Gtk?version=4.0';
import type {GnimNode} from 'gnim';
import QuickTimerButton from '../timer/QuickTimerButton';
import Caffeinated from './caffeinated';
import ColorScheme from './colorScheme';
import Conservation from './conservation';
import NightLight from './nightLight';
import Powerprofiles from './powerprofiles';
import type {QuickButton, QuickDetailButton} from './quickButton';
import Screenshot from './screenshot';
import Touchpad from './touchpad';

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
    const profile = pageControl(Powerprofiles, 'profile', 'Perfil de energia');
    const appearance = pageControl(ColorScheme, 'appearance', 'Aparência');
    const capture = pageControl(Screenshot, 'capture', 'Captura de tela');
    const inhibit = pageControl(Caffeinated, 'inhibit', 'Manter ativo');
    const timer = pageControl(QuickTimerButton, 'timer', 'Temporizador');
    const nightlight = pageControl(NightLight, 'nightlight', 'Luz noturna');

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
