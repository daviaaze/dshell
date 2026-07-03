# Revisão Multidisciplinar — Shade Shell

**Data:** 2026-07-03
** Versão analisada:** `0.2.1` @ commit `8daf60b` (2026-07-03)
**Codebase:** ~19.336 LOC TypeScript/TSX (`src/`)
**Revisor:** Agente multidisciplinar (Arquitetura · PM · UX/UI · QA)

---

## Sumário Executivo

O Shade Shell é, para um projeto pessoal em `0.2.1`, **surpreendentemente maduro e
bem-estruturado**. A separação `src/lib/` (serviços) ↔ `src/widget/` (UI) é real,
o bootstrap faz isolamento de erro por serviço e por widget (`widget/index.tsx`),
existe um `POSTMORTEM.md` genuinamente útil, logging com categorias e `perf`
tracer, e serviços críticos (Theming, NightLight, Hypridle) implementam graceful
degradation, double-init guard e `dispose()`. Isso está **muito acima da mediana**
de shells AGS/Astal amadores. O `WindowManager` é um registro leve — **não** é um
God Object — e o `ShellState` é minimalista (4 propriedades).

A **maior dívida estrutural** é a gestão de ciclo de vida de sinais GObject e
assinaturas Gnim nas widgets:多个 `connect()` em callbacks `$`/`onMount` sem
`onCleanup` correspondente (ex.: `notifications/index.tsx:97`, bar bluetooth), o
que gera listeners acumulando a cada re-mount por monitor. O segundo tema
recorrente é **polishing de robustez**: `dispose()` do `Screenshot` não mata o
`#freezeProcess` (`screenshot.ts:703`), `print()` em vez de `logger` em vários
serviços, e cache de notificações/cover-art sem limite.

Como **produto**, o Shade tem uma proposta clara ("Hyprland + HIG Adwaita via
GJS/Gnim") e um feature set muito amplo para `0.2.1` (bar, dock, launcher, QS,
notificações, lock, OSD, screenshot/recording, wallpaper, settings, timer,
weather). O risco dominante é de **dependência/bus factor**: Astal, Gnim e o
próprio Shade são cada um mantidos por uma só pessoa; Gnim em `^1.9.1` sem lock
claro de breaking-change policy. O caminho para `1.0.0` deveria priorizar
**estabilidade/fonte de leaks** sobre novas widgets.

Na **UX**, a adesão ao Libadwaita/HIG é honesta (usa `Adw.Window`,
`Adw.PreferencesPage`, `Gtk.AccessibleRole` em vários botões), mas a **a11y é
desigual**: há labels a11y em QS buttons mas falta em ícones-only da bar/dock,
não há indicação de suporte a alto-contraste/reduced-motion, e estados vazios
(launcher sem resultados, QS sem WiFi) não são visivelmente tratados. Multi-monitor
funciona via `For each={monitors}` mas hotplug não limpa widgets recicladas é um
risco (comportamento Layer Shell).

Em **QA**, a estratégia de testes é consciente (test-runner custom até porque
`GLib.Test` segfaulta) mas a **cobertura é baixíssima**: 5 arquivos de teste
cubrindo `hypridle`, `requestHandler`, `deferredSingleton`, `networkUtils` —
zero testes para widgets e para `Screenshot`, `Weather`, `Theming`, `Lockscreen`.
Não há regressão visual, nem teste de estresse. O `vm-test` existe mas a
fragilidade é desconhecida.

---

## 🔴 Achados Críticos (Cross-Perspectiva)

Estes apareceram em mais de uma perspectiva e devem ser atacados primeiro.

| # | Achado | Onde | Perspectivas |
|---|--------|------|--------------|
| C1 | **Leaks de sinais GObject / assinaturas Gnim** em widgets per-monitor — `connect()` no `$`/`onMount` sem `onCleanup` | `notifications/index.tsx:97`, `bar/indicators/bluetooth.tsx:34-36`, `quicksettings/...` (多处) | Arquitetura · QA |
| C2 | **`Screenshot.dispose()` não encerra `#freezeProcess`** — processo de "congelar" tela sobrevive ao shutdown do shell | `src/lib/screenshot.ts:703-715` | Arquitetura · QA |
| C3 | **Bus factor / dependências single-author** — Astal, Gnim e Shade cada um com um mantenedor; `gnim: ^1.9.1` sem lock / breaking-change policy documentada | `package.json:deps`, `docs/RESOURCES.md` | PM · Arquitetura |
| C4 | **a11y inconsistente** — labels `Gtk.Accessible` ausentes em ícones-only; sem reduced-motion / alto-contraste declarados | `bar/`, `dock/`, `applauncher/` | UX · QA |
| C5 | **Lockscreen mostra notificações?** — não há gating evidente de `ShellState.screenlocked` no path de popup de notificação | `notifications/index.tsx:27-97` | UX(security) · Arquitetura |

