import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {createBinding} from 'gnim';
import type Screenshot from '#/lib/services/capture/screenshot';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';
import {LinkedBox} from '#/widget/common/linkedBox';

interface ModeTabProps {
    label: string;
    value: 'screenshot' | 'recording';
    icon: string;
    ss: Screenshot;
    onReset: () => void;
}

interface TargetButtonProps {
    label: string;
    value: 'fullscreen' | 'area' | 'window' | 'monitor';
    icon: string;
    ss: Screenshot;
    onReset: () => void;
    onTargetChange: (value: string) => void;
}

interface ControlPanelProps {
    ss: Screenshot;
    onCapture: () => void;
    onReset: () => void;
    onTargetChange: (value: string) => void;
}

const ModeTab = ({label, value, icon, ss, onReset}: ModeTabProps) => (
    <Gtk.ToggleButton
        active={createBinding(ss, 'selectedMode').as(
            m => m === value
        )}
        onToggled={btn => {
            if (btn.active) {
                onReset();
                ss.selectedMode = value;
            }
        }}
        hexpand
    >
        <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
);

const TargetButton = ({
    label,
    value,
    icon,
    ss,
    onReset,
    onTargetChange,
}: TargetButtonProps) => (
    <Gtk.ToggleButton
        active={createBinding(ss, 'selectedTarget').as(
            t => t === value
        )}
        onToggled={btn => {
            if (btn.active) {
                onReset();
                ss.selectedTarget = value;
                onTargetChange(value);
            }
        }}
        hexpand
    >
        <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
);

export const ControlPanel = ({
    ss,
    onCapture,
    onReset,
    onTargetChange,
}: ControlPanelProps) => {
    const captureSettings = getScreenCaptureSettings();

    return (
        <Gtk.Box
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.START}
            hexpand={false}
            vexpand={false}
            css={'margin-top: 24px;'}
        >
            <Gtk.Box
                cssClasses={['card', 'frame', 'background']}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                css={'padding: 12px;'}
            >
                {/* Mode toggle */}
                <Gtk.Box spacing={4} homogeneous cssClasses={['linked']}>
                    <ModeTab
                        label="Screenshot"
                        value="screenshot"
                        icon="camera-photo-symbolic"
                        ss={ss}
                        onReset={onReset}
                    />
                    <ModeTab
                        label="Record"
                        value="recording"
                        icon="camera-video-symbolic"
                        ss={ss}
                        onReset={onReset}
                    />
                </Gtk.Box>

                <Gtk.Separator />

                {/* Target picker */}
                <LinkedBox>
                    <TargetButton
                        label="Fullscreen"
                        value="fullscreen"
                        icon="video-display-symbolic"
                        ss={ss}
                        onReset={onReset}
                        onTargetChange={onTargetChange}
                    />
                    <TargetButton
                        label="Area"
                        value="area"
                        icon="selection-mode-symbolic"
                        ss={ss}
                        onReset={onReset}
                        onTargetChange={onTargetChange}
                    />
                    <TargetButton
                        label="Window"
                        value="window"
                        icon="focus-windows-symbolic"
                        ss={ss}
                        onReset={onReset}
                        onTargetChange={onTargetChange}
                    />
                    <TargetButton
                        label="Monitor"
                        value="monitor"
                        icon="video-display-symbolic"
                        ss={ss}
                        onReset={onReset}
                        onTargetChange={onTargetChange}
                    />
                </LinkedBox>

                <Gtk.Separator />

                {/* Audio + Boundary options (recording) */}
                {ss.selectedMode === 'recording' && (
                    <Gtk.Box spacing={12}>
                        <Gtk.CheckButton
                            active={createBinding(ss, 'overlayOpen')}
                        >
                            <Gtk.Label label="Audio" />
                        </Gtk.CheckButton>
                        <Gtk.CheckButton
                            active={captureSettings.showRecordingBoundary}
                            onNotifyActive={({active}) => {
                                captureSettings.setShowRecordingBoundary(active);
                            }}
                        >
                            <Gtk.Label label="Boundary" />
                        </Gtk.CheckButton>
                    </Gtk.Box>
                )}

                <Gtk.Separator />

                {/* Capture button */}
                <Gtk.Button
                    onClicked={onCapture}
                    cssClasses={['suggested-action']}
                    hexpand
                >
                    <Adw.ButtonContent
                        iconName={createBinding(ss, 'selectedMode').as(m =>
                            m === 'screenshot'
                                ? 'camera-photo-symbolic'
                                : 'camera-video-symbolic'
                        )}
                        label={createBinding(ss, 'selectedMode').as(m =>
                            m === 'screenshot'
                                ? 'Take Screenshot'
                                : 'Start Recording'
                        )}
                    />
                </Gtk.Button>

                {/* Keyboard hint */}
                <Gtk.Label
                    label="Esc to cancel  ·  Enter to capture"
                    halign={Gtk.Align.CENTER}
                    cssClasses={['caption']}
                    css={'opacity: 0.6;'}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
};
