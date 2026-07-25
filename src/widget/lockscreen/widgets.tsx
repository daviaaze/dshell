/**
 * Lockscreen widget registry — extensible widget system for the lockscreen.
 *
 * Phase 1: static registry with Media Player widget.
 * Phase 2 (future): dynamic registration from any widget module,
 *   GSettings-enabled visibility, priority ordering, more widgets.
 */

import Gtk from 'gi://Gtk?version=4.0';
import {For, bind, createState} from 'gnim';
import MediaController from '#/lib/services/session/mediaController';
import logger from '#/lib/core/logger';

// ── Widget Interface ────────────────────────────────────────────

export interface LockscreenWidgetDef {
    id: string;
    position: 'center' | 'end';
    priority: number;
    render: () => any;
}

// ── Registry ────────────────────────────────────────────────────

const registry = new Map<string, LockscreenWidgetDef>();

export function registerLockscreenWidget(def: LockscreenWidgetDef): void {
    if (registry.has(def.id)) {
        logger.warn(
            'lockscreen',
            `Widget "${def.id}" already registered — skipping`
        );
        return;
    }
    registry.set(def.id, def);
}

export function getLockscreenWidgets(
    position: 'center' | 'end'
): LockscreenWidgetDef[] {
    return Array.from(registry.values())
        .filter(w => w.position === position)
        .sort((a, b) => a.priority - b.priority);
}

// ── LockscreenWidgets container ─────────────────────────────────

export const LockscreenWidgets = ({position}: {position: 'center' | 'end'}) => {
    const [widgetList] = createState(getLockscreenWidgets(position));
    if (widgetList().length === 0) return <></>;
    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            halign={Gtk.Align.CENTER}
        >
            <For each={widgetList}>
                {(def: LockscreenWidgetDef) => def.render()}
            </For>
        </Gtk.Box>
    );
};

// ── Media Controls Widget ───────────────────────────────────────

const MediaPlayerWidget = () => {
    const mc = MediaController.get_default();

    return (
        <Gtk.Box
            visible={bind(mc, 'players').as(p => p.length > 0)}
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={8}
            cssClasses={['card', 'p-8']}
            halign={Gtk.Align.CENTER}
        >
            <Gtk.Image
                visible={bind(mc, 'activeCoverArt').as(u => u.length > 0)}
                css={'min-width: 32px; min-height: 32px; border-radius: calc(var(--shade-radius) / 2);'}
                file={bind(mc, 'activeCoverArt')}
            />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                <Gtk.Label
                    label={bind(mc, 'activeTitle')}
                    maxWidthChars={30}
                    ellipsize={3}
                    halign={Gtk.Align.START}
                    cssClasses={['body']}
                />
                <Gtk.Label
                    label={bind(mc, 'activeArtist')}
                    maxWidthChars={30}
                    ellipsize={3}
                    halign={Gtk.Align.START}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Box spacing={4}>
                <Gtk.Button
                    tooltipText="Toggle playback"
                    cssClasses={['flat', 'circular']}
                    iconName="media-playback-pause-symbolic"
                    onClicked={() => mc.playPause()}
                />
                <Gtk.Button
                    tooltipText="Next track"
                    cssClasses={['flat', 'circular']}
                    iconName="media-skip-forward-symbolic"
                    onClicked={() => mc.next()}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
};

registerLockscreenWidget({
    id: 'media',
    position: 'end',
    priority: 30,
    render: () => <MediaPlayerWidget />,
});
