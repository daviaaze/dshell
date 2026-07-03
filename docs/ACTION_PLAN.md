# Plano de Ação — Shade Shell Remediation

> **Origem:** Revisão Multidisciplinar (`docs/REVIEW.md`)
> **Meta:** Transformar os achados em tarefas executáveis, ordenadas por impacto e dependência.
> **Estimativa total:** ~6–8 semanas (1 desenvolvedor ~10h/semana), ou ~2–3 semanas full-time.

---

## Como Usar Este Plano

Cada tarefa segue este formato:

```
[TAG] Título
  Onde: arquivo(s) específicos
  O quê: descrição concisa do que precisa mudar
  Esforço: XS (<1h) / S (1-3h) / M (3-8h) / L (8-24h) / XL (24h+)
  Risco: 🔴 quebra compatibilidade / 🟡 afeta UX conhecida / 🟠 risco médio / 🔵 seguro
  Depende de: [tags de pré-requisitos]
```

As fases **não precisam ser seguidas à risca** — tarefas de fases diferentes podem
ser feitas em paralelo (ex.: a11y e test-runner async são independentes). Use o
plano como menu, não como camisa-de-força.

---

## Fase 0 — Quick Wins 🚀 (emergencial, alto impacto, baixo risco)

Tarefas que são claramente bugs, levam <1h cada, e já estão completamente
entendidas. Faça todas primeiro.

| # | Tarefa | Esforço | Risco |
|---|--------|---------|-------|
| Q1 | **`Screenshot.dispose()` — matar `#freezeProcess`** | XS | 🔵 |
| Q2 | **`NightLight.#stopProcess()` — remover `pkill -f` global** | XS | 🔵 |
| Q3 | **`print()` → `logger` — substituir resíduos** | XS | 🔵 |
| Q4 | **`gjsUtils.toArray()` — log DEBUG de descartes** | XS | 🔵 |
| Q5 | **`Screenshot` — criar `SCREENSHOT_DIR` ausente** | XS | 🔵 |
| Q6 | **DND — suprimir toasts quando ativo** | S | 🟠 |
| Q7 | **Notificações — checar `screenlocked` antes do popup** | S | 🟡 |

---

### Q1: Matar `#freezeProcess` no `Screenshot.dispose()` 🚀

- **Onde:** `src/lib/screenshot.ts:703-715`
- **O quê:** O método `dispose()` mata `#recordingProcess` e `#durationTimer` mas ignora `#freezeProcess`. Adicionar o mesmo bloco de finalização.
- **Como:**
  ```typescript
  dispose() {
    if (this.#durationTimer) {
      GLib.Source.remove(this.#durationTimer);
      this.#durationTimer = null;
    }
    if (this.#freezeProcess) {
      try { this.#freezeProcess.signal(2) } catch {}
      try { this.#freezeProcess.signal(15) } catch {}
      this.#freezeProcess = null;
    }
    if (this.#recordingProcess) { ... }
  }
  ```
- **Esforço:** XS (<5min, 10 linhas)
- **Risco:** 🔵 Seguro — só afeta shutdown ou restart, não há fluxo que dependa de `dispose()` para continuar capturando.

### Q2: Remover `pkill -f` do `NightLight.#stopProcess()` 🚀

- **Onde:** `src/lib/nightLight.ts` (método `#stopProcess`)
- **O quê:** O `Process.exec("pkill -f 'hyprsunset --temperature'")` mata todas as instâncias do usuário. O método já rastreia `#process` e chama `kill()`. Remover o `pkill`.
- **Adicional:** Adicionar salvaguarda — antes de `kill()`, verificar se `#process?._pid` é o nosso processo (não o de outro).
- **Esforço:** XS (~10min)
- **Risco:** 🔵 Seguro — apenas remove comportamento destrutivo.

### Q3: Substituir `print()` por `logger` 🚀

- **Onde:**
  - `src/lib/powerProfiles.ts:45,77` — `print("PowerProfiles: ...")`
  - `src/widget/notifications/index.tsx:160` — `print("[Shade] [WARN] ...")`
  - Possivelmente outros (auditar: `grep -rn "print(" src/lib src/widget`)
- **O quê:** Trocar por `logger.warn("category", msg)` ou `logger.error`. Manter a semântica do log mas passando pelo sistema com categorias.
- **Esforço:** XS (5min + tempo de grep)
- **Risco:** 🔵 Seguro — só muda destino da saída.

### Q4: Log DEBUG no `toArray()` para descartes 🚀

