/**
 * Lockscreen widget registry — extensible widget system for the lockscreen.
 *
 * Phase 1: static registry with Media Player widget.
 * Phase 2 (future): dynamic registration from any widget module,
 *   GSettings-enabled visibility, priority ordering, more widgets.
 */

import Gtk from 'gi://Gtk?version=4.0';
import Mpris from 'gi://AstalMpris';
import {For, createState, onMount, onCleanup} from 'gnim';
import {connectFor, cleanupNode} from '#/lib/connectFor';

// ── Widget Interface ────────────────────────────────────────────

export interface LockscreenWidgetDef {
    id: string;
    position: 'center' | 'end';
    priority: number;
    render: () => JSX.Element;
}

// ── Registry ────────────────────────────────────────────────────

const registry = new Map<string, LockscreenWidgetDef>();

export function registerLockscreenWidget(def: LockscreenWidgetDef): void {
    if (registry.has(def.id)) {
        console.warn(
            `[Lockscreen] Widget "${def.id}" already registered — skipping`
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
    const [visible, setVisible] = createState(false);
    const [player, setPlayer] = createState<Mpris.Player | null>(null);
    const [title, setTitle] = createState('');
    const [artist, setArtist] = createState('');
    const [artUrl, setArtUrl] = createState('');
    const [playing, setPlaying] = createState(false);

    onMount(() => {
        const _hn = {};
        const mpris = Mpris.get_default();
        if (!mpris) return;

        const update = () => {
            const p = mpris.players?.[0] ?? null;
            setPlayer(p);
            if (p) {
                setTitle(p.title || '');
                setArtist(p.artist || '');
                setArtUrl(p.coverArt || '');
                setPlaying(p.playbackStatus === Mpris.PlaybackStatus.PLAYING);
            }
            setVisible(p !== null);
        };

        connectFor(_hn, mpris, 'notify::players', update);
        update();

        // Track player property changes
        let lastPlayer: Mpris.Player | null = null;

        connectFor(_hn, mpris, 'notify::players', () => {
            const players = mpris.players;
            const p = players?.[0] ?? null;
            if (p === lastPlayer) return;
            if (lastPlayer) cleanupNode(_hn);
            lastPlayer = p;
            if (p) {
                connectFor(_hn, p, 'notify::title', update);
                connectFor(_hn, p, 'notify::artist', update);
                connectFor(_hn, p, 'notify::coverArt', update);
                connectFor(_hn, p, 'notify::playback-status', update);
            }
            update();
        });

        onCleanup(() => {
            cleanupNode(_hn);
        });
    });

    const togglePlay = () => {
        const p = player();
        if (p === null) return;
        if (playing()) {
            p.pause();
        } else {
            p.play();
        }
    };

    const nextTrack = () => {
        player()?.next();
    };

    return (
        <Gtk.Box
            visible={visible}
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={8}
            cssClasses={['card', 'p-8']}
            halign={Gtk.Align.CENTER}
        >
            <Gtk.Image
                visible={artUrl.as(u => u.length > 0)}
                css={'min-width: 32px; min-height: 32px; border-radius: 4px;'}
                file={artUrl}
            />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                <Gtk.Label
                    label={title}
                    maxWidthChars={30}
                    ellipsize={3}
                    halign={Gtk.Align.START}
                    cssClasses={['body']}
                />
                <Gtk.Label
                    label={artist}
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
                    onClicked={togglePlay}
                />
                <Gtk.Button
                    tooltipText="Next track"
                    cssClasses={['flat', 'circular']}
                    iconName="media-skip-forward-symbolic"
                    onClicked={nextTrack}
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
