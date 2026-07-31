/**
 * App-wide event bus — the single shared instance every domain emits to and
 * subscribes from. Typed as the union of all domain event contracts.
 */
import {createBus, type EventBus} from '@shade/core/eventBus';
import type {ShellEvents} from './state/contract';
import type {CaptureEvents} from './capture/contract';
import type {SystemEvents} from './notifications/contract';
import type {InputEvents} from './input/contract';
import type {AudioEvents} from './audio/contract';
import type {DisplayEvents} from './display/contract';
import type {PowerEvents} from './power/contract';

export type AppEventMap = ShellEvents & CaptureEvents & SystemEvents & InputEvents & AudioEvents & DisplayEvents & PowerEvents;

export const bus: EventBus<AppEventMap> = createBus<AppEventMap>();
