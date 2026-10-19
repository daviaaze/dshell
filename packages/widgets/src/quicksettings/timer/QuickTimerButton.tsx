import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TimerService from '@shade/services/time/timerService';
import {bind, computed} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from '../button-grid/quickButton';
import {TimerSection} from './TimerSection';

function fmtShort(ms: number): string {
    if (ms < 0) return 'Not running';
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default (): QuickButton => {
    const timer = TimerService.get_default();
    const remaining = bind(timer, 'remaining');
    let popover: Gtk.Popover | null = null;

    const value = computed(() => fmtShort(remaining()));
    const icon = 'emoji-recent-symbolic';
    const popoverContent = (
        <Gtk.Popover
            cssClasses={[]}
            ref={(self) => {
                popover = self;
            }}
        >
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
            <QuickControlButton
                intent="action"
                domain="Timer"
                icon={icon}
                value={value}
                actionLabel={remaining.as((ms) => ms >= 0 ? 'Cancel timer' : 'Open timer options')}
                onClick={() => {
                    if (timer.remaining >= 0) bus.emit('timer:cmd:cancel');
                    else popover?.popup();
                }}
                menu={{label: 'Timer options', popover: popoverContent}}
            />
        ),
    };
};
