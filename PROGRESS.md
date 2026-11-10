# Progress

## Phase order changed (owner decision, 2026-11-10)

SPEC section 14 now lists the phases in this order: 0, 1, 2, 3, 4, **8**, 5, 6, 7, 9, 10. Phase numbers and contents are unchanged; only Phase 8 moved up. Nothing else in the spec changed.

**Reason:** the owner's goal is a 3D twin with real physics, runtime streaming and the Line Builder, running the box closing machine (`docs/box-closing-machine-design.md`). So Phase 4 (runtime, streaming, Monitor) comes next, then Phase 8 (Twin), before tests, logic blocks and the Panel.

**Dependencies to settle when Phase 8 starts (flagged, not decided):**

- Phase 8 acceptance switches routing from Sim to Twin. The Routing (bus manager) editor of SPEC 6.2 is not listed in any phase.
- The box machine's `Global.BoxCount = Global.BoxCount + 1` needs a computed value: logic blocks, Phase 6. Before that the twin can run the box machine without counting.

## Notes for later

- Box closing machine design (`docs/box-closing-machine-design.md`): a candidate for rebuilding in the Planner after Phase 3 and for the Phase 8 Twin demo. Review the Twin labels in SPEC 10.1 before Phase 8 and rename any that look copied from other products.
- 3D reference screenshot for the Phase 8 Twin: `docs/reference/twin-3d-reference.webp`, with its note (look and function only; it is from another product).

## Phase 3 — Planner canvas

Branch: `phase-3-planner-canvas`

### Done

- **Model in core** (`packages/core/src/planner.ts`, pure, 11 tests in `packages/runtime/src/planner.test.ts`): add / delete / move states, draw wires, priorities in drawing order and renumbering, Init, abort and interrupt blocks, hold actions, condition choice (instance, library condition or typed name), Construct Machine, copy / paste, drawing-only junctions.
- **Placeholders live in `plan.json`** (owner decision): states, wires, Init, aborts and interrupts that are not real yet. Anything fully real is written to `machine.json`. The engine and the validator never read `plan.json` (tested; SPEC 5.1 updated).
- **Construct Machine**: creates state templates (empty) and condition templates (one "TO DO" term, always false, flagged as a warning) from placeholder names; reuses library items with the same name; keeps node IDs so the drawing stays put; running it again only adds what is new ("Add New Items").
- **Canvas** (`packages/studio/src/planner/`): dark grid (20 px, stronger every 100 px), machine boxes with indigo header, collapse arrow, resize, Init node (cannot be deleted), state nodes with first On Entry lines, ports top/bottom; orthogonal wires with rounded corners and arrowheads, priority badge, condition label; back wires routed through side lanes; Abort / Interrupt Trig / Interrupt Resume blocks with "(Unassigned)" slots and a hold-actions dialog (the States editor's action form); placeholders `[Name]` with dashed borders.
- **Toolbar**: Save, undo, redo, State, Machine, H, V, Exp, delete, minimap, fit, zoom %. Right-edge **FSM / Queues** strip (Queues is a Phase 6 placeholder). Footer `Machines: n | Unsaved: n`. Machine header right-click: Construct Machine / Add New Items, Open in composer, Delete.
- **Editing**: drag to move (snap to grid), box-select, Delete, Ctrl+C / Ctrl+V, Ctrl+Z / Ctrl+Y for every canvas action, wheel / pinch zoom, Space-drag or two-finger pan. Undo only covers canvas edits and starts fresh after an edit made elsewhere.
- **Validator click-to-go**: problems about Init, transitions, priorities, abort, interrupt, unreachable states open the Planner at the machine or state; the rest of a machine still opens the composer.
- **Browser tests**: `e2e/planner.spec.ts` (seed drawing; drawing from placeholders through Construct; junctions and box-select), `e2e/rebuild-seed.spec.ts` (Sealer rebuilt from an empty project, now including Init, transitions, abort, interrupt with its hold action, compared with the seed in full, then run by the engine), `e2e/acceptance-phase3.spec.ts` (the two-machine demo).

### Acceptance

`e2e/acceptance-phase3.spec.ts`: in an empty project, the Sealer and Infeed machines are drawn from placeholders only, constructed (the second Construct reuses StartPressed), their skeletons filled in with the Phase 2 editors, saved, and the engine runs both: Start → Sealer Feed / Infeed Gap; after the 500 ms gap Infeed is in Handover; a box arrives → Sealer Push, and Infeed sees `inState(Sealer, Push)` and goes back to Gap; the cycle continues into Seal.

### Phone (owner request 2026-11-10, within SPEC 4.1: desktop layout, scaled)

- Touch screens: one finger on empty canvas pans, two fingers pan and zoom the drawing (this did not work before: the desktop pan setting switched off all touch pan and zoom, and a pinch that started on a machine box was ignored). Only a box's header bar and resize handles catch touches now.
- Finger-sized dots, badges, labels and slots on touch screens; a wire end snaps to a dot from further away.
- **Full screen** button in the Planner toolbar: hides the side panels and Messages, fits the drawing; press again to bring them back.
- Safari's own page zoom is blocked on the canvas (`touch-action: none` and Safari gesture events). **Not verified on a real iPhone**: the test browser here (Chromium with the iPhone 16 Pro Max profile) does no page zoom, so this can only be confirmed on the phone.
- Browser test `e2e/phone.spec.ts`: full screen, two-finger zoom, dot size, a wire drawn by touch.
- On touch screens there is no box-select (one finger pans instead).

### Decisions recorded

- The demo's Infeed and Sealer coordinate through `inState(...)` (and globals). **The `ToSealer` queue of SPEC 12 comes in Phase 6** with queues. The seed project is unchanged.
- H / V / Exp junctions are drawing only (they never change machine.json) and are not part of the acceptance test.
- Double-click on the canvas does not zoom: double-click edits badges and labels (SPEC 6.3).

### Browser-test timeouts: cause found and fixed

The intermittent timeouts first seen in Phase 2 were **a real bug in the name dialog**, not machine load and not a page reload. When a name dialog opened, its text field first showed an empty or stale value (the previous dialog's text) and only got its suggested name a moment later. Typing that landed in that gap mixed with the suggestion: a run on 2026-11-10 created a machine called "MachineInfeed" instead of "Infeed", and the test then waited for "Infeed" until it timed out. The new live-reload logging showed no reload during that test, which pointed to the app itself. Fix: each dialog now starts with its own text from its first frame (`ui/Dialogs.tsx`). A regression test (`e2e/library.spec.ts`, "A name dialog holds its own suggested text…") checks the field's value at the moment the dialog appears. It fails on the old code (it saw the previous project name, then "Alpha") and passes on the new code.

## Phase 2 — Library editors and composer

Merged to `main` (owner confirmed 2026-11-09). Editors for globals, interfaces, equipment, conditions (with variable picker), states (with action menus), Machines composer with bindings, validator with click-to-go. Accepted without state wiring; the Phase 3 acceptance finishes the Sealer rebuild (done above).