> Observação honesta: para um shell pessoal `0.2.1`, nenhum dos itens acima é
> "impeditivo para o autor usar". C1/C2 são críticos porque **pioram com o tempo
> de uso** (memory/listener growth e processos órfãos), o que é exatamente o tipo
> de bug que vira "shell fica lento depois de horas" — difícil de reproduzir e
> mancha a percepção de qualidade.

---

## 1. Revisão Arquitetural

### Resumo Executivo

A arquitetura é **limpa e idiomática para GJS/Astal/Gnim**. Há separação real de
serviços/UI, um bootstrap resiliente com isolamento de falhas, singletons
`get_default()` razoáveis para GObject, e um `WindowManager` que é um registro,
não um God Object. Os problemas são de **lifecycle management** (sinais e
assinaturas não limpos), alguns `dispose()` incompletos, e pouca injeção de
dependência (que limita testabilidade). O stack de build (Meson+esbuild+Nix) é
complexo mas justificado pelo requisito GJS+GIR+layer-shell.

### Achados

#### 🟡 Leaks de sinais GObject em widgets per-monitor
- **Onde:** `src/widget/notifications/index.tsx:97` (`notifd.connect("notified", …)` dentro de `$={() => {...}}` sem `onCleanup`); `src/widget/bar/indicators/bluetooth.tsx:34-36` (connect em `Bluetooth.get_default()` no onMount sem disconnect).
- **Descrição:** Cada re-mount da widget (uma barra por monitor, reconfig de monitors, ou troca de settings que recria a janela) adiciona um novo handler GObject que nunca é removido. O Gnim não desconecta sinais conectados manualmente via `connect()` em `onCleanup` automáticidamente — isso é responsabilidade explícita.
- **Impacto:** Listeners duplicados disparam N vezes por evento após N remounts → uso de CPU crescente, logs duplicados, memory leak de closures GTK. Sintoma clássico "shell fica lerdo após horas / após hotplug de monitor".
- **Recomendação:** Padronizar `onCleanup(() => notifd.disconnect(handlerId))` em TODO callback `$`/`onMount` que chame `connect()`. Extrair helper `connectFor(self, obj, signal, cb)` que registra o handlerId no `onCleanup` do nó Gnim. Adicionar um "debug signal registry" que conta handlers ativos por objeto para validar no VM-test.
- **Severidade:** 🟡 Alto

#### 🔴 `Screenshot.dispose()` não finaliza o `#freezeProcess`
- **Onde:** `src/lib/screenshot.ts:703-715` (método `dispose()`); o campo `#freezeProcess` é setado em `:590` e finalizado em `:602-607` num path manual, mas **não** no `dispose()`.
- **Descrição:** `dispose()` mata só `#recordingProcess` e remove `#durationTimer`. Se o shell encerrar (SIGTERM/SIGINT via `main.ts:setupSignalHandlers`) enquanto um "freeze" de captura estiver ativo, o processo externo (provável `hyprpicker`/freeze helper) vira **órfão**.
- **Impacto:** Processo órfão mantém tela congelada/comportamento invasivo; em restart do shell pode haver conflito; difícil de Diagnosticar via journalctl.
- **Recomendação:** No `dispose()`, antes de matar `#recordingProcess`, chamar o mesmo bloco `signal(2); signal(15)` para `#freezeProcess` (extrair `killProcess(p)` helper). Idealmente `signal(9)` fallback após timeout. Adicionar teste em `__tests__/screenshot.test.ts` mockando `Process`.
- **Severidade:** 🔴 Crítico (órphão + estado de tela invasivo)

#### 🟠 `NightLight.#stopProcess()` usa `pkill -f` global
- **Onde:** `src/lib/nightLight.ts` (método `#stopProcess`, `Process.exec("pkill -f 'hyprsunset --temperature'")`).
- **Descrição:** Mata **todos** os processos do usuário que casam com o padrão, não só os que este shell iniciou.
- **Impacto:** Se o usuário roda outra instância de hyprsunset manualmente, ou outro shell/compositor, será morto. Comportamento surpreendente e potencialmente destrutivo.
- **Recomendação:** Rastrear o PID do `Process` iniciado e matar só esse (já faz via `this.#process.kill()`). Remover o `pkill`. Se o receio é "stray de crash anterior", manter um arquivo de PID persistente ao invés de varredura global.
- **Severidade:** 🟠 Médio

