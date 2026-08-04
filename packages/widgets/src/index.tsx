/**
 * Widget barrel — re-exports the composition root.
 *
 * Service/widget registration and boot logic live in ./bootstrap.ts, which
 * this module imports for its side effects (registering every built-in service
 * and widget). Import `@shade/widgets/index` once at the app entry point, then
 * call `boot(app)`.
 *
 * @see ./bootstrap.ts for the full boot sequence.
 */

export type {AppContext} from '@shade/core/define';
export {boot, createAppContext} from './bootstrap';
