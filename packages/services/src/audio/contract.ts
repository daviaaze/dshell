/**
 * Audio Events — volume and mute commands emitted by widgets and
 * consumed by the AudioController service.
 *
 * Widgets emit these on the shared bus instead of calling service
 * methods directly. The controller subscribes in its init() hook.
 */
export interface AudioEvents {
    'audio:set-volume': {device: unknown; value: number};
    'audio:toggle-mute': {device: unknown};
    'audio:app-mixer:set-volume': {id: number; value: number};
}
