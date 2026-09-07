import Adw from 'gi://Adw?version=1';

interface Keybinding {
  key: string;
  description: string;
}

const KEYBINDINGS: Keybinding[] = [
  { key: 'Super', description: 'Open app launcher' },
  { key: 'Super+Return', description: 'Open terminal' },
  { key: 'Super+Q', description: 'Close focused window' },
  { key: 'Super+Shift+E', description: 'Exit Hyprland' },
  { key: 'Super+F', description: 'Toggle fullscreen' },
  { key: 'Super+Space', description: 'Toggle floating' },
  { key: 'Super+Shift+Space', description: 'Toggle scratchpad' },
  { key: 'Super+Left', description: 'Move focus left' },
  { key: 'Super+Right', description: 'Move focus right' },
  { key: 'Super+Up', description: 'Move focus up' },
  { key: 'Super+Down', description: 'Move focus down' },
  { key: 'Super+Shift+Left', description: 'Move window left' },
  { key: 'Super+Shift+Right', description: 'Move window right' },
  { key: 'Super+Shift+Up', description: 'Move window up' },
  { key: 'Super+Shift+Down', description: 'Move window down' },
  { key: 'Super+1', description: 'Switch to workspace 1' },
  { key: 'Super+2', description: 'Switch to workspace 2' },
  { key: 'Super+3', description: 'Switch to workspace 3' },
  { key: 'Super+4', description: 'Switch to workspace 4' },
  { key: 'Super+5', description: 'Switch to workspace 5' },
  { key: 'Super+Shift+1', description: 'Move window to workspace 1' },
  { key: 'Super+Shift+2', description: 'Move window to workspace 2' },
  { key: 'Super+Shift+3', description: 'Move window to workspace 3' },
  { key: 'Super+Shift+4', description: 'Move window to workspace 4' },
  { key: 'Super+Shift+5', description: 'Move window to workspace 5' },
  { key: 'Super+Tab', description: 'Cycle through workspaces' },
  { key: 'Super+Shift+Tab', description: 'Cycle through workspaces (reverse)' },
  { key: 'Print', description: 'Take screenshot' },
  { key: 'Super+Print', description: 'Take screenshot of active window' },
  { key: 'Shift+Print', description: 'Take screenshot of selected area' },
  { key: 'Super+V', description: 'Open clipboard manager' },
  { key: 'Super+M', description: 'Open music player' },
  { key: 'Super+L', description: 'Lock screen' },
];

export default () => (
  <Adw.PreferencesGroup title="Keyboard Shortcuts" description="View and customize keybindings">
    {KEYBINDINGS.map((binding) => (
      <Adw.ActionRow title={binding.description} subtitle={binding.key} />
    ))}
  </Adw.PreferencesGroup>
);