- **Onde:** `src/lib/gjsUtils.ts:22-30`
- **O quê:** No `catch` que silencia itens não-marshaláveis, adicionar `logger.debug("gir", "toArray: skipping item at index", i)` ou similar. Também adicionar log ao final: `if (arr.length !== originalCount) logger.debug(...)`.
- **Esforço:** XS (5min)
- **Risco:** 🔵 Seguro — só adiciona log.

### Q5: Criar `SCREENSHOT_DIR` se não existir 🚀

- **Onde:** `src/lib/screenshot.ts:14` (`SCREENSHOT_DIR = ${GLib.get_home_dir()}/Pictures/Screenshots`)
- **O quê:** Antes de salvar screenshot, verificar se o diretório existe e criar via `Gio.File.make_directory_with_parents()`. Se falhar, logar erro e salvar em `/tmp`.
- **Esforço:** XS (15min)
- **Risco:** 🔵 Seguro — fallback seguro.

### Q6: DND suprime toasts 🚀

- **Onde:** `src/widget/notifications/index.tsx` (handler `notified` ~linha 97, `addNotification` ~linha 27)
- **O quê:** O state `dontDisturb` existe e é setado (~138-154) mas `addNotification` não consulta. Adicionar guarda:
  ```typescript
  if (dontDisturb) return; // ou empilhar só no centro sem popup
  ```
- **Decisão a tomar:** DND acumula no centro de notificações ou descarta? Recomendação: acumular (usuário quer ver depois).
- **Esforço:** S (~30min)
- **Risco:** 🟠 Médio — precisa decidir política de DND (acumular vs descartar). Por default, descartar é mais seguro para não vazar notificação indesejada.

### Q7: Notificações gated pelo lockscreen 🚀

- **Onde:** `src/widget/notifications/index.tsx:27-97` (addNotification)
- **O quê:** Adicionar guarda `if (ShellState.get_default().screenlocked) return` no início de `addNotification`. Também na função de popup.
- **Esforço:** S (~30min)
- **Risco:** 🟡 Médio — precisa confirmar que é desejado. Se o usuário quer ver notificações na lockscreen (sem preview), o comportamento precisa ser mais sofisticado (mostrar só contagem, ou só app name). Por segurança, suprimir completamente é o mais correto.
- **Depende de:** Nada, mas é bom discutir antes.

---

## Fase 1 — Fundação (Testabilidade + Infra) 🧱

Esta fase prepara o terreno para as correções maiores. Sem ela, leak-fixing é
manual e frágil, e testes para serviços complexos ficam impossíveis.

| # | Tarefa | Esforço | Risco | Depende de |
|---|--------|---------|-------|------------|
| F1 | **Helper `connectFor(self, obj, signal, cb)`** | S | 🔵 | — |
| F2 | **Test-runner: suporte `async`** | M | 🔵 | — |
| F3 | **Test-runner: matchers `toThrowMatching`, `toContain`** | S | 🔵 | — |
| F4 | **`DeferredSingleton` com reset público** | XS | 🔵 | — |
| F5 | **Factory `createX(settings)` para serviços** | M | 🟡 | F2, F3 |

---

### F1: Helper `connectFor` 🧱

- **Onde:** Novo arquivo `src/lib/connectFor.ts` (ou dentro de `gjsUtils.ts` se pequeno)
- **O quê:** Criar um helper que faz `connect()` e automaticamente desconecta no `onCleanup` (ou quando o widget é destruído):
  ```typescript
  // API proposal
  connectFor(self: GnimNode, obj: GObject.Object, signal: string, cb: Function): number
  ```
  Internamente:
  1. Chama `obj.connect(signal, cb)` → guarda `handlerId`
  2. Registra no `onCleanup` do nó: `obj.disconnect(handlerId)`
  3. Retorna o `handlerId` para caso o caller queira disconnect manual antes do cleanup
- **Também:** `connectForDestroy(self, obj, cb)` para padrão `destroy` (se for diferente).
- **Esforço:** S (~1-2h, inclui testes)
- **Risco:** 🔵 Seguro — módulo novo, não afeta nada existente.

### F2: Test-runner com suporte a `async` 🧱

- **Onde:** `src/lib/__tests__/test-runner.ts`
- **O quê:** Hoje `run` faz loop síncrono. Adicionar `it.async(label, fn)` que retorna Promise e `run()` que `await Promise.all(...)`.
  ```typescript
  // API
  it.async("should connect async", async () => {
    const result = await someAsyncOperation()
    expect(result).toBe(42)
  })
  ```
