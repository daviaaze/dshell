import Gtk from 'gi://Gtk?version=4.0';
import {connectFor, cleanupNode} from '@shade/core/connectFor';
import {Accessor, JSX, onCleanup} from 'gnim';

const REVEAL_SIGNAL = 'notify::reveal-child';
const HIDE_DELAY_MS = 200; // let the slide-up animation finish before hiding

/**
 * Generic OSD popup revealer — pure UI. Visibility is driven entirely by the
 * `reveal` accessor (owned by OsdState); no signal wiring or timers here.
 */
export default ({
    widget,
    reveal,
}: {
    widget: JSX.Element;
    reveal: Accessor<boolean>;
}) => (
    <Gtk.Revealer
        transitionDuration={200}
        revealChild={reveal}
        visible={false}
        transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
        ref={self => {
            onCleanup(() => cleanupNode(self));
            let hideTimeout: ReturnType<typeof setTimeout> | null = null;
            // Keep `visible` in sync with `revealChild`: show instantly,
            // hide only after the slide-up animation finishes.
            connectFor(self, self, REVEAL_SIGNAL, () => {
                if (hideTimeout) clearTimeout(hideTimeout);
                if (self.revealChild) {
                    self.visible = true;
                } else {
                    hideTimeout = setTimeout(() => {
                        self.visible = false;
                    }, HIDE_DELAY_MS);
                }
            });
        }}
    >
        {widget}
    </Gtk.Revealer>
);