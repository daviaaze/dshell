# GTK4/Libadwaita Styling Reference & Migrations

## 1. Inventário completo de classes libadwaita

### Layout & Containers
| Classe | Função | Substitui |
|--------|--------|-----------|
| `.card` | `background`, `border-radius: 9px`, `padding: 12px`, cor de surface | `useStyle({padding:'12px'})`, margins manuais |
| `.frame` | `border: 1px solid var(--border-color)` | `css={'border:...'}` |
| `.background` | `bg: --window-bg-color, fg: --window-fg-color` | `css={'background-color:...'}` |
| `.view` | `bg: --view-bg-color, fg: --view-fg-color` | backgrounds custom |
| `.boxed-list` | Lista com padding interno + separadores | `marginTop` entre rows + `spacing` |
| `.boxed-list-separate` | Cada row = card separado | cards individuais + margins |
| `.toolbar` | `6px` spacing/margins entre filhos, botões flat | `spacing={8}` em barras horizontais |
| `.linked` | Controles visualizados como grupo | `spacing={0}` + botões juntos |
| `.spacer` | Separator invisível para toolbars | `marginTop/Bottom` em toolbars |
| `.menu` | Popover com aparência de menu | popover styling |
| `.inline` | SearchBar/TabBar com fundo neutro | headers custom |
| `.navigation-sidebar` | Itens arredondados + padded, sem bg | sidebar styling |
| `.compact` | StatusPage menos espaço | sizing manual |

### Botões
| Classe | Função |
|--------|--------|
| `.suggested-action` | Botão accent (ação principal) |
| `.destructive-action` | Botão vermelho (ação perigosa) |
| `.flat` | Botão transparente (só texto/icone) |
| `.raised` | Botão com relevo (dentro de toolbars) |
| `.circular` | Botão redondo |
| `.pill` | Botão comprimido |
| `.opaque` | Botão com bg sólido (deprecated, usar `.suggested-action`) |

### Tipografia
| Classe | Função |
|--------|--------|
| `.title-1` a `.title-4` | 4 níveis de título (1=maior) |
| `.heading` | Heading padrão (tamanho normal) |
| `.body` | Texto de alta legibilidade |
| `.document` | Fonte grande (docs/long text) |
| `.caption` | Texto menor |
| `.caption-heading` | Heading pequeno |
| `.monospace` | Fonte mono |
| `.numeric` | Tabular figures (números alinhados) |

### Cores/Semântica
| Classe | Função |
|--------|--------|
| `.accent` | Usa accent color |
| `.success` | Verde (validação ok) |
| `.warning` | Amarelo (atenção) |
| `.error` | Vermelho (erro) |
| `.dimmed` | `opacity: var(--dim-opacity)` |
| `.dim-label` | **(deprecated)** → usar `.dimmed` |
| `.activatable` | Hover/active states em cards |
| `.property` | ActionRow: título fraco, subtitle forte |
| `.selection-mode` | CheckButton grande e redondo |
| `.osd` | Fundo escuro semi-transparente, accent white |
| `.devel` | HeaderBar listrada (dev builds) |
| `.icon-dropshadow` | Sombra em ícones |
| `.lowres-icon` | Sombra em ícones 32x32 ou menores |
| `.undershoot-top/bottom/start/end` | Indicador de scroll |

---

## 2. CSS Variables do libadwaita

### Cores de UI
| Variável | Uso |
|----------|-----|
| `--accent-bg-color` | Fundo accent |
| `--accent-fg-color` | Texto sobre accent |
| `--accent-color` | Accent standalone |
| `--destructive-bg-color` | Fundo destrutivo |
| `--destructive-fg-color` | Texto sobre destrutivo |
| `--destructive-color` | Destructive standalone |
| `--success-bg-color` | Fundo success |
| `--success-fg-color` | Texto sobre success |
| `--success-color` | Success standalone |
| `--warning-bg-color` | Fundo warning |
| `--warning-fg-color` | Texto sobre warning |
| `--warning-color` | Warning standalone |
| `--error-bg-color` | Fundo error |
| `--error-fg-color` | Texto sobre error |
| `--error-color` | Error standalone |

