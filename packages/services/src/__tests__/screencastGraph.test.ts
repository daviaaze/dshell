import {classifyScreencastNode, JsonArrayFramer, ScreencastGraph} from '../capture/screencastGraph';
import {describe, expect, it, run} from './test-runner';

const node = (id: number, props: Record<string, unknown> = {}, state = 'running') => ({
    id,
    type: 'PipeWire:Interface:Node',
    info: {
        state,
        props: {
            'node.name': '.xdg-desktop-portal-hyprland-wrapped',
            'media.name': 'xdph-streaming-1',
            'node.description': 'Share',
            'object.serial': id,
            'media.class': 'Video/Source',
            ...props,
        },
    },
});

describe('ScreencastGraph', () => {
    it('classifies only active portal video sources, never audio or webcam nodes', () => {
        expect(classifyScreencastNode(node(1))).toBeTruthy();
        expect(
            classifyScreencastNode(node(2, {'media.name': 'camera', 'media.class': 'Video/Source'}))
        ).toBe(null);
        expect(classifyScreencastNode(node(3, {'media.class': 'Audio/Source'}))).toBe(null);
        expect(classifyScreencastNode(node(4, {}, 'idle'))).toBe(null);
    });

    it('applies snapshots, merges partial deltas, and removes info:null objects', () => {
        const graph = new ScreencastGraph();
        graph.apply([node(1), node(2)]);
        graph.apply([
            {
                id: 1,
                type: 'PipeWire:Interface:Node',
                info: {state: 'running', props: {'shade.capture.app-id': 'org.example'}},
            },
        ]);
        expect(graph.sources.length).toBe(2);
        expect(graph.sources[0]?.appId).toBe('org.example');
        graph.apply([{id: 1, type: 'PipeWire:Interface:Node', info: null}]);
        expect(graph.sources.length).toBe(1);
        expect(graph.sources[0]?.id).toBe(2);
    });

    it('clears old properties when PipeWire recycles a node id with a new serial', () => {
        const graph = new ScreencastGraph();
        graph.apply([node(1, {'object.serial': 10, 'media.name': 'xdph-streaming-old'})]);
        graph.apply([
            {
                id: 1,
                type: 'PipeWire:Interface:Node',
                info: {state: 'running', props: {'object.serial': 11}},
            },
        ]);
        expect(graph.sources.length).toBe(0);
    });

    it('retains client and link graph data and associates known client applications', () => {
        const graph = new ScreencastGraph();
        graph.apply([
            node(1),
            node(2, {'client.id': 7, 'node.name': 'Backspace', 'media.name': 'Backspace'}),
            {
                id: 7,
                type: 'PipeWire:Interface:Client',
                info: {props: {'application.id': 'org.example.App', 'application.name': 'Example'}},
            },
            {
                id: 9,
                type: 'PipeWire:Interface:Link',
                info: {props: {'link.input.node': 1, 'link.output.node': 2}},
            },
        ]);
        expect(graph.sources[0]?.appId).toBe('org.example.App');
        expect(graph.sources[0]?.appName).toBe('Example');
        graph.apply([{id: 7, type: 'PipeWire:Interface:Client', info: null}]);
        expect(graph.sources[0]?.appId).toBe(undefined);
    });

    it('frames nested JSON arrays across lines and adjacent documents, respecting strings', () => {
        const framer = new JsonArrayFramer();
        expect(
            framer.push('[{"id":1,"info":{"props":{"node.name":"share ] } \\"x\\""}}},').length
        ).toBe(0);
        const result = framer.push('{"id":2}]\n[{"id":3}]');
        expect(result.length).toBe(2);
        expect((result[0] as unknown[]).length).toBe(2);
    });
});

await run(import.meta.url);
