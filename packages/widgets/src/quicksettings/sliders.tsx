import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import AudioController from '@shade/services/audio/audioController';
import {getVolumeIcon} from '@shade/services/audio/icons';
import {bus} from '@shade/services/bus';
import Brightness from '@shade/services/display/brightness';
import {bind, computed, createState, With} from 'gnim';
import {AudioEndpointControl} from '../common/audioControl';
import {Slider} from '../common/slider';

interface EndpointConfig {
    devicesProp: 'speakers' | 'microphones';
    defaultProp: 'defaultSpeaker' | 'defaultMicrophone';
    mutedIcon: string;
    label: string;
    showAppMixer?: boolean;
}
function createEndpointConfig(config: EndpointConfig) {
    return () => {
        const controller = AudioController.get_default();
        const devices = bind(controller, config.devicesProp);
        return <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <AudioEndpointControl visible={devices.as(items => items.length > 0)}
                defaultDevice={bind(controller, config.defaultProp)} devices={devices}
                mutedIcon={config.mutedIcon} showAppMixer={config.showAppMixer} />
            <Adw.StatusPage visible={devices.as(items => items.length === 0)}
                title={`${config.label} indisponível`} iconName={config.mutedIcon}
                description="Nenhum dispositivo está disponível. Conecte um dispositivo ou confira as configurações de som."
                cssClasses={['compact']} />
        </Gtk.Box>;
    };
}
export const AudioConfig = createEndpointConfig({
    devicesProp:'speakers', defaultProp:'defaultSpeaker', mutedIcon:'audio-volume-muted-symbolic',
    label:'Saída de áudio', showAppMixer:true,
});
export const MicConfig = createEndpointConfig({
    devicesProp:'microphones', defaultProp:'defaultMicrophone', mutedIcon:'microphone-sensitivity-muted-symbolic', label:'Microfone',
});

const DetailArrow = ({label, onOpen}: {label:string; onOpen:(self:Gtk.Button)=>void}) => (
    <Gtk.Button iconName="go-next-symbolic" tooltipText={label} onClicked={onOpen}
        ref={self=>self.update_property([Gtk.AccessibleProperty.LABEL], [new GObject.Value(GObject.TYPE_STRING,label)])} />
);
interface CompactEndpointProps {kind:'speaker'|'microphone'; onOpen:(self:Gtk.Button)=>void;}
const CompactEndpoint = ({kind,onOpen}:CompactEndpointProps) => {
    const controller=AudioController.get_default();
    const title=kind==='speaker'?'Saída de áudio':'Microfone';
    const endpoint=bind(controller,kind==='speaker'?'defaultSpeaker':'defaultMicrophone');
    const mutedIcon=kind==='speaker'?'audio-volume-muted-symbolic':'microphone-sensitivity-muted-symbolic';
    return <With value={endpoint}>{device=> {
        if(!device) return <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <Gtk.Label label={title} cssClasses={['heading']} xalign={0}/>
            <Gtk.Box spacing={8}>
                <Gtk.Label label="Dispositivo padrão indisponível" wrap hexpand xalign={0}/>
                <DetailArrow label={`${title}: opções de dispositivos`} onOpen={onOpen}/>
            </Gtk.Box>
        </Gtk.Box>;
        const description=bind(device,'description');
        const name=bind(device,'name');
        const heading=computed(()=>`${title} / ${description() || name() || title}`);
        return <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <Gtk.Label label={heading} tooltipText={heading} ellipsize={Pango.EllipsizeMode.END}
                maxWidthChars={36} xalign={0} cssClasses={['heading']}/>
            <Gtk.Box spacing={8}>
                <Slider min={0} max={100} label={`Volume: ${title}`} icon={getVolumeIcon(device,mutedIcon)}
                    iconTooltip={bind(device,'mute').as(muted=>muted?`Restaurar áudio: ${title}`:`Silenciar: ${title}`)}
                    value={bind(device,'volume').as(value=>value*100)}
                    setValue={value=>bus.emit('audio:set-volume',{device,value:value/100})}
                    onIconClick={()=>bus.emit('audio:toggle-mute',{device})}/>
                <DetailArrow label={`${title}: opções de dispositivos`} onOpen={onOpen}/>
            </Gtk.Box>
        </Gtk.Box>;
    }}</With>;
};
export const AudioCompact = ({onOpen}:{onOpen:CompactEndpointProps['onOpen']}) => <CompactEndpoint kind="speaker" onOpen={onOpen}/>;
export const MicCompact = ({onOpen}:{onOpen:CompactEndpointProps['onOpen']}) => <CompactEndpoint kind="microphone" onOpen={onOpen}/>;

const BRIGHTNESS_PRESETS=[0.25,0.5,0.75,1.0];
export const BrightnessSlider = ({onOpen}:{onOpen:(self:Gtk.Button)=>void}) => {
    const brightness=Brightness.get_default();
    const screen=bind(brightness,'screen');
    const supported=screen.as(value=>value>=0);
    const [preset,setPreset]=createState(0);
    return <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <Gtk.Label label="Brilho" cssClasses={['heading']} xalign={0}/>
        <With value={supported}>{available=>available ? <Gtk.Box spacing={8}>
            <Slider min={1} max={100} label="Brilho da tela" icon="display-brightness-symbolic"
                iconTooltip="Alternar níveis de brilho" value={screen.as(value=>value*100)}
                setValue={value=>bus.emit('display:brightness:set',{screen:value/100})}
                onIconClick={()=>{
                    const next=(preset()+1)%BRIGHTNESS_PRESETS.length;
                    setPreset(next);
                    bus.emit('display:brightness:set',{screen:BRIGHTNESS_PRESETS[next]});
                }}/>
            <DetailArrow label="Opções de telas" onOpen={onOpen}/>
        </Gtk.Box> : <Gtk.Box spacing={8}>
            <Gtk.Label label="Controle de brilho indisponível nesta tela" wrap hexpand xalign={0}/>
            <DetailArrow label="Opções de telas" onOpen={onOpen}/>
        </Gtk.Box>}</With>
    </Gtk.Box>;
};