- **Esforço:** M (~3-4h, requer cuidado com edge cases: timeout, unhandled rejection, mix de sync/async tests)
- **Risco:** 🔵 Seguro — não altera API existente, só adiciona.

### F3: Matchers extras 🧱

- **Onde:** `src/lib/__tests__/test-runner.ts`
- **O quê:** Adicionar `toThrowMatching(predicate)`, `toContain(expected)`, `toBeNull`, `toBeDefined`. Básico para testes de init/state.
- **Esforço:** S (~1h)
- **Risco:** 🔵 Seguro

### F4: DeferredSingleton.reset() público 🧱

- **Onde:** `src/lib/deferredSingleton.ts`
- **O quê:** `reset()` já existe e é público (ver linha ~96). Confirmar que é suficiente; se não, expor `reset()` no wrapper `getDefault()` ou criar `resetSingleton()` exportado.
- **Esforço:** XS (~10min)
- **Risco:** 🔵 Seguro

### F5: Factory pattern para serviços 🧱

- **Onde:** Serviços com `get_default()`: `Screenshot`, `Hypridle`, `NightLight`, `Theming`, `Weather`, `ShellState`, etc.
- **O quê:** Para cada serviço, expor uma função `createX(props)` que aceita dependências (settings, process mock, dependências) e retorna instância. `get_default()` passa a chamar `createX` internamente. Isso permite testes isolados sem estado global compartilhado.
- **Padrão:**
  ```typescript
  // Exemplo para Screenshot
  export function createScreenshot(props?: {
    settings?: SettingsGroup<Gio.Settings>
    process?: typeof Process
    hyprland?: AstalHyprland.Hyprland
  }): Screenshot {
    return new Screenshot(props)
  }
  ```
- **Esforço:** M (~4-8h para todos os serviços)
- **Risco:** 🟡 — requer refactor de singletons; pode quebrar código que acessa via `get_default()`. Mitigação: wrapper mantém compatibilidade.
- **Depende de:** F2 (para testar), F3

---

## Fase 2 — Leak Hunt & Lifecycle 🔍 (C1 + dispose audit)

Aqui é onde se resolvem as dívidas estruturais mais importantes: sinais GObject
e assinaturas Gnim não limpos.

| # | Tarefa | Esforço | Risco | Depende de |
|---|--------|---------|-------|------------|
| L1 | **Auditar `connect()` sem `onCleanup`** | M | 🟡 | F1 |
| L2 | **Auditar `subscribe()` / `createBinding()` sem cleanup** | M | 🟡 | — |
| L3 | **Completar `dispose()` em serviços sem** | M | 🟠 | — |
| L4 | **Theming: guardar unsubscribers, expor dispose, debounce seguro** | S | 🔵 | L2 |
| L5 | **NightLight: poll 5s → event-driven (ColorScheme signal)** | S | 🔵 | — |
| L6 | **Teste de estresse de handlers (VM-test)** | M | 🔵 | L1, L2 |

---

### L1: Audit connect() → connectFor 🔍

- **Onde:** `grep -rn "\.connect(" src/widget/ src/lib/` — dezenas de ocorrências
- **O quê:** Para cada `connect()` que está dentro de `$={(self) => ...}` ou `onMount(...)` e que não tem `onCleanup` → trocar por `connectFor(self, ...)`. Foco em widgets (bar, dock, quicksettings, notifications).
- **Checklist de ocorrências conhecidas:**
  - `notifications/index.tsx:97` — `notifd.connect("notified", ...)` → `connectFor`
  - `notifications/index.tsx:138/154` — `cached.connect("notify::dontDisturb", ...)` → talvez singleton imortal, mas por consistência usar `connectFor`
  - `bar/indicators/bluetooth.tsx:34-36` — `Bluetooth.get_default().connect(...)` → `connectFor`
  - `quicksettings/` (vários `.connect` em `$={}`)
  - `osd/` idem
  - `lockscreen/index.tsx` (PAM connects — mas já têm cleanup? ver L2)
- **Esforço:** M (~4-6h)
- **Risco:** 🟡 — trocar `connect()` → `connectFor(self,...)` exige ter acesso ao `self` (nó Gnim). Em callbacks `$` é natural; em `onMount` OK. Em contexto fora da árvore Gnim, manter `connect` manual.
- **Depende de:** F1 (helper pronto)

