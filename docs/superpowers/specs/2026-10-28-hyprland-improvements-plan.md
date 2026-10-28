# Plano: melhorias do Hyprland no dshell

> Estado de referência: Hyprland 0.56.2, config gerada em `nix/hyprland/default.nix`
> (+ `binds.nix`, `layouts.nix`, layer rules em `nix/module.nix`). Hosts consumidores:
> `dvision-homelab` (AMD, desktop: FLAT DP-2 rotacionado + ASUS DP-3) e
> `dvision-thinkbook` (Intel, eDP-1 + docking). Toda sintaxe abaixo foi aceita por
> `Hyprland --verify-config` 0.56.2 em 2026-10-28.

## Status da implementação (2026-10-28)

Fases 1–7 implementadas. A config gerada (VM e homelab) passa em `--verify-config`; os testes passam.
Ainda falta validar em runtime, numa sessão real. Desvios do plano:

- **Fase 0 não feita**: não havia sessão inspecionável. As classes de janela vieram dos `.desktop` e dos app-ids conhecidos.
  Confirmar com `hyprctl clients -j` e ajustar se algum diálogo não flutuar.
- **Fase 4**: o lockscreen usa `gtk4-session-lock`, e não layer-shell, então nenhuma `layerrule` se aplica a ele.
  O namespace `selection` (morto) foi removido. Namespaces novos: `shade-{bar,dock,quicksettings,launcher,notifications,osd,switcher,recording,recording-boundary,screenshot,wallpaper}`.
- **Fase 6**: o hyprexpo não existe mais no 0.56 e o Hyprspace não compila contra o 0.56.2. Foi usado o **hyprtasking**
  (`overview.enable`, padrão `false`). O plugin é recompilado contra `programs.hyprland.package`.
  Ele é carregado via `exec-once`, depois do parse da config, por isso os binds usam `exec hyprctl dispatch …`: um dispatcher do
  plugin direto no bind geraria erro de config (overlay vermelho) em todo login. O gesto de 4 dedos para cima fica desligado
  (`overview.gesture`), porque conflita com o scratchpad.
- **Fase 7**: campos `bitdepth`, `cm`, `sdrbrightness` e `sdrsaturation` adicionados aos layouts (Nix e shell). Nenhum host os ativa ainda.

## Princípios

- Defaults vão em `defaultSettings` (sobrescrevíveis via `programs.shade.desktop.hyprland.settings`).
  Comportamento que alguém pode querer desligar ganha **opção própria** (`lib.mkEnableOption`), não flag escondida.
- Cada fase é um commit isolado e reversível.
- Verificação mínima de toda fase:
  1. `nix build .#nixosConfigurations.vm-vnc.config.environment.etc."xdg/hypr/hyprland.conf".source`
     e `Hyprland --verify-config -c <arquivo>` → `config ok`;
  2. smoke no host real após `nixos-rebuild switch` + `hyprctl reload` (ou na VM, ver `docs/vm-radio-testing.md`
     e a nota de `pci.0` → `pcie.0`/`-machine pc` no harness);
  3. checagem específica listada em cada fase.

## Fase 0 — Inventário de comportamento atual (pré-requisito, ~30 min)

Objetivo: ter um "antes" para comparar.

- Capturar `hyprctl -j getoption` das opções tocadas, `hyprctl layers -j`, `hyprctl clients -j` com os apps usuais
  (Zen, kitty, Nautilus, pwvucontrol, diálogo de arquivo do portal, polkit).
- Gravar um vídeo curto (`wf-recorder`/gravação do shell) de: abrir/fechar janela, trocar workspace,
  abrir scratchpad, abrir quick settings/launcher/notificação.
- Saída: `docs/superpowers/specs/assets/hyprland-baseline/` (não versionar vídeos grandes; anotar caminho).

## Fase 1 — Correções da config atual (baixo risco)

