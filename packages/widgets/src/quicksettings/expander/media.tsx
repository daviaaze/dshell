import Astal from 'gi://Astal?version=4.0';
import Mpris from 'gi://AstalMpris';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import MediaController from '@shade/services/session/mediaController';
import {exactQuery} from '@shade/services/state/apps';
import {bind, effect, For, onCleanup} from 'gnim';

function lengthStr(length: number) {
    const min = Math.floor(length / 60);
    const sec = Math.floor(length % 60);
    const sec0 = sec < 10 ? '0' : '';
    return `${min}:${sec0}${sec}`;
}

const PlayerApp = ({player}: {player: Mpris.Player}) => (
    <Gtk.Box hexpand halign={Gtk.Align.CENTER} spacing={4}>
        <Gtk.Image
            cssClasses={['icon']}
            hexpand
            tooltipText={bind(player, 'identity').as((id) => id || '')}
            iconName={bind(player, 'entry').as(
                (entry) => exactQuery(entry)[0]?.iconName ?? 'audio-x-generic-symbolic'
            )}
        />
        <Gtk.Label label={bind(player, 'identity').as((id) => id || '')} />
    </Gtk.Box>
);

const CoverArt = ({player}: {player: Mpris.Player}) => {
    return (
        <Gtk.Picture
            visible={bind(player, 'cover-art').as((c) => !!c)}
            file={bind(player, 'cover-art').as((path) =>
                path ? Gio.File.new_for_path(path) : null
            )}
            css={'border-radius: calc(var(--window-radius) / 2);'}
            contentFit={Gtk.ContentFit.COVER}
            widthRequest={120}
            heightRequest={120}
        />
    );
};

const TitleArtist = ({player}: {player: Mpris.Player}) => {
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
            <Gtk.Label
                wrap
                maxWidthChars={10}
                cssClasses={['heading']}
                label={bind(player, 'title')}
            />
            <Gtk.Label
                cssClasses={['caption', 'dimmed']}
                label={bind(player, 'artist')}
                maxWidthChars={10}
                ellipsize={3}
            />
        </Gtk.Box>
    );
};

function setPlaybackLabel(button: Gtk.Accessible, label: string) {
    button.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, label)]
    );
}

const PlaybackButtons = ({player, slot}: {player: Mpris.Player; slot?: string}) => {
    const mc = MediaController.get_default();
    const playbackLabel = bind(player, 'playback-status').as((status) =>
        status === Mpris.PlaybackStatus.PLAYING ? 'Pausar' : 'Reproduzir'
    );
    return (
        <Gtk.Box slot={slot}>
            <Gtk.Button
                iconName={'media-skip-backward-symbolic'}
                tooltipText="Faixa anterior"
                ref={(button) => setPlaybackLabel(button, 'Faixa anterior')}
                onClicked={() => {
                    mc.setActivePlayer(player);
                    mc.previous();
                }}
                visible={bind(player, 'can-go-previous')}
            />

            <Gtk.Button
                iconName={bind(player, 'playback-status').as((s) =>
                    s === Mpris.PlaybackStatus.PLAYING
                        ? 'media-playback-pause-symbolic'
                        : 'media-playback-start-symbolic'
                )}
                tooltipText={playbackLabel}
                ref={(button) => {
                    const update = () => setPlaybackLabel(button, playbackLabel());
                    onCleanup(playbackLabel.subscribe(update));
                    update();
                }}
                onClicked={() => {
                    mc.setActivePlayer(player);
                    mc.playPause();
                }}
            />
            <Gtk.Button
                iconName={'media-skip-forward-symbolic'}
                tooltipText="Próxima faixa"
                ref={(button) => setPlaybackLabel(button, 'Próxima faixa')}
                onClicked={() => {
                    mc.setActivePlayer(player);
                    mc.next();
                }}
                visible={bind(player, 'can-go-next')}
            />
        </Gtk.Box>
    );
};

const PlaybackStatus = ({player}: {player: Mpris.Player}) => {
    const mc = MediaController.get_default();
    const position = bind(player, 'position');
    const length = bind(player, 'length');
    let applyingPosition = false;
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
            <Astal.Slider
                marginTop={4}
                marginBottom={4}
                drawValue={false}
                onValueChanged={(self) => {
                    if (applyingPosition) return;
                    mc.setActivePlayer(player);
                    mc.seek(self.value);
                }}
                min={0}
                visible={bind(player, 'can-seek')}
                ref={(slider) => {
                    setPlaybackLabel(slider, 'Posição da faixa');
                    effect(() => {
                        const maximum = Math.max(0, length());
                        const value = Math.max(0, Math.min(maximum, position()));
                        applyingPosition = true;
                        try {
                            slider.max = maximum;
                            slider.value = value;
                        } finally {
                            applyingPosition = false;
                        }
                    });
                }}
            />
            <Gtk.CenterBox>
                <Gtk.Label slot="start" label={bind(player, 'position').as(lengthStr)} />
                <PlaybackButtons slot="center" player={player} />
                <Gtk.Label slot="end" label={bind(player, 'length').as(lengthStr)} />
            </Gtk.CenterBox>
        </Gtk.Box>
    );
};

export const Media = () => {
    const mc = MediaController.get_default();

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            visible={bind(mc, 'players').as((p) => p.length > 0)}
        >
            <For each={bind(mc, 'players')}>
                {(player: Mpris.Player) => (
                    <Gtk.Box cssClasses={['card']} orientation={Gtk.Orientation.VERTICAL} hexpand>
                        <PlayerApp player={player} />
                        <Gtk.Box>
                            <CoverArt player={player} />
                            <TitleArtist player={player} />
                        </Gtk.Box>
                        <PlaybackStatus player={player} />
                    </Gtk.Box>
                )}
            </For>
        </Gtk.Box>
    );
};
