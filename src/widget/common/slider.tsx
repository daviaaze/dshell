import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createState } from "gnim"

type SliderProps = {
  icon: Accessor<string> | string
  visible?: Accessor<boolean> | boolean
  min: number
  max: number
  value: Accessor<number>
  setValue: (value: number) => void
  onIconClick?: () => void
}

const DEBOUNCE_MS = 80

export const Slider = (props: SliderProps) => {
  const safe = (v: number) => (Number.isFinite(v) ? v : 0)
  const [displayValue, setDisplayValue] = createState(safe(props.value()))
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingValue: number | null = null

  const debouncedSetValue = (value: number) => {
    setDisplayValue(value)
    pendingValue = value
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      props.setValue(value)
      // Keep guard up for 150ms after setting to absorb stale D-Bus callbacks
      debounceTimer = setTimeout(() => {
        pendingValue = null
        debounceTimer = null
        // If the actual value hasn't caught up, sync display to reality
        setDisplayValue(safe(props.value()))
      }, 150)
    }, DEBOUNCE_MS)
  }

  props.value.subscribe(() => {
    const v = safe(props.value())
    // During a drag or just after setting a value, ignore updates that
    // don't match the pending target (stale Wireplumber D-Bus callbacks)
    if (pendingValue !== null && v !== pendingValue) return
    if (debounceTimer === null) setDisplayValue(v)
  })

  return (
    <Gtk.Box cssClasses={["slider"]} spacing={4} visible={props.visible}>
      {props.onIconClick ? (
        <Gtk.Button onClicked={props.onIconClick}>
          <Gtk.Image iconName={props.icon} />
        </Gtk.Button>
      ) : (
        <Gtk.Image iconName={props.icon} />
      )}
      <Astal.Slider
        hexpand
        min={props.min}
        max={props.max}
        $={(self) => self.set_value(safe(displayValue()))}
        onChangeValue={({ value }) => debouncedSetValue(safe(value))}
        value={displayValue}
      />
      <Gtk.Label
        cssClasses={["heading"]}
        label={displayValue((v) => (v ?? 0).toFixed(0).toString().concat("%"))}
      />
    </Gtk.Box>
  )
}
