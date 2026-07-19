import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import {createBinding, createState, onMount} from 'gnim';
import AuthSession from '#/lib/services/session/authSession';
import FingerprintAuth from '#/lib/services/input/fingerprint';
import {LockscreenWidgets} from './widgets';

interface AuthPanelProps {
    authSession: AuthSession;
    fingerprint: FingerprintAuth;
    fpStateBinding: ReturnType<typeof createBinding>;
    fpErrorBinding: ReturnType<typeof createBinding>;
}

const CARD_SPACING = 12;
const AVATAR_SIZE = 80;

export const LockscreenAuthPanel = ({
    authSession,
    fingerprint,
    fpStateBinding,
    fpErrorBinding,
}: AuthPanelProps) => {
    const [_password, setPassword] = createState('');

    return (
        <Gtk.Box
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            spacing={CARD_SPACING}
            css={'padding:8px;'}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['card']}
        >
            <Adw.Avatar size={AVATAR_SIZE} />
            <Gtk.Label
                label={GLib.get_real_name()}
                cssClasses={['title-3']}
            />
            <Gtk.PasswordEntry
                $={self => onMount(() => self.grab_focus())}
                placeholderText={'password'}
                showPeekIcon
                onActivate={self => {
                    authSession.submitPassword(self.get_text());
                    setPassword('');
                }}
            />
            <Gtk.Label
                visible={createBinding(authSession, 'auth-status').as(
                    s => s.length > 0
                )}
                cssClasses={['caption']}
                label={createBinding(authSession, 'auth-status')}
            />
            <Gtk.Spinner
                visible={fpStateBinding.as(
                    s => s === 'verifying' || s === 'initializing'
                )}
                spinning
            />
            <Gtk.Button
                visible={fpStateBinding.as(s => s === 'error')}
                label={fpErrorBinding.as(msg => msg || 'Retry fingerprint')}
                cssClasses={['flat']}
                onClicked={() => fingerprint.retry()}
            />
            <LockscreenWidgets position="center" />
        </Gtk.Box>
    );
};
