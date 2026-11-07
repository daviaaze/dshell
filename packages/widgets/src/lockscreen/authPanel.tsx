import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type FingerprintAuth from '@shade/services/input/fingerprint';
import type AuthSession from '@shade/services/session/authSession';
import {type Accessor, bind, computed, onCleanup} from 'gnim';
import {LockscreenWidgets} from './widgets';

interface AuthPanelProps {
    authSession: AuthSession;
    fingerprint: FingerprintAuth;
    fpStateBinding: Accessor<string>;
    fpErrorBinding: Accessor<string | null>;
}

export const LockscreenAuthPanel = ({
    authSession, fingerprint, fpStateBinding, fpErrorBinding,
}: AuthPanelProps) => {
    let passwordEntry: Gtk.PasswordEntry | null = null;
    let focusSource = 0;
    let restorePasswordFocus = false;
    const busy = bind(authSession, 'passwordBusy');
    const error = bind(authSession, 'passwordError');
    const status = bind(authSession, 'authStatus');
    const available = bind(fingerprint, 'available');
    const fingerprintActive = computed(() =>
        available() && ['initializing', 'verifying'].includes(fpStateBinding()));
    const submit = () => {
        if (passwordEntry && authSession.submitPassword(passwordEntry.get_text())) {
            restorePasswordFocus = true;
            passwordEntry.set_text('');
            if (!busy()) {
                restorePasswordFocus = false;
                requestPasswordFocus();
            }
        }
    };
    const requestPasswordFocus = () => {
        if (focusSource) GLib.source_remove(focusSource);
        focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            focusSource = 0;
            if (passwordEntry?.get_mapped() && !busy()) passwordEntry.grab_focus();
            return GLib.SOURCE_REMOVE;
        });
    };
    onCleanup(busy.subscribe(() => {
        if (!busy() && restorePasswordFocus) {
            restorePasswordFocus = false;
            requestPasswordFocus();
        }
    }));
    onCleanup(() => {
        if (focusSource) GLib.source_remove(focusSource);
    });

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['card']}>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={16}
                marginTop={24} marginBottom={24} marginStart={24} marginEnd={24}>
                <Gtk.Label cssClasses={['title-2']} wrap xalign={0}
                    label={computed(() => {
                        if (busy()) return 'Verificando sua identidade';
                        if (error()) return 'Tente novamente';
                        return 'Sessão bloqueada';
                    })} />
                <Adw.Avatar size={64} showInitials text={GLib.get_real_name()} />
                <Gtk.Label cssClasses={['title-3']} label={GLib.get_real_name()} wrap />
                <Adw.PreferencesGroup title="Autenticação">
                    <Adw.ActionRow title="Método ativo"
                        subtitle={fingerprintActive.as(active => active ? 'Impressão digital · senha disponível' : 'Senha')} />
                </Adw.PreferencesGroup>
                <Gtk.Label label="Senha" cssClasses={['heading']} xalign={0} />
                <Gtk.PasswordEntry hexpand showPeekIcon placeholderText="Senha" sensitive={busy.as(value => !value)}
                    ref={self => {
                        passwordEntry = self;
                        self.update_property([Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Senha da conta')]);
                    }}
                    onMap={requestPasswordFocus}
                    onActivate={submit} />
                <Gtk.Label label="Sua senha permanece oculta. A sessão continua bloqueada até a autenticação."
                    cssClasses={['caption', 'dimmed']} wrap xalign={0} />
                <Gtk.Box spacing={8} visible={available}>
                    <Gtk.Image iconName="fingerprint-symbolic" />
                    <Gtk.Label hexpand wrap xalign={0} label={computed(() => {
                        const state = fpStateBinding();
                        if (state === 'initializing') return 'Preparando leitor de impressão digital…';
                        if (state === 'verifying') return 'Toque no leitor ou use sua senha.';
                        if (state === 'error') return fpErrorBinding() ?? 'Leitor indisponível. Use sua senha.';
                        return 'Você pode usar sua senha a qualquer momento.';
                    })} />
                </Gtk.Box>
                <Gtk.Button visible={fpStateBinding.as(state => state === 'error')}
                    label="Tentar impressão digital novamente" onClicked={() => fingerprint.retry()} />
                <Gtk.Button visible={fingerprintActive} label="Usar senha" cssClasses={['flat']}
                    sensitive={busy.as(value => !value)} onClicked={requestPasswordFocus} />
                <Gtk.Label visible={error.as(message => message.length > 0)} label={error} accessibleRole={Gtk.AccessibleRole.ALERT}
                    cssClasses={['error']} wrap xalign={0} />
                <Gtk.Box visible={busy} spacing={8}>
                    <Gtk.Spinner spinning />
                    <Gtk.Label label="Verificando a senha…" wrap xalign={0} />
                </Gtk.Box>
                <Gtk.Label visible={computed(() => !busy() && !error() && !!status())}
                    label={status} cssClasses={['caption']} wrap xalign={0} />
                <Gtk.Button label="Desbloquear com senha" cssClasses={['suggested-action']}
                    sensitive={busy.as(value => !value)} onClicked={submit} />
                <Gtk.Button visible={busy} label="Interromper tentativa"
                    onClicked={() => {
                        if (authSession.cancelPasswordAttempt()) requestPasswordFocus();
                    }} />
                <LockscreenWidgets position="center" />
            </Gtk.Box>
        </Gtk.Box>
    );
};
