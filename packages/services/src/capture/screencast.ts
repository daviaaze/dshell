import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object as GObject, property, register} from 'gnim/gobject';
import {JsonArrayFramer, ScreencastGraph, type ScreencastNode} from './screencastGraph';
export type ScreencastSource = ScreencastNode;
export {classifyScreencastNode} from './screencastGraph';

/** Watches PipeWire for active xdg-desktop-portal video capture sources. */
@register
export class Screencast extends GObject {
    private static instance: Screencast;
    static get_default() {
        if (!Screencast.instance) Screencast.instance = new Screencast();
        return Screencast.instance;
    }

    #process: Process | null;
    #graph: ScreencastGraph;
    #framer: JsonArrayFramer;
    #sources: ScreencastSource[];

    constructor() {
        super();
        this.#process = null;
        this.#graph = new ScreencastGraph();
        this.#framer = new JsonArrayFramer();
        this.#sources = [];
    }

    @property get active() {
        return this.#sources.length > 0;
    }
    @property get sources(): ScreencastSource[] {
        return this.#sources;
    }

    init() {
        this.start();
    }

    start() {
        if (this.#process) return;
        this.#graph.clear();
        this.#framer.reset();
        this.#publish();
        try {
            const process = Process.subprocessv(['pw-dump', '--monitor', '--no-colors']);
            this.#process = process;
            process.connect('stdout', (_p: Process, line: string) => {
                try {
                    for (const document of this.#framer.push(`${line}\n`)) {
                        this.#graph.apply(document);
                        this.#publish();
                    }
                } catch (error) {
                    logger.error(
                        'screencast',
                        `Invalid pw-dump stream; stopping watcher: ${error}`
                    );
                    this.stop();
                }
            });
            process.connect('exit', () => {
                if (this.#process !== process) return;
                this.#process = null;
                this.#framer.reset();
                this.#graph.clear();
                this.#publish();
            });
        } catch (error) {
            logger.warn('screencast', `Could not start pw-dump: ${error}`);
        }
    }

    stop() {
        const process = this.#process;
        this.#process = null;
        this.#framer.reset();
        this.#graph.clear();
        process?.kill();
        this.#publish();
    }

    dispose() {
        this.stop();
    }

    #publish() {
        this.#sources = this.#graph.sources;
        this.notify('sources');
        this.notify('active');
    }
}

defineService({name: 'Screencast', service: Screencast.get_default()});
export default Screencast;
