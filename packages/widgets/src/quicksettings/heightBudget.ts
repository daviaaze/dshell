import {SURFACE_EDGE_GAP} from '../common/surface';

interface QuickSettingsHeightMetrics {
    monitorHeight: number;
    reservedTop: number;
    reservedBottom: number;
    headerHeight: number;
    errorHeight: number;
    footerHeight: number;
    surfaceInsets: number;
}

/**
 * Maximum scroll viewport in logical pixels. Measured fixed widgets already
 * include their GTK margins; page padding belongs inside the scroll viewport.
 */
export function quickSettingsContentHeight(metrics: QuickSettingsHeightMetrics): number {
    return Math.max(
        1,
        Math.floor(
            metrics.monitorHeight -
                metrics.reservedTop -
                metrics.reservedBottom -
                SURFACE_EDGE_GAP * 2 -
                metrics.headerHeight -
                metrics.errorHeight -
                metrics.footerHeight -
                metrics.surfaceInsets
        )
    );
}
