import GObject from 'gi://GObject?version=2.0';
import type Hyprland from 'gi://AstalHyprland?version=0.1';
import * as WorkspaceModule from '../bar/workspaces';
import {describe, expect, it, run} from './test-runner';

const TestClient = GObject.registerClass(
    {
        GTypeName: 'ShadeWorkspaceIconTestClient',
        Properties: {
            class: GObject.ParamSpec.string(
                'class',
                'class',
                'class',
                GObject.ParamFlags.READWRITE,
                ''
            ),
            title: GObject.ParamSpec.string(
                'title',
                'title',
                'title',
                GObject.ParamFlags.READWRITE,
                ''
            ),
            'initial-class': GObject.ParamSpec.string(
                'initial-class',
                'initial-class',
                'initial-class',
                GObject.ParamFlags.READWRITE,
                ''
            ),
            'initial-title': GObject.ParamSpec.string(
                'initial-title',
                'initial-title',
                'initial-title',
                GObject.ParamFlags.READWRITE,
                ''
            ),
        },
    },
    class extends GObject.Object {}
);

// The named helper is a test seam; the module's default export remains the widget.
const workspaceTestHooks = WorkspaceModule as unknown as {
    bindWorkspaceClientIcon?: (
        client: Hyprland.Client,
        resolveIcon: (client: Hyprland.Client) => string
    ) => () => string;
};
const bindWorkspaceClientIcon = workspaceTestHooks.bindWorkspaceClientIcon;

describe('workspace client icon binding', () => {
    it('replaces the missing icon when Hyprland fills in the client class', () => {
        expect(typeof bindWorkspaceClientIcon).toBe('function');
        if (!bindWorkspaceClientIcon) return;

        const client = new TestClient();
        // This GObject fixture implements the four Hyprland client identity properties.
        const hyprlandClient = client as unknown as Hyprland.Client;
        const iconName = bindWorkspaceClientIcon(hyprlandClient, (target) => {
            return target.class ? 'orca-ide' : 'image-missing-symbolic';
        });

        expect(iconName()).toBe('image-missing-symbolic');
        hyprlandClient.class = 'orca';
        expect(iconName()).toBe('orca-ide');
    });
});

await run();