### L2: Audit subscribe() / createBinding() sem cleanup 🔍

- **Onde:** `grep -rn "\.subscribe(" src/widget/ src/lib/`
- **O quê:** `subscribe()` no Gnim retorna um unsubscriber. Em services com `dispose()`, guardar e chamar. Em widgets (Gnim `$` internal), verificar se o Gnim já faz auto-cleanup. Se não, `onCleanup`.
- **Esforço:** M (~3-5h)
- **Risco:** 🟡 — pode quebrar se Gnim já limpa; testar com duplo cleanup não crasha.

### L3: Dispose audit 🔍

- **Onde:** Todos os serviços em `src/lib/`
- **O quê:** Para cada serviço com `get_default()`, verificar se `dispose()` existe e se cobre:
  - Sinais GObject conectados (disconnect)
  - Subscriptions Gnim (chamar unsubscriber)
  - `setInterval` / `GLib.timeout_add` / `GLib.timeout_add_seconds` (source_remove)
  - Processos filho (`kill()`, `signal(2/15/9)`)
  - Arquivos temporários
  - `#freezeProcess` já endereçado em Q1
- **Checklist:**
  - ✅ `Screenshot.dispose()` (após Q1)
  - ❌ `Theming.dispose()` — não existe
  - ✅ `NightLight.dispose()` — existe e cobre poll + process
  - ✅ `Hypridle.dispose()` — existe e cobre process + subscriptions
  - ❓ Demais serviços — verificar
- **Esforço:** M (~3-5h)
- **Risco:** 🟠 Médio — mexer em dispose pode quebrar shutdown sequence. Testar no VM-test.

### L4: Theming cleanup 🔍

- **Onde:** `src/lib/theming.ts`
- **O quê:**
  - Guardar retornos de `.subscribe()` e chamar no `dispose()`
  - Debounce seguro: guardar `sourceId` do `GLib.timeout_add_seconds` e remover antes de criar novo
  - Expor método `dispose()` público
- **Esforço:** S (~1-2h)
- **Risco:** 🔵 Seguro — estado interno.

### L5: NightLight poll → event-driven 🔍

- **Onde:** `src/lib/nightLight.ts` (método `#startPoll`, timeout de 5s)
- **O quê:** Em vez de poll a cada 5s para verificar `autoSchedule`, conectar ao sinal `notify::daytime` de `ColorScheme` (já que NightLight depende de ColorScheme). Isso:
  - Reduz CPU idle
  - Reage instantaneamente à mudança de dia/noite
- **Esforço:** S (~1-2h)
- **Risco:** 🔵 Seguro — só muda o trigger, lógica de schedule idêntica.

### L6: Teste de estresse de handlers 🔍

- **Onde:** Novo arquivo: `src/lib/__tests__/stress.test.ts` ou diretiva no VM-test
- **O quê:** Script que faz no VM-test:
  1. Remount bar N vezes → verificar handler count não cresce
  2. Hotplug simulado (emular monitor plug/unplug via libei ou script) → verificar count
- **Esforço:** M (~4-6h)
- **Risco:** 🔵 — VM-test já existe.
- **Depende de:** L1, L2 (precisa primeiro dos helpers para depois testar)

---

## Fase 3 — Test Coverage 🧪

Depois da Fase 1 (infra de teste) e Fase 2 (estado limpo), escrever testes para
os módulos críticos.

| # | Tarefa | Esforço | Risco | Depende de |
|---|--------|---------|-------|------------|
| T1 | **Testar `Screenshot` (start/stop/dispose/state machine)** | M | 🟡 | F2, F5, Q1 |
| T2 | **Testar `NightLight` (clamp, schedule, poll→event)** | M | 🟡 | F2, F5, L5 |
| T3 | **Testar `Weather` (parsing GWeather, erro de API)** | M | 🟡 | F2 |
| T4 | **Testar `Theming` (apply, clear, dispose, matugen mock)** | M | 🟡 | F2, F5, L4 |
| T5 | **Testar `Geolocation` (init, error, fallback)** | S | 🟠 | F2 |
| T6 | **Testar `NotificationHistory` (max size, cleanup)** | S | 🔵 | F2 |
| T7 | **Testar `requestHandler` (full dispatch, erro rota)** | M | 🔵 | — |
| T8 | **VM-test: screenshot visual + RSS baseline** | L | 🟡 | L6 |

---

### T1: Screenshot tests 🧪

