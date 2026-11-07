import Cairo from 'gi://cairo?version=1.0';
import type Gdk from 'gi://Gdk?version=4.0';

/** Exclude the recording-boundary layer window from pointer targeting. */
export function setBoundaryInputPassthrough(surface: Gdk.Surface): void {
    surface.set_input_region(new Cairo.Region());
}
