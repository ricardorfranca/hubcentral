# Menu lateral recolhível e modo foco no detalhe do projeto

Two frontend UX changes for HUB Central. The sidebar in `Shell.tsx` gains a mini-variant collapse: a toggle button at the top of the permanent drawer shrinks the desktop nav to a 64px icon-only rail with right-placed tooltips, replacing the group subheaders with a top border separator, while the main content and nav width track the effective drawer width. The project detail page in `ProjectDetailPage.tsx` gains a "Modo foco" toggle that hides the left info column and expands the board to full width. Both preferences persist in localStorage — the sidebar globally at `hubcentral.sidebar.collapsed`, focus mode per-project at `hubcentral.projetos.focus.<id>`. The mobile temporary drawer is left unchanged and always renders expanded.

Watch for: nothing blocking. One minor UX observation on the collapsed group separator (possible), and the focus toggle's full-width board may overflow on narrow boards (possible, already acknowledged by the author as cosmetic). Verification evidence (typecheck, build, test 14/14) is recorded in the plan.

**Verdict**: APPROVED

## High-level view

The sidebar collapse is implemented as local `Shell` state seeded lazily from localStorage, not a global store — a reasonable scope for a pure layout preference. The permanent drawer renders through a parameterized `renderDrawer(isCollapsed)` so the mobile temporary drawer can be driven with `false` and stay fully expanded regardless of the desktop state. The effective `drawerWidth` is threaded through the nav Box, the permanent paper, and the main Box, so content reflows when the rail collapses. The toggle button is hidden on `xs` via `sx display`, which is the mechanism keeping the control off mobile.

Focus mode mirrors the same lazy-init-from-localStorage pattern but keys per project id, with a `useEffect([id])` that re-reads the saved value on route change. This correctly handles both switching projects and the first-render case where `id` is initially empty (`useParams` is defaulted to `""`). The info column is gated behind `!focus` and the board Grid size flips between `md:8` and `md:12`; Tabs, ProjectBoard, GanttChart, TaskDetailDialog and all mutations sit inside the board column or below the grid and are untouched by the toggle.

Both toggles wrap localStorage access in try/catch and guard `window`, so an unavailable storage degrades to the default rather than throwing. The `.js` import suffix convention holds, all new strings and comments are in Brazilian Portuguese, and no version bump or CHANGELOG edit is bundled in.

<details>
<summary>Issues (2)</summary>

1. **Collapsed group separator relies on existing borderTop** — when collapsed, group separation falls back to the pre-existing `borderTop` on the `List` (`gi > 0`) rather than a dedicated `Divider`; visually adequate but the first group has no separator from the toolbar divider. Possible, cosmetic — verify it reads clearly at 64px.
2. **Full-width board overflow risk in focus mode** — at `md:12` the Gantt/board could overflow if it has a min width wider than the recovered space. Possible, cosmetic, already acknowledged by the author as non-blocking.

</details>

<details>
<summary>Details</summary>

### Mini-variant collapse via parameterized renderDrawer

The drawer body was converted from a `drawer` constant to `renderDrawer(isCollapsed: boolean)`. The permanent drawer is called with the live `collapsed` state and the temporary (mobile) drawer with a hardcoded `false`, which is what keeps the mobile experience unchanged — the requirement that the temporary drawer always render expanded is satisfied structurally rather than by a runtime branch. The toggle `IconButton` itself is additionally hidden on `xs` through `sx={{ display: { xs: "none", sm: "inline-flex" } }}`, so even though the mobile drawer renders the button in the expanded tree, it never shows on mobile.

When collapsed, each `ListItemButton` drops its `ListItemText`, centers the icon, and is wrapped in a right-placed `Tooltip` carrying `entry.label`; expanded keeps the text and omits the tooltip. The group `List` passes `subheader={undefined}` when collapsed (the plan's note about `exactOptionalPropertyTypes` is why the conditional `sx` values use `{}` instead of `undefined`). The effective `drawerWidth` is applied to the nav Box width, the permanent paper width (with `overflowX: hidden` and a width transition), and the main Box `calc(100% - …)`, so the content area reflows with the rail. The temporary paper keeps the fixed `DRAWER_WIDTH`.

One observation on group separation: collapsed mode removes the `ListSubheader` and leans on the `borderTop` that already exists for `gi > 0`. This works for separating groups from each other, but it's the same border that was there before — there's no dedicated `Divider` added for the collapsed state as the design decision text describes. It reads fine functionally; worth a glance to confirm the icon-only rail looks intentional rather than like groups bleeding together. Cosmetic, non-blocking.

### Per-project focus persistence and route-change sync

Focus state is seeded lazily from `hubcentral.projetos.focus.<id>` and re-synced by a `useEffect` keyed on `id`. Because `useParams` is destructured with `id = ""`, the first render before the route param resolves reads the key for an empty id and the effect corrects it once `id` is populated — the per-project reflect-on-switch requirement holds, and switching between two projects with different saved states shows each project's own preference. The `toggleFocus` writer persists `"1"`/`"0"` under the same per-project key.

The layout reacts by gating the entire left info Grid behind `{!focus && ( … )}` and flipping the board Grid between `md:8` and `md:12`. Everything that must stay intact — the Kanban/Gantt Tabs, `ProjectBoard`, `GanttChart`, and the `TaskDetailDialog` deep-link via `taskId` — lives in the board column or below the grid, so none of it unmounts when the info column hides. The report, archive/unarchive, member, resource and comment mutations are likewise unaffected. The one caveat the author already flagged: a full-width board could overflow horizontally if the inner board/Gantt has a min width; purely visual and not a build or correctness concern.

### Conventions and scope

Local imports keep the `.js` suffix (`./TaskDetailDialog.js`, `../core/modules/registry.js`, etc.), new UI strings ("recolher menu", "expandir menu", "Modo foco", "Ocultar informações e expandir o quadro", "ativar/desativar modo foco") and all comments are in Brazilian Portuguese, and the change touches only the two target source files plus the plan. No `package.json` version bump and no CHANGELOG edit are bundled in, matching the constraint.

### Verification

Per the recorded note in `plan.md`, the coder ran `npm run typecheck` (clean), `npm run build` (`tsc -b && vite build` succeeded, only pre-existing unrelated warnings), and `npm run test` (`vitest run`, 4 files / 14 tests passing, no regressions, no new tests — neither changed file had existing coverage). The note also documents the `exactOptionalPropertyTypes` adjustment that explains the `{}`-vs-`undefined` conditional `sx` pattern. Evidence is present and consistent with the diff; no re-run performed.

Not tested: there is no automated coverage for the new collapse or focus behavior (both files were already untested, and the task did not require adding tests). The persistence and route-sync behavior is covered only by reasoning over the diff, not by a test.

</details>

<details>
<summary>File map</summary>

- `frontend/src/app/Shell.tsx` — mini-variant sidebar collapse: toggle button, icon-only collapsed rail with right tooltips, effective width threading, localStorage persistence.
- `frontend/src/modules/projetos/ProjectDetailPage.tsx` — "Modo foco" ToggleButton hiding the info column and expanding the board, per-project localStorage persistence with route-change sync.
- `frontend/.agents/tasks/plan.md` — implementation plan and recorded verification note (not production code).

Full diff: `git diff origin/main`
</details>