- **Onde:** `src/lib/__tests__/screenshot.test.ts`
- **O quê:** Mockar `Process`, `AstalHyprland`, `GLib.get_monotonic_time`. Validar:
  - `startRecording()` → cria processo
  - `stopRecording()` → signal(2) e cleanup
  - `dispose()` → mata recording + freeze process (regressão de Q1)
  - Dois `dispose()` consecutivos não crasha
  - Guard contra second-recording (deve retornar ou rejeitar)
  - `SCREENSHOT_DIR` criado se ausente
- **Esforço:** M (~4-6h)
- **Risco:** 🟡 — requer mock de módulos GObject, que pode ser frágil.
- **Depende de:** F2 (async), F5 (factory), Q1 (correção já aplicada)

### T2: NightLight tests 🧪

- **Onde:** `src/lib/__tests__/nightLight.test.ts`
- **O quê:** Testar:
  - Clamping de temperatura (TEMP_MIN/TEMP_MAX)
  - `enabled` toggle → start/stop process
  - `autoSchedule` + `colorScheme.daytime` → enabled toggle
  - `dispose()` → poll timer removido, process morto
  - `available` sem hyprsunset → false
  - Poll não criado se autoSchedule=false (após L5, event-driven não poll)
- **Esforço:** M (~3-5h)
- **Risco:** 🟡 — mock de ColorScheme.
- **Depende de:** F2, F5, L5

### T8: VM-test baseline 🧪

- **Onde:** `.github/workflows/vm-test.yml` + novo script
- **O quê:**
  - Boot VM
  - Capture screenshot `after-boot.png`
  - Execute `shade toggle-applauncher`, sleep 1s, capture `launcher-open.png`
  - Execute `shade toggle-quicksettings`, capture `qs-open.png`
  - Arquive baselines em `test/baseline/`
  - Compare em CI (pixel diff) — se diff > X%, falhar
- **Esforço:** L (~2-3 dias incluindo setup de baseline + CI)
- **Risco:** 🟡 — VMs headless podem ter render diferente do real; ajustar threshold.

---

## Fase 4 — UX/UI Quality 🎨

Melhorias de experiência, paralelas com Fase 2/3 (não dependem delas).

| # | Tarefa | Esforço | Risco |
|---|--------|---------|-------|
| U1 | **a11y: adicionar `accessibleLabel` em botões ícone-only** | M | 🔵 |
| U2 | **Empty states: launcher sem match, WiFi scan vazio, notif vazia** | M | 🔵 |
| U3 | **Cap lista do app launcher (top 30 + scrolling)** | S | 🔵 |
| U4 | **Windowing no centro de notificações (paginar)** | M | 🟡 |
| U5 | **CSS: respeito a `prefers-reduced-motion`** | S | 🔵 |
| U6 | **CSS: prefixo `shade-` + documentação de tokens** | S | 🔵 |
| U7 | **DND: definir política (acumular vs descartar)** | XS | 🔵 |

---

### U1: a11y labels 🎨

- **Onde:** `src/widget/bar/` (indicadores), `src/widget/dock/` (item.tsx), `src/widget/quicksettings/button-grid/` (revisar)
- **O quê:** Em botões que são só ícone (bluetooth, volume, brightness, launcher, dock items):
  ```typescript
  <button accessibleLabel={gettext("Toggle Bluetooth")} ...>
  ```
- **Esforço:** M (~3-5h de auditoria + edição)
- **Risco:** 🔵 — só adiciona propriedades.

### U2: Empty states 🎨

- **Onde:** `applauncher/index.tsx`, `quicksettings/network/index.tsx`, `notifications/index.tsx`
- **O quê:** Para cada condição:
  - `applauncher`: quando `list` vazio, mostrar `Gtk.Label("Nenhum app encontrado")`
  - WiFi: quando scan retorna 0 APs, mostrar ícone + texto "Nenhuma rede encontrada"
  - Notificações: quando `notifications.length === 0`, mostrar "Sem notificações"
- **Esforço:** M (~3-5h)
- **Risco:** 🔵 — só adiciona componente condicional.

### U3: Cap app launcher 🎨

- **Onde:** `src/widget/applauncher/index.tsx` (~linha 162)
- **O quê:** Em vez de `list` direto, usar `list.slice(0, 30)` ou estado `visibleCount` com scroll incremental. Manter busca full para precisão mas renderizar só N primeiros.
- **Esforço:** S (~2h)
- **Risco:** 🔵 — fácil de desfazer.

### U4: Paginação de notificações 🎨

