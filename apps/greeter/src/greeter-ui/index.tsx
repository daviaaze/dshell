/**
 * Greeter Login Screen — greetd login UI built with AstalGreet.
 *
 * This is a separate entry point from the main shell. It shows a
 * login screen (username + password) and starts the user's session
 * on successful authentication.
 *
 * Features:
 *  - two-step username → password flow with Back/Escape navigation
 *  - session picker (wayland-sessions/xsessions discovery; the
 *    SHADE_SESSION_COMMAND env var is offered as the default entry)
 *  - power off / reboot via systemd-logind
 *  - PAM fingerprint prompts (pam_fprintd info messages) shown inline
 */

import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, createState, onCleanup} from 'gnim';
import {GreetSession} from './GreetSession';
import {powerOff, reboot} from './power';
import {buildSessionList} from './sessions';

export const Greeter = ({application}: {application: Gtk.Application}) => {
    const greeter = GreetSession.get_default();
    const [username, setUsername] = createState('');
    const [showPassword, setShowPassword] = createState(false);
    let passwordEntry: Gtk.PasswordEntry | null = null;
    let sessionDropDown: Gtk.DropDown | null = null;

    // Session list: default (SHADE_SESSION_COMMAND) + discovered sessions
    const sessionList = buildSessionList();
    const sessionNames = new Gtk.StringList();
    for (const s of sessionList) sessionNames.append(s.name);

    // State bindings
    const stateBinding = bind(greeter, 'state');
    const errorBinding = bind(greeter, 'errorMessage');
    const infoBinding = bind(greeter, 'infoMessage');

    const handleLogin = () => {
        if (
            greeter.state !== 'idle' &&
            greeter.state !== 'error' &&
            greeter.state !== 'awaiting-input'
        )
            return;

        if (!showPassword()) {
            // First step: create session with username
            if (!username().trim()) return;
            greeter.start(username());
            setShowPassword(true);
            passwordEntry?.grab_focus();
        } else {
            // Submit password — only while PAM is waiting for a response.
            // During the pam_fprintd wait (or after an error message but before
            // the password prompt arrives) posting would be rejected by greetd.
            if (greeter.state !== 'awaiting-input') return;
            const pw = passwordEntry?.get_text() ?? '';
            if (!pw) return;
            greeter.postAuth(pw);
            passwordEntry?.set_text('');
        }
    };

    // Return to the username step, aborting any in-flight auth
    const goBack = () => {
        greeter.reset();
        setShowPassword(false);
        passwordEntry?.set_text('');
    };

    // Handle authentication success
    onCleanup(
        stateBinding.subscribe(() => {
            if (stateBinding() === 'authenticated') {
                const selected = sessionDropDown?.selected ?? 0;
                const entry = sessionList[selected] ?? sessionList[0];
                greeter.startSession(entry.command);
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
            {/* Escape anywhere → back to username step */}
            <Gtk.EventControllerKey
                ref={(self) => {
                    self.connect('key-pressed', (_, keyval) => {
                        if (keyval === Gdk.KEY_Escape && showPassword()) {
                            goBack();
                            return true;
                        }
                        return false;
                    });
                }}
            />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} vexpand>
                {/* Power actions, top-right corner */}
                <Gtk.Box halign={Gtk.Align.END} marginTop={16} marginEnd={16} spacing={8}>
                    <Gtk.Button
                        iconName="system-reboot-symbolic"
                        tooltipText="Restart"
                        onClicked={() => reboot()}
                    />
                    <Gtk.Button
                        iconName="system-shutdown-symbolic"
                        tooltipText="Power Off"
                        cssClasses={['destructive-action']}
                        onClicked={() => powerOff()}
                    />
                </Gtk.Box>

                <Gtk.CenterBox
                    orientation={Gtk.Orientation.VERTICAL}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                    vexpand
                >
                    {/* User info section */}
                    <Gtk.Box
                        slot="start"
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={16}
                        marginBottom={32}
                    >
                        <Adw.Avatar size={96} showInitials text={username} />
                        <Gtk.Label cssClasses={['title-1']} label={username} />
                    </Gtk.Box>

                    {/* Login form */}
                    <Gtk.Box
                        slot="center"
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={8}
                        cssClasses={['card']}
                        widthRequest={300}
                    >
                        {/* Username entry (shown before password) */}
                        <Gtk.Entry
                            visible={showPassword.as((v) => !v)}
                            placeholderText="Username"
                            text={username}
                            onNotifyText={(self) => setUsername(self.text)}
                            onActivate={() => handleLogin()}
                        />

                        {/* Password entry */}
                        <Gtk.PasswordEntry
                            visible={showPassword}
                            placeholderText="Password"
                            showPeekIcon
                            ref={(self) => {
                                passwordEntry = self;
                            }}
                            onActivate={() => handleLogin()}
                        />

                        {/* Error message */}
                        <Gtk.Label
                            visible={errorBinding.as((msg) => msg.length > 0)}
                            cssClasses={['caption', 'error']}
                            wrap
                            label={errorBinding}
                        />

                        {/* Info message (e.g. pam_fprintd "Place your finger...") */}
                        <Gtk.Label
                            visible={infoBinding.as((msg) => msg.length > 0)}
                            cssClasses={['caption']}
                            wrap
                            label={infoBinding}
                        />

                        {/* Loading indicator */}
                        <Adw.Spinner
                            visible={stateBinding.as(
                                (s) => s === 'authenticating' || s === 'creating-session'
                            )}
                        />

                        {/* Login button */}
                        <Gtk.Button
                            cssClasses={['suggested-action']}
                            hexpand
                            label={showPassword.as((v) => (v ? 'Log In' : 'Continue'))}
                            onClicked={() => handleLogin()}
                        />

                        {/* Back to username step */}
                        <Gtk.Button
                            visible={showPassword}
                            label="Back"
                            onClicked={() => goBack()}
                        />

                        {/* Session picker */}
                        <Gtk.Box spacing={8} marginTop={8}>
                            <Gtk.Label
                                label="Session"
                                cssClasses={['caption', 'dimmed']}
                                valign={Gtk.Align.CENTER}
                            />
                            <Gtk.DropDown
                                hexpand
                                model={sessionNames}
                                selected={0}
                                ref={(self) => {
                                    sessionDropDown = self;
                                }}
                            />
                        </Gtk.Box>
                    </Gtk.Box>
                </Gtk.CenterBox>
            </Gtk.Box>
        </Astal.Window>
    );
};
