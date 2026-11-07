# Region selection history

This specification is historical: the standalone `region-selector` component is not an active widget. Area/window/monitor selection now belongs to the unified capture overlay [`screenshot-ui/index.tsx`](../../packages/widgets/src/screenshot-ui/index.tsx), with selection drawing in [`drawing.ts`](../../packages/widgets/src/screenshot-ui/drawing.ts) and capture lifecycle in [`Screenshot`](../../packages/services/src/capture/screenshot.ts). The current flow requires selection, review, and explicit capture/start confirmation; Escape/cancel does not capture. See [screenshot-ui.md](screenshot-ui.md) for the source-linked active behavior and manual procedure.

Do not use the former implementation details below as a description of a current component or runtime guarantee. Backend capture behavior and multi-monitor coordinates require validation on the target compositor; no new VM result is asserted here.