- **Onde:** `src/widget/notifications/index.tsx` (centro de notificações)
- **O quê:** Em vez de renderizar todas as `notifications`, mostrar N (ex.: 50) e botão "Mostrar mais". Ou usar `Gtk.ScrolledWindow` com `vscrollbar-policy=always`.
- **Esforço:** M (~3-4h)
- **Risco:** 🟡 — GTK `ScrolledWindow` dentro de Gnim pode precisar de largura/altura explícita.

### U5: `prefers-reduced-motion` 🎨

- **Onde:** `src/shade.css`
- **O quê:**
  ```css
  @media (prefers-reduced-motion: reduce) {
    .shade-osd,
    .shade-popup {
      transition: none !important;
      animation: none !important;
    }
  }
  ```
- **Esforço:** S (~30min)
- **Risco:** 🔵 — CSS only.

### U6: Prefixo CSS 🎨

- **Onde:** `src/shade.css` + cada widget que usa classes
- **O quê:** Adicionar prefixo `shade-` a todas as classes CSS. Ex.: `.bar` → `.shade-bar`, `.dock` → `.shade-dock`.
- **Esforço:** S (~1h de rename + grep no código)
- **Risco:** 🔵 — mudança cosmética, nomes não são API pública.

---

## Fase 5 — Observabilidade & Diagnóstico 🔭

| # | Tarefa | Esforço | Risco | Depende de |
|---|--------|---------|-------|------------|
| O1 | **Capability registry** | M | 🟡 | — |
| O2 | **`shade --diagnostics`** | M | 🟡 | O1 |
| O3 | **Perf traces em ações D-Bus** | S | 🔵 | — |
| O4 | **Dump de estado (`dumpState()`)** | M | 🟡 | — |

---

### O1: Capability registry 🔭

- **Onde:** Novo arquivo `src/lib/capabilities.ts`
- **O quê:** Registry central que verifica no boot quais ferramentas externas estão disponíveis:
  ```typescript
  export interface Capabilities {
    wfRecorder: boolean
    wlScreenrec: boolean
    slurp: boolean
    hyprshot: boolean
    hyprsunset: boolean
    matugen: boolean
    fprintd: boolean
    geoclue: boolean
    brightnessctl: boolean
    cava: boolean
  }

  export function getCapabilities(): Capabilities {
    // check each via GLib.find_program_in_path
  }
  ```
- Serviços que usam essas ferramentas consultam o registry ao invés de `find_program_in_path` próprio. Benefícios: cache, diagnóstico centralizado, dependency graph explícito.
- **Esforço:** M (~3-5h)
- **Risco:** 🟡 — precisa refatorar serviços existentes para usar o registry em vez de `find_program_in_path` local.

### O2: `shade --diagnostics` 🔭

- **Onde:** `src/lib/diagnostics.ts` + novo handler D-Bus
- **O quê:** Script/lógica que coleta:
  - Versão do shade, commit hash
  - Boot time (via `perf` data)
  - RSS atual (`GTop.glibtop_mem`)
  - Capacidades (O1)
  - Serviços ativos (quais singletons foram initados)
  - Widgets montadas
  - Número de handlers GObject conectados (opcional, ver O4)
  - Erros recentes do logger
- Saída formatada para colar em issues.
- **Esforço:** M (~4-6h)
- **Risco:** 🟡 — acesso a `GTop` pode ser novo dep.
- **Depende de:** O1 (capabilities)

### O3: Perf traces em ações D-Bus 🔭

- **Onde:** `src/lib/requestHandler.ts`
- **O quê:** Wrap cada handler com `perf.measureSync()` ou `perf.start/stop`:
  ```typescript
  perf.measureSync(`action-${actionName}`, () => handler(), "dbus")
  ```
- **Esforço:** S (~30min)
- **Risco:** 🔵

### O4: Dump de estado 🔭

- **Onde:** `src/lib/logger.ts` ou novo `src/lib/stateDump.ts`
- **O quê:** Função que percorre `WindowManager`, `ShellState`, capabilities e produz JSON estruturado com:
  - Quantas barras/locks/docks ativas
  - Estado de recording/screenshot
  - Notificações count
  - Handlers count de serviços monitorados
- **Esforço:** M (~3-5h, principalmente definir o que coletar)
- **Risco:** 🟡 — requer cooperão das serviços (padrão `dump()`).

---

## Fase 6 — Produto & Decisões (PM) 📋

Decisões e documentação que não requerem código.

