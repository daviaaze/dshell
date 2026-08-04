import type Adw from 'gi://Adw?version=1';

let _app: Adw.Application | null = null;

/** Populated by the composition root (App.tsx) early in constructor. */
export function setApp(a: Adw.Application): void {
    _app = a;
}

/** Available from bootstrap onward — safe to call in renderers and service init(). */
export function getApp(): Adw.Application {
    if (!_app) throw new Error('appHandle: setApp() must be called before getApp()');
    return _app;
}
