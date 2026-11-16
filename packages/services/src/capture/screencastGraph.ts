export type ScreencastNode = {
    id: number;
    serial: number;
    name: string;
    description: string;
    kind?: string;
    appId?: string;
    appName?: string;
};

type Entry = {
    id?: number;
    type?: string;
    info?: {state?: string; props?: Record<string, unknown>} | null;
};

export function classifyScreencastNode(item: Entry): ScreencastNode | null {
    const info = item.info;
    const props = info?.props ?? {};
    const name = props['media.name'] ?? props['node.name'];
    if (
        item.type !== 'PipeWire:Interface:Node' ||
        info?.state !== 'running' ||
        props['media.class'] !== 'Video/Source' ||
        typeof name !== 'string' ||
        !name.startsWith('xdph-streaming-')
    )
        return null;
    const knownName = props['shade.capture.source-name'] ?? props['node.description'];
    return {
        id: Number(item.id),
        serial: Number(props['object.serial'] ?? item.id),
        name,
        description:
            typeof knownName === 'string' && knownName
                ? knownName
                : 'Screen or window being shared',
        kind:
            typeof props['shade.capture.source-kind'] === 'string'
                ? props['shade.capture.source-kind']
                : undefined,
        appId:
            typeof props['shade.capture.app-id'] === 'string'
                ? props['shade.capture.app-id']
                : undefined,
        appName:
            typeof props['shade.capture.app-name'] === 'string'
                ? props['shade.capture.app-name']
                : undefined,
    };
}

/** Stateful view of pw-dump snapshots and partial monitor deltas. */
export class ScreencastGraph {
    #nodes: Map<number, Entry>;
    #links: Map<number, Entry>;
    #clients: Map<number, Entry>;

    constructor() {
        this.#nodes = new Map();
        this.#links = new Map();
        this.#clients = new Map();
    }

    get sources(): ScreencastNode[] {
        const result: ScreencastNode[] = [];
        for (const [id, entry] of this.#nodes) {
            const node = classifyScreencastNode(entry);
            if (!node) continue;
            const nodeProps = entry.info?.props ?? {};
            let clientId = Number(nodeProps['client.id']);
            for (const link of this.#links.values()) {
                const p = link.info?.props ?? {};
                const input = Number(p['link.input.node']);
                const output = Number(p['link.output.node']);
                if (input !== id && output !== id) continue;
                const peer = this.#nodes.get(input === id ? output : input);
                const peerClient = Number(peer?.info?.props?.['client.id']);
                if (Number.isFinite(peerClient)) {
                    clientId = peerClient;
                    break;
                }
            }
            const clientProps = this.#clients.get(clientId)?.info?.props ?? {};
            const appId =
                node.appId ??
                (typeof clientProps['application.id'] === 'string'
                    ? clientProps['application.id']
                    : undefined);
            let appName = node.appName;
            if (!appName && typeof clientProps['application.name'] === 'string')
                appName = clientProps['application.name'];
            else if (!appName && typeof clientProps['application.process.binary'] === 'string')
                appName = clientProps['application.process.binary'];
            result.push({...node, appId, appName: appName || undefined});
        }
        return result;
    }

    apply(payload: unknown) {
        const items = Array.isArray(payload) ? payload : [payload];
        for (const raw of items) {
            if (!raw || typeof raw !== 'object') continue;
            const item = raw as Entry;
            const id = Number(item.id);
            if (!Number.isFinite(id)) continue;
            const map = this.#mapForType(item.type);
            if (map) this.#applyEntry(map, item, id);
        }
    }

    #mapForType(type: string | undefined): Map<number, Entry> | null {
        switch (type) {
            case 'PipeWire:Interface:Node':
                return this.#nodes;
            case 'PipeWire:Interface:Link':
                return this.#links;
            case 'PipeWire:Interface:Client':
                return this.#clients;
            default:
                return null;
        }
    }

    #applyEntry(map: Map<number, Entry>, item: Entry, id: number) {
        if (item.info === null) {
            map.delete(id);
            return;
        }
        const old = map.get(id);
        const oldSerial = Number(old?.info?.props?.['object.serial']);
        const newSerial = Number(item.info?.props?.['object.serial']);
        const recycled =
            Number.isFinite(newSerial) && Number.isFinite(oldSerial) && oldSerial !== newSerial;
        if (recycled && item.type === 'PipeWire:Interface:Node') {
            for (const [linkId, link] of this.#links) {
                const props = link.info?.props ?? {};
                if (
                    Number(props['link.input.node']) === id ||
                    Number(props['link.output.node']) === id
                )
                    this.#links.delete(linkId);
            }
        }
        map.set(id, {
            id,
            type: item.type,
            info: {
                ...(recycled ? {} : (old?.info ?? {})),
                ...(item.info ?? {}),
                props: {...(recycled ? {} : (old?.info?.props ?? {})), ...(item.info?.props ?? {})},
            },
        });
    }

    clear() {
        this.#nodes.clear();
        this.#links.clear();
        this.#clients.clear();
    }
}

/** Frames adjacent JSON documents from Process stdout without assuming line boundaries. */
export class JsonArrayFramer {
    #buffer: string;
    #depth: number;
    #inString: boolean;
    #escaped: boolean;

    constructor() {
        this.#buffer = '';
        this.#depth = 0;
        this.#inString = false;
        this.#escaped = false;
    }

    push(chunk: string): unknown[] {
        const results: unknown[] = [];
        for (const char of chunk) {
            const parsed = this.#append(char);
            if (parsed.complete) results.push(parsed.value);
        }
        return results;
    }

    #append(char: string): {complete: boolean; value?: unknown} {
        if (!this.#buffer && /\s/.test(char)) return {complete: false};
        this.#buffer += char;
        if (this.#inString) {
            if (this.#escaped) this.#escaped = false;
            else if (char === '\\') this.#escaped = true;
            else if (char === '"') this.#inString = false;
            return {complete: false};
        }
        if (char === '"') this.#inString = true;
        else if (char === '[' || char === '{') this.#depth++;
        else if (char === ']' || char === '}') this.#depth--;
        if (this.#depth !== 0 || !this.#buffer.trim()) return {complete: false};
        try {
            const value = JSON.parse(this.#buffer);
            this.reset();
            return {complete: true, value};
        } catch {
            this.reset();
            return {complete: false};
        }
    }

    reset() {
        this.#buffer = '';
        this.#depth = 0;
        this.#inString = false;
        this.#escaped = false;
    }
}
