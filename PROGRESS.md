# Phase 2 progress — library editors and composer

Branch: `phase-2-library-editors`

## Done

- Foundation: runtime project API (open/create/save, schema-checked), Studio working copy of the project, live project tree, New/Rename/Duplicate/Delete/Find-usages, dialogs, Save (Ctrl+S), unsaved indicator, File > New/Open project
- Global Variables editor (all types incl. nested array/map/record) + browser test `e2e/library.spec.ts`
- Interfaces editor (card per interface, typed and directed signals) + browser test
- Equipment editor (interfaces it is made of, simulated behaviour) + browser test
- Conditions editor: roles, IF row of term boxes (operators, NOT, brackets, compare), read-only summary, alarm section, variable picker (typed, searchable, categories) + shared text helpers in core (`catalog.ts`) tested against the compiler
- States editor: roles, On Entry / Steps / On Exit, **+ Add** menu (Equipment, Global, Generic, Timer; Logic block and Queue shown as Phase 6), text forms, drag to reorder, per-action edit form + browser test
- Machines composer: cycle time, instances, timers, state and condition instances, binding table (unbound in warning colour, Auto-bind) + browser test
- Validator core (`validateProject`): compiler problems plus unreachable state, no way out, transition without condition, library items pointing at deleted things; each with a location. 8 tests against the seed.

- Validator problems in the Messages panel: live rows (Time shows "live", Source "Validator"), counted in the level pills, filterable, copied with Copy, not removed by Clear; click (or Enter) opens the editor and lights the item. Machine card got a description field. Browser test in `e2e/library.spec.ts`.
- Acceptance check (`e2e/rebuild-seed.spec.ts`): from an empty project, the whole Sealer library and machine is rebuilt by clicking only (5 interfaces, 4 equipment types with simulation, 5 globals, 8 conditions incl. the PusherStuck alarm, 6 states with their actions, the machine with 5 instances, 2 timers, 6 states, 8 conditions, all 20 bindings). The saved project equals `projects/box-sealer-demo` once IDs are replaced by names. **Excluded:** Init, transitions, abort and interrupt (Planner, Phase 3); the validator correctly reports the one remaining problem, "the Init node is not connected to a first state".

## Carried to Phase 3 (owner decision, 2026-11-09)

- Phase 2 accepted without state wiring. **The Phase 3 acceptance must also finish the Sealer rebuild** in `e2e/rebuild-seed.spec.ts`: draw Init, the transitions, the PusherStuck abort and the Stop/Start interrupt in the Planner, and compare them with the seed too (no temporary way to enter them in Phase 2).

## Status

Phase 2 complete, waiting for the owner's confirmation before merging.
Browser-test timeouts: 2 of the first 9 full runs had one timeout each (different test each time). Afterwards, 8 full runs in a row were green (load 4–5 on 2 CPUs), and a run under deliberate 3x CPU overload was 2.5x slower but still passing until it was stopped. No source edit or Vite dependency rebuild happened during the failing runs, so there is no sign of a page reload. The timeouts were not reproduced; no app fault was found, but the cause is not proven either.
