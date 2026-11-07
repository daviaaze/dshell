# OSD

Source: [`index.tsx`](../../packages/widgets/src/osd/index.tsx), pure reveal component [`popup.tsx`](../../packages/widgets/src/osd/popup.tsx), plus owning audio, brightness and touchpad services.

One passive `Astal.Window` on the focused monitor uses `OVERLAY`, bottom anchor, `Keymode.NONE`, width request 250 and margin 24. Visibility is the union of active speaker/microphone reveal state with an available endpoint, valid screen/keyboard brightness reveal state, or touchpad reveal state. It renders audio and microphone endpoint sliders, screen/keyboard brightness sliders, and the touchpad revealer. The service owns reveal state and its timer; the UI revealer follows that state and delays hiding until its 200ms slide animation completes. This is not an on-demand interactive panel.

The OSD content has 8px internal padding. This is separate from the centered surface's 24px bottom offset: the 4px edge margin used by edge-attached shell panels does not apply to this centered OSD.

Manual: adjust audio, microphone, brightness and touchpad using their actual controls on a suitable session; observe OSD appearance/disappearance and missing-endpoint/brightness states. Confirm service timing rather than inferring it from animation. Not a new VM result.
