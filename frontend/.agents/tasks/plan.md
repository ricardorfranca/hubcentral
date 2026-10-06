# Implementation Plan — Menu lateral recolhível (Item 1) + Modo foco do projeto (Item 2)

Contexto verificado durante a exploração:
- Frontend: React 18 + TypeScript + Vite + MUI v6 (`@mui/material`/`@mui/icons-material` ^6.4.0), zustand ^5, react-router-dom v7, @tanstack/react-query v5.
- Convenção de imports: sufixo `.js` em arquivos locais TS/TSX (ex.: `import { Shell } from "./Shell.js"`). Seguir exatamente.
- Comentários e textos de UI em português; cabeçalhos JSDoc `@file`/`@module` no topo de cada arquivo.
- Padrão de nomes de chave em localStorage no projeto: prefixo `hubcentral.*` (ex.: `hubcentral.branding`). O ambiente de teste já injeta um `localStorage` funcional em `src/test/setup.ts`, então ler/escrever localStorage não quebra os testes.
- Nenhum teste existente cobre `Shell.tsx` nem `ProjectDetailPage.tsx` (confirmado por busca). Portanto, não é necessário adicionar testes novos; apenas não quebrar os 4 arquivos / 14 testes existentes.
- Baseline verde confirmado antes do plano: `npm run typecheck` e `npm run test` passam (14/14).
- Todos os comandos de verificação rodam a partir de `/Users/ricardofranca/HUB Central/frontend`.

Decisões de design (sem documento de design aprovado, decididas aqui):
- Item 1: manter o estado recolhido/expandido como **estado local do componente `Shell`** inicializado de forma preguiçosa a partir do localStorage (o enunciado permite; evita acoplar a um store zustand global para uma preferência puramente de layout). Chave: `hubcentral.sidebar.collapsed`, valor `"1"`/`"0"`.
- Item 1: o drawer temporário (mobile, `xs`) **não muda** — sempre mostra o conteúdo expandido completo. O recolhimento aplica-se só ao drawer permanente (`sm+`).
- Item 1: no modo recolhido, separar grupos por `<Divider />` (já que os `ListSubheader` ficam ocultos) e envolver o ícone de cada item num `<Tooltip placement="right">` com o rótulo do item.
- Item 2: "Modo foco" como `ToggleButton` MUI com `Tooltip` e `aria-label` em português; estado local inicializado preguiçosamente do localStorage, chave **por projeto** `hubcentral.projetos.focus.<id>` (`"1"`/`"0"`). Ao mudar o `id` da rota, o estado efetivo reflete o valor salvo daquele projeto.
- Largura efetiva do drawer: `const drawerWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;` usada tanto no `Box component="nav"` quanto no `Box component="main"` e nos `MuiDrawer-paper`.

---

## Item 1 — Menu lateral recolhível (`src/app/Shell.tsx`)

- [ ] 1. Adicionar a constante de largura recolhida e o estado de recolhimento persistido.
      No topo do arquivo, abaixo de `const DRAWER_WIDTH = 248;`, adicionar `const COLLAPSED_WIDTH = 64;` e `const SIDEBAR_KEY = "hubcentral.sidebar.collapsed";`.
      Dentro de `Shell`, adicionar estado local inicializado preguiçosamente do localStorage com guarda de `window`:
      `const [collapsed, setCollapsed] = useState<boolean>(() => { try { return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; } });`
      Adicionar um handler de toggle que grava no localStorage:
      `const toggleCollapsed = () => setCollapsed((v) => { const next = !v; try { window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch { /* ignora */ } return next; });`
      Computar a largura efetiva do drawer permanente: `const drawerWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;`.
      Files: `src/app/Shell.tsx`
      Verify: `npm run typecheck` passa (sem erros TS).

- [ ] 2. Importar os ícones de recolher/expandir usados no botão de toggle.
      Adicionar `import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";` e `import ChevronRightIcon from "@mui/icons-material/ChevronRight";` junto aos demais imports de ícones (`@mui/icons-material/*`).
      Files: `src/app/Shell.tsx`
      Verify: `npm run typecheck` passa.

