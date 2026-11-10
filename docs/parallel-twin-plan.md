# Parallel work: the Twin 3D scene beside Phase 4

Approved by the owner on 2026-11-10 as an exception to "one phase at a time". Two Claude sessions work at once:

- **Session A** (the main session) does **Phase 4** (Runtime, Monitor, Routing editor) in `/workspaces/Pulse` on branch `phase-4-runtime-monitor`.
- **Session B** builds **the 3D scene part of Phase 8** in its own working folder `/workspaces/Pulse-twin` on branch `phase-8-twin-scene`.

Read `CLAUDE.md` and `SPEC.md` (sections 3, 4, 10, 12) first. All standing rules apply.

## 1. Boundaries

- Everything of the scene lives in `packages/studio/src/twin/` (code, unit tests, demo data) and `e2e/twin-*.spec.ts` (browser tests). The entry point `twin/index.tsx` already exists: `twinEditorForTab()` returns the Station Builder and Line Builder content for the tabs `twin:station` and `twin:line`.
- Session B does not edit the Planner, the editors, the shell, the runtime or `packages/core`.
- The scene talks to the outside world only through a small interface defined in the twin folder:

  ```ts
  interface TwinIO {
    read(path: string): Value; // a command written by the logic (logic → scene)
    write(path: string, value: Value): void; // a sensor reading (scene → logic)
  }
  ```

  Paths use the normal address form (SPEC 5.3), e.g. `Sealer.Pusher.ICylinder.Extend`.

- Each moving part and sensor has named **ports**; a **binding table** maps ports to paths (SPEC 10.2 step 5). The first table is the seed Sealer:

  | Direction  | Path                                  |
  | ---------- | ------------------------------------- |
  | command in | `Sealer.Conveyor.IMotor.Run`          |
  | command in | `Sealer.Pusher.ICylinder.Extend`      |
  | command in | `Sealer.SealHead.ICylinder.Extend`    |
  | command in | `Sealer.Lamp.IIndicator.On`           |
  | sensor out | `Sealer.Conveyor.IMotor.Running`      |
  | sensor out | `Sealer.BoxAtStop.ISensor.Present`    |
  | sensor out | `Sealer.Pusher.ICylinder.Extended`    |
  | sensor out | `Sealer.Pusher.ICylinder.Retracted`   |
  | sensor out | `Sealer.SealHead.ICylinder.Extended`  |
  | sensor out | `Sealer.SealHead.ICylinder.Retracted` |

  The owner's box machine (`docs/box-closing-machine-design.md`) later gets its own table; the scene code does not change for it.

## 2. What Session B builds now (no runtime needed)

- Shapes of our own, from primitives: belt and frame, stop, pusher, seal head, presence sensor (a beam), lamp.
- Rapier physics: boxes ride the belt; pusher and seal head are solid moving parts with a travel time; the sensor reports a box inside its beam.
- A box spawner (a box of a set size every N seconds).
- Orbit, pan, zoom, `Frame` and `Ortho`; touch works on a phone (one finger orbits, two fingers pan and zoom).
- A hand panel: a switch per command, a lamp per sensor, driving the scene through a local in-memory `TwinIO`.
- Tests: binding table and motion timing (Vitest, inside the twin folder); the scene loads, a box stops at the sensor, the pusher moves it (browser test).
- New libraries (all listed in SPEC 3): `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`. Only Session B adds libraries.
- Colours and sizes: only between the "Twin scene" markers in `tokens.css`. 3D materials read their colours from those tokens.
- **Labels:** several labels in SPEC 10.1 match the reference screenshot of another product word for word (`docs/reference/`). Do not copy them; ask the owner before naming the builder's panels and buttons.

## 3. What waits for Phase 4

- The live `TwinIO` over the runtime's WebSocket, and the runtime's TwinDriver.
- Choosing Twin as the transport in the Routing editor (added to Phase 4).
- Saving stations and lines as project files (`twin/stations`, `twin/lines`): their schemas belong to `packages/core`.
- The full Station Builder and Line Builder (SPEC 10.2, 10.3) around the scene.

## 4. Merge order and conflict rules

1. The prep commit on `main` (done): the `twin/index.tsx` hook, the reserved token section, the shared test lock.
2. Both branches start from `main` after the prep commit.
3. Phase 4 merges first, after its acceptance and the owner's confirmation.
4. Session B then updates its branch from `main`, adds the live connection, and merges at the end of Phase 8, after Phase 8's acceptance and the owner's confirmation.

| File                                                          | Who may edit it                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/studio/src/twin/**`, `e2e/twin-*.spec.ts`           | Session B only                                                                                                       |
| `package.json`, `package-lock.json`                           | Session B (adds the 3D libraries). On merge, rebuild the lock file with `npm install` instead of merging it by hand. |
| `packages/core/**` (message types, schemas)                   | Session A only                                                                                                       |
| `tokens.css`                                                  | Session B only between the Twin markers; Session A elsewhere                                                         |
| `editors/index.tsx`, `state/store.ts`, `playwright.config.ts` | Neither                                                                                                              |
| `PROGRESS.md`                                                 | Session A. Session B keeps its notes in `packages/studio/src/twin/NOTES.md` until merge.                             |

## 5. Working rules for Session B

- Work only in `/workspaces/Pulse-twin`. Never switch branches in `/workspaces/Pulse` and never use port 4600 (the owner's dev server).
- Dev server: `PORT=4620 npm run dev`. Browser tests: `PULSO_E2E_PORT=4621 npm run test:ui`.
- **The full browser suite runs in one session at a time** (the Codespace has 2 CPUs). `npm run test:ui` waits for the other session's run to finish (a shared lock). Run browser tests only through `npm run test:ui`.
- Commit after each working step, push the branch, and stop and report to the owner at the end of the scene work. Do not merge.
