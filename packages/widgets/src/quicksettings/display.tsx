import Gtk from 'gi://Gtk?version=4.0';
import LayoutService, {type OutputInfo} from '@shade/services/display/layouts';
import {bind, For} from 'gnim';
import {QuickToggleButton} from '../common/quickToggleButton';

const SPACING = 8;

export const DisplaySection = () => {
    const service = LayoutService.get_default();
    return (
        <Gtk.Box
            spacing={SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            visible={bind(service, 'monitors').as(
                (outputs) => outputs.length > 0 || service.names.length > 0
            )}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Label label="Display" xalign={0} cssClasses={['caption']} hexpand />
                <Gtk.Label
                    label={bind(service, 'current').as((name) => name ?? 'Custom setup')}
                    xalign={1}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Label
                visible={bind(service, 'names').as((names) => names.length > 0)}
                label="Layouts"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(service, 'names')}>
                    {(name: string) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={name}
                            active={bind(service, 'current').as((current) => current === name)}
                            onClick={() => {
                                const layout = service.get(name);
                                if (layout) void service.preview(layout);
                            }}
                        />
                    )}
                </For>
            </Gtk.Box>
            <Gtk.Label
                visible={bind(service, 'monitors').as((outputs) => outputs.length > 1)}
                label="Monitors"
                xalign={0}
                cssClasses={['caption']}
            />
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <For each={bind(service, 'monitors')}>
                    {(monitor: OutputInfo) => (
                        <QuickToggleButton
                            icon="video-display-symbolic"
                            label={monitor.description || monitor.name}
                            active={monitor.enabled}
                            onClick={() => void service.setEnabled(monitor.name, !monitor.enabled)}
                        />
                    )}
                </For>
            </Gtk.Box>
            <Gtk.Box
                spacing={6}
                visible={bind(service, 'pending').as((deadline) => deadline !== null)}
            >
                <Gtk.Button label="Keep Changes" hexpand onClicked={() => service.confirm()} />
                <Gtk.Button label="Revert" hexpand onClicked={() => void service.revert()} />
            </Gtk.Box>
            <Gtk.Label
                visible={bind(service, 'error').as((error) => error !== null)}
                label={bind(service, 'error').as((error) => error ?? '')}
                wrap
                xalign={0}
                cssClasses={['error']}
            />
        </Gtk.Box>
    );
};
