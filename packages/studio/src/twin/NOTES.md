# Twin scene notes (session B)

Kept here, not in PROGRESS.md, until the scene branch merges (docs/parallel-twin-plan.md).

## What exists

- `motion.ts`: actuator travel and feedback, belt speed (pure, tested).
- `sensing.ts`: beam, on-belt, under-seal-head rules (pure, tested).
- `layout.ts`: every position and size in the scene, in metres.
- `bindings.ts`: ports and two binding tables (the box closing machine, the seed Sealer).
- `io.ts`: `TwinIO` and the local in-memory version used before the runtime exists.
- `Scene.tsx`: the 3D scene (three, react-three-fiber, Rapier). Colours come from the `--tw-*` tokens.
- `HandPanel.tsx`, `TwinView.tsx`, `twin.css`: hand controls and the tab content.
- Browser tests: `e2e/twin-scene.spec.ts`.

## Run it

`PORT=4620 npm run dev`, then open `/twin`. Browser tests: `PULSO_E2E_PORT=4621 npm run test:ui`.

## Waiting for Phase 4

- The live `TwinIO` over the runtime's WebSocket and the runtime's TwinDriver.
- Choosing Twin as the transport (Routing editor).
- Saving stations and lines as project files.

## Owner decisions needed before the builder screens

- Button names "Reset view" and "Flat view" are our own (the reference product uses "Frame" and "Ortho"; SPEC 10.1 copies them).
- The shell's tree shows "Models Library" and "Instances" (SPEC 10.1 / treeData.ts). They match the reference product word for word and need renaming.

## Design finding (box closing machine)

After a carton is sealed it is still standing in the sensor beam. When the machine returns to FEED_BOX, `BoxAtPosition` (state is FEED_BOX and BoxSensor.Detected) is true at once for the same carton, so the logic would clamp the sealed carton again without waiting for a new one. The design needs a "beam clear" step or condition, or a way to eject the carton.
