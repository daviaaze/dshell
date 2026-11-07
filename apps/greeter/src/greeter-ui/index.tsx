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
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {IconNames} from '@shade/core/iconNames';
import {bind, computed, createState, onCleanup} from 'gnim';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {presentPowerConfirmation} from '@shade/widgets/common/powerConfirmation';
import {GreeterClock} from './clock';
import {GreetSession} from './GreetSession';
import {getGreeterKeyboardIndicator} from './keyboard';
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
    const knownUsersVisible = computed(() => !showPassword() && greeterUsers.length > 0);
    const manualUsernameVisible = computed(() => !showPassword() && selectedUser() === null);
    const otherAccountVisible = computed(() => !showPassword() && selectedUser() !== null);
    let initialAutoStartQueued = false;
    let initialAutoStartAllowed = true;
    let initialAutoStartId = 0;
    let entryFocusId = 0;
    let pendingPasswordSubmit = false;

    onCleanup(() => {
        initialAutoStartAllowed = false;
        pendingPasswordSubmit = false;
        if (initialAutoStartId) GLib.source_remove(initialAutoStartId);
        if (entryFocusId) GLib.source_remove(entryFocusId);
    });

    // Session list: default (SHADE_SESSION_COMMAND) + discovered sessions
    const sessionList = buildSessionList();
    const sessionNames = new Gtk.StringList();
    for (const s of sessionList) sessionNames.append(s.name);

    // State bindings
    const stateBinding = bind(greeter, 'state');
    const errorBinding = bind(greeter, 'errorMessage');
    const infoBinding = bind(greeter, 'infoMessage');
    const loginButtonSensitive = computed(
        () =>
            !showPassword() ||
            stateBinding() === 'awaiting-input' ||
            stateBinding() === 'error'
    );

    // CapsLock and fingerprint state
    const [capsLock, setCapsLock] = createState(false);
    const [isFingerprint, setIsFingerprint] = createState(false);

    // Keyboard layout
    const keyboardIndicator = getGreeterKeyboardIndicator();
    const keyboardDescription = 'Layout switching is unavailable here; active layout is not queried.';

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

    const startLogin = (account: string) => {
        initialAutoStartAllowed = false;
        pendingPasswordSubmit = false;
        setShowPassword(true);
        setIsFingerprint(
            greeter.infoMessage.toLowerCase().includes('finger') ||
                greeter.infoMessage.toLowerCase().includes('biometric')
        );
        greeter.start(account);
    };

    const handleLogin = () => {
        if (!showPassword()) {
            const account = username().trim();
            if (!account) return;
            startLogin(account);
            return;
        }

        if (greeter.state === 'authenticated' || greeter.state === 'starting-session') return;
        const account = (selectedUser()?.username ?? username()).trim();
        const password = passwordEntry?.get_text() ?? '';
        if (greeter.state === 'error') {
            pendingPasswordSubmit = password.length > 0;
            if (account) greeter.start(account);
            return;
        }
        if (!password) return;
        if (greeter.state !== 'awaiting-input') {
            pendingPasswordSubmit = true;
            return;
        }

        pendingPasswordSubmit = false;
        greeter.postAuth(password);
        passwordEntry?.set_text('');
        setIsFingerprint(false);
    };

    // Return to account selection without automatically restarting PAM.
    const goBack = () => {
        initialAutoStartAllowed = false;
        if (greeter.state === 'authenticated' || greeter.state === 'starting-session') return;
        pendingPasswordSubmit = false;
        greeter.reset();
        setShowPassword(false);
        passwordEntry?.set_text('');
        setIsFingerprint(false);
    };

    // Handle authentication success and error shake
    onCleanup(
        stateBinding.subscribe(() => {
            const state = stateBinding();
            if (state === 'awaiting-input' && pendingPasswordSubmit) {
                pendingPasswordSubmit = false;
                handleLogin();
            } else if (state === 'authenticated') {
                pendingPasswordSubmit = false;
                setLastUsername(username());
                const selected = sessionDropDown?.selected ?? 0;
                const entry = sessionList[selected] ?? sessionList[0];
                greeter.onSessionStarted = () => application.quit();
                greeter.startSession(entry.command);
            } else if (state === 'error') {
                pendingPasswordSubmit = false;
                loginFormBox?.add_css_class('shake');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    loginFormBox?.remove_css_class('shake');
                    return GLib.SOURCE_REMOVE;
                });
            }
        })
    );

    onCleanup(
        infoBinding.subscribe(() => {
            const info = infoBinding().toLowerCase();
            setIsFingerprint(info.includes('finger') || info.includes('biometric'));
        })
    );

    const loginForm = (
        <Gtk.Box ref={self => { loginFormBox = self; }}
            orientation={Gtk.Orientation.VERTICAL} cssClasses={['card']}>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={16}
                marginTop={24} marginBottom={24} marginStart={24} marginEnd={24}>
                <Gtk.Label cssClasses={['title-2']} wrap xalign={0}
                    label={showPassword.as(visible => visible ? 'Entre na sua conta' : 'Escolha uma conta')} />
                <Adw.Avatar size={64} showInitials
                    text={computed(() => selectedUser()?.realName ?? username())} />
                <Gtk.Label cssClasses={['title-3']} wrap
                    label={computed(() => selectedUser()?.realName ?? username())} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8} visible={knownUsersVisible}>
                    {greeterUsers.map(user => (
                        <Gtk.Button onMap={self => {
                            if (!showPassword() && selectedUser()?.username === user.username) self.grab_focus();
                        }} onClicked={() => {
                            setSelectedUser(user);
                            setUsername(user.username);
                            startLogin(user.username);
                        }}>
                            <Gtk.Box spacing={12}>
                                <Adw.Avatar size={40} showInitials text={user.realName} />
                                <Gtk.Label label={user.realName} hexpand xalign={0} wrap />
                            </Gtk.Box>
                        </Gtk.Button>
                    ))}
                </Gtk.Box>
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8} visible={manualUsernameVisible}>
                    <Gtk.Label label="Nome de usuário" xalign={0} cssClasses={['heading']} />
                    <Gtk.Entry text={username} placeholderText="Nome de usuário"
                        onMap={self => { if (manualUsernameVisible()) self.grab_focus(); }}
                        ref={self => self.update_property([Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Nome de usuário')])}
                        onNotifyText={self => setUsername(self.text)} onActivate={handleLogin} />
                </Gtk.Box>
                <Gtk.Button visible={otherAccountVisible} cssClasses={['flat']} label="Outra conta"
                    onClicked={() => {
                        initialAutoStartAllowed = false;
                        pendingPasswordSubmit = false;
                        greeter.reset();
                        setSelectedUser(null);
                        setUsername('');
                        setShowPassword(false);
                        setIsFingerprint(false);
                    }} />
                <Adw.PreferencesGroup visible={showPassword} title="Autenticação">
                    <Adw.ActionRow title="Método ativo"
                        subtitle={isFingerprint.as(active => active ? 'Impressão digital · senha disponível' : 'Senha')} />
                </Adw.PreferencesGroup>
                <Gtk.Label visible={showPassword} cssClasses={['heading']} label="Senha" xalign={0} />
                <Gtk.Box spacing={8} visible={showPassword}>
                    <Gtk.PasswordEntry hexpand placeholderText="Senha" showPeekIcon
                        ref={self => {
                            passwordEntry = self;
                            self.update_property([Gtk.AccessibleProperty.LABEL],
                                [new GObject.Value(GObject.TYPE_STRING, 'Senha da conta')]);
                            self.connect('map', () => {
                                if (!showPassword()) return;
                                if (entryFocusId) GLib.source_remove(entryFocusId);
                                entryFocusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                    entryFocusId = 0;
                                    if (showPassword() && self.get_mapped()) self.grab_focus();
                                    return GLib.SOURCE_REMOVE;
                                });
                            });
                        }}
                        onActivate={handleLogin} />
                    <Gtk.Image iconName="caps-lock-symbolic" visible={capsLock} tooltipText="Caps Lock ativado" />
                </Gtk.Box>
                <Gtk.Label visible={showPassword} cssClasses={['caption', 'dimmed']}
                    label="Sua senha permanece oculta." wrap xalign={0} />
                <Gtk.Box spacing={8} visible={isFingerprint}>
                    <Gtk.Image iconName={IconNames.authFingerprint} />
                    <Gtk.Label label={infoBinding} wrap hexpand xalign={0} />
                    <Gtk.Button label="Usar senha" onClicked={() => passwordEntry?.grab_focus()} />
                </Gtk.Box>
                <Gtk.Label visible={errorBinding.as(message => !!message)}
                    cssClasses={['error']} wrap xalign={0} label={errorBinding} />
                <Gtk.Label visible={computed(() => !!infoBinding() && !isFingerprint())}
                    cssClasses={['caption']} wrap xalign={0} label={infoBinding} />
                <Gtk.Box spacing={8}>
                    <Gtk.Label label="Sessão" cssClasses={['heading']} valign={Gtk.Align.CENTER} />
                    <Gtk.DropDown hexpand model={sessionNames} selected={0}
                        ref={self => { sessionDropDown = self; }} />
                </Gtk.Box>
                <Gtk.Box spacing={8} visible={stateBinding.as(state =>
                    ['authenticating', 'creating-session', 'cancelling-session', 'starting-session'].includes(state))}>
                    <Gtk.Spinner spinning />
                    <Gtk.Label label={stateBinding.as(state =>
                        state === 'starting-session' ? 'Iniciando a sessão…' : 'Aguardando autenticação…')} wrap />
                </Gtk.Box>
                <Gtk.Button cssClasses={['suggested-action']} hexpand
                    label={showPassword.as(visible => visible ? 'Entrar' : 'Continuar')}
                    sensitive={loginButtonSensitive} onClicked={handleLogin} />
                <Gtk.Button visible={showPassword}
                    sensitive={stateBinding.as(state => state !== 'authenticated' && state !== 'starting-session')}
                    label="Alterar conta" onClicked={goBack} />
            </Gtk.Box>
        </Gtk.Box>
    );

    const content = (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} vexpand hexpand>
            <Gtk.Box marginTop={16} marginStart={16} marginEnd={16} spacing={8}>
                <Gtk.Label label={keyboardIndicator} tooltipText={keyboardDescription}
                    ref={self => self.update_property([Gtk.AccessibleProperty.DESCRIPTION],
                        [new GObject.Value(GObject.TYPE_STRING, keyboardDescription)])} />
                <Gtk.Box hexpand />
                <Gtk.Button iconName="system-reboot-symbolic" tooltipText="Reiniciar"
                    cssClasses={['flat', 'circular']}
                    onClicked={self => presentPowerConfirmation(self, 'reboot', reboot)} />
                <Gtk.Button iconName="system-shutdown-symbolic" tooltipText="Desligar"
                    cssClasses={['flat', 'circular']}
                    onClicked={self => presentPowerConfirmation(self, 'poweroff', powerOff)} />
            </Gtk.Box>
            <Gtk.ScrolledWindow hexpand vexpand
                hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                <Adw.Clamp maximumSize={420} tighteningThreshold={340}
                    marginTop={24} marginBottom={24} marginStart={16} marginEnd={16}
                    valign={Gtk.Align.CENTER}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={24}>
                        <Gtk.Box halign={Gtk.Align.CENTER}><GreeterClock /></Gtk.Box>
                        {loginForm}
                    </Gtk.Box>
                </Adw.Clamp>
            </Gtk.ScrolledWindow>
        </Gtk.Box>
    );

    // Per-monitor layout from Gdk directly — no MonitorService dependency
    // (requires Hyprland IPC, unavailable under greetd/Cage).
    //
    // Cage extends the single fullscreen toplevel across the output-layout
    // bounding box, so we letterbox with a Gtk.Fixed sized to that bounding
    // box and place one pane per monitor at its exact (x, y) geometry.
    // The login form goes on the largest-area monitor; others show a clock.
    const display = Gdk.Display.get_default();
    const monitorList = display?.get_monitors();
    const monitorCount = monitorList?.get_n_items() ?? 0;

    let body;

    if (monitorCount === 0) {
        // Headless fallback: render the login content directly.
        body = content;
    } else {
        // Bounding box over all monitors
        const geos: Array<{x: number; y: number; width: number; height: number}> = [];
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < monitorCount; i++) {
            const mon = monitorList!.get_item(i) as Gdk.Monitor;
            const geo = mon.get_geometry();
            geos.push({x: geo.x, y: geo.y, width: geo.width, height: geo.height});
            minX = Math.min(minX, geo.x);
            minY = Math.min(minY, geo.y);
            maxX = Math.max(maxX, geo.x + geo.width);
            maxY = Math.max(maxY, geo.y + geo.height);
        }

        // Largest-area monitor hosts the login form (no Gdk primary API).
        let loginIdx = 0;
        let bestArea = -1;
        geos.forEach((geo, i) => {
            const area = geo.width * geo.height;
            if (area > bestArea) {
                bestArea = area;
                loginIdx = i;
            }
        });

        const clockPane = (
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                hexpand
                vexpand
                cssClasses={['card']}
            >
                <Gtk.Box marginTop={16} marginBottom={16} marginStart={16} marginEnd={16}>
                    <GreeterClock />
                </Gtk.Box>
            </Gtk.Box>
        );

        // Collect pane widgets + target positions; placed once the Fixed
        // (and its children) have mounted (gnim refs fire pre-mount).
        const placements: Array<{widget: Gtk.Widget; x: number; y: number}> = [];
        const panes = geos.map((geo, i) => (
            <Gtk.Box
                ref={(self) => {
                    placements.push({widget: self, x: geo.x - minX, y: geo.y - minY});
                }}
                widthRequest={geo.width}
                heightRequest={geo.height}
            >
                {i === loginIdx ? content : clockPane}
            </Gtk.Box>
        ));

        body = (
            <Gtk.Fixed
                widthRequest={maxX - minX}
                heightRequest={maxY - minY}
                ref={(self) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        for (const p of placements) {
                            if (p.widget.get_parent() === self) {
                                self.move(p.widget, p.x, p.y);
                            } else {
                                self.put(p.widget, p.x, p.y);
                            }
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }}
            >
                {panes}
            </Gtk.Fixed>
        );
    }

    return (
        <Gtk.Window
            title="shade-greeter"
            decorated={false}
            defaultWidth={1920}
            defaultHeight={1080}
            visible
            ref={(win: Gtk.Window) => {
                application.add_window(win);
                // Attach key controller to window (not as child widget)
                const keyCtrl = new Gtk.EventControllerKey();
                keyCtrl.connect('key-pressed', (_, keyval) => {
                    if (keyval === Gdk.KEY_Escape && showPassword()) {
                        goBack();
                        return true;
                    }
                    const state = keyCtrl.get_current_event_state();
                    setCapsLock((state & Gdk.ModifierType.LOCK_MASK) !== 0);
                    return false;
                });
                win.add_controller(keyCtrl);
                win.present();
                win.fullscreen();
                if (preselected && !initialAutoStartQueued) {
                    initialAutoStartQueued = true;
                    initialAutoStartId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        initialAutoStartId = 0;
                        if (
                            initialAutoStartAllowed &&
                            selectedUser()?.username === preselected.username &&
                            !showPassword()
                        ) {
                            startLogin(preselected.username);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }}
        >
            <Gtk.Overlay>
                <Gtk.Picture file={wallpaper ?? undefined} contentFit={Gtk.ContentFit.COVER}
                    visible={wallpaper?.as(file => file !== null) ?? false} canShrink hexpand vexpand />
                <Gtk.Box slot="overlay" hexpand vexpand>{body}</Gtk.Box>
            </Gtk.Overlay>
        </Gtk.Window>
    );
};
