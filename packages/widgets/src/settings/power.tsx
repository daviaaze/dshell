import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { Process } from '@shade/core/process';

const ACTIONS = ['poweroff', 'reboot', 'suspend', 'hibernate', 'lock', 'nothing'] as const;
type PowerAction = typeof ACTIONS[number];
const ACTION_LABELS: Record<PowerAction, string> = {
  poweroff: 'Power Off',
  reboot: 'Restart',
  suspend: 'Suspend',
  hibernate: 'Hibernate',
  lock: 'Lock Screen',
  nothing: 'Do Nothing',
};

export default () => {
  const getLogindConfig = (key: string, fallback: PowerAction): PowerAction => {
    try {
      const output = Process.exec(`busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager ${key}`);
      const match = output.match(/s "([^"]+)"/);
      const value = match ? match[1] : fallback;
      return ACTIONS.includes(value as PowerAction) ? (value as PowerAction) : fallback;
    } catch {
      return fallback;
    }
  };

  const setLogindConfig = (key: string, value: string) => {
    Process.execAsync(`pkexec busctl set-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager ${key} s "${value}"`).catch(() => {});
  };

  const currentPowerButton = getLogindConfig('HandlePowerKey', 'poweroff');
  const currentLidClose = getLogindConfig('HandleLidSwitch', 'suspend');
  const currentLidClosePlugged = getLogindConfig('HandleLidSwitchExternalPower', 'suspend');

  return (
    <Adw.PreferencesGroup title="Power Actions" description="Configure power button and lid behavior">
      <Adw.ComboRow
        title="Power Button"
        subtitle="Action when power button is pressed"
        selected={ACTIONS.indexOf(currentPowerButton)}
        onNotifySelected={(row) => {
          const action = ACTIONS[row.selected];
          if (action) setLogindConfig('HandlePowerKey', action);
        }}
      >
        <Gtk.StringList strings={ACTIONS.map(a => ACTION_LABELS[a])} />
      </Adw.ComboRow>

      <Adw.ComboRow
        title="Lid Close (Battery)"
        subtitle="Action when laptop lid is closed on battery"
        selected={ACTIONS.indexOf(currentLidClose)}
        onNotifySelected={(row) => {
          const action = ACTIONS[row.selected];
          if (action) setLogindConfig('HandleLidSwitch', action);
        }}
      >
        <Gtk.StringList strings={ACTIONS.map(a => ACTION_LABELS[a])} />
      </Adw.ComboRow>

      <Adw.ComboRow
        title="Lid Close (Plugged In)"
        subtitle="Action when laptop lid is closed while plugged in"
        selected={ACTIONS.indexOf(currentLidClosePlugged)}
        onNotifySelected={(row) => {
          const action = ACTIONS[row.selected];
          if (action) setLogindConfig('HandleLidSwitchExternalPower', action);
        }}
      >
        <Gtk.StringList strings={ACTIONS.map(a => ACTION_LABELS[a])} />
      </Adw.ComboRow>
    </Adw.PreferencesGroup>
  );
};
