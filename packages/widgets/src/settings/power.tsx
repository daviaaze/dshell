import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {createState} from 'gnim';
import {errorMessage} from './errorMessage';

const LOG_TAG = 'settings-power';
const LOGIND_MANAGER =
    'org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager';

const ACTIONS = ['poweroff', 'reboot', 'suspend', 'hibernate', 'lock', 'nothing'] as const;
type PowerAction = (typeof ACTIONS)[number];
const ACTION_LABELS: Record<PowerAction, string> = {
    poweroff: 'Desligar',
    reboot: 'Reiniciar',
    suspend: 'Suspender',
    hibernate: 'Hibernar',
    lock: 'Bloquear sessão',
    nothing: 'Não fazer nada',
};

const getLogindConfig = (key: string, fallback: PowerAction): PowerAction => {
    try {
        const output = Process.exec(`busctl get-property ${LOGIND_MANAGER} ${key}`);
        const match = output.match(/s "([^"]+)"/);
        const value = match ? match[1] : fallback;
        return ACTIONS.includes(value as PowerAction) ? (value as PowerAction) : fallback;
    } catch {
        return fallback;
    }
};

/** Writes the property, then reads it back; logind rejects properties it does not allow changing. */
const setLogindConfig = async (
    key: string,
    value: PowerAction,
    previous: PowerAction
): Promise<void> => {
    await Process.execAsync(`pkexec busctl set-property ${LOGIND_MANAGER} ${key} s "${value}"`);
    if (getLogindConfig(key, previous) !== value) {
        throw new Error('O sistema não aceitou a alteração.');
    }
};

export default () => {
    const [error, setError] = createState('');
    const actionModel = new Gtk.StringList({strings: ACTIONS.map((a) => ACTION_LABELS[a])});

    const PowerActionRow = ({
        title,
        subtitle,
        property,
        fallback,
    }: {
        title: string;
        subtitle: string;
        property: string;
        fallback: PowerAction;
    }) => {
        let applied = getLogindConfig(property, fallback);
        let reverting = false;
        return (
            <Adw.ComboRow
                title={title}
                subtitle={subtitle}
                model={actionModel}
                selected={ACTIONS.indexOf(applied)}
                onNotifySelected={(row) => {
                    const action = ACTIONS[row.selected];
                    if (reverting || !action || action === applied) return;
                    const previous = applied;
                    setError('');
                    setLogindConfig(property, action, previous).then(
                        () => {
                            applied = action;
                        },
                        (cause) => {
                            logger.error(LOG_TAG, `Setting ${property} failed:`, cause);
                            setError(errorMessage(cause));
                            reverting = true;
                            row.selected = ACTIONS.indexOf(previous);
                            reverting = false;
                        }
                    );
                }}
            />
        );
    };

    return (
        <Adw.PreferencesGroup
            title="Botão de energia e tampa"
            description="Comportamento do botão físico e da tampa; requer autorização do sistema."
        >
            <PowerActionRow
                title="Ao pressionar o botão de energia"
                subtitle="Ação do botão físico."
                property="HandlePowerKey"
                fallback="poweroff"
            />
            <PowerActionRow
                title="Fechar tampa / na bateria"
                subtitle="Comportamento ao usar a bateria."
                property="HandleLidSwitch"
                fallback="suspend"
            />
            <PowerActionRow
                title="Fechar tampa / ligado à energia"
                subtitle="Comportamento com alimentação externa."
                property="HandleLidSwitchExternalPower"
                fallback="suspend"
            />
            <Adw.ActionRow
                visible={error.as((message) => message.length > 0)}
                title="Não foi possível alterar o comportamento"
                subtitle={error}
                cssClasses={['error']}
            />
        </Adw.PreferencesGroup>
    );
};
