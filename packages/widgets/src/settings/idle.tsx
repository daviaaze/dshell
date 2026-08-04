import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {type Accessor, onCleanup} from 'gnim';

/** A SpinRow whose adjustment is rebuilt whenever its value or reload
 *  accessors change, so bounds track dependent settings live. */
function TimedSpinRow({
    title,
    subtitle,
    value,
    lower,
    upper,
    reloads = [],
    setter,
    sensitive = true,
    step = 30,
}: {
    title: string;
    subtitle: string;
    value: Accessor<number>;
    lower: () => number;
    upper: () => number;
    reloads?: Accessor<number>[];
    setter: (v: number) => void;
    sensitive?: Accessor<boolean> | boolean;
    step?: number;
}) {
    return (
        <Adw.SpinRow
            title={title}
            subtitle={subtitle}
            sensitive={sensitive}
            ref={(self) => {
                const apply = () => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: lower(),
                        upper: upper(),
                        stepIncrement: step,
                        value: value(),
                    });
                };
                const unsubs = [value, ...reloads].map((a) => a.subscribe(apply));
                onCleanup(() => unsubs.forEach((un) => un()));
                apply();
            }}
            onNotifyValue={(self) => setter(self.value)}
        />
    );
}

export default () => {
    const settings = generalSettings();

    return (
        <Adw.PreferencesGroup
            title={'Idle Management'}
            description={'Screen lock, display power, and sleep behavior'}
        >
            <Adw.SwitchRow
                title={'Auto Lock'}
                subtitle={'Lock screen after idle timeout'}
                active={settings.autoLockEnabled}
                onNotifyActive={(self) => settings.setAutoLockEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Idle Timeout'}
                subtitle={'Seconds of inactivity before locking'}
                value={settings.idleTimeout}
                lower={() => 60}
                upper={() => 1800}
                setter={(v) => settings.setIdleTimeout(v)}
            />
            <Adw.SwitchRow
                title={'Dim Before Lock'}
                subtitle={'Lower brightness before auto-lock'}
                active={settings.screenDimEnabled}
                onNotifyActive={(self) => settings.setScreenDimEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Dim Timeout'}
                subtitle={'Seconds before lock to start dimming'}
                value={settings.screenDimTimeout}
                lower={() => 30}
                upper={() => Math.max(30, settings.idleTimeout() - 10)}
                reloads={[settings.idleTimeout]}
                setter={(v) => settings.setScreenDimTimeout(v)}
            />
            <Adw.SwitchRow
                title={'Turn Off Display'}
                subtitle={'Power off screen after idle (DPMS)'}
                active={settings.dpmsEnabled}
                onNotifyActive={(self) => settings.setDpmsEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Display Timeout'}
                subtitle={'Seconds before turning off display'}
                value={settings.dpmsTimeout}
                lower={() => settings.idleTimeout() + 10}
                upper={() => 3600}
                reloads={[settings.idleTimeout]}
                setter={(v) => settings.setDpmsTimeout(v)}
            />
            <Adw.SwitchRow
                title={'Auto Suspend'}
                subtitle={'Suspend system after prolonged inactivity'}
                active={settings.suspendEnabled}
                onNotifyActive={(self) => settings.setSuspendEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Suspend Timeout'}
                subtitle={'Seconds before suspending'}
                value={settings.suspendTimeout}
                lower={() => settings.dpmsTimeout() + 10}
                upper={() => 7200}
                reloads={[settings.dpmsTimeout]}
                step={60}
                sensitive={settings.suspendEnabled}
                setter={(v) => settings.setSuspendTimeout(v)}
            />
        </Adw.PreferencesGroup>
    );
};
