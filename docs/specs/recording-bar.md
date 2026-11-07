# Recording and capture feedback

Source: [`index.tsx`](../../packages/widgets/src/recording-bar/index.tsx), bar entry point [`indicators/recording.tsx`](../../packages/widgets/src/bar/indicators/recording.tsx), service [`screenshot.ts`](../../packages/services/src/capture/screenshot.ts).

The bottom-right focused-monitor overlay is visible while recording, capture preparation is busy, a result path exists, or an error exists. During recording it shows elapsed duration, audio indicator when capture preferences request audio, and Stop (`stopRecording()`). While capture preparation is busy it shows a spinner. On successful result it displays the actual path, a screenshot preview for image captures, and Open file/Open folder/Done actions. Errors display service feedback and can be dismissed. The bar indicator is a separate recording affordance; this surface also handles screenshot results/errors and is not only a recording bar.

The optional recording boundary is a separate transparent layer surface: it paints only the per-output dashed edges and accepts neither keyboard nor pointer input. Starting a recording reads the current boundary preference; disabling it leaves no boundary layer.

Manual: initiate a capture and recording through the overlay on a suitable session, inspect busy and actual result/error states, open the file/folder and stop recording. Do not claim output correctness from UI state alone; inspect the real file. Proposed procedures only, not new VM results.
