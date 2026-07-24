import Astal from 'gi://Astal?version=4.0';
import Mpris from 'gi://AstalMpris';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {For, bind} from 'gnim';
import Adw from 'gi://Adw?version=1';
import {useStyle} from '#/style/useStyle';
import MediaController from '#/lib/services/session/mediaController';
import {exactQuery} from '#/lib/services/state/apps';

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
            tooltipText={bind(player, 'identity').as(id => id || '')}
            iconName={bind(player, 'entry').as(
                entry =>
                    exactQuery(entry)[0]?.iconName ?? 'audio-x-generic-symbolic'
            )}
        />
        <Gtk.Label
            label={bind(player, 'identity').as(id => id || '')}
        />
    </Gtk.Box>
);

const CoverArt = ({player}: {player: Mpris.Player}) => {
    const thumbnailStyle = useStyle({
        'border-radius': '8px',
    });
    return (
        <Gtk.Picture
        visible={bind(player, 'coverArt').as(c => !!c)}
        file={bind(player, 'coverArt').as(path =>
            Gio.File.new_for_path(path)
        )}
        cssClasses={['media-thumbnail', thumbnailStyle.class]}
        ref={thumbnailStyle.$}
        contentFit={Gtk.ContentFit.COVER}
        widthRequest={120}
        heightRequest={120}
    />
);
}

const TitleArtist = ({player}: {player: Mpris.Player}) => {
    const dimmedStyle = useStyle({
        opacity: '0.6',
    });
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
        <Gtk.Label
            wrap
            maxWidthChars={10}
            cssClasses={['heading']}
            label={bind(player, 'title')}
        />
        <Gtk.Label
            cssClasses={['caption', 'dimmed', dimmedStyle.class]}
            ref={dimmedStyle.$}
            label={bind(player, 'artist')}
            maxWidthChars={10}
            ellipsize={3}
        />
    </Gtk.Box>
);
}

const PlaybackButtons = ({player}: {player: Mpris.Player}) => {
    const mc = MediaController.get_default();
    return (
        <Gtk.Box>
            <Gtk.Button
                iconName={'media-skip-backward-symbolic'}
                onClicked={() => { mc.setActivePlayer(player); mc.previous(); }}
                visible={bind(player, 'canGoPrevious')}
            />

            <Gtk.Button
                iconName={bind(player, 'playbackStatus').as(s =>
                    s === Mpris.PlaybackStatus.PLAYING
                        ? 'media-playback-pause-symbolic'
                        : 'media-playback-start-symbolic'
                )}
                onClicked={() => mc.playPause()}
            />
            <Gtk.Button
                iconName={'media-skip-forward-symbolic'}
                onClicked={() => { mc.setActivePlayer(player); mc.next(); }}
                visible={bind(player, 'canGoNext')}
            />
        </Gtk.Box>
    );
};

const PlaybackStatus = ({player}: {player: Mpris.Player}) => {
    const mc = MediaController.get_default();
    const positionStyle = useStyle({
        'min-height': '8px',
        'border-radius': '4px',
    });
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
        <Astal.Slider
            cssClasses={['media-position', positionStyle.class]}
            ref={positionStyle.$}
            drawValue={false}
            onNotifyValue={({value}) => mc.seek(value)}
            min={0}
            max={bind(player, 'length')}
            visible={bind(player, 'canSeek')}
            value={bind(player, 'position')}
        />
        <Gtk.CenterBox>
            <Gtk.Label
                slot="start"
                label={bind(player, 'position').as(lengthStr)}
            />
            <PlaybackButtons slot="center" player={player} />
            <Gtk.Label
                slot="end"
                label={bind(player, 'length').as(lengthStr)}
            />
        </Gtk.CenterBox>
    </Gtk.Box>
);
}

export const MediaIcon = () => {
    const mc = MediaController.get_default();
    const hasPlayers = bind(mc, 'players').as(p => p.length > 0);

    return (
        <Gtk.Box
            spacing={4}
            cssClasses={['popover-padded']}
            visible={hasPlayers}
        >
            <Gtk.Image
                iconName="media-playback-start-symbolic"
                pixelSize={20}
            />
            <Adw.WindowTitle
                title={bind(mc, 'activeTitle')}
                subtitle={bind(mc, 'activePlayer').as(
                    p => p?.identity ?? ''
                )}
            />
        </Gtk.Box>
    );
};

export const Media = () => {
    const mc = MediaController.get_default();

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            visible={bind(mc, 'players').as(p => p.length > 0)}
        >
            <For each={bind(mc, 'players')}>
                {(player: Mpris.Player) => (
                    <Gtk.Box
                        cssClasses={['card', 'p-12']}
                        orientation={Gtk.Orientation.VERTICAL}
                        hexpand
                    >
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