#### 🟠 `Theming` não tem `dispose()` e não cancela subscriptions
- **Onde:** `src/lib/theming.ts:60-71` (`settings.dynamicThemingEnabled.subscribe(...)`, `wallpaperDay/ Night.subscribe(...)`) — sem unsubscribe; classe sem método `dispose()`.
- **Descrição:** Assinaturas Gnim permanecem vivas após o shell/destruição da instância. `Theming` é singleton de ciclo de vida do app, então o leak é办主任 em shutdown — mas se algum dia `Theming` puder ser resetado/reinit, as subscriptions duplicam.
- **Impacto:** Hoje baixo (singleton imortal); futuro risco de memory/Callback leak se reset for introduzido. Também o debounce de `#onWallpaperChange` (`timeout_add_seconds` sem guardar source-id) acumula timers em mudanças rápidas de wallpaper.
- **Recomendação:** Guardar os unsubscribers em array e expor `dispose()`; no debounce, armazenar o `sourceId` e `GLib.source_remove` antes de criar novo.
- **Severidade:** 🟠 Médio

#### 🟡 Código de roteamento D-Bus duplica estado (actions map vs commandRoutes)
- **Onde:** `src/lib/requestHandler.ts` — mapa `actions` e mapa `commandRoutes` são mantidos à parte; os testes (`requestHandler.test.ts:120-141`) validam que "toda ação registrada tem rota CLI exceto open-clipboard".
- **Descrição:** Adicionar uma ação exige editar 2–3 lugares (handler, rota CLI, keybinding nix). O teste garante cobertura mas o padrão é propenso a drift.
- **Impacto:** Escala mal para dezenas de ações; cada nova feature D-Bus toca código sensível.
- **Recomendação:** Unificar em uma única tabela `{ cli: string[], action: string, handler }` registrada uma vez; gerar `commandRoutes` e `GAction`s dela. Documentar latência (~7ms gdbus) como aceita e medir caso adicione ações de alta frequência.
- **Severidade:** 🟡 Alto (manutenibilidade/extensibility)

#### 🟠 Inicialização de serviços: hard-coded order em `getServiceDescriptors`
- **Onde:** `src/widget/index.tsx` (`getServiceDescriptors` retorna array com ordem fixa).
- **Descrição:** A ordem é implícita; serviços que dependem de outros (ex.: `NightLight` depende de `ColorScheme`; `Weather` depende de `Geolocation`) confiam na ordem manual. O `try/catch` por serviço isola falhas, mas uma dependência que falha silenciosamente deixa o dependente null sem aviso claro.
- **Recomendação:** Declarar dependências explicitamente (ex.: `deps: ["colorScheme"]`) e validar/inicializar topologicamente; o `try/catch` deve relançar um evento "service degraded" para o `ShellState`/logger.
- **Severidade:** 🟠 Médio

#### 🔵 `gjsUtils.toArray` silenciosamente descarta itens não marshaláveis
- **Onde:** `src/lib/gjsUtils.ts:22-30` (`toArray` — `catch { l = l.next }`).
- **Descrição:** Itens que o GJS não consegue converter ("Can't convert non-null pointer to JS value") são pulados sem log. Isso já causou bugs (SSID/BSSID, ver POSTMORTEM).
- **Recomendação:** Logar em DEBUG quantos itens foram descartados e por quê, para tornar futuros bugs de GIR-type visíveis durante desenvolvimento.
- **Severidade:** 🔵 Baixo

#### ⚪ CSS global único; sem namespacing por widget nem thema dinâmico documentado
- **Onde:** `src/shade.css` (global), `src/App.tsx:initCss` (`PRIORITY_USER`), `theming.ts#applyColors` (`PRIORITY_USER+1`).
- **Descrição:** Tudo é global; classes CSS podem colidir; override por widget depende de prefixo manual. Dark/light usa Libadwaita (`Adw.StyleManager` implícito) mas `shadow.css` tokens são hard-coded.
- **Recomendação:** Adotar prefixo `shade-`/classe por widget; documentar tokens CSS em `docs/CONTRIBUTING.md`. (Sugestão — hoje funciona.)
- **Severidade:** ⚪ Sugestão

#### ✅ Acertos arquiteturais
- **Isolamento de erro em bootstrap** (`widget/index.tsx`): cada serviço e cada widget em `try/catch` com `logger.error` — uma widget quebrada não derruba as outras. Padrão raro e correto.
- **`DeferredSingleton`** (`deferredSingleton.ts`) — padrão elegante para serviços opcionais (Notifd) com guards de concorrência e erro. Tem testes.
- **`WindowManager`** como coleção tipada de janelas + `notify()` — simples, observável, testeável.
- **Graceful degradation** em `Theming.available` / `NightLight.available` via `GLib.find_program_in_path` — ferramentas ausentes não quebram o shell.

