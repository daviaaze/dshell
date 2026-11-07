import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import type Screenshot from '@shade/services/capture/screenshot';
import {getScreenCaptureSettings} from '@shade/services/settings/screenCapture';
import {type Accessor, bind} from 'gnim';

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
    quick: Accessor<boolean>;
    reviewing: Accessor<boolean>;
    onReview: () => void;
    onBack: () => void;
    onReset: () => void;
    onCapture: () => void;
    onCancel: () => void;
    targetSummary: Accessor<string>;
    onTargetChange: (value: string) => void;
}

const TARGET_DESCRIPTIONS: Readonly<Record<'fullscreen' | 'area' | 'window' | 'monitor', string>> = {
    fullscreen: 'The full desktop will be captured.',
    area: 'Drag to set the region on screen.',
    window: 'Click a visible window to select it.',
    monitor: 'The focused monitor will be captured.',
};

const ModeTab = ({label, value, icon, ss, onReset}: ModeTabProps) => (
    <Gtk.ToggleButton
        active={bind(ss, 'selectedMode').as((m) => m === value)}
        onToggled={(btn) => {
            if (btn.active && ss.selectedMode !== value) {
                onReset();
                ss.selectedMode = value;
            }
        }}
        hexpand
        ref={(self) =>
            self.update_property(
                [Gtk.AccessibleProperty.LABEL],
                [new GObject.Value(GObject.TYPE_STRING, label)]
            )
        }
    >
        <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
);

const TargetButton = ({label, value, icon, ss, onReset, onTargetChange}: TargetButtonProps) => (
    <Gtk.ToggleButton
        active={bind(ss, 'selectedTarget').as((t) => t === value)}
        onToggled={(btn) => {
            if (btn.active && ss.selectedTarget !== value) {
                onReset();
                ss.selectedTarget = value;
                onTargetChange(value);
            }
        }}
        hexpand
        ref={(self) =>
            self.update_property(
                [Gtk.AccessibleProperty.LABEL],
                [new GObject.Value(GObject.TYPE_STRING, label)]
            )
        }
    >
        <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.ToggleButton>
);

export const ControlPanel = ({ss, quick, reviewing, targetSummary, onReview, onBack, onCapture, onReset, onCancel, onTargetChange}: ControlPanelProps) => {
    const captureSettings = getScreenCaptureSettings();

    return (
        <Gtk.ScrolledWindow slot="overlay" halign={Gtk.Align.CENTER} valign={Gtk.Align.START}
            marginTop={24} marginBottom={24} marginStart={12} marginEnd={12}
            propagateNaturalWidth propagateNaturalHeight maxContentWidth={480} maxContentHeight={600}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Gtk.Box cssClasses={['card', 'background']} orientation={Gtk.Orientation.VERTICAL}>
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}
                    marginTop={24} marginBottom={24} marginStart={16} marginEnd={16}>
                <Gtk.Label
                    label={reviewing.as((review) => review ? 'Review capture' : 'Capture screen')}
                    halign={Gtk.Align.START}
                    cssClasses={['title-2']}
                />
                <Gtk.Label
                    label={reviewing.as((review) => review
                        ? 'Review the selected target. Capture starts only when you confirm.'
                        : 'Choose what to capture. Your selection is not captured until confirmation.')}
                    wrap xalign={0} cssClasses={['dim-label']}
                />
                <Gtk.Stack visibleChildName={reviewing.as(review => review ? 'review' : 'select')}
                    hhomogeneous={false} vhomogeneous={false}>
                    <Gtk.Box name="review" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
                        <Gtk.Label
                            label={bind(ss, 'selectedMode').as((mode) => mode === 'screenshot' ? 'Image' : 'Recording')}
                            halign={Gtk.Align.START} cssClasses={['heading']}
                        />
                        <Gtk.Label label={targetSummary} halign={Gtk.Align.START} wrap xalign={0} />
                        <Gtk.Label
                            label={bind(ss, 'selectedTarget').as((target) => TARGET_DESCRIPTIONS[target])}
                            wrap xalign={0} cssClasses={['dim-label']}
                        />
                        <Gtk.Box spacing={8}>
                            <Gtk.Button label="Change target" onClicked={onBack} hexpand />
                            <Gtk.Button label="Cancel" onClicked={onCancel} hexpand />
                        </Gtk.Box>
                        <Gtk.Button onClicked={onCapture} cssClasses={['suggested-action']} sensitive={bind(ss, 'captureBusy').as(busy => !busy)}>
                            <Adw.ButtonContent
                                iconName={bind(ss, 'selectedMode').as((m) => m === 'screenshot' ? 'camera-photo-symbolic' : 'camera-video-symbolic')}
                                label={bind(ss, 'selectedMode').as((m) => m === 'screenshot' ? 'Capture image' : 'Start recording')}
                            />
                        </Gtk.Button>
                    </Gtk.Box>
                    <Gtk.Box name="select" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
                        <Gtk.Box visible={quick.as((isQuick) => !isQuick)} orientation={Gtk.Orientation.VERTICAL} spacing={10}>
                            <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} homogeneous cssClasses={['linked', 'horizontal']}>
                                <ModeTab label="Image" value="screenshot" icon="camera-photo-symbolic" ss={ss} onReset={onReset} />
                                <ModeTab label="Recording" value="recording" icon="camera-video-symbolic" ss={ss} onReset={onReset} />
                            </Gtk.Box>
                            <Gtk.Label label="What to capture" halign={Gtk.Align.START} cssClasses={['heading']} />
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['linked', 'vertical']}>
                                <TargetButton label="Fullscreen" value="fullscreen" icon="video-display-symbolic" ss={ss} onReset={onReset} onTargetChange={onTargetChange} />
                                <TargetButton label="Area" value="area" icon="selection-mode-symbolic" ss={ss} onReset={onReset} onTargetChange={onTargetChange} />
                                <TargetButton label="Window" value="window" icon="focus-windows-symbolic" ss={ss} onReset={onReset} onTargetChange={onTargetChange} />
                                <TargetButton label="Monitor" value="monitor" icon="video-display-symbolic" ss={ss} onReset={onReset} onTargetChange={onTargetChange} />
                            </Gtk.Box>
                            <Gtk.Label label={targetSummary} wrap xalign={0} />
                            <Gtk.Label label="Select a target on screen, then review before capture." wrap xalign={0} cssClasses={['dim-label']} />
                        </Gtk.Box>
                        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12} visible={bind(ss, 'selectedMode').as((m) => m === 'recording')}>
                            <Gtk.CheckButton label="Audio" active={bind(ss.prefs, 'audio')} onNotifyActive={({active}) => {
                                if (ss.prefs.audio !== active) ss.prefs.audio = active;
                            }} />
                            <Gtk.CheckButton label="Recording boundary" active={captureSettings.showRecordingBoundary} onNotifyActive={({active}) => {
                                if (captureSettings.showRecordingBoundary() !== active) captureSettings.setShowRecordingBoundary(active);
                            }} />
                        </Gtk.Box>
                        <Gtk.Box spacing={8}>
                            <Gtk.Button label="Cancel" onClicked={onCancel} hexpand />
                            <Gtk.Button label="Review target" onClicked={onReview} cssClasses={['suggested-action']} hexpand />
                        </Gtk.Box>
                        <Gtk.Label label="Esc to cancel · Enter to review" halign={Gtk.Align.CENTER} cssClasses={['caption', 'dimmed']} />
                    </Gtk.Box>
                </Gtk.Stack>
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
};
