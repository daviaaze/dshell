import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { Process } from '@shade/core/process';

export default () => {
  const getOption = (key: string, fallback: string): string => {
    try {
      const output = Process.exec(`hyprctl getoption ${key}`);
      const match = output.match(/(?:int|float|string):\s*(\S+)/);
      return match ? match[1] : fallback;
    } catch {
      return fallback;
    }
  };

  const setOption = (key: string, value: string | number | boolean) => {
    Process.execAsync(`hyprctl keyword ${key} ${value}`).catch(() => {});
  };

  return (
    <>
      <Adw.PreferencesGroup title="Mouse" description="Pointer device settings">
        <Adw.ActionRow title="Sensitivity" subtitle="Pointer speed (-1.0 to 1.0)">
          <Gtk.Scale
            orientation={Gtk.Orientation.HORIZONTAL}
            adjustment={new Gtk.Adjustment({
              value: parseFloat(getOption('input:sensitivity', '0')),
              lower: -1.0,
              upper: 1.0,
                        stepIncrement: 0.1,
            })}
            width-request={200}
            onValueChanged={(scale) => setOption('input:sensitivity', scale.get_value())}
          />
        </Adw.ActionRow>

        <Adw.ComboRow
          title="Acceleration Profile"
          subtitle="Pointer acceleration"
          selected={getOption('input:accel_profile', 'flat') === 'adaptive' ? 1 : 0}
          onNotifySelected={(row) => {
            setOption('input:accel_profile', row.selected === 0 ? 'flat' : 'adaptive');
          }}
        >
          <Gtk.StringList strings={['Flat', 'Adaptive']} />
        </Adw.ComboRow>

        <Adw.SwitchRow
          title="Natural Scrolling"
          subtitle="Scroll direction follows finger movement"
          active={getOption('input:natural_scroll', 'false') === 'true'}
          onNotifyActive={(row) => setOption('input:natural_scroll', row.active)}
        />

        <Adw.SwitchRow
          title="Left-Handed"
          subtitle="Swap left and right buttons"
          active={getOption('input:left_handed', 'false') === 'true'}
          onNotifyActive={(row) => setOption('input:left_handed', row.active)}
        />
      </Adw.PreferencesGroup>

      <Adw.PreferencesGroup title="Touchpad" description="Touchpad device settings">
        <Adw.SwitchRow
          title="Tap to Click"
          subtitle="Tap touchpad to click"
          active={getOption('input:touchpad:tap-to-click', 'true') === 'true'}
          onNotifyActive={(row) => setOption('input:touchpad:tap-to-click', row.active)}
        />

        <Adw.SwitchRow
          title="Tap and Drag"
          subtitle="Tap and hold to drag"
          active={getOption('input:touchpad:tap-and-drag', 'true') === 'true'}
          onNotifyActive={(row) => setOption('input:touchpad:tap-and-drag', row.active)}
        />

        <Adw.SwitchRow
          title="Natural Scrolling"
          subtitle="Scroll direction follows finger movement"
          active={getOption('input:touchpad:natural_scroll', 'false') === 'true'}
          onNotifyActive={(row) => setOption('input:touchpad:natural_scroll', row.active)}
        />

        <Adw.SwitchRow
          title="Disable While Typing"
          subtitle="Disable touchpad when typing"
          active={getOption('input:touchpad:disable_while_typing', 'true') === 'true'}
          onNotifyActive={(row) => setOption('input:touchpad:disable_while_typing', row.active)}
        />

        <Adw.ActionRow title="Scroll Speed" subtitle="Touchpad scroll sensitivity">
          <Gtk.Scale
            orientation={Gtk.Orientation.HORIZONTAL}
            adjustment={new Gtk.Adjustment({
              value: parseFloat(getOption('input:touchpad:scroll_factor', '1.0')),
              lower: 0.1,
              upper: 5.0,
              stepIncrement: 0.1,
            })}
            width-request={200}
            onValueChanged={(scale) => setOption('input:touchpad:scroll_factor', scale.get_value())}
          />
        </Adw.ActionRow>
      </Adw.PreferencesGroup>
    </>
  );
};
