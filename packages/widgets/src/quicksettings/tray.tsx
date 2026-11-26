import Astal from 'gi://Astal?version=4.0';
import type Tray from 'gi://AstalTray';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TrayService from '@shade/services/desktop/trayService';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {bind, effect, For} from 'gnim';
import {IconButton, setAccessibleName} from '../common/iconButton';
import {isTrayItemHidden, TrayItemButton} from '../common/trayItem';

const {TOP, RIGHT, BOTTOM, LEFT} = Astal.WindowAnchor;
const CLOCKWISE_POSITIONS: number[] = [TOP, RIGHT, BOTTOM, LEFT];
const POSITION_LABELS: Record<number, string> = {
    [TOP]: 'Superior',
    [RIGHT]: 'Direita',
    [BOTTOM]: 'Inferior',
    [LEFT]: 'Esquerda',
};

/**
 * Tray items hidden from the bar, plus the bar-position and lock actions.
 * Settings and the session/power menu live in the Quick Settings header.
 */
export const TrayBox = () => {
    const tray = TrayService.get_default();
    const bar = barSettings();
    const rotateLabel = bar.position.as(
        (position) =>
            `Girar posição da barra (atual: ${POSITION_LABELS[position] ?? 'Desconhecida'})`
    );

    const LockButton = () => (
        <IconButton
            icon="system-lock-screen-symbolic"
            accessibleLabel="Bloquear tela"
            onClicked={() => {
                bus.emit('shell:lock');
            }}
        />
    );

    const RotateButton = () => (
        <Gtk.Button
            iconName="object-rotate-right-symbolic"
            cssClasses={['circular']}
            tooltipText={rotateLabel}
            ref={(self) => effect(() => setAccessibleName(rotateLabel())(self))}
            onClicked={() => {
                const current = CLOCKWISE_POSITIONS.indexOf(bar.position());
                bar.setPosition(CLOCKWISE_POSITIONS[(current + 1) % CLOCKWISE_POSITIONS.length]);
            }}
        />
    );

    return (
        <Gtk.Box spacing={4} homogeneous halign={Gtk.Align.CENTER}>
            <For each={bind(tray, 'items')}>
                {(item: Tray.TrayItem) => (
                    <TrayItemButton
                        item={item}
                        visible={bar.hiddenTrayItems.as((ids) => isTrayItemHidden(item, ids))}
                    />
                )}
            </For>
            <RotateButton />
            <LockButton />
        </Gtk.Box>
    );
};
