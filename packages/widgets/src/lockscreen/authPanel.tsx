import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type FingerprintAuth from '@shade/services/input/fingerprint';
import type AuthSession from '@shade/services/session/authSession';
import {type Accessor, bind, createState} from 'gnim';
import {LockscreenWidgets} from './widgets';

interface AuthPanelProps {
    slot?: string;
    authSession: AuthSession;
    fingerprint: FingerprintAuth;
    fpStateBinding: Accessor<string>;
    fpErrorBinding: Accessor<string | null>;
}

const CARD_SPACING = 12;
const AVATAR_SIZE = 80;

export const LockscreenAuthPanel = ({
    slot,
    authSession,
    fingerprint,
    fpStateBinding,
    fpErrorBinding,
}: AuthPanelProps) => {
    const [, setPassword] = createState('');

    return (
        <Gtk.Box
            slot={slot}
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            spacing={CARD_SPACING}
            css={'padding:8px;'}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['card']}
        >
            <Adw.Avatar size={AVATAR_SIZE} />
            <Gtk.Label label={GLib.get_real_name()} cssClasses={['title-3']} />
            <Gtk.PasswordEntry
                ref={(self) => {
                    self.connect('map', () => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            self.grab_focus();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                }}
                placeholderText={'password'}
                showPeekIcon
                onActivate={(self) => {
                    authSession.submitPassword(self.get_text());
                    setPassword('');
                }}
            />
            <Gtk.Label
                visible={bind(authSession, 'authStatus').as((s) => s.length > 0)}
                cssClasses={['caption']}
                label={bind(authSession, 'authStatus')}
            />
            <Gtk.Spinner
                visible={fpStateBinding.as((s) => s === 'verifying' || s === 'initializing')}
                spinning
            />
            <Gtk.Button
                visible={fpStateBinding.as((s) => s === 'error')}
                label={fpErrorBinding.as((msg) => msg ?? 'Retry fingerprint')}
                cssClasses={['flat']}
                onClicked={() => fingerprint.retry()}
            />
            <LockscreenWidgets position="center" />
        </Gtk.Box>
    );
};