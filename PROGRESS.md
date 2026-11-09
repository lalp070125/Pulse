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

## Status

Phase 2 complete, waiting for the owner's confirmation before merging.
Known: in 2 of 9 full browser-test runs a test timed out (different test each time, machine under heavy load); the other 7 runs were fully green. Cause not proven.

## Not in this phase (by the spec)

- Routing editor (it is not in the Phase 2 list)
- Wiring transitions, Init, abort and interrupt blocks: that is the Planner canvas (Phase 3)
- Logic blocks and queues (Phase 6)
