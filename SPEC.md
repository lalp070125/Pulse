# PULSO — Machine Control Studio

**Specification v1.0 — simulation-first build**

> "Pulso" is a working name. It lives in one constant (`PRODUCT_NAME`) and one logo file so it can be renamed in a minute.
> This product has its own name, its own visual identity and its own code. Do not copy names, logos, icons, screenshots, text or assets from any existing commercial product.

---

## 0. How to read this file (instructions for Claude Code)

1. Read this whole file before writing any code.
2. Build **phase by phase** (section 14). Never start a phase until the previous one meets its acceptance checklist and the owner has confirmed.
3. The owner does not write code. Every phase must end with something he can **open in the browser and click**, plus a short plain-language report: what was built, how to see it, what is not done yet.
4. The engine (section 5) is the foundation. Every other part reads the same project model and the same live variable space. Never create a second copy of the variable list anywhere.
5. Evidence only: do not claim something works unless a test or a manual check in the running app proved it. Say "not verified" when it is not.
6. Automated tests are required for the engine and the test runner. A phase with red tests is not finished.
7. Commit after each working step with a clear message. One phase = one branch, merged only after the acceptance checklist passes.
8. If a requirement here is ambiguous or two requirements conflict, stop and ask one precise question instead of guessing.
9. Copy section 15 into `CLAUDE.md` at the repo root as the standing rules.

---

## 1. What we are building

One web application, running in a GitHub Codespace on **a single port**, that lets one person:

1. **Describe a machine** as a structured model: its devices, signals, states, and the conditions for moving between states.
2. **Draw the control logic** as parallel state machines on a canvas.
3. **Run that logic** in a deterministic runtime, live, with every action and every evaluated condition logged.
4. **Watch it**: active states lit on the drawing, signals drawn as waveforms on a time axis, a filterable event log.
5. **Test it** automatically: scripted test cases, fixtures, assertions, regression comparison, coverage with a gap list.
6. **Design the operator panel (HMI)** bound directly to the same variables.
7. **Validate it on a 3D digital twin**: a physics scene where product flows through the machine and the same logic drives the moving parts and reads the virtual sensors.
8. **Generate a first draft from plain language** ("conveyor feeds box, sensor stops it, cylinder pushes, sealer closes") through an AI layer.

Everything runs in simulation. **No physical hardware is connected in this version.** The architecture must make adding real hardware later a new driver, not a rewrite (section 5.9).

### 1.1 Who it is for

A machine builder who designs custom production machines (packaging first) and wants one environment for logic, tests, panel and virtual commissioning. The first user cannot program a PLC, so every screen must be learnable by reading it, with plain-language labels and tooltips.

### 1.2 Non-goals for this version

- No real fieldbus drivers (Modbus, EtherCAT, OPC UA, serial). Only the driver *interface* and simulated drivers.
- No hard real-time guarantees. The runtime is deterministic in logic (same inputs, same tick count, same result) but runs on Node timers.
- No user accounts, multi-user editing, licensing or cloud sync.
- No phone-optimised layout. This is a desktop-class studio (section 4.1 explains how it still opens on a phone).
- **Not a safety system.** See section 13.

---

## 2. The three applications

| App | Purpose | Modes / tabs |
|---|---|---|
| **Pulso Studio** | Model the machine, draw the logic, run, monitor, test | Plan · Monitor · Test |
| **Pulso Panel** | Design operator screens bound to machine variables; build a standalone panel page | Design · Variable Mapping |
| **Pulso Twin** | Build a 3D physics model of a station and a line; let the runtime drive it | Station Builder · Line Builder |

All three are routes of the same web app (`/studio`, `/panel`, `/twin`), share one project and one runtime connection, and have an app switcher in the title bar. Panel and Twin are never standalone: they only talk to the Pulso runtime.

---

## 3. Technology

| Area | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere, `strict: true` | One language for engine, server and UI |
| Repo | npm workspaces monorepo | Shared engine package |
| Engine | `packages/core`: pure TypeScript, **no Node or browser APIs** | Must run identically in tests, server and (later) other hosts |
| Runtime server | `packages/runtime`: Node 20+, Express, `ws` | Owner already runs Node/Express projects on a forwarded port |
| UI | `packages/studio`: React 18 + Vite | |
| State (UI) | Zustand | Simple, no boilerplate |
| Canvas (state machines) | `@xyflow/react` with custom nodes and a custom orthogonal edge router | |
| Panels/layout | `react-resizable-panels` + own tab component | |
| Waveforms | Custom `<canvas>` renderer | Needs square waves, traces and labelled bands on one time axis |
| HMI canvas | SVG scene with own selection/transform handles | Crisp at any zoom, easy to export |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` | Real physics, glTF support |
| Code editor (logic blocks) | CodeMirror 6 | Light, works in the browser |
| Validation | `zod` schemas for every project file | |
| Tests | Vitest (engine, runner), Playwright (UI smoke tests) | |
| Lint/format | ESLint + Prettier | |

### 3.1 Single port

One command, `npm run dev`, starts one Express server on **port 4600** that:
- serves the UI (Vite in middleware mode in development; built static files in production),
- exposes the REST API under `/api`,
- exposes the live WebSocket under `/ws`,
- serves built operator panels under `/panels/<name>`.

Add a `.devcontainer/devcontainer.json` that installs dependencies, forwards port 4600 with label "Pulso", and runs nothing else automatically.

### 3.2 Repository layout

```
/SPEC.md
/CLAUDE.md
/.devcontainer/devcontainer.json
/packages
  /core        engine: model types, zod schemas, evaluator, scheduler, logic-block language, test runner, coverage
  /runtime     Node host: project store, tick loop, drivers, REST + WS, session logs, MCP server
  /studio      React app: Studio, Panel designer, Twin
  /panel-player  tiny standalone runtime for built operator panels
