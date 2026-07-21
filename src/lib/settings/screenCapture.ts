import Gio from 'gi://Gio';
import {createSettings} from 'gnim-schemas';
import {screenCaptureSchema} from './schema';

let instance: ReturnType<typeof createScreenCaptureSettings> | null = null;

function createScreenCaptureSettings() {
    const settings = new Gio.Settings({schemaId: screenCaptureSchema.id});
    return createSettings(settings, screenCaptureSchema)
}

export function getScreenCaptureSettings() {
    if (!instance) instance = createScreenCaptureSettings();
    return instance;
}
