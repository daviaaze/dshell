import Gtk from 'gi://Gtk?version=4.0';
import {drawUsageGraph} from '@shade/services/monitoring/usageGraph';
import {type Accessor, effect} from 'gnim';

/**
 * Line graph for a fixed-length sample window. Values are drawn right-aligned
 * so the newest sample sits on the right edge. `max` fixes the vertical scale
 * (e.g. 1 for fractions); omit it to auto-scale to the largest sample.
 * `secondary` is drawn as a dashed line on the same scale.
 *
 * Colors follow the widget's CSS `color`, so a style class like `accent`
 * or `success` picks the series color and adapts to light/dark themes.
 */
export function UsageGraph({
    values,
    secondary,
    capacity,
    max,
    cssClasses = ['accent'],
    heightRequest = 56,
}: {
    values: Accessor<number[]>;
    secondary?: Accessor<number[]>;
    capacity: number;
    max?: number;
    cssClasses?: string[];
    heightRequest?: number;
}) {
    return (
        <Gtk.DrawingArea
            cssClasses={['usage-graph', ...cssClasses]}
            heightRequest={heightRequest}
            hexpand
            ref={(self) => {
                self.set_draw_func((area, cr, width, height) =>
                    drawUsageGraph(cr, width, height, area.get_color(), {
                        primary: values(),
                        secondary: secondary?.() ?? [],
                        capacity,
                        max,
                    })
                );
                effect(() => {
                    values();
                    secondary?.();
                    self.queue_draw();
                });
            }}
        />
    );
}