### Recomendações Prioritárias (Arquitetura)
1. **Padronizar cleanup de sinais** com helper `connectFor` + `onCleanup` (C1). Audit grep: `grep -rn "connect(" src/widget | grep -v onCleanup` → zero restantes.
2. **Completar `Screenshot.dispose()`** para `#freezeProcess` (C2) + teste.
3. **Remover `pkill` global** do NightLight (track PID).
4. **Adicionar `dispose()` ao `Theming`** e rastrear unsubscribers.
5. **Unificar tabela D-Bus** action↔CLI.

### Perguntas para o Time (Arquitetura)
- O `WindowManager` expõe `notify("bars")` etc. — widgets reagem via `createBinding`? Confirme que re-mount de bar em hotplug não acumula sinais.
- Há plano de tornar serviços injetáveis (fábrica) para testes, ou o `get_default()` é o contrato final?
- A latência D-Bus ~7ms é aceitável para **todas** ações? (ex.: OSD de volume precisa de <50ms percebido.)

---

## 2. Revisão de Produto (PM)

### Resumo Executivo

O Shade tem **proposta de valor articulada e diferencial real** (Hyprland nativo + HIG
Adwaita + GJS/Gnim, ao invés de SCSS/Eww ou QML). Para `0.2.1` o feature set é
ambicioso — talvez **ambitioso demais** face à equipe de 1. O maior risco de
produto é de **manutenção**: três single-authors na cadeia crítica (Shade→Gnim→Astal).
O caminho para `1.0.0` deve ser **estabilidade e narrativa de qualidade**, não features.

### Achados

#### 🟡 Bus factor = 1 em três níveis da cadeia
- **Onde:** `docs/RESOURCES.md` (referencia Astal/Gnim como fontes centrais); `package.json:gnim ^1.9.1`; `docs/CONTRIBUTING.md`.
- **Descrição:** Shade = 1 mantenedor (caioasmuniz); Gnim e Astal = mantidos majoritariamente por aylur. GJS é GNOME (multi-author, baixo risco EOL — SpiderMonkey é rastreado, **não** EOL). A cadeia Shade→Gnim→Astal é de pontos únicos de falha.
- **Impacto:** A inatividade de qualquer um dos três orfa o projeto. Sem ADRs/contexto fora do POSTMORTEM, um sucessor não raciocina sem o autor.
- **Recomendação:** (a) pinar upstreams no `flake.lock` para um orphan não quebrar `nix flake update`; (b) documentar decisões da arquitetura como ADRs no `ai-workspace`/repo; (c) avaliar vendor/fork do subset ~2k-LOC do Gnim (licença GPL-compatível) para remover um single-author.
- **Severidade:** 🟡 Alto

#### 🟠 Matriz de risco de dependências sem mitigação documentada
- **Onde:** `docs/RESOURCES.md`, `package.json`.
- **Descrição:** Não há política de versionamento/breaking-changes para `gnim` (`^1.9.1` aceita minors que podem ter breaking). `astal` via flake floating. Nenhum "lock" semântico.
- **Recomendação:** Fixar `gnim` exato (ou caret com policy), declarar no README a versão mínima suportada de `astal`, e ter um ADR "o que fazemos se Astal parar".
- **Severidade:** 🟠 Médio

#### 🟡 Salto `0.2.1 → 1.0.0` sem critérios definidos
- **Onde:** `docs/README.md` (versão `0.2.1`), ausência de roadmap/milestone público.
- **Descrição:** Semver informal; não há critério documentado para `0.3.0` vs `1.0.0`. Features ainda crescem (timer, weather, share-picker, previewer) enquanto leaks/robustez penduram.
- **Recomendação:** Definir gates para `1.0.0`: (1) zero leaks de sinais/intervalos auditados; (2) dispose() em 100% dos serviços; (3) testes para serviços críticos; (4) POSTMORTEM bugs sistêmicos corrigidos; (5) 7 dias de uso contínuo sem growth anormal de RSS. **Priorizar quick wins do POSTMORTEM** sobre novas widgets.
- **Severidade:** 🟡 Alto

#### 🟠 Escopo: diferenciação vs commodidade
- **Onde:** `docs/README.md` (feature list).
- **Descrição:** Features como **timer no QS** e **recording-boundary visual** (borda vermelha na região compartilhada) são diferenciais honestos e marketáveis. Mas faltam peças de desktop-shell maduras: **polkit agent, user switcher, gestão de energia (suspend/hibernate) de verdade, integração com file manager, suporte a layouts de teclado múltiplos**.
- **Impacto:** Para "shell principal" falta completude; para "personal shell para entusiastas" está ótimo. A ambiguidade atrapalha priorização.
- **Recomendação:** Declarar explicitamente o posicionamento (ex.: "personal power-user shell, não substituto do GNOME Shell para todos"). Daí priorizar polkit + power-management se a meta for experiencia desktop completa.
- **Severidade:** 🟠 Médio