- [ ] 3. Parametrizar o conteúdo do drawer (`drawer`) para suportar os modos recolhido e expandido, mantendo o mobile sempre expandido.
      Converter a constante `drawer` numa função que recebe se está recolhido, por ex. `const renderDrawer = (isCollapsed: boolean) => ( ... )`, para que o drawer temporário (mobile) seja chamado com `renderDrawer(false)` e o permanente com `renderDrawer(collapsed)`.
      Dentro de `renderDrawer`:
      - No `Toolbar` do topo, adicionar o botão de toggle (visível só no drawer desktop; como o mobile sempre chama `renderDrawer(false)`, basta renderizar o botão sempre — ele só aparece no permanente porque o temporário recebe `isCollapsed=false` e o botão de toggle não deve aparecer no mobile; para garantir, envolver o `IconButton` com `sx={{ display: { xs: "none", sm: "inline-flex" } }}`). O botão usa `onClick={toggleCollapsed}`, `aria-label={isCollapsed ? "expandir menu" : "recolher menu"}`, e ícone `isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />`. Quando `isCollapsed`, ocultar o `Typography` do nome do sistema (ex.: renderizar o título só quando `!isCollapsed`).
      - Para cada grupo (`menuGroups.map`): quando `isCollapsed`, não passar `subheader` ao `List` e, para `gi > 0`, manter a separação visual com borda/`Divider` (a borda `borderTop` já existente em `sx` para `gi > 0` cobre o requisito de separador quando recolhido; manter). Quando `!isCollapsed`, manter o `ListSubheader` atual.
      - Em cada `ListItemButton`: quando `isCollapsed`, não renderizar `<ListItemText>`; aplicar `sx={{ justifyContent: "center", px: 2.5 }}` ao botão e `sx={{ minWidth: 0, mr: "auto", justifyContent: "center" }}` ao `ListItemIcon`; envolver o `ListItemIcon`/ícone num `<Tooltip title={entry.label} placement="right">`. Quando `!isCollapsed`, manter `ListItemText` e o layout atual (sem Tooltip).
      Files: `src/app/Shell.tsx`
      Verify: `npm run typecheck` passa.

- [ ] 4. Fazer o nav e o main reagirem à largura efetiva, e os drawers usarem `renderDrawer`.
      No `Box component="nav"`: trocar `width: { sm: DRAWER_WIDTH }` por `width: { sm: drawerWidth }`.
      No `Drawer variant="temporary"`: manter `"& .MuiDrawer-paper": { width: DRAWER_WIDTH }` (mobile fixo expandido) e passar `{renderDrawer(false)}`.
      No `Drawer variant="permanent"`: trocar o paper para `"& .MuiDrawer-paper": { width: drawerWidth, overflowX: "hidden", transition: (t) => t.transitions.create("width", { duration: t.transitions.duration.shorter }) }` e passar `{renderDrawer(collapsed)}`.
      No `Box component="main"`: trocar `width: { sm: \`calc(100% - ${DRAWER_WIDTH}px)\` }` por `width: { sm: \`calc(100% - ${drawerWidth}px)\` }`.
      Files: `src/app/Shell.tsx`
      Verify: `npm run typecheck` passa e `npm run build` conclui sem erros (tsc -b && vite build).

---

## Item 2 — Modo foco do projeto (`src/modules/projetos/ProjectDetailPage.tsx`)

- [ ] 5. Adicionar imports e constante de chave do localStorage.
      Adicionar aos imports de `@mui/material` os componentes `ToggleButton` e `Tooltip`. Adicionar os imports de ícones `import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";` (foco ligado) e `import CenterFocusWeakIcon from "@mui/icons-material/CenterFocusWeak";` (foco desligado) — ou usar um único ícone alternando por estado.
      Adicionar a função utilitária de chave perto do topo do módulo: `const focusKey = (projectId: string) => \`hubcentral.projetos.focus.${projectId}\`;`.
      Files: `src/modules/projetos/ProjectDetailPage.tsx`
      Verify: `npm run typecheck` passa.

- [ ] 6. Adicionar o estado "Modo foco" por projeto, inicializado preguiçosamente e sincronizado quando o `id` muda.
      Dentro de `ProjectDetailPage`, após os demais `useState`, adicionar:
      `const [focus, setFocus] = useState<boolean>(() => { try { return typeof window !== "undefined" && window.localStorage.getItem(focusKey(id)) === "1"; } catch { return false; } });`
      Adicionar um `useEffect` que, quando `id` muda, relê o valor salvo daquele projeto:
      `useEffect(() => { try { setFocus(window.localStorage.getItem(focusKey(id)) === "1"); } catch { setFocus(false); } }, [id]);` (importar `useEffect` de `react`).
      Adicionar o toggle que persiste:
      `const toggleFocus = () => setFocus((v) => { const next = !v; try { window.localStorage.setItem(focusKey(id), next ? "1" : "0"); } catch { /* ignora */ } return next; });`
      Observação: a inicialização preguiçosa roda uma vez; o `useEffect` cobre tanto a troca de rota quanto o caso em que `id` chega vazio no 1º render e é preenchido depois.
      Files: `src/modules/projetos/ProjectDetailPage.tsx`
      Verify: `npm run typecheck` passa.