| # | Mudança | Arquivo | Aceite |
|---|---------|---------|--------|
| 1.1 | `swallow_regex` gerado a partir de `desktopCfg.defaultTerminal` (ex.: `^(kitty)$`, escapando a classe); manter `enable_swallow` | `default.nix` | `kitty -e mpv x.mp4`: terminal some e volta ao fechar o mpv |
| 1.2 | Regra padrão `monitor = ", preferred, auto, 1"` (era `auto-left, auto`) | `default.nix` | Monitor desconhecido entra à direita, escala 1; eDP não fica em 1.5 antes do LayoutService aplicar |
| 1.3 | `cursor.no_hardware_cursors` vira opção `hyprland.softwareCursor` (default `false`) | `default.nix` + hosts que precisarem | Homelab (AMD) e thinkbook (Intel) com cursor por hardware sem artefatos |
| 1.4 | Remover `~/.config/hypr/monitors-hdr.conf` órfão (DP-4, não é `source`d) — é arquivo do usuário, só documentar/pedir | — | Nada referencia o arquivo |
| 1.5 | `kb_layout = "us"` no default vs `br/abnt2` nos hosts: manter, mas expor `input.kb_*` no doc do módulo | `docs/` | — |

Risco: 1.2 muda posição de monitores *sem* layout salvo; mitigado pelo fallback de layouts lembrados (commit `69c9a15`).

## Fase 2 — Regras de janela (maior ganho de UX)

Nova opção `programs.shade.desktop.hyprland.windowRules.enable` (default `true`) + lista
`extraWindowRules` para hosts. Regras em um bloco `windowrule = [...]` separado, comentado por grupo.

| Grupo | Regras | Aceite |
|-------|--------|--------|
| Diálogos | `float`, `center` para: `com.saivert.pwvucontrol`, `org.gnome.Nautilus` com título de diálogo, `xdg-desktop-portal-gtk`, `polkit-gnome-authentication-agent-1`, `nm-connection-editor`, `blueman-manager`, títulos `^(Open File|Save As|Abrir arquivo|Salvar como).*` | Abrir "Salvar como" no Zen → flutua centralizado |
| PiP | `float`, `pin`, `size 480 270`, `move` para canto inferior direito (respeitando `gaps_out`), `keep_aspect_ratio` — `match:title ^(Picture-in-Picture)$` | PiP do Zen acompanha troca de workspace |
| Idle | `idle_inhibit fullscreen, match:class .*` | Vídeo em fullscreen > timeout do hypridle não bloqueia (testar com timeout reduzido) |
| Eventos | `suppress_event maximize, match:class .*` | Apps que pedem maximize (ex.: alguns Electron) continuam tiled |
| Janela única | `workspace = w[tv1], gapsout:0, gapsin:0` + `border_size 0`/`rounding 0` para `match:float false, match:workspace w[tv1]` (atrás de opção `hyprland.smartGaps`, default `false` até validar com o visual da barra) | Uma janela tiled ocupa a área útil sem borda; com 2+ volta ao normal |

Pendência a resolver na implementação: confirmar as `class` reais com `hyprctl clients -j` (Fase 0) — não chutar.

## Fase 3 — Animações estilo Adwaita

- Substituir as 6 linhas `default` por curvas nomeadas:
  - `bezier = adw, 0.25, 0.1, 0.25, 1` (ease-out padrão libadwaita)
  - `bezier = emphasized, 0.05, 0.7, 0.1, 1` (entrada enfática)
- Mapa proposto:

| Animação | Curva/velocidade | Estilo |
|----------|------------------|--------|
| windowsIn | emphasized, 4 | popin 85% |
| windowsOut | adw, 3 | popin 90% |
| windowsMove | emphasized, 4 | slide |
| fade | adw, 3 | — |
| border | adw, 6 | — |
| layersIn / layersOut | emphasized 3 / adw 2 | fade |
| fadePopups | adw, 3 | — |
| workspaces | emphasized, 4 | slidefadevert 15% |
| specialWorkspace | emphasized, 4 | slidefadevert 20% |
| monitorAdded | adw, 5 | — |

- Opção `hyprland.animations.preset = "adwaita" | "minimal" | "off"` (`minimal` = só fades curtos;
  `off` = `animations.enabled = false`) — acessibilidade/“reduzir movimento”. Considerar ligar ao
  `gtk-enable-animations` / setting de reduzir movimento do shell numa fase futura.
- Aceite: comparação lado a lado com o vídeo da Fase 0; nenhuma animação > 400 ms percebidos.

## Fase 4 — Animações por superfície do shell (exige mudança no shell)

Hoje quase toda janela do shell usa o namespace padrão `gtk4-layer-shell` (só `quicksettings`
e `PopupWindow` definem o seu), então `layerrule` não consegue diferenciá-las.