| # | Tarefa | Esforço | Risco |
|---|--------|---------|-------|
| P1 | **Definir gates de 1.0.0 como ADR** | S | 🔵 |
| P2 | **Pinar `gnim` + policy de breaking-changes** | XS | 🔵 |
| P3 | **Posicionamento explícito (README)** | XS | 🔵 |
| P4 | **ADR de continuidade (se Astal/Gnim parar)** | M | 🔵 |
| P5 | **ADR de dependency injection vs singleton** | S | 🔵 |
| P6 | **Consolidar roteamento D-Bus em tabela única** | M | 🟡 |

---

### P1: Gates de 1.0.0 📋

- **Onde:** `docs/ROADMAP.md` (novo) ou adicionar em `docs/README.md`
- **O quê:** Documentar critérios objetivos:
  1. ✅ Zero leaks de sinais/intervalos (auditado por script)
  2. ✅ `dispose()` em 100% dos serviços
  3. ✅ Testes para serviços críticos (Screenshot, Hypridle, Weather, Theming)
  4. ✅ Bugs sistêmicos do POSTMORTEM corrigidos (verificar cada um)
  5. ✅ 7 dias de uso contínuo do autor sem RSS growth anormal
  6. ✅ VM-test green
- **Esforço:** S (~1h)
- **Risco:** 🔵 — documentação.

### P2: Pinar gnim 📋

- **Onde:** `package.json`
- **O quê:** Mudar `"gnim": "^1.9.1"` → `"gnim": "1.9.1"` (exato). Adicionar comentário no CONTRIBUTING.md: "gnim é fixado na versão X.Y.Z; atualizamos manualmente após testar compatibilidade."
- **Esforço:** XS (~5min)
- **Risco:** 🔵 — só muda o range da dependência.

### P3: Posicionamento explícito 📋

- **Onde:** `docs/README.md`
- **O quê:** Adicionar seção "Positioning":
  > **Shade Shell** is a personal, power-user desktop shell for Hyprland, not a general-purpose desktop environment. It prioritizes deep Hyprland integration, visual polish, and developer extensibility over broad compatibility or mass adoption.
- **Esforço:** XS (~10min)
- **Risco:** 🔵

### P4: ADR de continuidade 📋

- **Onde:** Escrever ADR. Local: `docs/adr/2026-07-03-dependency-continuity.md` (ou no ai-workspace conforme convenção).
- **O quê:** Analisar as opções:
  1. **Manter pin + monitorar** — fixar versões, testar breaking changes antes de atualizar
  2. **Fork Gnim** — vendor critical subset (~2k LOC) no repositório, eliminando dependência single-author
  3. **ASTAL compat layer** — abstrair interface de Astal para trocar implementação se necessário
- Recomendação: (1) imediato; (2) médio prazo se Gnim mostrar sinais de abandono; (3) baixa prioridade.
- **Esforço:** M (~3h de análise + escrita)
- **Risco:** 🔵 — só documento.

### P6: Tabela única de roteamento D-Bus 📋

- **Onde:** `src/lib/requestHandler.ts`
- **O quê:** Unificar `actions` map e `commandRoutes` em uma única declaração:
  ```typescript
  const routes = [
    { cli: ["lockscreen"], action: "lockscreen", handler: () => toggleLockscreen() },
    { cli: ["screenshot", "screenshot-area", "screenshot-overlay"], action: "screenshot", handler: ... },
    { cli: ["toggle", "applauncher"], action: "toggle-applauncher", handler: ... },
    // ...
  ]
  ```
  Gerar automaticamente:
  - `commandRoutes` (CLI dispatch)
  - `registerActions(this)` (GAction registration)
  - (Opcional) `--help` CLI
- **Esforço:** M (~3-5h)
- **Risco:** 🟡 — refatora código de entrada; requer testar todos os comandos depois.

---

## Fase 7 — Extra: Capacidades Futuras 🧠

Ideias que não são bugs nem dívidas, mas melhorariam a qualidade do projeto
a médio prazo. Inclua conforme interesse/energia.

| # | Tarefa | Esforço |
|---|--------|---------|
| E1 | **Autorun de memcheck (`valgrind --tool=massif`) no CI** | M |
| E2 | **`DeferredSingleton` com timeout** — se factory demorar >N, log warning | S |
| E3 | **GIR type generator script** para `@girs/` local | S |
| E4 | **Contribution template (issue forms + PR template)** | S |
| E5 | **`docs/STYLE_GUIDE.md`** — padrões de codificação para o projeto | M |
| E6 | **`shade --version`** — exibir commit + versão no stdout | XS |
| E7 | **Documentar debug categories em `docs/DEBUGGING.md`** | S |
| E8 | **Teste de startup no vm-test** — boot até widgets prontas < 2s | M |