- [ ] 7. Renderizar o controle "Modo foco" na linha de ações do cabeçalho.
      No `Stack` de ações do cabeçalho (o que tem `Chip` + Relatório + Arquivar), adicionar antes/junto dos botões um:
      `<Tooltip title="Ocultar informações e expandir o quadro"><ToggleButton value="focus" size="small" selected={focus} onChange={toggleFocus} aria-label={focus ? "desativar modo foco" : "ativar modo foco"}>{focus ? <CenterFocusStrongIcon fontSize="small" /> : <CenterFocusWeakIcon fontSize="small" />}&nbsp;Modo foco</ToggleButton></Tooltip>`.
      Files: `src/modules/projetos/ProjectDetailPage.tsx`
      Verify: `npm run typecheck` passa.

- [ ] 8. Fazer o layout em `Grid` reagir ao modo foco.
      Na coluna esquerda de informações, condicionar a renderização ao `!focus`: envolver todo o `<Grid size={{ xs: 12, md: 4 }}>...</Grid>` (Resumo, Descritivo, Membros, Recursos e custos, Comentários) em `{!focus && ( ...a Grid de info... )}`.
      Na coluna do quadro, tornar o tamanho dinâmico: `<Grid size={{ xs: 12, md: focus ? 12 : 8 }}>`.
      Manter intactos: `Tabs` (Kanban/Gantt), `ProjectBoard`, `GanttChart`, o `TaskDetailDialog` (deep-link via `taskId`), e todas as mutações (membros, recursos, comentários, arquivar/desarquivar, relatório PDF). Nenhum desses depende da coluna de info estar montada; apenas os painéis de info somem quando `focus` está ligado.
      Files: `src/modules/projetos/ProjectDetailPage.tsx`
      Verify: `npm run typecheck` passa e `npm run build` conclui sem erros.

---

## Verificação final (rodar de `/Users/ricardofranca/HUB Central/frontend`)

- [ ] 9. Rodar a verificação completa do projeto e confirmar que nada quebrou.
      Files: (nenhuma edição — verificação)
      Verify: executar nesta ordem e confirmar sucesso em cada:
      - `npm run typecheck` → sem erros.
      - `npm run build` → `tsc -b && vite build` conclui sem erros.
      - `npm run test` → `vitest run` continua com os 4 arquivos / 14 testes passando (nenhuma regressão). Não adicionar testes novos (os módulos alterados não têm testes existentes a manter).

## Nota de verificação (execução)

Executado a partir de `/Users/ricardofranca/HUB Central/frontend`:
- `npm run typecheck` (`tsc --noEmit`) → OK, sem erros. (Houve um ajuste: com `exactOptionalPropertyTypes` ligado, não é permitido passar `sx={undefined}`; os `sx` condicionais em `Shell.tsx` usam `{}` no caso não recolhido.)
- `npm run build` (`tsc -b && vite build`) → OK, build concluído. Avisos pré-existentes e não relacionados (import dinâmico de `session-store.ts` e tamanho de chunk > 500 kB) permanecem iguais ao baseline.
- `npm run test` (`vitest run`) → OK, 4 arquivos / 14 testes passando. Nenhum teste novo adicionado.

Comportamento visual esperado:
- Item 1: no desktop (sm+), um botão de seta no topo do drawer recolhe/expande o menu. Recolhido (64px): só ícones, com Tooltip à direita por item e grupos separados por borda/Divider (sem ListSubheader); o conteúdo principal realoca a largura. Expandido (248px): aparência atual (ícone + texto + subheaders). A preferência persiste em `hubcentral.sidebar.collapsed`. O drawer mobile (xs) continua sempre expandido com o hambúrguer no AppBar.
- Item 2: no detalhe do projeto, o ToggleButton "Modo foco" (na linha de ações) oculta toda a coluna de informações e expande o quadro (Kanban/Gantt) para largura total; desligado, volta ao layout lado a lado. Preferência persiste por projeto em `hubcentral.projetos.focus.<id>` e reflete o valor salvo ao trocar de projeto. Abas, diálogo de tarefa (deep-link) e demais ações permanecem funcionando em ambos os modos.

## Notas / suposições
- O botão de toggle do menu fica dentro do `Toolbar` do drawer permanente e é ocultado no mobile via `sx display` (o drawer temporário sempre renderiza no modo expandido).
- "Modo foco" usa `ToggleButton` isolado (não `ToggleButtonGroup`) por ser um único controle booleano; o `onChange` do `ToggleButton` dispara ao clicar, suficiente para alternar.
- Caso o `GanttChart`/`ProjectBoard` tenham largura mínima que cause overflow em `md:12`, isso é apenas visual e não bloqueia build/typecheck; o quadro simplesmente ganha a largura recuperada conforme pedido no Item 2 (Opção A).
