import Screenshot from '#/lib/screenshot';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import {LinkedBox} from '#/widget/common/linkedBox';

export default () => {
    const screenshot = Screenshot.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                cssClasses={['popover-padded']}
            >
                {/* Screenshot section */}
                <Gtk.Label
                    label="Screenshot"
                    halign={Gtk.Align.START}
                    cssClasses={['title-4']}
                />
                <LinkedBox>
                    <Gtk.Button onClicked={() => screenshot.screenshot(true)}>
                        <Adw.ButtonContent
                            iconName="camera-photo-symbolic"
                            label="Fullscreen"
                        />
                    </Gtk.Button>
                    <Gtk.Button onClicked={() => screenshot.screenshot(false)}>
                        <Adw.ButtonContent
                            iconName="selection-mode-symbolic"
                            label="Area"
                        />
                    </Gtk.Button>
                </LinkedBox>

                <Gtk.Separator />

                {/* Recording section */}
                <Gtk.Label
                    label="Recording"
                    halign={Gtk.Align.START}
                    cssClasses={['title-4']}
                />
                <LinkedBox>
                    <Gtk.Button onClicked={() => screenshot.toggleRecording()}>
                        <Adw.ButtonContent
                            iconName="camera-video-symbolic"
                            label="Fullscreen"
                        />
                    </Gtk.Button>
                    <Gtk.Button onClicked={() => screenshot.recordArea()}>
                        <Adw.ButtonContent
                            iconName="selection-mode-symbolic"
                            label="Area"
                        />
                    </Gtk.Button>
                    <Gtk.Button
                        onClicked={btn => {
                            const pop = btn.get_root() as Gtk.Popover | null;
                            if (pop instanceof Gtk.Popover) pop.popdown();
                            setTimeout(
                                () => screenshot.recordOutputVisual(),
                                200
                            );
                        }}
                    >
                        <Adw.ButtonContent
                            iconName="video-display-symbolic"
                            label="Output"
                        />
                    </Gtk.Button>
                    <Gtk.Button
                        onClicked={btn => {
                            const pop = btn.get_root() as Gtk.Popover | null;
                            if (pop instanceof Gtk.Popover) pop.popdown();
                            setTimeout(
                                () => screenshot.recordWindowVisual(),
                                200
                            );
                        }}
                    >
                        <Adw.ButtonContent
                            iconName="focus-windows-symbolic"
                            label="Window"
                        />
                    </Gtk.Button>
                </LinkedBox>

                <Gtk.Separator />

                {/* Audio toggle */}
                <Gtk.Box
                    spacing={8}
                    orientation={Gtk.Orientation.HORIZONTAL}
                    marginStart={4}
                >
                    <Gtk.CheckButton
                        active={createBinding(screenshot, 'audio')}
                        onNotifyActive={({active}) => {
                            screenshot.audio = active;
                        }}
                    />
                    <Gtk.Label label="Record Audio" />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return (
        <QuickToggleButton
            icon={createBinding(screenshot, 'recording').as(rec =>
                rec ? 'media-playback-stop-symbolic' : 'camera-video-symbolic'
            )}
            label={createBinding(screenshot, 'recording').as(rec =>
                rec ? 'Stop' : 'Record'
            )}
            onClick={() => screenshot.toggleRecording()}
            popover={popover}
        />
    );
};