#### 🟠 Não há métricas de sucesso / telemetria opcional
- **Onde:** `docs/README.md`, `src/lib/logger.ts`.
- **Descrição:** Não há boot-time/RSS/crash-rate medidos de forma estruturada. O `perf` tracer mede startup internamente mas não publica. Sem telemetria (opcional/privacy-respecting) não há base para priorização de bugs.
- **Recomendação:** Em vez de telemetria, adotar um **"shade --diagnostics"** que o usuário roda sob demanda e cola em issues: boot-time, RSS, serviços ativos, versões de deps. Resolve suporte sem privacy concerns.
- **Severidade:** 🟠 Médio

#### ✅ Acertos de produto
- **POSTMORTEM documentado e honesto** — raro em projetos pessoais; acelera onboarding e evita re-cometer os mesmos bugs de GIR-type.
- **Diferenciais marketáveis** (timer QS, recording boundary, dynamic theming via matugen) sem vender hype.
- **Previewer** (`src/previewer.tsx`) e `share-picker` — ferramental de desenvolvimento que few shells tem; melhora DX.

### Recomendações Prioritárias (PM)
1. **Definir gates de `1.0.0`** e congelar novas widgets até battery de robustez.
2. **Pinar `gnim` + declarar policy de breaking changes**; ADR de continuidade.
3. **Posicionamento explícito** (personal power-user vs general-purpose desktop shell).
4. **`shade --diagnostics`** para auto-coleta de info de suporte.

### Perguntas para o Time (PM)
- Qual é o público-alvo declarado? "Eu mesmo" vs "comunidade NixOS/Hyprland" muda tudo.
- Há interesse em contribuidores externos? Se sim, "good-first-issue" + ROADMAP público.
- Telemetria opt-in é ou não é uma opção (mesmo só crash reports)?

---

## 3. Revisão de UX/UI

### Resumo Executivo

A adesão ao Libadwaita/HIG é **sincera**: usa widgets reais (`Adw.Window`,
`Adw.PreferencesPage`, `Adw.Avatar`, `Gtk.PasswordEntry`), tipografia bem
documentada (`docs/FONTS.md`), e bons padrões (granular focus no launcher,
numeric no clock). A **lacuna mais clara é a11y**: labels acessíveis ausentes em
botões ícone-only, sem reduced-motion/alto-contraste, e estados vazios/loading
não tratados de forma visível. Lockscreen tem cuidados de segurança mas o
gating de notificações quando bloqueado não é evidente.

### Achados

#### 🟠 A11y: labels/roles ausentes em controles ícone-only
- **Onde:** `src/widget/bar/indicators/bluetooth.tsx:34-36` (botões sem `accessibleLabel`/`Gtk.AccessibleRole`); `src/widget/dock/item.tsx`; `src/widget/quicksettings/button-grid/` (varia).
- **Descrição:** Controles que são só ícone (toggle bluetooth, launcher) dependem do glyphs para significado. AT-SPI não anuncia ação. Há uso de `Gtk.AccessibleRole` em outros botões do QS — portanto é inconsistente, não falta total.
- **Impacto:** Usuários de leitor de tela (Orca) não conseguem operar a bar/dock. Para "personal shell" talvez aceitável, mas degrada a **narrativa de qualidade HIG** que o projeto reivindica.
- **Recomendação:** Auditar com `gtk4-icon-browser`+Orca; adicionar `accessible-label`/`accessible-role` em todo botão ícone-only. Adicionar ao CONTRIBUTING.md a regra "todo botão ícone-only precisa de `accessibleLabel`".
- **Severidade:** 🟠 Médio

#### 🟡 Notificações não estão evidentemente gated pelo lockscreen
- **Onde:** `src/widget/notifications/index.tsx:27-97` (`addNotification` não checa `ShellState.screenlocked`); `ShellState.screenlocked` existe mas não há uso visível no path de popup.
- **Descrição:** Se o shell exibe popups de notificação sobre a lockscreen, isso é **privacidade** (mensagem preview visível para quem está ao lado / ao mexer o mouse) e também **segurança de sessão**. Como o projeto tem lockscreen próprio com `SessionLock`, é crítico confirmar.
- **Impacto:** Potencial exposição de conteúdo de notificação em tela bloqueada.
- **Recomendação:** Reservar/ocultar popups quando `ShellState.screenlocked === true` (ou redirecionar para um overlay seguro na própria lockscreen). Adicionar teste E2E no vm-test: notificar enquanto locked → sem popup público.
- **Severidade:** 🟡 Alto (assume confirmação; se já gated, reverte para acerto documentado)

