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

## Next

1. Validator (messages panel, click-to-go)
2. Acceptance check (rebuild the seed machine from an empty project using only the UI) and report

## Not in this phase (by the spec)

- Routing editor (it is not in the Phase 2 list)
- Wiring transitions, Init, abort and interrupt blocks: that is the Planner canvas (Phase 3)
- Logic blocks and queues (Phase 6)
