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
 *  - clock + wallpaper background, user picker (AccountsService), last-user persistence
 *  - CapsLock indicator, fingerprint visual feedback, error shake animation
 *  - keyboard layout indicator
 */

import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, createState, onCleanup} from 'gnim';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {GreeterClock} from './clock';
import {GreetSession} from './GreetSession';
import {useGreeterKeyboard} from './keyboard';
import {powerOff, reboot} from './power';
import {buildSessionList} from './sessions';
import {getGreeterUsers, getLastUsername, setLastUsername, type GreeterUser} from './users';

export const Greeter = ({application}: {application: Gtk.Application}) => {
    const greeter = GreetSession.get_default();
    const [username, setUsername] = createState('');
    const [showPassword, setShowPassword] = createState(false);
    let passwordEntry: Gtk.PasswordEntry | null = null;
    let sessionDropDown: Gtk.DropDown | null = null;
    let loginFormBox: Gtk.Box | null = null;

    // User picker via AccountsService, with last-user cache
    let greeterUsers: GreeterUser[] = [];
    try {
        greeterUsers = getGreeterUsers();
    } catch {
        // AccountsService not available — degrade to entry fallback
    }
    const lastUser = getLastUsername();
    const defaultUser = lastUser ? greeterUsers.find((u) => u.username === lastUser) : null;
    const preselected = defaultUser ?? greeterUsers[0] ?? null;
    if (preselected) setUsername(preselected.username);

    const [selectedUser, setSelectedUser] = createState<GreeterUser | null>(preselected);

    // Session list: default (SHADE_SESSION_COMMAND) + discovered sessions
    const sessionList = buildSessionList();
    const sessionNames = new Gtk.StringList();
    for (const s of sessionList) sessionNames.append(s.name);

    // State bindings
    const stateBinding = bind(greeter, 'state');
    const errorBinding = bind(greeter, 'errorMessage');
    const infoBinding = bind(greeter, 'infoMessage');

    // CapsLock and fingerprint state
    const [capsLock, setCapsLock] = createState(false);
    const [isFingerprint, setIsFingerprint] = createState(false);

    // Keyboard layout
    const {layout: keyboardLayout} = useGreeterKeyboard();

    // Wallpaper: resolve from GSettings (auto day/night by ColorScheme), fallback solid
    let wallpaper: ReturnType<typeof computed<Gio.File | null>> | null = null;
    try {
        const settings = generalSettings();
        const colorScheme = ColorScheme.get_default();
        const color = bind(colorScheme, 'colorScheme');
        const daytime = bind(colorScheme, 'daytime');
        const chooseWallpaper = (): string => {
            if (color() === DarkModes.AUTO) {
                return daytime() ? settings.wallpaperDay() : settings.wallpaperNight();
            }
            if (color() === DarkModes.LIGHT) return settings.wallpaperDay();
            return settings.wallpaperNight();
        };
        wallpaper = computed<Gio.File | null>(() => {
            try {
                return Gio.File.new_for_path(chooseWallpaper());
            } catch {
                return null;
            }
        });
    } catch {
        // GSettings not available in greeter — solid background
    }

    const handleLogin = () => {
        if (
            greeter.state !== 'idle' &&
            greeter.state !== 'error' &&
            greeter.state !== 'awaiting-input'
        )
            return;

        if (!showPassword()) {
            if (!username().trim()) return;
            greeter.start(username());
            setShowPassword(true);
            passwordEntry?.grab_focus();
            setIsFingerprint(
                greeter.infoMessage.toLowerCase().includes('finger') ||
                    greeter.infoMessage.toLowerCase().includes('biometric')
            );
        } else {
            if (greeter.state !== 'awaiting-input') return;
            const pw = passwordEntry?.get_text() ?? '';
            if (!pw) return;
            greeter.postAuth(pw);
            passwordEntry?.set_text('');
            setIsFingerprint(false);
        }
    };

    // Return to the username step, aborting any in-flight auth
    const goBack = () => {
        greeter.reset();
        setShowPassword(false);
        passwordEntry?.set_text('');
        setIsFingerprint(false);
    };

    // Handle authentication success and error shake
    onCleanup(
        stateBinding.subscribe(() => {
            if (stateBinding() === 'authenticated') {
                setLastUsername(username());
                const selected = sessionDropDown?.selected ?? 0;
                const entry = sessionList[selected] ?? sessionList[0];
                greeter.startSession(entry.command);
                greeter.onSessionStarted = () => application.quit();
            } else if (stateBinding() === 'error') {
                loginFormBox?.add_css_class('shake');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    loginFormBox?.remove_css_class('shake');
                    return GLib.SOURCE_REMOVE;
                });
            }
        })
    );

    const loginForm = (
        <Gtk.Box
            ref={(self) => {
                loginFormBox = self;
            }}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            cssClasses={['card']}
            widthRequest={300}
        >
            {/* User picker (avatars) or manual username entry */}
            {greeterUsers.length > 0 ? (
                <Gtk.Box
                    orientation={Gtk.Orientation.HORIZONTAL}
                    spacing={8}
                    halign={Gtk.Align.CENTER}
                    visible={showPassword.as((v) => !v)}
                >
                    {greeterUsers.map((user) => (
                        <Gtk.Button
                            tooltipText={user.realName}
                            onClicked={() => {
                                setSelectedUser(user);
                                setUsername(user.username);
                            }}
                            cssClasses={['flat', 'circular']}
                            opacity={selectedUser.as((sel) =>
                                sel?.username === user.username ? 1 : 0.5
                            )}
                        >
                            <Adw.Avatar size={48} showInitials text={user.realName} />
                        </Gtk.Button>
                    ))}
                </Gtk.Box>
            ) : (
                <Gtk.Entry
                    visible={showPassword.as((v) => !v)}
                    placeholderText="Username"
                    text={username}
                    onNotifyText={(self) => setUsername(self.text)}
                    onActivate={() => handleLogin()}
                />
            )}

            {/* Password entry with CapsLock indicator */}
            <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={4} visible={showPassword}>
                <Gtk.PasswordEntry
                    hexpand
                    placeholderText="Password"
                    showPeekIcon
                    ref={(self) => {
                        passwordEntry = self;
                    }}
                    onActivate={() => handleLogin()}
                />
                <Gtk.Image
                    iconName="caps-lock-symbolic"
                    visible={capsLock}
                    tooltipText="Caps Lock is on"
                />
            </Gtk.Box>

            {/* Fingerprint visual */}
            <Gtk.Box
                orientation={Gtk.Orientation.HORIZONTAL}
                spacing={8}
                halign={Gtk.Align.CENTER}
                visible={isFingerprint}
            >
                <Gtk.Image iconName="fingerprint-symbolic" pixelSize={48} />
                <Adw.Spinner
                    visible={stateBinding.as((s) => s === 'authenticating' || s === 'creating-session')}
                />
            </Gtk.Box>
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
                visible={stateBinding.as((s) => s === 'authenticating' || s === 'creating-session')}
            />

            {/* Login button */}
            <Gtk.Button
                cssClasses={['suggested-action']}
                hexpand
                label={showPassword.as((v) => (v ? 'Log In' : 'Continue'))}
                onClicked={() => handleLogin()}
            />

            {/* Back to username step */}
            <Gtk.Button visible={showPassword} label="Back" onClicked={() => goBack()} />

            {/* Session picker */}
            <Gtk.Box spacing={8} marginTop={8}>
                <Gtk.Label label="Session" cssClasses={['caption', 'dimmed']} valign={Gtk.Align.CENTER} />
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
    );

    const content = (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            vexpand
            hexpand
            css={wallpaper ? 'backdrop-filter: blur(40px) brightness(0.35);' : undefined}
        >
            <Gtk.EventControllerKey
                ref={(self) => {
                    self.connect('key-pressed', (_, keyval) => {
                        if (keyval === Gdk.KEY_Escape && showPassword()) {
                            goBack();
                            return true;
                        }
                        const state = self.get_current_event_state();
                        setCapsLock((state & Gdk.ModifierType.LOCK_MASK) !== 0);
                        return false;
                    });
                }}
            />
            {/* Top bar: keyboard layout (left) + power actions (right) */}
            <Gtk.Box marginTop={16} marginStart={16} marginEnd={16}>
                <Gtk.Button
                    cssClasses={['pill']}
                    label={keyboardLayout}
                    tooltipText="Keyboard layout"
                    halign={Gtk.Align.START}
                />
                <Gtk.Box hexpand />
                <Gtk.Button iconName="system-reboot-symbolic" tooltipText="Restart" onClicked={() => reboot()} />
                <Gtk.Button
                    iconName="system-shutdown-symbolic"
                    tooltipText="Power Off"
                    cssClasses={['destructive-action']}
                    marginStart={8}
                    onClicked={() => powerOff()}
                />
            </Gtk.Box>

            <Gtk.Separator visible={greeterUsers.length > 1} orientation={Gtk.Orientation.HORIZONTAL} marginTop={8} />

            {/* Clock */}
            <Gtk.Box halign={Gtk.Align.CENTER} marginTop={48} marginBottom={24}>
                <GreeterClock />
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
                    halign={Gtk.Align.CENTER}
                >
                    <Adw.Avatar size={96} showInitials text={username} />
                    <Gtk.Label cssClasses={['title-1']} label={username} />
                </Gtk.Box>

                {/* Login form */}
                <Gtk.Box slot="center">{loginForm}</Gtk.Box>
            </Gtk.CenterBox>
        </Gtk.Box>
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
            {wallpaper ? (
                <Gtk.Overlay hexpand vexpand>
                    <Gtk.Picture contentFit={Gtk.ContentFit.COVER} file={wallpaper} hexpand vexpand />
                    {content}
                </Gtk.Overlay>
            ) : (
                content
            )}
        </Astal.Window>
    );
};
