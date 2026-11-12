import {CompositorPort} from '@shade/services/compositor/port';
import {renderCompositorConfig} from '@shade/services/compositor/render';
import {exit, programArgs} from 'system';

try {
    if (programArgs[0] !== 'compositor')
        throw new Error('Usage: shade-shell compositor <render|dpms>');

    if (programArgs[1] === 'render') {
        print(renderCompositorConfig());
        exit(0);
    }

    if (programArgs[1] === 'dpms') {
        const action = programArgs[2];
        if (action !== 'on' && action !== 'off')
            throw new Error('Usage: shade-shell compositor dpms <on|off>');
        await new CompositorPort().applyDpms(action === 'on');
        exit(0);
    }

    throw new Error('Usage: shade-shell compositor <render|dpms>');
} catch (cause) {
    printerr(`Shade compositor command failed: ${cause}`);
    exit(1);
}