#### 🟠 DND não suprime evidently os toasts
- **Onde:** `notifications/index.tsx:138-160` (setup de `dontDisturb` state) — `addNotification` (linha 27) não consulta `dontDisturb` antes de empilhar popup.
- **Descrição:** Há state `dontDisturb` mas o handler `notified` chama `addNotification(id)` incondicionalmente.
- **Recomendação:** No handler `notified`, checar `dontDisturb` antes de criar toast; em DND, só acumular no centro de notificações (ou suprimir por completo conforme política). Confirmar o comportamento desejado (acumular vs descartar).
- **Severidade:** 🟠 Médio

#### 🟠 Estilhaço de listas: launcher e centro de notificações sem virtualização
- **Onde:** `src/widget/applauncher/index.tsx:162` (`<For each={list}>` renderiza todos os matchs); `notifications/index.tsx` (`<For each={notifications(...) }>` com `.reverse()`).
- **Descrição:** Sem `limit`/slice no launcher (`fuzzyQuery` retorna todos matches) e sem virtual scrolling no centro de notificações. 100+ apps / 100+ notificações renderizam todos os nós GTK.
- **Impacto:** Lag perceptível em máquinas modestas e com muitas notificações; memory growth.
- **Recomendação:** Launcher: capar resultados (ex.: top 30) + "show more" scroll. Centro de notificações: paginar/windowing; o `.reverse()` a cada emission cria array novo — usar lista em ordem estável.
- **Severidade:** 🟠 Médio

#### 🟠 Estados vazios/loading não visivelmente tratados
- **Onde:** `applauncher` (sem mensagem "nenhum app encontrado"), `quicksettings/network` (sem "nenhuma rede", estado de scan loading?), `notifications` vazias, clipboard vazio (prefix `>`).
- **Descrição:** Não evidenciei tratamentos de empty/loading state nas widgets lidas. GNOME HIG valoriza isso fortemente.
- **Recomendação:** Adicionar placeholders emptystandardizados (Ícone + texto + ação) para: launcher sem match, WiFi scan vazio/em-progresso, notif center vazio, clipboard vazio.
- **Severidade:** 🟠 Médio

#### 🔵 Sem reduced-motion / alto-contraste declarados
- **Onde:** `src/shade.css`, sem uso de `@media (prefers-reduced-motion)` ou `Adw.StyleManager` high-contrast.
- **Descrição:** Animações de OSD/notif/lock não respeitam preferência do sistema. Sem teste com tema HighContrast.
- **Recomendação:** Respeitar `prefers-reduced-motion` no CSS; testar com `gsettings set org.gnome.desktop.interface high-contrast true`.
- **Severidade:** 🔵 Baixo

#### 🔵 Multi-monitor hotplug — widgets recicladas vs sinais staleness
- **Onde:** `widget/index.tsx` (`<For each={monitors}>` em bar/dock/lock); `recording-boundary/index.tsx:103-106` (`toArray(monitors)` por render).
- **Descrição:** O modelo per-monitor via `<For>` é correto; o risco é **residual listeners** quando um monitor sai (item C1 arquitetura). O `recording-boundary` faz `toArray(monitors)` a cada render — se a lista muda em hotplug, re-renderiza todos os boundaries.
- **Recomendação:** Validar no VM-test: plug/unplug 10×, medir que handler count não cresce.
- **Severidade:** 🔵 Baixo (se C1 resolvido)

#### ✅ Acertos de UX
- **Tipografia madura** (`docs/FONTS.md` discute tabular-nums no clock, DPI, pesos) — atenção real a legibilidade.
- **Lockscreen com `SessionLock` + `Gtk.PasswordEntry` + `grab_focus`** (`lockscreen/index.tsx`) e **save/restore de brightness** — polido e funcional.
- **Recording boundary visual** é um diferencial UX excelente para share/recording (feedback claro da região ativa).

### Recomendações Prioritárias (UX)
1. **Auditoria de a11y** com Orca + regra no CONTRIBUTING.
2. **Confirmar (e tee) gating de notificações na lockscreen**; se faltar, implementar.
3. **DND suprime toasts** com política definida (acumular ou descartar).
4. **Empty states** padronizados para launcher/network/notif/clipboard.
5. **Capar lista do launcher** + windowing no centro de notificações.

### Perguntas para o Time (UX)
- Qual a política de notificações em tela bloqueada? (ocultar? redirecionar para a lockscreen?)
- DND acumula ou descarta notificações?
- Há usuário-alvo de leitor de tela, ou a11y é "boa-prática" sem demanda real?

---

## 4. Revisão de QA

### Resumo Executivo

