import Cairo from "gi://cairo?version=1.0"
import GLib from "gi://GLib?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createComputed } from "gnim"

interface SunArcProps {
  sunrise: Accessor<number>
  sunset: Accessor<number>
  now: Accessor<number>
}

export const SunArc = ({ sunrise, sunset, now }: SunArcProps) => {
  const draw = (_area: Gtk.DrawingArea, cr: Cairo.Context, w: number, h: number) => {
    const sr = sunrise()
    const ss = sunset()
    const n = now()

    // Handle invalid/unset timestamps (initial loading)
    if (!sr || !ss || sr <= 0 || ss <= 0) {
      return
    }

    const isDay = n >= sr && n <= ss
    const dayLength = ss - sr
    const fraction = dayLength > 0 ? (n - sr) / dayLength : 0

    const pad = 8
    const arcW = w - pad * 2
    const arcH = h * 0.65
    const cx = w / 2
    const cy = h * 0.85
    const rx = arcW / 2
    const ry = arcH

    // ── Background fill below the arc (ground area) ──
    cr.save()
    cr.translate(cx, cy)
    cr.scale(rx, ry)
    cr.arc(0, 0, 1, Math.PI, 2 * Math.PI)
    cr.restore()
    cr.lineTo(cx + rx, cy)
    cr.closePath()
    if (isDay) {
      cr.setSourceRGBA(1.0, 0.65, 0.2, 0.12)
    } else {
      cr.setSourceRGBA(0.2, 0.2, 0.4, 0.12)
    }
    cr.fill()

    // ── Arc line ──
    cr.save()
    cr.translate(cx, cy)
    cr.scale(rx, ry)
    cr.arc(0, 0, 1, Math.PI, 2 * Math.PI)
    cr.restore()
    cr.setSourceRGBA(1, 1, 1, isDay ? 0.4 : 0.2)
    cr.setLineWidth(1.5)
    cr.stroke()

    // ── Horizon line ──
    cr.moveTo(pad, cy)
    cr.lineTo(w - pad, cy)
    cr.setSourceRGBA(1, 1, 1, 0.15)
    cr.setLineWidth(1)
    cr.stroke()

    // ── Sun position dot ──
    if (isDay && fraction >= 0 && fraction <= 1) {
      const angle = Math.PI - fraction * Math.PI // PI=sunrise (left), 0=sunset (right)
      const sx = cx + rx * Math.cos(angle)
      const sy = cy - ry * Math.sin(angle)

      // Glow
      cr.arc(sx, sy, 10, 0, 2 * Math.PI)
      cr.setSourceRGBA(1.0, 0.7, 0.1, 0.2)
      cr.fill()

      // Sun dot
      cr.arc(sx, sy, 5, 0, 2 * Math.PI)
      cr.setSourceRGBA(1.0, 0.8, 0.1, 1.0)
      cr.fill()
    }

    // ── Sunrise time label (left) ──
    const sunriseLabel = formatTimeShort(sr)
    cr.selectFontFace("sans-serif", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL)
    cr.setFontSize(9)
    cr.setSourceRGBA(1, 1, 1, 0.7)

    const extents = cr.textExtents(sunriseLabel)
    cr.moveTo(pad, cy + 12)
    cr.showText(sunriseLabel)

    // Sunrise dot
    cr.arc(pad + 4, cy + 12 + 3, 3, 0, 2 * Math.PI)
    cr.setSourceRGBA(1.0, 0.6, 0.1, 0.7)
    cr.fill()

    // ── Sunset time label (right) ──
    const sunsetLabel = formatTimeShort(ss)
    const extents2 = cr.textExtents(sunsetLabel)
    cr.setSourceRGBA(1, 1, 1, 0.7)
    cr.moveTo(w - pad - extents2.x_advance, cy + 12)
    cr.showText(sunsetLabel)

    // Sunset dot
    cr.arc(w - pad - 4, cy + 12 + 3, 3, 0, 2 * Math.PI)
    cr.setSourceRGBA(0.8, 0.3, 0.1, 0.7)
    cr.fill()

    // ── "Daylight: Xh Ym" label ──
    const hours = Math.floor(dayLength / 3600)
    const minutes = Math.floor((dayLength % 3600) / 60)
    const daylightLabel = `Daylight: ${hours}h ${minutes}m`
    cr.setFontSize(8)
    cr.setSourceRGBA(1, 1, 1, 0.5)
    const extents3 = cr.textExtents(daylightLabel)
    cr.moveTo(cx - extents3.x_advance / 2, h - 4)
    cr.showText(daylightLabel)
  }

  const area = (
    <Gtk.DrawingArea
      hexpand
      heightRequest={100}
      widthRequest={280}
    />
  ) as Gtk.DrawingArea

  area.set_draw_func(draw)

  // Queue redraw when dependencies change
  createComputed(() => {
    sunrise()
    sunset()
    now()
    area.queue_draw()
  })

  return area
}

function formatTimeShort(unixTs: number): string {
  const dt = GLib.DateTime.new_from_unix_local(unixTs)
  return dt.format("%H:%M") ?? "--:--"
}