/projects
  /box-sealer-demo   seed project (section 12)
/docs          user-facing help pages (markdown), one per screen
```

---

## 4. Visual design

The look is a **dark, dense, engineering IDE**: calm near-black surfaces, thin borders, small type, one vivid accent, colour used only to carry meaning (state, severity, pass/fail). It should feel like professional tooling, not a consumer dashboard.

### 4.1 Screen size

- Designed for **1440 × 900 and larger**. Minimum supported width 1280.
- Set `<meta name="viewport" content="width=1440">` so a phone or tablet renders the full desktop layout scaled, with pinch-zoom and pan, instead of a broken reflow.
- All dragging uses Pointer Events so touch works: one finger drags, two fingers pan/zoom canvases.

### 4.2 Design tokens

All colours, spacing and fonts live in `packages/studio/src/theme/tokens.css` as CSS variables. No hard-coded colours in components.

```
--bg-0: #070A12;        /* app background, title bar */
--bg-1: #0D1220;        /* panels, sidebars */
--bg-2: #131A2B;        /* cards, nodes, inputs */
--bg-3: #1B2438;        /* hover, raised rows */
--grid-line: #18203A;   /* canvas grid */
--border: #232C44;
--border-strong: #34405F;

--text-1: #E6EAF5;      /* primary */
--text-2: #9AA5BF;      /* secondary */
--text-3: #5E6A86;      /* disabled, hints */

--accent: #7C5CFF;      /* selection, active mode, primary identity */
--accent-soft: #2A2157; /* selected row background */
--focus: #3B82F6;       /* active tab, focus ring, primary buttons */

--ok: #22C55E;          /* pass, running, connected, Save */
--warn: #F59E0B;        /* warnings, connecting, alarm banner */
--err: #EF4444;         /* fail, fault, offline, Stop */
--info: #38BDF8;

/* log event chips */
--ev-action: #F97316;
--ev-trans:  #14B8A6;
--ev-cond:   #A855F7;
--ev-bus:    #3B82F6;
--ev-logic:  #EAB308;
--ev-inject: #EC4899;

