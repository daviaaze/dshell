/**
 * Greeter Login Screen — greetd login UI built with AstalGreet.
 *
 * This is a separate entry point from the main shell. It shows a
 * login screen (username + password) and starts the user's session
 * on successful authentication.
 */
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Astal from 'gi://Astal?version=4.0';
import {createBinding, createState, onCleanup} from 'gnim';
import {GreetSession} from './GreetSession';

export const Greeter = ({application}: {application: Gtk.Application}) => {
    const greeter = GreetSession.get_default();
    const [username, setUsername] = createState('');
    const [showPassword, setShowPassword] = createState(false);
    let passwordEntry: Gtk.PasswordEntry | null = null;

    // State bindings
    const stateBinding = createBinding(greeter, 'state');
    const errorBinding = createBinding(greeter, 'errorMessage');

    const handleLogin = () => {
        if (
            greeter.state !== 'idle' &&
            greeter.state !== 'error' &&
            greeter.state !== 'awaiting-input'
        ) return;

        if (!showPassword()) {
            // First step: create session with username
            if (!username().trim()) return;
            greeter.start(username());
            setShowPassword(true);
            passwordEntry?.grab_focus();
        } else {
            // Submit password
            const pw = passwordEntry?.get_text() ?? '';
            if (!pw) return;
            greeter.postAuth(pw);
            passwordEntry?.set_text('');
        }
    };

    // Handle authentication success
    onCleanup(
        stateBinding.subscribe(() => {
            if (stateBinding() === 'authenticated') {
                // Start session from env var (set by cage wrapper), fallback Hyprland
                const sessionCmd = (GLib.getenv('SHADE_SESSION_COMMAND') ?? 'Hyprland').split(' ');
                greeter.startSession(sessionCmd);
                // Quit after session starts (async callback in GreetSession)
                greeter.onSessionStarted = () => application.quit();
            }
        })
    );

    return (
        <Astal.Window
            name="shade-greeter"
            application={application}
            namespace="shade-greeter"
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            keymode={Astal.Keymode.EXCLUSIVE}
            layer={Astal.Layer.OVERLAY}
            visible
        >
            <Gtk.CenterBox
                orientation={Gtk.Orientation.VERTICAL}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
            >
                {/* User info section */}
                <Gtk.Box
                    $type="start"
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={16}
                    marginBottom={32}
                >
                    <Adw.Avatar
                        size={96}
                        showInitials
                        text={username}
                    />
                    <Gtk.Label
                        cssClasses={['title-1']}
                        label={username}
                    />
                </Gtk.Box>

                {/* Login form */}
                <Gtk.Box
                    $type="center"
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    cssClasses={['card']}
                    css={'padding: 24px; min-width: 300px;'}
                >
                    {/* Username entry (shown before password) */}
                    <Gtk.Entry
                        visible={showPassword.as(v => !v)}
                        placeholderText="Username"
                        text={username}
                        onNotifyText={self => setUsername(self.text)}
                        onActivate={() => handleLogin()}
                    />

                    {/* Password entry */}
                    <Gtk.PasswordEntry
                        visible={showPassword}
                        placeholderText="Password"
                        showPeekIcon
                        $={self => {
                            passwordEntry = self;
                        }}
                        onActivate={() => handleLogin()}
                    >
                        <Gtk.EventControllerKey
                            $={self => {
                                self.connect('key-pressed', (_, keyval) => {
                                    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
                                        handleLogin();
                                        return true;
                                    }
                                    return false;
                                });
                            }}
                        />
                    </Gtk.PasswordEntry>

                    {/* Error message */}
                    <Gtk.Label
                        visible={errorBinding.as(msg => msg.length > 0)}
                        cssClasses={['caption', 'error']}
                        wrap
                        label={errorBinding}
                    />

                    {/* Loading indicator */}
                    <Adw.Spinner
                        visible={stateBinding.as(
                            s => s === 'authenticating' || s === 'creating-session'
                        )}
                    />

                    {/* Login button */}
                    <Gtk.Button
                        cssClasses={['suggested-action']}
                        hexpand
                        label={showPassword.as(v => (v ? 'Log In' : 'Continue'))}
                        onClicked={() => handleLogin()}
                    />
                </Gtk.Box>
            </Gtk.CenterBox>
        </Astal.Window>
    );
};