1. Shell: definir `namespace` explícito e estável em cada janela: `shade-bar`, `shade-quicksettings`,
   `shade-launcher`, `shade-notifications`, `shade-osd`, `shade-switcher`, `shade-lock`, `shade-dock`
   (`packages/widgets/src/**`; PopupWindow já usa `name`).
2. Nix: trocar o `blur`/`ignore_alpha` de `match:namespace gtk4-layer-shell` por
   `match:namespace ^shade-` (`nix/module.nix`).
3. Layer rules:
   - `shade-quicksettings`: `animation slide` sem direção — a posição da barra é runtime (GSettings),
     então não dá para gerar a direção em Nix. **A verificar**: se o Hyprland escolhe a borda pela
     âncora da layer; se não, o shell troca a regra via `hyprctl keyword layerrule` ao mudar a posição.
   - `shade-launcher`: `animation popin 90%`.
   - `shade-notifications`: `animation slide`.
   - `shade-osd`: `animation fade`.
   - `shade-lock`: `no_anim on` (o lock deve aparecer instantaneamente).
4. Aceite: `hyprctl layers -j` mostra os namespaces novos; blur continua na barra; lock sem animação.

Risco: o namespace é usado em outros lugares (screenshots, testes VM, `hyprctl layers` em scripts) —
fazer `grep` por `gtk4-layer-shell` antes e migrar todos os consumidores no mesmo commit.

## Fase 5 — Recursos pouco usados

| # | Recurso | Mudança | Aceite |
|---|---------|---------|--------|
| 5.1 | Grupos/abas | Estilizar `group.groupbar` (font_size 11, `gradients false`, cores Adwaita, `rounding`), binds `moveintogroup l/r/u/d`, `moveoutofgroup`, `lockactivegroup` em `binds.nix` | Grupo com 3 janelas mostra abas legíveis; mover para dentro/fora funciona |
| 5.2 | Binds | `binds.workspace_back_and_forth = true`, `allow_workspace_cycles = true` | SUPER+1 duas vezes volta ao workspace anterior |
| 5.3 | Gestos | `gesture = 4, pinch, fullscreen`; `gestures.workspace_swipe_forever = true`; revisar `workspace_swipe_cancel_ratio` | No thinkbook: pinça de 4 dedos alterna fullscreen |
| 5.4 | Cursor | `hide_on_key_press = true`, `inactive_timeout = 5` (opção) | Cursor some ao digitar |
| 5.5 | Zoom (acessibilidade) | binds `SUPER+scroll` → `cursor:zoom_factor` via `hyprctl keyword` com limites | Zoom in/out e reset |
| 5.6 | Jogos | `render.direct_scanout = 2` (auto) | Jogo fullscreen sem regressão de tearing/flicker no homelab |

Os binds novos precisam aparecer no painel de atalhos do shell (`packages/services/src/input/keybinds.ts`
lê `hyprctl binds -j`; usar `bindd` com descrição) e não colidir — rodar `shade-keybinds` (detecta duplicatas).

## Fase 6 — Overview de workspaces (opcional, decisão de produto)

- Plugin oficial **hyprexpo** via `programs.hyprland.plugins` (precisa casar com a versão exata do Hyprland:
  hoje o pacote vem do nixpkgs, então usar `pkgs.hyprlandPlugins.hyprexpo`).
- Gesto `4, up` / bind `SUPER+grave` para abrir.
- Alternativa sem plugin: overview desenhado pelo próprio shell (já existe window switcher) — mais trabalho,
  sem acoplamento de ABI. Decidir antes de implementar.
- Aceite: atualização do Hyprland não quebra o login (plugin falhando não pode impedir a sessão).

## Fase 7 — HDR/cor por monitor (opcional)

- Levar HDR do monitor ASUS para o modelo de layout (`layouts.nix` ganha `bitdepth`/`cm`/`sdrbrightness`),
  e o `renderMonitorSpec` do LayoutService passa a emitir esses campos.
- Pré-requisito: confirmar suporte HDR do VG34WQML5A e do driver amdgpu no homelab.

## Ordem e dependências

```
Fase 0 ─┬─> Fase 1 ─> Fase 2 ─> Fase 3 ─> Fase 4 (shell + nix)
        └─> Fase 5 (independente após Fase 1)
Fase 6, Fase 7: só após decisão do usuário
```

## Fora de escopo

- Migração para config Lua do Hyprland (0.56 ainda suporta hyprlang; reavaliar quando houver aviso de depreciação).
- Trocar a fonte do pacote Hyprland (nixpkgs → flake).
