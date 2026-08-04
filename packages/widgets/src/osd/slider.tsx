import Gtk from 'gi://Gtk?version=4.0';
import type {Accessor} from 'gnim';

export default ({
    value,
    iconName,
}: {
    value: Accessor<number>;
    iconName: string | Accessor<string>;
}) => (
    <Gtk.Box cssClasses={['slider']} spacing={8}>
        <Gtk.Image iconName={iconName} pixelSize={20} />
        <Gtk.LevelBar
            hexpand
            value={value.as((v) => {
                const n = Number(v);
                return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
            })}
        />
        <Gtk.Label
            cssClasses={['heading']}
            label={value.as((v) =>
                Math.floor((Number.isFinite(Number(v)) ? Number(v) : 0) * 100)
                    .toString()
                    .concat('%')
            )}
        />
    </Gtk.Box>
);