--radius-sm: 3px; --radius-md: 6px;
--font-ui: "Inter", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
--fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px;
--row-h: 24px;          /* tree rows, table rows */
```

Rules:
- Base font 13 px. Tree rows and table rows 24 px high. Dense, but never cramped: 8 px inner padding minimum.
- Monospace for variable paths, values, timestamps, code and log messages.
- Borders are 1 px. No drop shadows except on menus and dialogs.
- Icons: `lucide-react`, 14 px, stroke 1.5. No emoji.
- Motion: 120 ms ease-out for hover and selection only. Live data never animates decoratively.
- Every colour that carries meaning also has a text label or icon (colour-blind safe).

### 4.3 Application shell (shared by all three apps)

Top to bottom:

1. **Title bar** (28 px, `--bg-0`): product mark, `Pulso Studio — <project name> — [Connected | Disconnected]`, app switcher (Studio / Panel / Twin).
2. **Menu bar** (26 px): File, Edit, View, Runtime, Settings, Help. Plain text menus with keyboard shortcuts shown.
3. **Runtime strip** (24 px, centred): three small round status lamps — Runtime (running/stopped), Simulation link, Twin link — with tooltips. Next to them: Deploy, Start, Stop, Step-one-tick buttons.
4. **Workspace**: left sidebar (260 px, resizable) · centre document area with tabs · optional right inspector (280 px) · bottom panel (220 px, resizable, collapsible).
5. **Status bar** (22 px): connection dot and text on the left; unsaved-changes indicator, cycle time and tick counter on the right.

Tabs in the document area: flat, 28 px, active tab filled with `--focus` and white text, each with a close "×", reorderable by drag.

---

## 5. The engine (`packages/core`)

This is the most important part. Build it first, test it hardest.

### 5.1 Project model

A project is a **folder of small JSON files, one file per entity**, with keys written in a fixed order and 2-space indentation, so every change is a clean Git diff.

```
project.json                      name, format version, default cycle time
globals/<id>.json
interfaces/<id>.json
equipment/<id>.json
logic-blocks/<id>.json (+ .pst source)
conditions/<id>.json
states/<id>.json
machines/<id>/machine.json        instances, bindings, fsm, queues, timers
machines/<id>/plan.json           canvas drawing: positions, machine box, junctions, placeholders
routing.json                      the bus manager table
tests/cases/<id>.json
tests/fixtures/<id>.json
tests/runs/<timestamp>/           reports + machine snapshot
panels/<id>/...                   HMI pages, widgets, bindings
twin/stations/<id>.json
twin/lines/<id>.json
```

`plan.json` holds only the drawing. Placeholders (SPEC 6.3: states, wires, Init, abort and interrupt blocks that are not real yet) are stored there until Construct Machine or a later edit makes them real; anything fully real is written to `machine.json`. **The engine and the validator never read `plan.json`.** *(Added in Phase 3.)*

Every entity has a **stable ID** (ULID) and a `name`. **All references use the ID, never the name**, so renaming never breaks anything. Deleting an entity that is referenced must list what depends on it and ask for confirmation.

### 5.2 Variable types

`bool`, `int`, `real`, `duration` (ms), `string`, `enum` (named values), `array<T, N>` (fixed length), `map<string, T>`, `record` (named fields of mixed types). Each variable has a type, a default value, an optional unit and a description.

### 5.3 Structured variable space

Nothing is a flat tag list.

- **Interface**: a named, reusable group of signals that describes a *kind of connection*. Convention: names start with `I` (`IMotor`, `IValve`, `ICylinder`, `ISensor`). Each signal has a type and a **direction**:
  - `command` — written by the logic, sent out to the world,
  - `feedback` — read from the world,
  - `param` — configuration value.
- **Equipment type**: a named device made of one or more interfaces (`Motor = IMotor + IFault`).
- **Instance**: a real device inside a machine (`Conveyor1` of type `Motor`).
- **Global**: a project-wide variable.

Every value has a readable address:
`Machine.Instance.Interface.Signal` → `Sealer.Pusher.ICylinder.Extended`
`Global.Name` → `Global.BoxCount`

### 5.4 Library versus machine (reuse)

- The **Library** holds reusable **state templates** and **condition templates**. They can refer to *roles* ("a motor", "a sensor") instead of concrete devices.
- A **Machine** holds *instances* of those templates and **binds each role to a concrete instance**. The same `Running` template can drive three different motors in three machines.
- A template with unbound roles makes the machine invalid; the validator names exactly which binding is missing.

### 5.5 Conditions

A condition is a **named boolean rule**, stored as a tree (never as a typed string), built in the UI from boxes:

- **Terms**: variable reference, literal, comparison (`= ≠ < ≤ > ≥`), and placeholder functions:
  - edges: `rising(x)`, `falling(x)`, `changed(x)`
  - aggregates over arrays: `any`, `all`, `count`
  - machine state: `inState(machine, state)`
  - timers: `timer.done`, `timer.running`, `timer.elapsed`
  - queues: `queue.empty`, `queue.full`, `queue.count`
- **Operators**: `AND`, `OR`, `NOT`, parentheses for grouping.
- A read-only **summary line** shows the whole rule as text: `IF( Pusher.ICylinder.Extended AND NOT Global.Stop )`.

**A condition can also be an alarm.** Optional metadata: `group`, `severity` (Info / Warning / Alarm / Critical), `message`. The condition that stops the machine *is* the alarm. Alarms are never defined a second time anywhere else.

### 5.6 States

A state is a named mode of a machine with three action groups:

| Group | When it runs |
|---|---|
| **On Entry** | once, on the tick the state becomes active |
| **Steps** | every tick while the state is active |
| **On Exit** | once, on the tick the state is left |

Action kinds (same list available in all three groups):

| Kind | Effect | Text form shown in the UI |
|---|---|---|
| Equipment | write a device signal from a literal or from another signal | `Conveyor.IMotor.SetRun(true)` |
| Global | write a global | `Global.SetBoxCount(0)` |
| Generic | a typed setter with no target yet, bound later in the machine | `Generic.Set[bool](true)` |
| Timer | `Start`, `Stop`, `Restart`, `Reset`, `SetPreset` | `Timer.Start('SealTime')` |
| Logic block | run a logic block once | `Logic.Execute('CountBox')` |
| Queue | `Push`, `Pop`, `Clear` | `Queue.Push('ToLabeler', record)` |

### 5.7 State machines

- A **machine** contains states, **transitions** and one undeletable **Init** node (where it starts on the first tick).
- A transition has: `from`, `to`, `condition`, `priority`. When several transitions leave one state, they are checked in ascending priority and **the first true one wins**. Priorities are auto-assigned in drawing order and can be renumbered.
- **Abort handlers**: a condition that is checked in *every* state. When true: run the active state's On Exit, go to the handler's target state. Used for faults.
- **Interrupt handlers**: `trigger` and `resume` conditions. On trigger the machine **holds**: the active state stays, Steps stop running, its timers freeze, optional hold actions run. On resume it continues exactly where it was, not from the beginning.
- **Parallel machines**: a project has many machines side by side, each with its own cycle time. They coordinate only through globals, queues and `inState(...)`.
- **Sub-machines and modes** (later phase): a machine may own parallel sections, and mode sets such as Auto and Manual that hand over cleanly.
- **Queues**: typed FIFO with a capacity, for handing batch records from one machine to the next.
- **Timers**: `preset`, `elapsed`, `running`, `done`. They advance by cycle time per tick, so they are exact and repeatable.

### 5.8 The scan cycle (exact order, per machine, per tick)

1. Read the input snapshot from the drivers (feedback signals).
2. Advance timers; update edge detectors against the previous tick.
3. Check abort handlers, then interrupt handlers.
4. If not held: evaluate the active state's transitions by priority. If one fires → run On Exit (old), switch state, run On Entry (new). **At most one transition per tick.**
5. If no transition fired and not held → run Steps.
6. Write the output snapshot to the drivers (command signals).
7. Emit trace events and timing figures.

Rules:
- **Deterministic**: the engine takes time only from the tick counter. No `Date.now()`, no randomness, no I/O inside `packages/core`.
- **Each machine has its own cycle time** (default 10 ms). The scheduler runs each machine when its next tick is due.
- The engine exposes `step(n)` so tests can advance an exact number of ticks instantly, much faster than real time.
- An infinite loop or exception in a logic block faults that machine only, with machine name, message and stack saved to disk.

### 5.9 Drivers and routing (the hardware seam)

Machine logic **never names an address**. A separate **routing table** ("Bus Manager") lists every variable against every transport with a direction.

```ts
interface Driver {
  id: string;
  connect(): Promise<void>;
  readInputs(paths: string[]): Record<string, Value>;   // world → logic
  writeOutputs(values: Record<string, Value>): void;    // logic → world
  status(): 'connected' | 'connecting' | 'offline';
}
```

Drivers in this version:
- `SimDriver` — holds values in memory; feedback can be set by the user, by tests (inject), or by simple built-in device models (for example "cylinder: Extended becomes true 400 ms after Extend command").
- `TwinDriver` — exchanges values with the 3D scene.
- `PanelDriver` — exchanges values with operator panels.

Switching a variable from Sim to Twin (and, in a future version, to Modbus) is a change in the routing table only. No state, condition or logic block changes.

### 5.10 Logic blocks (small procedural language)

For the few places a state machine needs real procedural code. A compact, safe subset of IEC 61131-3 Structured Text, file extension `.pst`:

- Typed parameters (in / out / in-out) and local variables.
- Assignment `:=`, arithmetic `+ - * / MOD`, comparisons, `AND OR NOT`.
- `IF / ELSIF / ELSE / END_IF`, `CASE`, `FOR` (bounded), `WHILE` with a hard iteration cap.
- Built-in functions: `ABS MIN MAX LIMIT SQRT ROUND`, string length/concat, array length.
- Reads and writes of globals and of equipment signals through bound roles.
- Hand-written recursive-descent parser → AST → tree-walking interpreter with an instruction budget per call.
- **Advisor**: inline diagnostics in the editor (unknown variable, type mismatch, unused variable, assignment to a feedback signal, unreachable code), each with a plain-language explanation.

### 5.11 Trace and log events

Every event has: tick number, virtual time in microseconds, machine, state, type, details.

| Type | Logged when |
|---|---|
| `TRANS` | a transition fires (`Idle → Run`) |
| `ACTION` | an action runs, with the value written |
| `COND` | a condition is evaluated — **including false results**, with the value of each term |
| `LOGIC` | a logic block runs |
| `BUS` | a value crosses a driver |
| `INJECT` | a value is forced by a user or a test |
| `SET` | a variable changes value |
| `FAULT` | a machine faults |

To keep volume sane: repeated identical `COND` results are logged on change, plus once per second while unchanged; a setting switches to "log every evaluation". Logging is **always on**, not a debug mode. The runtime writes rotating session files (`.jsonl`) so the last hours can be opened after the fact.

### 5.12 Timing figures

Per machine: scan duration (min / avg / max), jitter against the target cycle, tick count, overruns. Shown in Monitor and stored with each session.

---

## 6. Pulso Studio — Plan mode

### 6.1 Left sidebar

Top of the sidebar: three mode pills — **Plan**, **Monitor**, **Test**. Active pill filled with `--accent`.

Below, the **project tree** (24 px rows, expand arrows, small coloured icons, selected row filled `--accent-soft` with an accent left edge):

```
▾ Target
    ▾ Runtime (local)          ● 127.0.0.1:4600
    ▸ Panels (1)
      Twin
