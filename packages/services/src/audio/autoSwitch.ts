import Wireplumber from 'gi://AstalWp';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {bind} from 'gnim';

export function initAutoSwitch() {
    // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        const audio = Wireplumber.get_default()!.audio;
        let knownIds = new Set<number>();

        const binding = bind(audio, 'speakers');
        binding.subscribe(() => {
            const speakers = binding();
            if (!speakers) return;
            const currentIds = new Set(speakers.map((s) => s.id));

            for (const speaker of speakers) {
                // Skip devices we already knew about
                if (knownIds.has(speaker.id)) continue;

                // Check if this is a bluetooth device using PipeWire's node name
                const name = speaker.name || '';
                const isBluetooth = name.startsWith('bluez_output');

                if (isBluetooth) {
                    logger.log(
                        `[AudioAutoSwitch] New bluetooth device: ${speaker.description} (${name}) — switching to it`
                    );
                    speaker.isDefault = true;
                }
            }

            knownIds = currentIds;
        });

        return GLib.SOURCE_REMOVE;
    });
}

defineService({name: 'AudioAutoSwitch', service: {init: () => initAutoSwitch()}});
