/**
 * MockAudioControl — standalone preview of the audio control widget.
 *
 * Visually matches src/widget/common/audioControl.tsx but uses
 * mock static data and Gtk.Scale instead of AstalWp + Astal.Slider.
 */

import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createState } from "gnim"

interface MockAudioControlProps {
  volume?: number
  muted?: boolean
  showAppMixer?: boolean
  deviceName?: string
}

export const MockAudioControl = (props: MockAudioControlProps) => {
  const {
    volume: initialVolume = 75,
    muted = false,
    showAppMixer = false,
    deviceName = "Built-in Audio",
  } = props

  const [volume, setVolume] = createState(initialVolume)
  const [isMuted, setIsMuted] = createState(muted)
  const [revealed, setRevealed] = createState(false)

  const scaleAdjustment = new Gtk.Adjustment({
    value: volume(),
    lower: 0,
    upper: 100,
    stepIncrement: 1,
  })
  scaleAdjustment.connect("value-changed", () => {
    setVolume(Math.round(scaleAdjustment.value))
  })

  const volIcon = isMuted()
    ? "audio-volume-muted-symbolic"
    : volume() > 50
      ? "audio-volume-high-symbolic"
      : volume() > 20
        ? "audio-volume-medium-symbolic"
        : "audio-volume-low-symbolic"

  return (
    <Gtk.Box
      spacing={4}
      cssClasses={[
        "card",
        "audio-config",
      ]}
      orientation={Gtk.Orientation.VERTICAL}
      widthRequest={350}
    >
      {/* ── Main slider row ── */}
      <Gtk.Box spacing={4}>
        <Gtk.Button
          onClicked={() => setIsMuted(!isMuted())}
          cssClasses={["flat"]}
        >
          <Gtk.Image iconName={volIcon} pixelSize={16} />
        </Gtk.Button>
        <Gtk.Scale
          hexpand
          adjustment={scaleAdjustment}
          drawValue={false}
        />
        <Gtk.Label
          label={volume((v) => `${v}%`)}
          cssClasses={["caption"]}
          widthChars={4}
        />
        {/* Reveal toggle */}
        <Gtk.Button
          onClicked={() => setRevealed(!revealed())}
          cssClasses={["flat"]}
        >
          <Gtk.Image
            iconName={revealed.as((r) =>
              r ? "go-up-symbolic" : "go-down-symbolic",
            )}
          />
        </Gtk.Button>
      </Gtk.Box>

      {/* ── Expanded area ── */}
      <Gtk.Revealer revealChild={revealed}>
        <Gtk.Box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
          cssClasses={["popover-padded", "p-12"]}
        >
          {!showAppMixer ? (
            /* ── Devices list ── */
            <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
              <MockDevice
                name={deviceName}
                description="Analog Stereo"
                isDefault
                volume={volume}
              />
              <MockDevice
                name="USB Headset"
                description="Digital Stereo (USB)"
                isDefault={false}
                volume={30}
              />
            </Gtk.Box>
          ) : (
            /* ── Tabbed: Devices + Apps ── */
            <Gtk.Box spacing={0} orientation={Gtk.Orientation.VERTICAL}>
              <Gtk.Box
                spacing={0}
                halign={Gtk.Align.CENTER}
                cssClasses={["linked"]}
              >
                <Gtk.ToggleButton
                  active
                  onClicked={() => print("[MockAudio] Devices tab")}
                  label="Devices"
                />
                <Gtk.ToggleButton
                  active={false}
                  onClicked={() => print("[MockAudio] Apps tab")}
                  label="Applications"
                />
              </Gtk.Box>
              <Gtk.Box
                spacing={12}
                cssClasses={["popover-padded", "p-12"]}
                orientation={Gtk.Orientation.VERTICAL}
              >
                <MockDevice
                  name={deviceName}
                  description="Analog Stereo"
                  isDefault
                  volume={volume}
                />
                <MockDevice
                  name="USB Headset"
                  description="Digital Stereo (USB)"
                  isDefault={false}
                  volume={30}
                />
              </Gtk.Box>
            </Gtk.Box>
          )}
        </Gtk.Box>
      </Gtk.Revealer>
    </Gtk.Box>
  )
}

const MockDevice = ({
  name,
  description,
  isDefault,
  volume: initialVol,
}: {
  name: string
  description: string
  isDefault: boolean
  volume: number
}) => {
  const [vol] = createState(initialVol)

  return (
    <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
        <Gtk.CheckButton
          active={isDefault}
          label={name}
          hexpand
          halign={Gtk.Align.START}
          cssClasses={["body"]}
          onNotifyActive={() =>
            print(`[MockAudio] set default: ${name}`)
          }
        />
        <Gtk.Label
          label={description}
          cssClasses={["caption", "dim-label"]}
          maxWidthChars={20}
          ellipsize={Pango.EllipsizeMode.END}
        />
      </Gtk.Box>
      <Gtk.Box spacing={4}>
        <Gtk.Button cssClasses={["flat"]}>
          <Gtk.Image iconName="audio-volume-high-symbolic" pixelSize={16} />
        </Gtk.Button>
        <Gtk.Scale
          hexpand
          adjustment={new Gtk.Adjustment({
            value: vol(),
            lower: 0,
            upper: 100,
            stepIncrement: 1,
          })}
          drawValue={false}
        />
        <Gtk.Label
          label={vol.as((v) => `${Math.round(v)}%`)}
          cssClasses={["caption"]}
          widthChars={4}
        />
      </Gtk.Box>
    </Gtk.Box>
  )
}