### Cores de Container
| Variável | Uso |
|----------|-----|
| `--window-bg-color` | Fundo da janela |
| `--window-fg-color` | Texto da janela |
| `--view-bg-color` | Fundo de views |
| `--view-fg-color` | Texto de views |
| `--card-bg-color` | Fundo de cards |
| `--card-fg-color` | Texto de cards |
| `--card-shade-color` | Separações em boxed-list |
| `--headerbar-bg-color` | Fundo de header bars |
| `--headerbar-fg-color` | Texto de header bars |
| `--headerbar-border-color` | Borda vertical de header bars |
| `--headerbar-backdrop-color` | Header bar sem foco |
| `--headerbar-shade-color` | Sombra de header bars |
| `--sidebar-bg-color` | Fundo de sidebars |
| `--sidebar-fg-color` | Texto de sidebars |
| `--sidebar-backdrop-color` | Sidebar sem foco |
| `--sidebar-border-color` | Borda de sidebars |
| `--sidebar-shade-color` | Sombra de sidebars |
| `--secondary-sidebar-bg-color` | Fundo de sidebars secundárias |
| `--secondary-sidebar-fg-color` | Texto de sidebars secundárias |
| `--thumbnail-bg-color` | Fundo de thumbnails |
| `--thumbnail-fg-color` | Texto de thumbnails |

### Opacidade
| Variável | Uso |
|----------|-----|
| `--dim-opacity` | Opacidade do `.dimmed` |

### Fontes
| Variável | Uso |
|----------|-----|
| `--document-font` | Fonte de documentos |
| `--monospace-font` | Fonte monospace |

### Cores de accent disponíveis
`--accent-blue`, `--accent-teal`, `--accent-green`, `--accent-yellow`, `--accent-orange`, `--accent-red`, `--accent-pink`, `--accent-purple`, `--accent-slate`

---

## 3. Componentes Adw/Astal relevantes

| Componente | Quando usar |
|------------|-------------|
| `Adw.Clamp` | Limita largura do conteúdo com padding responsivo |
| `Adw.Leaflet`/`Adw.Flap` | Layouts responsivos (mobile-friendly) |
| `Adw.ExpanderRow` | Rows expansíveis (substitui reveals manuais) |
| `Adw.EntryRow` | Entry com título integrado |
| `Adw.ActionRow` | Row com título + subtitle + prefix/suffix widgets |
| `Adw.SwitchRow` | ActionRow com switch |
| `Adw.ComboBoxRow` | ActionRow com dropdown |
| `Adw.ButtonRow` | Row clicável |
| `Adw.PreferencesGroup` | Agrupa rows com título/opcional descrição |
| `Adw.PreferencesWindow` | Janela de preferências padrão |
| `Adw.ToastOverlay` | Container para toasts/notificações |
| `Adw.Toast` | Notificação transitória |
| `Adw.TabOverview` | Overview de abas |
| `Adw.TabView` | Sistema de abas |
| `Adw.NavigationSplitView` | Split view com sidebar |
| `Adw.OverlaySplitView` | Split view overlay |
| `Adw.StatusPage` | Página de status (vazio, erro) |
| `Adw.Avatar` | Avatar com iniciais |
| `Adw.Bin` | Container simples |
| `Adw.Carousel` | Carrossel horizontal |
| `Adw.CarouselIndicatorDots` | Indicador do carrossel |
| `Adw.CarouselIndicatorLines` | Indicador do carrossel |
| `Adw.SplitButton` | Botão com menu dropdown |
| `Adw.EntryRow` | Entry com label |
| `Adw.PasswordEntryRow` | Entry de senha |
| `Adw.SearchRow` | Row de busca |
| `Adw.SpinRow` | Row com spin button |
| `Adw.Window` | Janela base com suporte a dim-blur |
| `Adw.Application` | App com initialização libadwaita |
| `Astal.Window` | Janela base Astal (mais simples) |

---

## 4. Mapeamento de migração (repo shade-shell)

### A. `useStyle({padding})` → `.card`

**Achado**: ~8 usos de `useStyle` são só padding que `.card` já fornece.

| Arquivo | Linha | Atual | Vira |
|---------|-------|-------|------|
| `common/audioControl.tsx:25` | `useStyle({padding: '8px'})` | `cssClasses={['card']}` |
| `quicksettings/sliders.tsx:58` | `useStyle({padding: '8px'})` | `cssClasses={['card']}` |
| `common/weatherForecast.tsx:73` | `useStyle({padding: '8px'})` | `cssClasses={['card']}` |
| `common/weatherWidget.tsx:131` | `useStyle({marginTop: '4px', marginBottom: '4px'})` | avaliar se `.card` resolve |