▸ Routing                      (bus manager)
▾ Library
    ▾ Global Variables
    ▾ Interfaces
    ▸ Equipment
    ▾ Logic Blocks
    ▸ Conditions
    ▾ States
▸ Machines                     (composer: instances and bindings)
  Planner                      (the state machine canvas)
```

Right-click on any node: New, Rename, Duplicate, Delete, Find usages.

### 6.2 Editors (centre tabs)

- **Global Variables**: table — name, type, default, unit, description. Type picker covers all types in 5.2, with nested editors for arrays, maps and records.
- **Interfaces**: card per interface; rows of signals with type and direction.
- **Equipment**: card per equipment type; pick the interfaces it is made of.
- **Conditions**: card per condition — Name, the **IF** row of term boxes with operator dropdowns between them, `NOT` toggle and bracket buttons, delete on each term, read-only Summary. Collapsible "Alarm" section (group, severity, message).
  - **Variable picker**: a dialog with categories — Equipment, Globals, Edges, Aggregates, Machine state, Timers, Queues — and a search box. It only offers variables whose type fits the slot.
- **States**: card per state — Name and three collapsible groups (On Entry, Steps, On Exit), each with a **+ Add ▾** menu listing the action kinds in 5.6. Actions are shown as their text form in monospace and are reorderable by drag.
- **Logic Blocks**: CodeMirror editor, parameter table on the right, Advisor list at the bottom.
- **Machines (composer)**: per machine — instances table (name, equipment type), the state and condition instances it uses, and the **binding table** mapping each role to a concrete instance. Unbound roles shown in `--warn`.
- **Routing (bus manager)**: one row per variable, one column per transport (Sim, Twin, Panel), each cell a checkbox plus direction (Read / Write). Filter by machine and by transport.

### 6.3 The Planner canvas

The centre of the product. Dark canvas with a fine grid (`--grid-line`, 20 px, a stronger line every 100 px).

**Toolbar** (32 px, above the canvas): `Save` (green, primary) · undo · redo · separator · `State` · `Machine` · separator · `H` (horizontal combiner) · `V` (vertical combiner) · `Exp` (expander: fans one wire out to up to four) · right side: delete, fit-to-view, zoom percentage.

**Right edge**: a slim vertical tab strip — `FSM` and `Queues` — switching the canvas between the state diagram and the queue diagram.

**Elements**
- **Machine box**: large rounded rectangle, 1 px `--border-strong`, with a full-width header bar in a deep indigo carrying the machine name and a collapse arrow. Contains its states. Created with a small circular **Init** node at the top centre that cannot be deleted.
- **State node**: rectangle about 190 × 110, fill `--bg-3`, header with the state name centred in bold, body listing the first lines of its On Entry actions in 10 px monospace, small "entry" caption. Connection ports are small dots: inputs on the top edge, outputs on the bottom edge.
- **Wire (transition)**: thin orthogonal line with rounded corners, light grey, arrowhead into the target. A small **circular numbered badge** in `--focus` sits near the source end showing the **priority**. The condition name is a small label chip on the wire. Double-click the badge to renumber; double-click the label to pick or create the condition.
- **Back wires** (to an earlier state) are routed out to a free lane at the side of the machine box and re-enter at the top of the target, so loops never cut through states.
- **Abort / Interrupt blocks**: a row of small blocks at the bottom of the machine box: `Abort`, `Interrupt Trig`, `Interrupt Resume`, each with a condition slot above it and "(Unassigned)" until bound.

**Placeholders (draw first, build second)**
- Anything dropped without a real entity behind it is a **placeholder**: name in `[square brackets]`, dashed border.
- You can type a condition name on a wire that does not exist yet.
- Right-click the machine header → **Construct Machine**: creates the state templates, condition templates, the machine, the instances and their mappings from every placeholder name, then re-points the drawing at the real entities. Existing entities with the same name are **reused, not duplicated**. Running it again later only adds what is new ("Add New Items").
- Construct creates the skeleton only: states have no actions and conditions hold one placeholder term, clearly marked as "to do".

**Saving**: `Save` writes the transitions into the machine's FSM (what the runtime executes). Until saved the status bar shows "unsaved" and the canvas footer shows `Machines: n | Unsaved: n`.

**Canvas behaviour**: drag to move, box-select, snap to grid, copy/paste, undo/redo for every action, mouse wheel or pinch to zoom, space-drag or two-finger drag to pan, minimap toggle.

### 6.4 Bottom panel — messages

Header row: `Filter` button, pills with live counts `Errors: n` `Warnings: n` `Info: n` (click to toggle each), and on the right `Pause`, `Clear`, `Copy`.
Table columns: **Time · Level · Source · Message**. Monospace, 22 px rows, error rows tinted red, auto-scroll unless paused.

### 6.5 Validation

A continuous validator lists problems with a click-to-go location: unbound role, transition without condition, state with no way out, **unreachable state**, duplicate priority, type mismatch in an action, two writers of the same command signal in one state.

---

## 7. Pulso Studio — Monitor mode

Works against the running runtime. Nothing here is a debug mode that must be switched on first.

### 7.1 Live plan
The same Planner drawing, read-only. **The active state of every machine glows** (accent outline plus soft fill). The transition that last fired flashes briefly. A held machine shows a "HELD" tag; a faulted one a red "FAULT" tag. Hovering a wire shows its condition with **the live value of each term**, so a blocked transition names the term that blocks it.

### 7.2 Focused signals
Clicking a state fills the signal monitor with **exactly the signals that state and its transitions touch**: the device signals its actions write, the timers it starts, the globals its conditions read, and the machine's own state track. The user never builds a watch list by hand (but can pin extra signals).

### 7.3 Waveform monitor
- One shared time axis. Rows: booleans as square waves, numbers as traces, states and enums as **labelled coloured bands**.
- Left column: signal name and **value at the cursor**. Dragging the cursor updates every row.
- Zoom and pan in time, pause/resume, record a session and load it back later.
- **Force a value** from the chart (logged as `INJECT`) to test a theory live.

### 7.4 Event log viewer
Toolbar: auto-refresh interval dropdown · `Start` (green) `Stop` `Clear` · type checkboxes `Actions` `Trans` `Cond` `LB` `Inject` `Bus` · `Machine:` dropdown · `Bus:` dropdown · text filter.
Table columns: **Time** (to the microsecond) · **Type** (coloured chip using the `--ev-*` tokens) · **Machine** · **State** · **Details**.
Footer: running/stopped status and `Entries: n`.
Clicking a row moves the waveform cursor to that instant and highlights the state on the plan.

### 7.5 Inspectors
Live tables for timers (preset, elapsed, running, done), queues (depth and contents), and timing figures per machine (5.12).

---

## 8. Pulso Studio — Test mode

Left sidebar in Test mode: `Test Manager`, `Reports`.

### 8.1 Layout
- **Left column, top**: `TEST CASES` list with toolbar — step-mode checkbox, run selected ▶, run all ▶▶, repeat count, new, duplicate, delete, filter by tag. Each row is tinted and marked by its last result: green with ✓, red with ✗, neutral if never run.
- **Left column, bottom**: `FIXTURES` list with new / duplicate / delete.
- **Main area**: case title (large), summary at the right (`4/6 passed — failed: <case>`), collapsible **Test Case Configuration** (tags, requirement ID, timeout, description), then `STEPS` with a blue **+ Add Step** button.
- Each step is a row: drag handle · status tick · a small **type tag** (`Inject`, `Time Control`, `Assertions`, `Fixture`) · step name · parameters in monospace · editable value fields · per-step timeout (ms) · delete ✕.
- A fixture used in a case appears as an expandable block showing its inner steps, with per-use value overrides.

### 8.2 Every case has the same four parts
1. **Inject state** — put the machine straight into a known state.
2. **Preconditions** — apply one or more fixtures (reusable setup blocks).
3. **Trigger** — the one stimulus being examined.
4. **Assert** — check the outcome.

### 8.3 Step vocabulary
- **Inject**: variable value, machine state, timer value, queue contents.
- **Time control**: **advance N ticks** (the default and recommended), wait until variable equals value (with tick limit), wait X ms wall-clock (flagged in the editor as a flakiness risk).
- **Faults**: disconnect a transport, freeze one signal.
- **Assertions**: variable equals / in range, machine in state, named condition true, transition happened within N ticks.
- **Standing assertions** (checked every tick for the rest of the case): *never in state*, *never exceeds*, *always* (invariant). The first failing tick stops the case and is named in the report.
- **Expected fault**: the abort or interrupt path is supposed to happen here.

### 8.4 Running
- Tests run on a fresh engine instance with virtual time: instant, exact, repeatable. Project and twin scene reset between cases.
- **Compile first**: every reference in every case is resolved before anything runs; broken references are listed by case and step number.
- Run one, run a tag, run all, repeat N times, per-case timeout, and **step mode** (advance one step at a time and watch the plan).

### 8.5 Reports
- Every run stores the report **and a snapshot of the machine it ran against**.
- **Regression comparison** against the previous run gives four different answers:

| | Machine unchanged | Machine changed |
|---|---|---|
| **Results differ** | **Regression** — something broke | Expected — review the change |
| **Results identical** | Stable | No behaviour change |

- A failed case opens on the failed step, expanded, with that step's event log attached.
- Reports group by tag and requirement ID and export to a printable HTML page (print to PDF).

### 8.6 Coverage
After a run: states entered, transitions taken, abort and interrupt paths reached — as counts **and as a gap list**. Each gap names how to close it ("drive condition `VentStuck` while in `Settle`"). A state with no incoming transition is reported separately as a **design fault, not a test gap**.

---

## 9. Pulso Panel (HMI designer)

### 9.1 Layout
- Menu bar plus an icon toolbar: new, open, save, undo, redo, align, distribute, zoom in/out, fit, grid toggle, preview ▶. Right side: page name, resolution (`1920 × 1080`), zoom %.
- **Left — PROJECT tree**: Target Devices · Widgets (Basic Shapes, Lines & Pipework, 3D Shapes, Text & Fields, Buttons & Inputs, Gauges & Charts, Alarms & Dialogs) · Screens · Image Library · Variable Mapping.
- **Centre**: tabs `Design` and `Variable Mapping`. The design surface is the page at its real resolution on a gridded dark canvas with a light frame. Drag widgets from the tree; select, move, resize, rotate, multi-select, group, layer order, snap lines.
- **Right — PROPERTIES**: collapsible sections `SCREEN`, `PAGES`, `DISPLAY` (geometry, fill, stroke, text), `BINDINGS`. With nothing selected it reads "No widget selected".
- **Bottom — OUTPUT**: Time · Level · Category · Message.
- Status bar: last save message, `Runtime target: Web`.

### 9.2 Binding
- The designer reads the variable list **live from the runtime** — the same endpoint the finished panel uses. There is no separate tag list.
- A variable reaches the panel by ticking the Panel column in Routing with a direction.
- The variable picker offers only what fits the binding (right type, right direction). A "show incompatible" toggle reveals the rest with the reason.
- **Buttons** write a clean edge: `Toggle`, `RisingEdge` or `FallingEdge`, with a pulse width that guarantees at least one scan sees it.

### 9.3 Colour and motion
- **Ranked colour states**: a widget has an ordered list of states, each bound to its own boolean; the highest active one wins (rank `Fault` above `Running`). Nothing active = the colour as drawn.
- **Transforms from a live value**: move X/Y, rotate, resize, and stretch from an anchored edge (a tank filling from the bottom). Each has an optional **map** (0–100 → 0–270°) and **cap**.
- Movement is **interpolated** at a set rate; the first reading snaps.
- **Preview strip** per motion: scrub a pretend value or press play, see `reading → applied`, without touching the runtime.

### 9.4 Alarms and dialogs
- The **alarm banner** widget shows alarms that come from conditions (5.5). In the designer you only set which groups it shows, auto-hide and whether the operator can dismiss. Text can bind to a string variable.
- Every raised alarm writes a row to every **alarm table** widget (time, group, severity, message). Live alarms keep a coloured edge. Tables can filter by group and have a bounded row count.
- One page can be marked as **the alarm page**; any widget can open it; Back returns to the previous page. Navigation never writes to the runtime.
- **Dialogs**: the runtime raises a popup, the operator answers, the answer pulses back on its own variable.

### 9.5 Variable Mapping report
One table of every binding, sorted by variable: variable · direction · page · widget · binding type · routing status. **Two widgets writing the same variable are flagged.**

### 9.6 Build
`Build` emits **one self-contained HTML page** (runtime, styles, scene and images inlined) served at `/panels/<name>`. It reconnects on its own and shows a corner badge: green connected, amber connecting, red offline. Many panels can connect to one runtime at once.

---

## 10. Pulso Twin (3D digital twin)

Purpose: prove that the control logic actually runs the machine. It models **product moving through the machine** and the parts that act on it. It is a test rig, not a rendering showcase.

### 10.1 Layout
- Top bar: File, Settings, Routing; tabs **Station Builder** and **Line Builder**.
- Left panel: **Models Library** (with Refresh and Import), **Instances** in the scene, Delete Selected, **Flow Editor…** (spawners and product).
- Viewport: mid-grey floor with soft shadows, orbit / pan / zoom, axis gizmo top-left, `Frame` and `Ortho` buttons, selection outline, transform gizmo.
- Right inspector: properties of the selected part, motion or sensor, including its variable binding.

### 10.2 Station Builder
1. **Import** a `glTF/GLB` model (FBX optional), or build from primitives (box, cylinder, belt, frame).
2. **Mark the moving parts.** Everything else stays static scenery, which keeps the twin fast.
3. **Assign a motion** from a library — a dropdown and a few fields, never a script:
   - *Linear* and *Rotary* (axis, range, speed)
   - *Actuator* (two positions, travel time) and *Gripper* (closes on what is between the jaws)
   - *Transport surface* (conveyor: carries whatever lands on it, speed and direction)
   - *Indicator* (changes colour to show a state) and *Level*
4. **Add sensors**: *presence* (beam or volume) and *distance*. They publish real readings from the physics scene.
5. **Bind** each motion input and each sensor output either to a constant or to a variable path picked from the live list.
6. Save as a station model.

### 10.3 Line Builder
- Place station models into a line (infeed, station, station, reject).
- Add **spawners**: a product definition (shape, size, mass, colour) dropped at a set period.
- Physics (Rapier) does the rest: parts ride conveyors, block sensors, get pushed, pile up, jam.

### 10.4 Connection
The twin is **just another transport** in the routing table. Outputs from the logic move parts; sensors in the scene feed the conditions. The exact machine that will later run on hardware drives the 3D line, unmodified.

### 10.5 Fault injection
From the twin or from a test step: stuck sensor, slow or jammed actuator, product arriving skewed or two at once, spawner stopped. Any fault found can be saved as a test case.

---

## 11. AI layer

Two ways in, both producing ordinary project entities that the user can read and edit:

1. **MCP server** (`packages/runtime/mcp`): exposes project operations as tools — list/create/update entities, construct a machine from a plan, validate, run tests, read coverage gaps, read the event log. This lets Claude Code build and test a machine in a Pulso project directly.
2. **"Describe a machine" panel** in Studio: a text box where the user writes the machine in plain language. The app sends it to an LLM (provider key from the `PULSO_LLM_KEY` environment variable; feature hidden when no key is set) with a strict JSON **blueprint schema** (equipment, states, transitions, conditions, a first set of tests, a first panel page). The result is shown as a **preview diff** — nothing is written until the user accepts.

Rules: generated content always passes through the same validator; generated tests are run immediately and the result shown; anything the model was unsure about is created as a placeholder, not as a confident guess.

---

## 12. Seed project: `box-sealer-demo`

Ships with the repo so every screen has real content on first launch.

**Machine: `Sealer`**
- Equipment: `Conveyor` (Motor), `BoxAtStop` (Sensor), `Pusher` (Cylinder), `SealHead` (Cylinder), `Lamp` (Indicator).
- Globals: `Start`, `Stop`, `Running`, `BoxCount`, `FaultReset`.
- States: `Idle` → `Feed` → `Push` → `Seal` → `Release` → back to `Feed`; `Faulted`.
- Conditions: `StartPressed`, `BoxArrived`, `PusherOut`, `SealDone` (timer), `PusherHome`, `StopPressed`, and alarm `PusherStuck` (command given, no feedback within 2 s, severity Alarm) wired as an **abort** to `Faulted`.
- Interrupt: `Stop` holds the machine; `Start` resumes.

**Second machine: `Infeed`** (spawns boxes on a timer) to demonstrate parallel machines and a queue (`ToSealer`).

**Tests**: happy path, stop-and-resume mid-cycle, pusher stuck → fault, reset from fault, "never in `Seal` while `Pusher` is home" (standing assertion). One transition deliberately left uncovered so the gap list has content.

**Panel**: one page — conveyor, box and cylinder symbols with ranked colours, START and STOP buttons, box counter, alarm banner; plus an alarm page.

**Twin**: station built from primitives — belt, stop gate, pusher, seal head, presence sensor — and a line with one spawner.

---

## 13. Safety statement

Pulso is **not** a safety system and must never be the only thing preventing harm. Emergency stops, guard interlocks and any function protecting people must be implemented with hardwired, certified safety components, independent of this software. This statement is shown in Help → About and in the README. It also applies to any future hardware driver.

---

## 14. Build phases

Each phase ends with: tests green, the acceptance checklist verified in the running app, a short report for the owner, and a commit. **Stop after each phase and wait for confirmation.**

**Phase 0 — Skeleton and shell**
Monorepo, tooling, devcontainer, single port 4600, design tokens, the application shell (4.3) with the three app routes, mode pills, an empty project tree, the bottom message panel.
*Accept*: `npm run dev` opens the shell on the forwarded port; it matches section 4; phone shows the desktop layout scaled.

**Phase 1 — Engine core**
Model types and zod schemas, project store (folder of files, stable IDs), variable space, conditions, states, transitions, timers, scan cycle (5.8), `step(n)`, SimDriver, trace events. Seed project data for the `Sealer` machine.
*Accept*: Vitest suite proves priority order, one-transition-per-tick, entry/steps/exit order, timers, edges, abort, interrupt hold-and-resume, determinism (same run twice = identical trace).

**Phase 2 — Library editors and composer**
Globals, Interfaces, Equipment, Conditions (with variable picker), States (with action menus), Machines composer with bindings, validator.
*Accept*: the seed machine can be rebuilt from an empty project using only the UI.

**Phase 3 — Planner canvas**
Everything in 6.3 including placeholders, Construct Machine, priorities, back-wire routing, abort/interrupt blocks, undo/redo, Save.
*Accept*: draw the two-machine demo from placeholders, construct it, save, and the engine runs it.

**Phase 4 — Runtime and Monitor**
Tick loop with per-machine cycle time, WebSocket streaming, Deploy/Start/Stop/Step, live plan, focused signals, waveform monitor with cursor and forcing, event log viewer, session files, timing figures, Routing (bus manager) editor (6.2).
*Accept*: start the demo, watch states light up, force `BoxAtStop` from the chart, read why a transition did not fire from the log.

**Phase 8 — Pulso Twin**
All of section 10.
*Accept*: with routing switched from Sim to Twin, the unchanged `Sealer` logic runs the 3D station; boxes flow; a jammed pusher raises the alarm.

**Phase 5 — Test Manager**
All of section 8 including regression comparison and coverage with gap list.
*Accept*: seed tests run; a deliberate change produces "Regression"; the gap list names the uncovered transition and the unreachable-state check works.

**Phase 6 — Logic blocks, queues, sub-machines and modes**
Section 5.10 with the Advisor, queue diagram tab, sub-machines, Auto/Manual modes.

**Phase 7 — Pulso Panel**
All of section 9, including Build to a standalone page.
*Accept*: the built demo panel starts and stops the running machine from a second browser tab and shows the `PusherStuck` alarm.

**Phase 9 — AI layer**
Section 11: MCP server first, then the Describe panel.

**Phase 10 — Hardening**
Playwright smoke tests for every screen, docs pages, performance pass (100 states, 50 signals at 10 ms without dropped frames in Monitor), export/import project as zip.
*Note (added after Phase 0)*: bundle the Inter and JetBrains Mono fonts locally instead of loading them from Google Fonts, so the app looks the same offline.

---

## 15. Standing rules (copy into `CLAUDE.md`)

- The owner directs; he does not write code. Explain in plain language, briefly.
- Read `SPEC.md` before any task. If the task conflicts with it, say so before acting.
- One phase at a time. Stop and report at the end of each phase.
- Evidence only. Never say something works without a passing test or a verified check in the running app.
- `packages/core` stays pure: no Node APIs, no browser APIs, no clock, no randomness.
- One variable space. Never duplicate the variable list in the Panel, the Twin or the tests.
- References by ID, never by name.
- All colours and sizes come from `tokens.css`.
- Provide complete files, not fragments, when showing code to the owner.
- Do not add dependencies beyond section 3 without asking.
- Never copy names, logos, text or assets from other products.
- Never present this software as a safety system (section 13).
- Work on a branch per phase; merge only after the acceptance checklist passes and the owner confirms.
- Keep the handoff current: after each finished step, update "Resume here" in `PROGRESS.md`, then commit and push. Another person may continue on another account at any time.

---

## Later ideas

Not scheduled in any phase yet. Each needs the owner's go-ahead before it is built.

- **Per-instance simulation overrides.** Simulated device behaviour lives on the equipment type (for example "Cylinder: 400 ms travel"). Later, let one instance override it (for example "this Pusher takes 600 ms") without creating a new equipment type.
- **"Stop timer on state exit" option.** Timers keep running when the machine changes state (approved in Phase 1). Later, add an optional per-timer setting that stops (or resets) the timer automatically when the state that started it is left.
