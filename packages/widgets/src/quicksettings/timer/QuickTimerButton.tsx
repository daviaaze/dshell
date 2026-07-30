import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import TimerService from '../../../lib/services/time/timerService';
import {TimerSection} from './TimerSection';
import type {QuickButton} from '../button-grid/quickButton';
import {QuickToggleButton} from '../../common/quickToggleButton';

function fmtShort(ms: number): string {
    if (ms < 0) return 'Timer';
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default (): QuickButton => {
    const timer = TimerService.get_default();
    const remaining = bind(timer, 'remaining');
    const running = bind(timer, 'running');

    const label = computed(() => {
        const rem = remaining();
        return rem >= 0 ? fmtShort(rem) : 'Timer';
    });

    const icon = computed(() => 'emoji-recent-symbolic');

    const cssClasses = computed(() =>
        running() ? ['raised', 'suggested-action'] : ['raised']
    );

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                cssClasses={['popover-padded']}
                widthRequest={230}
                halign={Gtk.Align.FILL}
            >
                <TimerSection />
            </Gtk.Box>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                cssClasses={cssClasses}
                icon={icon}
                label={label}
                popover={popover}
                onClick={() => {
                    if (timer.remaining >= 0) timer.cancel();
                }}
            />
        ),
    };
};
