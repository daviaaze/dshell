# Recording and capture feedback

Source: [`index.tsx`](../../packages/widgets/src/recording-bar/index.tsx), bar entry point [`indicators/recording.tsx`](../../packages/widgets/src/bar/indicators/recording.tsx), service [`screenshot.ts`](../../packages/services/src/capture/screenshot.ts).

The bottom-right focused-monitor overlay is visible while recording, capture preparation is busy, a result path exists, or an error exists. During recording it shows elapsed duration, audio indicator when capture preferences request audio, and Stop (`stopRecording()`). While capture preparation is busy it shows a spinner. On successful result it displays the actual path, a screenshot preview for image captures, and Open file/Open folder/Done actions. Errors display service feedback and can be dismissed. The bar indicator is a separate recording affordance; this surface also handles screenshot results/errors and is not only a recording bar.
## External screen-sharing feedback

The bar independently watches PipeWire through `Screencast`: `pw-dump --monitor --no-colors` snapshots and deltas are merged by object id, and `info: null` removes an object. Only running `Video/Source` nodes whose `media.name` (falling back to `node.name`) starts with `xdph-streaming-` count as portal screen/window shares; audio and webcam sources are not classified as sharing. The indicator is a red display icon that remains visible while any such source is active; its tooltip lists the known consumer app and target when PipeWire metadata permits. It has no popover and is not clickable. Missing metadata is presented as an unidentified application or as a generic screen share; the UI does not invent an app or target name. Internal recording remains a separate indicator with its elapsed duration and stop action.


The `Astal.Window` uses `margin={4}` for its layer-shell edges and an opaque native window background. Do not substitute inherited GTK `marginStart`/`marginEnd`: those inset widget content rather than setting the right/left layer margin. The busy/recording rows retain their own `8px 12px` content padding, and result/error panels retain `12px`; these are independent of the exterior gap.

The optional recording boundary is a separate transparent layer surface: it paints only the per-output dashed edges and accepts neither keyboard nor pointer input. Starting a recording reads the current boundary preference; disabling it leaves no boundary layer.

Manual: initiate a capture and recording through the overlay on a suitable session, inspect busy and actual result/error states, open the file/folder and stop recording. Do not claim output correctness from UI state alone; inspect the real file. Proposed procedures only, not new VM results.
