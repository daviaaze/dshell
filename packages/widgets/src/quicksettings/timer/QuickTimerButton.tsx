import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TimerService from '@shade/services/time/timerService';
import {bind, computed} from 'gnim';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from '../button-grid/quickButton';
import {TimerSection} from './TimerSection';

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

    const cssClasses = computed(() => (running() ? ['raised', 'suggested-action'] : ['raised']));

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                marginTop={8}
                marginBottom={8}
                marginStart={8}
                marginEnd={8}
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
                    if (timer.remaining >= 0) bus.emit('timer:cmd:cancel');
                }}
            />
        ),
    };
};
