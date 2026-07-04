# Roadmap Shade Shell

> **Versão atual:** `0.2.1` · **Branch:** `fix/review-sprint1`
> **Status:** Pós-revisão multidisciplinar — remediação em andamento.

---

## Posicionamento

**Shade Shell** is a personal, power-user desktop shell for Hyprland — not a
general-purpose desktop environment. It prioritizes:

- **Deep Hyprland integration** — native IPC, gestures, Layer Shell, screencopy
- **Visual polish** — Libadwaita HIG, Material You dynamic theming, thoughtful typography
- **Developer extensibility** — GJS runtime, Gnim reactivity, JSX widgets, D-Bus API
- **Performance and correctness** — no polling, no canvas rendering, proper signal lifecycle

It is **not** a GNOME Shell replacement, KDE Plasma alternative, or mass-market
product. It is a crafted tool for people who want Hyprland with a GTK4/Adwaita shell.

---

## Critérios para `1.0.0`

Estes gates definem quando `0.x` → `1.0.0`. Todos devem ser verdes.

| # | Critério | Status | Detalhes |
|---|----------|--------|----------|
| 1 | **Zero leaks de sinais GObject** | ✅ | Auditado. Todos os widgets usam `connectFor` + `onCleanup`. |
| 2 | **`dispose()` em 100% dos serviços** | 🟡 Em andamento | Theming ✅ — restam: colorScheme, fingerprint, notificationHistory, weather, powerProfiles |
| 3 | **Testes para serviços críticos** | 🟡 Em andamento | hypridle ✅ — faltam: screenshot, nightLight, weather, theming |
| 4 | **Bugs sistêmicos do POSTMORTEM corrigidos** | 🟡 Em andamento | SSID Uint8Array: documentado + `toArray` com log. GIR type narrowing: em andamento. |
| 5 | **7 dias de uso contínuo sem RSS growth anormal** | ⬜ Não testado | Medir baseline antes/depois. |
| 6 | **VM-test green** | ⬜ Não verificado | CI precisa de execução estável. |
| 7 | **a11y básica** (accessibleLabel em botões ícone-only) | 🟡 Em andamento | Bar indicators em progresso. QuickSettings pendente. |

---

## Próximos Marcos

### Sprint 1 (concluído) — Correções Críticas
- [x] **Q1-Q5**: freezeProcess leak, pkill global, print→logger, toArray log, screenshot dir
- [x] **Q6-Q7**: DND accumulation, lockscreen notification gating + display
- [x] **F1**: connectFor helper with tests
- [x] **L1**: Signal leak audit (14 widgets)
- [x] **P2**: pin gnim 1.9.1
- [x] **O3**: perf traces on D-Bus actions
- [x] **L4**: Theming dispose (subscriptions, debounce, CSS cleanup)

### Sprint 2 — Fundação de Qualidade
- [ ] **U1**: a11y accessibleLabel em todos os botões ícone-only
- [ ] **L3**: dispose() nos serviços restantes (colorScheme, fingerprint, notificationHistory, weather, powerProfiles)
- [ ] **P1**: este documento + ADR de dependências + posicionamento
- [ ] **F2**: async test-runner
- [ ] **O1**: capability registry
- [ ] **O2**: shade --diagnostics
- [ ] **P6**: tabela única de roteamento D-Bus

### Sprint 3 — Testes + Observabilidade
- [ ] **T1**: Screenshot tests (start/stop/dispose state machine)
- [ ] **T2**: NightLight tests (clamp, schedule, dispose)
- [ ] **T3**: Weather tests (parsing, error)
- [ ] **T4**: Theming tests (apply, clear, dispose)
- [ ] **T8**: VM-test baseline (screenshot + RSS)
- [ ] **U2-U4**: empty states, list caps, notification windowing

### Sprint 4 — UX + Polimento
- [ ] **Sistema de widgets na lockscreen**
- [ ] **U5-U6**: reduced-motion CSS, prefixo shade-
- [ ] **E1**: memcheck CI
- [ ] **E6**: shade --version

---

## ADR: Estratégia de Dependências

### Contexto
Shade depende de Astal (aylur), Gnim (aylur) e GJS (GNOME). Astal e Gnim são
single-author. GJS é multi-author com baixo risco de EOL (SpiderMonkey é ativamente
mantido pela Mozilla e GNOME).

### Decisão
1. **Pin explícito**: `gnim` fixado em `1.9.1` no `package.json`. Atualizações
   manuais após testar compatibilidade em VM.
2. **Flake.lock versionado**: `astal` via flake, não via caret range — o lock
   protege contra breaking.
3. **Monitoramento ativo**: seguir releases e issues de Astal/Gnim. Se
   mantenedor ficar inativo >6 meses, considerar fork do subset crítico.
4. **Compat layer**: não criar abstração adicional hoje — o acoplamento com
   Astal é direto e justificado pelo tamanho do projeto.

### Consequências
- Positivo: estabilidade, sem surpresas em `nix flake update`
- Negativo: atualizações manuais e atraso em pegar correções upstream
- Risco: se ambos os projetos forem abandonados, Shade para de evoluir