A **estratégia de testes é racional** (test-runner custom pois `GLib.Test` segfaulta,
com `run()` que retorna exit code para CI) e os testes existentes são **bem
escritos** (clamping, cross-validation, guards). Mas a **cobertura é muito baixa
para o tamanho**: 5 arquivos, zero testes para widgets e para os serviços mais
complexos (`Screenshot`, `Weather`, `Theming`, `Lockscreen`, `Notifications`).
Não há regressão visual, testes de estresse, nem métricas de memory. O risco
maior é **regressão silenciosa** nos serviços não cobertos.

### Achados

#### 🟡 Cobertura de testes muito baixa para serviços críticos
- **Onde:** `src/lib/__tests__/` — só `hypridle`, `requestHandler`, `deferredSingleton`, `networkUtils`. Faltam: `screenshot.ts` (717 LOC, lógica de state machine recording), `weather.ts` (303 LOC, parsing GWeather), `theming.ts`, `nightLight.ts` (clamp), `geolocation.ts`, `fingerprint.ts`, `notificationHistory.ts` (cache).
- **Descrição:** O `CONTRIBUTING.md` lista prioridades de teste mas a realidade cobre só serviços triviais/puros. As partes **com lógica de borda real** (screenshot state machine, weather parsing, nightlight clamp/schedule) não têm testes.
- **Impacto:** Mudanças nessas áreas regredir sem detectar. O `screenshot.ts` é o módulo mais complexo do projeto e não tem teste — exatamente onde o bug C2 (freezeProcess leak) vive.
- **Recomendação:** Priorizar teste de `screenshot.ts` (mock `Process` para validar start/stop/dispose e que `dispose` mata freezeProcess — isso teria pegado C2). Testar clamping/`dispose` de cada serviço (CONTRIBUTING já lista "dispose" como alta prioridade — cumprir).
- **Severidade:** 🟡 Alto

#### 🟠 Test-runner: sem suporte a async, mocks limitados
- **Onde:** `src/lib/__tests__/test-runner.ts:80-108` (`run` faz loop síncrono; matchers limitados a 7).
- **Descrição:** Não há `async`/`await` no runner; testes de init assíncrona (Notifd, Geoclue) não são testáveis isoladamente. Sem framework de mock/stub (testes usam `mockX` manual como em `hypridle.test.ts`). `toThrow` não valida mensagem.
- **Impacto:** Limita o tipo de teste a lógica pura/síncrona; serviços event-driven não são testáveis.
- **Recomendação:** Estender `test-runner` com `it.async`, matchers `toThrowMatching`, `toContain`. Documentar padrão de `mockSettings`/`mockProcess` reutilizável.
- **Severidade:** 🟠 Médio

#### 🟠 Serviços não testáveis isoladamente (singletons hard-coded)
- **Onde:** `ShellState.get_default()`, `Screenshot.get_default()`, `Bluetooth.get_default()`, `Notifd` via `DeferredSingleton`. `Hypridle.get_default()` usa singleton testável só porque o teste confunde estado global entre testes.
- **Descrição:** `get_default()` cria instância imortal; testes de `Hypridle` leak state entre casos (o teste "guards against double-init" depende de `init` anterior — frágil).
- **Recomendação:** Expor `reset()` ou fábrica `createX(settings)` para testes; manter `get_default()` como wrapper. `Hypridle` já tem pattern init() guardado — estender a outros.
- **Severidade:** 🟠 Médio

#### 🟡 Não há regressão visual nem teste de estresse
- **Onde:** `.github/workflows/` (aparenta não haver screenshot-diff/visual), nada de memory baseline.
- **Descrição:** UI GTK4/Gnim não testada automaticamente para mudanças visuais; `Gtk.Test` existe mas não usado. Sem teste de "100 notif/s", "abrir launcher 100×", "hotplug 10×".
- **Impacto:** Refactors visuais (CSS, Adwaita upgrade) podem introduzir regressões invisíveis até o uso.
- **Recomendação:** Mínimo viável: VM-test que_boota o shell e captura screenshot do estado idle + após "shade toggle-*", diferença vs baseline (mesmo que manual). Adicionar smoke de memória: medir RSS pós-boot e após N operações.
- **Severidade:** 🟡 Alto

#### 🟠 Casos de borda não cobertos / provavelmente quebram
- **Onde:**
  - **Concorrência:** dois screenshots simultâneos, recording+screenshot ao mesmo tempo (`screenshot.ts` tem state `#recordingProcess` único — segundo disparo sobrescreve?).
  - **Overflow:** 100+ notificações em 1s (`notifications/index.tsx` `addNotification` sem throttle/cap → 100 nós GTK + 100 setTimeout).
  - **Recursos externos ausentes:** `wf-recorder`/`wl-screenrec` não instalados, `fprintd` indisponível, `geoclue` não autorizado, `hyprshot`/`slurp` ausentes. Muitos serviços checam `find_program_in_path` (bom) mas `screenshot.ts` assume caminho em `SCREENSHOT_DIR`${home}/Pictures/Screenshots`` (`screenshot.ts:14`) sem criar dir.
