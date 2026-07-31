/**
 * Display Events — brightness, night light, color scheme.
 *
 * Commands emitted by widgets and consumed by the respective services.
 * Each service subscribes in its init() hook.
 */
export interface DisplayEvents {
    'display:brightness:set': { screen: number };
    'display:nightlight:enabled': boolean;
    'display:nightlight:temperature': number;
    'display:nightlight:schedule': boolean;
    'display:colorscheme:set': number;
}
