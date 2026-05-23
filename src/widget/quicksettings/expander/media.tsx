import Astal from "gi://Astal?version=4.0"
import Mpris from "gi://AstalMpris"
import Gio from "gi://Gio?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { For, createBinding, createState, onMount } from "gnim"
import Adw from "gi://Adw?version=1"
import logger from "#/lib/logger"
import CavaVisualizer from "#/widget/quicksettings/cava"
import { exactQuery } from "#/lib/apps"

function lengthStr(length: number) {
  const min = Math.floor(length / 60)
  const sec = Math.floor(length % 60)
  const sec0 = sec < 10 ? "0" : ""
  return `${min}:${sec0}${sec}`
}

const PlayerApp = ({ player }: { player: Mpris.Player }) => (
  <Gtk.Box hexpand halign={Gtk.Align.CENTER} spacing={4}>
    <Gtk.Image
      cssClasses={["icon"]}
      hexpand
      tooltipText={createBinding(player, "identity").as((id) => id || "")}
      iconName={createBinding(player, "entry").as(
        (entry) => exactQuery(entry)[0]?.iconName ?? "audio-x-generic-symbolic",
      )}
    />
    <Gtk.Label label={createBinding(player, "identity").as((id) => id || "")} />
  </Gtk.Box>
)

const CoverArt = ({ player }: { player: Mpris.Player }) => (
  <Gtk.Picture
    visible={createBinding(player, "coverArt").as((c) => !!c)}
    file={createBinding(player, "coverArt").as((path) =>
      path ? Gio.File.new_for_path(path) : null,
    )}
    cssClasses={["thumbnail"]}
    contentFit={Gtk.ContentFit.COVER}
    widthRequest={120}
    heightRequest={120}
  />
)

const TitleArtist = ({ player }: { player: Mpris.Player }) => (
  <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
    <Gtk.Label
      wrap
      maxWidthChars={10}
      cssClasses={["heading"]}
      label={createBinding(player, "title")}
    />
    <Gtk.Label
      cssClasses={["artist"]}
      label={createBinding(player, "artist")}
      maxWidthChars={10}
      ellipsize={3}
    />
  </Gtk.Box>
)

const PlaybackButtons = ({ player }: { player: Mpris.Player }) => (
  <Gtk.Box>
    <Gtk.Button
      onClicked={() => player.previous()}
      visible={createBinding(player, "canGoPrevious")}
    >
      <Gtk.Image iconName={"media-skip-backward-symbolic"} />
    </Gtk.Button>

    <Gtk.Button
      onClicked={() =>
        player.playbackStatus === Mpris.PlaybackStatus.PAUSED
          ? player.play()
          : player.pause()
      }
    >
      <Gtk.Image
        iconName={createBinding(player, "playbackStatus").as((s) =>
          s === Mpris.PlaybackStatus.PLAYING
            ? "media-playback-pause-symbolic"
            : "media-playback-start-symbolic",
        )}
      />
    </Gtk.Button>
    <Gtk.Button
      onClicked={() => player.next()}
      visible={createBinding(player, "canGoNext")}
    >
      <Gtk.Image iconName={"media-skip-forward-symbolic"} />
    </Gtk.Button>
  </Gtk.Box>
)

const PlaybackStatus = ({ player }: { player: Mpris.Player }) => (
  <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
    <Astal.Slider
      cssClasses={["position"]}
      drawValue={false}
      onNotifyValue={({ value }) => (player.position = value)}
      min={0}
      max={createBinding(player, "length")}
      visible={createBinding(player, "canSeek")}
      value={createBinding(player, "position")}
    />
    <Gtk.CenterBox>
      <Gtk.Label
        $type="start"
        label={createBinding(player, "position").as(lengthStr)}
      />
      <PlaybackButtons $type="center" player={player} />
      <Gtk.Label
        $type="end"
        label={createBinding(player, "length").as(lengthStr)}
      />
    </Gtk.CenterBox>
  </Gtk.Box>
)

// --- MediaIcon (deferred D-Bus) ---

const MediaIconInner = ({ mpris }: { mpris: Mpris.Mpris }) => {
  logger.log("MediaIcon: Mpris done")
  return (
    <Gtk.Box
      spacing={4}
      cssClasses={["popover-padded"]}
      visible={createBinding(mpris, "players").as((p) => p.length > 0)}
    >
      <Gtk.Image iconName="media-playback-start-symbolic" pixelSize={20} />
      <Adw.WindowTitle
        title={createBinding(mpris, "players").as((p) =>
          p[0] ? p[0].title : "",
        )}
        subtitle={createBinding(mpris, "players").as((p) =>
          p[0] ? p[0].identity : "",
        )}
      />
    </Gtk.Box>
  )
}

export const MediaIcon = () => {
  logger.log("MediaIcon: start")
  const [mpris, setMpris] = createState<Mpris.Mpris | null>(null)

  onMount(() => {
    // Defer Mpris D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      logger.log("MediaIcon: Mpris.get_default()...")
      setMpris(Mpris.get_default())
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Box>
      {mpris.as((m) => (m ? <MediaIconInner mpris={m} /> : null))}
    </Gtk.Box>
  )
}

// --- Media (deferred D-Bus) ---

const MediaInner = ({ mpris }: { mpris: Mpris.Mpris }) => {
  logger.log("Media: Mpris done")
  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      visible={createBinding(mpris, "players").as((p) => p.length > 0)}
    >
      <CavaVisualizer />
      <For each={createBinding(mpris, "players")}>
        {(player: Mpris.Player) => (
          <Gtk.Box
            cssClasses={["card", "p-12"]}
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
  )
}

export const Media = () => {
  logger.log("Media: start")
  const [mpris, setMpris] = createState<Mpris.Mpris | null>(null)

  onMount(() => {
    // Defer Mpris D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      logger.log("Media: Mpris.get_default()...")
      setMpris(Mpris.get_default())
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Box>
      {mpris.as((m) => (m ? <MediaInner mpris={m} /> : null))}
    </Gtk.Box>
  )
}