- **Recomendação:** Para `screenshot.ts`: criar dir no dispose-safe init, e guard contra second-disparo (return se já recording, ou fila). Para notif: throttle/cap. Para external tools: haver um **capability registry** (wf-recorder? slurp? fprintd? matugen? hyprsunset?) verificado no boot e exposto em `shade --diagnostics`.
- **Severidade:** 🟠 Médio

#### 🔵 `print`/`console.warn` em vez de `logger` em vários pontos
- **Onde:** `src/lib/powerProfiles.ts:45/77` (`print(...)`), `notifications/index.tsx:160` (`print("[Shade] [WARN]...")`).
- **Descrição:** Logging bypassa o `logger` categorizado, quebrando filtro de `debugCategories` e níveis.
- **Recomendação:** Trocar por `logger.warn("category", ...)`. Auditar `grep -rn "print(" src/lib src/widget`.
- **Severidade:** 🔵 Baixo

#### 🔵 `perf` tracer existe mas é subutilizado para diagnóstico de produção
- **Onde:** `src/lib/logger.ts` (`perf.start/stop/measure`), usado em `App.tsx`/`main.ts`/`widget/index.tsx` para startup.
- **Descrição:** Mede startup lindamente, mas não há traces por-operação (abrir QS, primeiro notif, recording start). Não há dump de estado (serviços ativos, widgets montadas) — útil para depurar issues de user.
- **Recomendação:** Adicionar `perf` em handlers de ação D-Bus e um `dumpState()` no `Logger` para `shade --diagnostics`.
- **Severidade:** 🔵 Baixo

#### ✅ Acertos de QA
- **Test-runner robusto ao segfault do `GLib.Test`** — decisão pragmática e documentada, com exit code para CI.
- **`safeTry`/error boundary helpers** (`logger.ts:safeTry`) e uso consistente em `widget/index.tsx`.
- **`hypridle.test.ts`** é exemplary: testa clamping, cross-validation, double-init guard, dispose — modelo a replicar em outros serviços.
- **CI Nix + VM-test** existe (raro neste nicho) — base sólida a expandir.

### Recomendações Prioritárias (QA)
1. **Testar `screenshot.ts`** com `Process` mockado — teria capturado C2; cobrir start/stop/dispose/state-machine.
2. **Capability registry** (ferramentas externas) verificado no boot + exposto em `--diagnostics`.
3. **Smoke de memória/boot no VM-test** + baseline de screenshot.
4. **Throttle/cap de notificações** (100/s) + guard de second-disparo no screenshot.
5. **Padronizar `logger`** em todo `print` residual; `reset()` factory para testes isolados.

### Perguntas para o Time (QA)
- O `vm-test.yml` é estável? Quantas runs passam consecutivas? (medir flakiness)
- Há baseline de RSS/boot-time para detectar regressões de perf?
- Qual o critério de "teste suficiente" para aceitar um serviço novo no PR?

---

## Glossário de Severidade

| Severidade | Significado |
|------------|-------------|
| 🔴 Crítico | Impeditivo. Causa crash, perda de dados, processo órfão/estado invasivo, ou impossibilita uso. |
| 🟡 Alto | Degradação significativa. Funciona mas piora com o tempo, expõe risco real, ou bloqueia maturidade (`1.0.0`). |
| 🟠 Médio | Problema real mas contornável ou de baixa frequência hoje. |
| 🔵 Baixo | Melhoria desejável. Cosmético, observabilidade, ou borda rara. |
| ⚪ Sugestão | Ideia para considerar. Não é um problema hoje. |

---

## Observância Metodológica

- Achados foram **verificados** em leitura direta (não só por subagentes):
`widget/index.tsx`, `lockscreen/index.tsx` (PAM cleanup confirmado ✅),
`screenshot.ts:703` (freezeProcess leak confirmado 🔴),
`notifications/index.tsx:97/160`, `nightLight.ts #stopProcess` (`pkill` global),
`theming.ts` (sem dispose/subscriptions), `powerProfiles.ts` (`print`), cava
widget, `gjsUtils.toArray`. Achados marcados "assumindo" indicam risco a confirmar.
- Severidade **contextualizada** ao estágio (pessoal, `0.2.1`, autor único): nada
aqui é "pare de tudo" — mas C1/C2 + baixa cobertura de teste são os pontos que
mais impactam a **transição de "funciona pra mim" para "produto 1.0 confiável"**.