---

## Mapa de Dependências

```
Fase 0 (Quick Wins)
├── Q1-Q5 (independentes, fazer primeiro)
├── Q6 (DND)
└── Q7 (lockscreen notif)

Fase 1 (Infra)
├── F1 (connectFor) → L1
├── F2 (async test-runner) → T1-T6
├── F3 (matchers) → T1-T6
├── F4 (DeferredSingleton reset) → T1-T6
└── F5 (factory) → T1-T6

Fase 2 (Leak Hunt)
├── L1 (connect audit) → depende F1
├── L2 (subscribe audit) → independente
├── L3 (dispose audit) → independente
├── L4 (theming) → L2
├── L5 (nightlight poll→event) → independente
└── L6 (stress test) → depende L1+L2, alimenta Fase 3

Fase 3 (Test Coverage)
├── T1 (screenshot) → F2+F5+Q1
├── T2 (nightlight) → F2+F5+L5
├── T3 (weather) → F2
├── T4 (theming) → F2+F5+L4
├── T5 (geolocation) → F2
├── T6 (notificationHistory) → F2  → F2
├── T7 (requestHandler) → independente
└── T8 (vm-test baseline) → independente

Fase 4 (UX/UI) → independente de Fase 2/3 (pode paralelo)
├── U1 (a11y labels)
├── U2 (empty states)
├── U3 (cap launcher)
├── U4 (paginar notificações)
├── U5 (reduced-motion CSS)
├── U6 (prefixo CSS)
└── U7 (política DND)

Fase 5 (Observabilidade)
├── O1 (capability registry) → dependências reversas (serviços usam)
├── O2 (--diagnostics) → O1
├── O3 (perf traces D-Bus)
└── O4 (dump state)

Fase 6 (PM) → independente do código
├── P1 (gates 1.0)
├── P2 (pinar gnim)
├── P3 (posicionamento)
├── P4 (ADR continuidade)
├── P5 (ADR DI vs singleton)
└── P6 (tabela D-Bus única) → pode integrar com O3

Fase 7 (Futuro) → depois de tudo estável
```

---

## Prioridade Recomendada (Primeiro Sprint — 2 semanas)

Se a pergunta é "por onde começar amanhã?", aqui estão as tarefas de maior
impacto no menor tempo:

| Ordem | Tarefa | Justificativa |
|-------|--------|---------------|
| 1 | **Q1** — freezeProcess leak | 5min, bug crítico, processo órfão |
| 2 | **Q2** — pkill global | 10min, comportamento destrutivo |
| 3 | **Q3** — print→logger | 15min, consistência |
| 4 | **Q7** — lockscreen notif guard | 30min, potencial privacy bug |
| 5 | **Q6** — DND suprime toasts | 30min, funcionalidade quebrada |
| 6 | **F1** — connectFor helper | ~2h, desbloqueia L1 |
| 7 | **L1** — audit connect() crítica | ~4h, maior dívida estrutural (C1) |
| 8 | **U7 + Q6** — política DND | discussão rápida + código |
| 9 | **P2** — pinar gnim | 5min, reduz risco |
| 10| **O3** — perf traces | 30min, observabilidade imediata |

**Estimativa do primeiro sprint:** ~8-10h de código, cobrindo os achados 🔴 e 🟡
mais críticos.

---

## Glossário de Esforço

| Tag | Tempo Estimado | Exemplo |
|-----|----------------|---------|
| XS | < 30 min | Adicionar log, renomear, fix de 3 linhas |
| S | 1-3 h | Helper pequeno, empty state, toggle simples |
| M | 3-8 h | Novo módulo, audit sistemática, refator moderado |
| L | 8-24 h | Setup CI complexo, VM-test baseline, factory para todos serviços |
| XL | 24h+ | Fork de dependência, rewrite de core |

---

> **Nota final:** Este plano cobre ~40 tarefas. Não precisa fazer todas. A beleza
> de projeto pessoal é que **você escolhe o que te dá mais alegria**. Se a
> diversão está em escrever um capability registry, vai fundo. Se é polir a a11y,
> perfeito. O plano existe para você conseguir **escolher o que encarar a cada
> sessão** sem se perder.