### B. Margins entre itens de lista → `.boxed-list`

| Arquivo | Padrão atual | Vira |
|---------|-------------|------|
| `quicksettings/index.tsx` | `Gtk.Box` com `spacing={12}` + `margin: 12px` | `Gtk.ListBox` com `.boxed-list` |
| `notificationList.tsx` | `HistoryItem` com `marginBottom` | container `.boxed-list` |
| `lockscreen/notifications.tsx` | cards com margins | `.boxed-list-separate` |

### C. CSS inline desnecessário → classes

| Arquivo | CSS inline | Vira |
|---------|-----------|------|
| `notification.tsx:213` | `padding: 12px; margin: 12px; box-shadow: none;` | `.card` (padding já incluso) |
| `osd/index.tsx:87` | `box-shadow: none; border: none; padding: 12px;` | `.background` ou `.osd` |
| `recording-bar/index.tsx:43` | `box-shadow: none; padding: 6px 12px;` | `.background` ou `.osd` |
| `quicksettings/index.tsx:52` | `box-shadow: none; border: none;` | remover `.card` se não quer visual de card |

### D. Margins manuais para posicionamento → manter com comentário

| Tipo | Exemplo | Ação |
|------|---------|------|
| Posicionamento contextual | `marginTop={position.as(...)}` | **Manter** |
| Offset hierárquico | `marginStart={28}` (indentação) | **Manter** |
| Gap entre seções | `marginTop={12}` entre componentes distintos | **Manter** |

---

## 5. Plano de migração controlada

### Fase 1 — QuickSettings (mais impacto visual)
1. Converter container principal para `Gtk.ListBox` + `.boxed-list`
2. Trocar `BrightnessSlider` e `AudioEndpointControl` pra `.card`
3. Trocar `Battery`, `Calendar`, `Weather` pra `.boxed-list` rows
4. Remover margins manuais que `.boxed-list` já resolve

### Fase 2 — Notificações
1. Usar `Adw.ToastOverlay` + `Adw.Toast` se fizer sentido
2. Ou converter container pra `.boxed-list-separate`
3. Remover `css` inline da notificação

### Fase 3 — Popups (OSD, Recording Bar)
1. Usar `.osd` class pra fundo escuro semi-transparente
2. Remover `box-shadow: none` inline
3. Usar `.background` quando aplicar

### Fase 4 — Applauncher
1. Converter lista de apps pra `.boxed-list` ou `.navigation-sidebar`
2. Remover margins manuais

### Fase 5 — Dock
1. Avaliar `.toolbar` pro dock horizontal
2. Avaliar `.linked` pros itens

### Fase 6 — Logger/Clean-up
1. Auditar usos restantes de `useStyle` — mover pros `--shade-*` vars quando possível
2. Remover `css` inline que não são necessários
3. Documentar decisões

---

## 6. Como executar migrações em batch

### Substituição via sed (cuidadoso)
```bash
# useStyle padding → .card
find packages apps -name "*.tsx" -exec sed -i \
  "s/useStyle({padding: '8px'})/useStyle({}); cssClasses={['card']}/g" {} +

# css={'box-shadow: none'} → remover se .card também removido
# css={'padding: 12px; margin: 12px;'} → .card
```

### Usando `style-classes.md` como referência
Toda classe listada no documento do GNOME pode ser aplicada via `cssClasses={[...]}` no JSX/TSX.

### Validação pós-migração
```bash
npx tsc --noEmit        # TypeScript OK
npx @biomejs/biome check .  # Lint OK
# Testar visualmente:
# - Cantos arredondados onde é card
# - Padding consistente
# - Sem bordas duplas
# - Sem margins colapsados
```

---

## 7. Cuidados

1. **`.card` dentro de `.boxed-list`** — padding dobrado. Ou usa um ou outro, não ambos.
2. **`box-shadow: none` inline** — se precisa tirar, avalie se deve usar `.card` ou não.
3. **`margin` vs `padding`** — margin é espaço externo (entre elementos), padding é espaço interno (dentro do elemento). Use padding pra "respiro interno" e margin pra "distância entre elementos".
4. **`.boxed-list` requer `selection-mode: none`** no ListBox.
5. **`spacing={0}` é mandatory pra `.linked`** funcionar.
