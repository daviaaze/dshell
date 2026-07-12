import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed} from 'gnim';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import Hypridle from '#/lib/services/power/hypridle';

export default () => {
    const hypridle = Hypridle.get_default();

    const $enabled = createBinding(hypridle, 'enabled');
    const $idleTimeout = createBinding(hypridle, 'idleTimeout');
    const $dpmsEnabled = createBinding(hypridle, 'dpmsEnabled');
    const $dpmsTimeout = createBinding(hypridle, 'dpmsTimeout');
    const $suspendEnabled = createBinding(hypridle, 'suspendEnabled');
    const $suspendTimeout = createBinding(hypridle, 'suspendTimeout');
    const $dimEnabled = createBinding(hypridle, 'dimEnabled');

    const chainSummary = createComputed(() => {
        if (!$enabled()) return 'Auto-lock disabled';
        const lock = Math.round($idleTimeout() / 60);
        let text = `Lock at ${lock}m`;
        if ($dpmsEnabled()) {
            const dpms = Math.round($dpmsTimeout() / 60);
            text += ` → Display off at ${dpms}m`;
        }
        if ($suspendEnabled()) {
            const susp = Math.round($suspendTimeout() / 60);
            text += ` → Suspend at ${susp}m`;
        }
        return text;
    });

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                cssClasses={['toolbar', 'linked', 'popover-padded']}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
            >
                <Gtk.Label
                    cssClasses={['caption']}
                    halign={Gtk.Align.CENTER}
                    label={chainSummary}
                />
                <Gtk.Separator />
                <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                    <Gtk.Label label="Lock after" />
                    <Gtk.Scale
                        hexpand
                        digits={0}
                        adjustment={
                            (
                                <Gtk.Adjustment
                                    lower={60}
                                    upper={1800}
                                    stepIncrement={30}
                                    value={$idleTimeout}
                                />
                            ) as Gtk.Adjustment
                        }
                        onValueChanged={self =>
                            (hypridle.idleTimeout = self.get_value())
                        }
                    />
                    <Gtk.Label
                        label={$idleTimeout.as(t => `${Math.round(t / 60)}m`)}
                        cssClasses={['caption']}
                    />
                </Gtk.Box>
                <Gtk.Separator />
                <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                    <Gtk.Label label="Dim before lock" hexpand />
                    <Gtk.Switch
                        active={$dimEnabled}
                        onNotifyActive={self =>
                            (hypridle.dimEnabled = self.active)
                        }
                    />
                </Gtk.Box>
                <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                    <Gtk.Label label="Dim after" />
                    <Gtk.Scale
                        widthRequest={120}
                        digits={0}
                        adjustment={
                            (
                                <Gtk.Adjustment
                                    lower={30}
                                    upper={1740}
                                    stepIncrement={30}
                                    value={createBinding(
                                        hypridle,
                                        'dimTimeout'
                                    )}
                                />
                            ) as Gtk.Adjustment
                        }
                        onValueChanged={self =>
                            (hypridle.dimTimeout = self.get_value())
                        }
                    />
                    <Gtk.Label
                        label={createBinding(hypridle, 'dimTimeout').as(
                            t => `${Math.round(t / 60)}m`
                        )}
                        cssClasses={['caption']}
                    />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return (
        <QuickToggleButton
            cssClasses={$enabled.as(e => (e ? ['raised'] : ['raised', 'flat']))}
            icon={$enabled.as(e =>
                e
                    ? 'system-lock-screen-symbolic'
                    : 'system-unlock-screen-symbolic'
            )}
            label={$enabled.as(e => (e ? 'Auto Lock' : 'Auto Lock Off'))}
            onClick={() => (hypridle.enabled = !hypridle.enabled)}
            popover={popover}
        />
    );
};
