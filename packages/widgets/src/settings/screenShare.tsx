import Adw from 'gi://Adw?version=1';

export default () => (
    <Adw.PreferencesGroup title="Compartilhamento de tela"
        description="A escolha e a autorização pertencem a cada pedido do aplicativo.">
        <Adw.ActionRow title="Escolher tela ou janela"
            subtitle="As fontes disponíveis aparecem no seletor quando um aplicativo solicita compartilhamento." />
        <Adw.ActionRow title="Revisar antes de compartilhar"
            subtitle="Selecionar uma fonte não a autoriza. Revise a escolha e confirme em Compartilhar; Cancelar não envia uma fonte." />
        <Adw.ActionRow title="Restaurar uma escolha"
            subtitle="Quando o pedido permite restauração, a opção é oferecida no próprio seletor. Não existe uma fonte padrão global." />
        <Adw.ActionRow title="Prévia e privacidade"
            subtitle="A prévia ajuda a identificar a fonte. Ela não inicia uma transmissão; o aplicativo e o portal gerenciam a sessão após a confirmação." />
    </Adw.PreferencesGroup>
);
